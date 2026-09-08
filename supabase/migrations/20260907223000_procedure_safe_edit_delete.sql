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

  if exists(select 1 from public.payment_procedures where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.reconciliation_payment_items where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.client_credit_transactions where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.procedure_products where organization_id=p_organization_id and procedure_id=p_procedure_id and inventory_outcome is not null)
  then
    raise exception 'Procedure has linked financial or inventory movements';
  end if;

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

  if exists(select 1 from public.payment_procedures where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.reconciliation_payment_items where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.client_credit_transactions where organization_id=p_organization_id and procedure_id=p_procedure_id)
     or exists(select 1 from public.procedure_products where organization_id=p_organization_id and procedure_id=p_procedure_id and inventory_outcome is not null)
  then
    raise exception 'Procedure has linked financial or inventory movements';
  end if;

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
