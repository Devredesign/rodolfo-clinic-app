-- A voided, unreconciled payment is preserved for audit but must not keep the
-- procedure locked forever. Only active/non-voided or reconciled payments are
-- blocking dependencies. When a voided payment is the only financial link,
-- detach its payment_procedures row and preserve the payment record itself.

create or replace function public.admin_update_clean_procedure(
  p_organization_id uuid,
  p_procedure_id uuid,
  p_client_id uuid,
  p_service_id uuid,
  p_status text,
  p_event_at timestamptz,
  p_followup_requested boolean,
  p_notes text,
  p_products jsonb default '[]'::jsonb
) returns public.procedures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proc public.procedures%rowtype;
  v_service public.services%rowtype;
  v_org public.organizations%rowtype;
  v_result public.procedures%rowtype;
  v_bad_count integer;
begin
  if not private.is_org_admin(p_organization_id) then
    raise exception 'Admin access required';
  end if;

  select * into v_proc
  from public.procedures
  where id = p_procedure_id and organization_id = p_organization_id
  for update;

  if not found then raise exception 'Procedure not found'; end if;

  if exists(
       select 1
       from public.payment_procedures pp
       join public.payments pay on pay.id = pp.payment_id
       where pp.organization_id = p_organization_id
         and pp.procedure_id = p_procedure_id
         and (pay.status <> 'voided' or pay.reconciliation_status <> 'pending')
     )
     or exists(select 1 from public.reconciliation_payment_items where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.client_credit_transactions where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.procedure_products where organization_id=p_organization_id and procedure_id=p_procedure_id and inventory_outcome is not null)
  then
    raise exception 'Procedure has linked financial or inventory movements';
  end if;

  -- A voided/unreconciled payment stays in payments for audit, but the stale
  -- procedure link is removed so editing does not rewrite what that old voided
  -- payment was originally attached to.
  delete from public.payment_procedures pp
  using public.payments pay
  where pp.payment_id = pay.id
    and pp.organization_id = p_organization_id
    and pp.procedure_id = p_procedure_id
    and pay.status = 'voided'
    and pay.reconciliation_status = 'pending';

  if p_status not in ('pending','performed') then raise exception 'Invalid procedure status'; end if;
  if p_event_at is null then raise exception 'Procedure date is required'; end if;

  select * into v_service from public.services where id=p_service_id and organization_id=p_organization_id;
  if not found then raise exception 'Service not found'; end if;
  if not exists(select 1 from public.clients where id=p_client_id and organization_id=p_organization_id) then raise exception 'Client not found'; end if;
  select * into v_org from public.organizations where id=p_organization_id;

  select count(*) into v_bad_count
  from jsonb_to_recordset(coalesce(p_products,'[]'::jsonb)) as x(product_id uuid, quantity numeric)
  where x.product_id is null or x.quantity is null or x.quantity <= 0
     or not exists(select 1 from public.products pr where pr.id=x.product_id and pr.organization_id=p_organization_id);
  if v_bad_count > 0 then raise exception 'Invalid procedure products'; end if;

  select count(*) - count(distinct product_id) into v_bad_count
  from jsonb_to_recordset(coalesce(p_products,'[]'::jsonb)) as x(product_id uuid, quantity numeric);
  if v_bad_count > 0 then raise exception 'Duplicate procedure products'; end if;

  update public.procedures
  set client_id=p_client_id,
      service_id=p_service_id,
      scheduled_at=case when p_status='pending' then p_event_at else null end,
      performed_at=case when p_status='performed' then p_event_at else null end,
      status=p_status,
      followup_requested=(p_status='performed' and coalesce(p_followup_requested,false)),
      notes=nullif(trim(coalesce(p_notes,'')),''),
      service_name_snapshot=v_service.name,
      service_price_usd_snapshot=v_service.price_usd,
      fx_crc_per_usd_snapshot=v_org.default_fx_crc_per_usd,
      quoted_currency='USD',
      quoted_amount=v_service.price_usd
  where id=p_procedure_id and organization_id=p_organization_id
  returning * into v_result;

  delete from public.procedure_products
  where organization_id=p_organization_id and procedure_id=p_procedure_id;

  insert into public.procedure_products(
    organization_id, procedure_id, product_id, standard_quantity_snapshot, product_cost_usd_snapshot
  )
  select p_organization_id, p_procedure_id, x.product_id, x.quantity, coalesce(pr.current_cost_usd,0)
  from jsonb_to_recordset(coalesce(p_products,'[]'::jsonb)) as x(product_id uuid, quantity numeric)
  join public.products pr on pr.id=x.product_id and pr.organization_id=p_organization_id;

  return v_result;
end;
$$;

revoke all on function public.admin_update_clean_procedure(uuid,uuid,uuid,uuid,text,timestamptz,boolean,text,jsonb) from public, anon;
grant execute on function public.admin_update_clean_procedure(uuid,uuid,uuid,uuid,text,timestamptz,boolean,text,jsonb) to authenticated;

create or replace function public.admin_delete_clean_procedure(
  p_organization_id uuid,
  p_procedure_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.is_org_admin(p_organization_id) then
    raise exception 'Admin access required';
  end if;

  if not exists(select 1 from public.procedures where id=p_procedure_id and organization_id=p_organization_id) then
    raise exception 'Procedure not found';
  end if;

  if exists(
       select 1
       from public.payment_procedures pp
       join public.payments pay on pay.id = pp.payment_id
       where pp.organization_id = p_organization_id
         and pp.procedure_id = p_procedure_id
         and (pay.status <> 'voided' or pay.reconciliation_status <> 'pending')
     )
     or exists(select 1 from public.reconciliation_payment_items where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.client_credit_transactions where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.procedure_products where organization_id=p_organization_id and procedure_id=p_procedure_id and inventory_outcome is not null)
  then
    raise exception 'Procedure has linked financial or inventory movements';
  end if;

  -- Preserve voided payments for audit, but remove their stale procedure link.
  delete from public.payment_procedures pp
  using public.payments pay
  where pp.payment_id = pay.id
    and pp.organization_id = p_organization_id
    and pp.procedure_id = p_procedure_id
    and pay.status = 'voided'
    and pay.reconciliation_status = 'pending';

  delete from public.tasks
  where organization_id=p_organization_id
    and reference_id=p_procedure_id
    and reference_type in ('procedure_collection','procedure_followup','procedure_remarketing');

  delete from public.procedures
  where id=p_procedure_id and organization_id=p_organization_id;
end;
$$;

revoke all on function public.admin_delete_clean_procedure(uuid,uuid) from public, anon;
grant execute on function public.admin_delete_clean_procedure(uuid,uuid) to authenticated;

-- Future voids should also release the procedure immediately. The payment row
-- remains in the audit trail; only the link table row is removed.
create or replace function public.void_procedure_payment(
  p_organization_id uuid,
  p_payment_id uuid,
  p_void_reason text
) returns public.payments
language plpgsql
set search_path = public
as $$
declare
  v_payment public.payments;
  v_procedure_id uuid;
begin
  select * into v_payment
  from public.payments
  where id=p_payment_id and organization_id=p_organization_id
  for update;

  if v_payment.id is null then raise exception 'Payment not found or inaccessible'; end if;
  if v_payment.status <> 'paid' then raise exception 'Only active paid payments can be voided'; end if;
  if v_payment.reconciliation_status <> 'pending' then raise exception 'Reconciled payments cannot be voided'; end if;
  if nullif(trim(p_void_reason),'') is null then raise exception 'Void reason is required'; end if;

  select procedure_id into v_procedure_id
  from public.payment_procedures
  where organization_id=p_organization_id and payment_id=p_payment_id
  limit 1;

  update public.payments
  set status='voided', void_reason=trim(p_void_reason), updated_at=now()
  where id=p_payment_id and organization_id=p_organization_id
  returning * into v_payment;

  if v_procedure_id is not null then
    perform public.recalculate_procedure_payment_status(p_organization_id, v_procedure_id);

    delete from public.payment_procedures
    where organization_id=p_organization_id
      and payment_id=p_payment_id
      and procedure_id=v_procedure_id;
  end if;

  return v_payment;
end;
$$;

revoke all on function public.void_procedure_payment(uuid,uuid,text) from public, anon;
grant execute on function public.void_procedure_payment(uuid,uuid,text) to authenticated;

-- Backfill: release procedures currently locked only by old voided/unreconciled
-- payment links. This does not delete any payment record.
delete from public.payment_procedures pp
using public.payments pay
where pp.payment_id = pay.id
  and pay.status = 'voided'
  and pay.reconciliation_status = 'pending';
