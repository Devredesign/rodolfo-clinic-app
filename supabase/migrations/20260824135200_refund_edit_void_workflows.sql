alter table public.payment_refunds
  add column if not exists status text not null default 'active',
  add column if not exists void_reason text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.recalculate_payment_after_refunds(p_organization_id uuid, p_payment_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_payment public.payments;
  v_refunded numeric;
  v_procedure_id uuid;
  v_nominal_due numeric;
  v_total_net_paid_usd numeric;
  v_new_status public.payment_status;
begin
  select * into v_payment
  from public.payments
  where id=p_payment_id and organization_id=p_organization_id;
  if v_payment.id is null then return; end if;

  select coalesce(sum(amount),0) into v_refunded
  from public.payment_refunds
  where payment_id=p_payment_id and organization_id=p_organization_id and status='active';

  if v_payment.status <> 'voided' then
    update public.payments
    set status = case when v_refunded >= v_payment.final_amount - 0.01 then 'refunded'::public.payment_status else 'paid'::public.payment_status end,
        updated_at=now()
    where id=p_payment_id;
  end if;

  select procedure_id into v_procedure_id
  from public.payment_procedures
  where payment_id=p_payment_id and organization_id=p_organization_id
  limit 1;

  if v_procedure_id is null then return; end if;

  select coalesce(quoted_amount, service_price_usd_snapshot) into v_nominal_due
  from public.procedures
  where id=v_procedure_id and organization_id=p_organization_id;

  select coalesce(sum(
    case
      when pay.currency='USD' then greatest(pay.list_amount - coalesce(r.refunded,0),0)
      when pay.currency='CRC' and pay.fx_crc_per_usd_snapshot > 0 then greatest(pay.list_amount - coalesce(r.refunded,0),0) / pay.fx_crc_per_usd_snapshot
      else 0
    end
  ),0)
  into v_total_net_paid_usd
  from public.payment_procedures pp
  join public.payments pay on pay.id=pp.payment_id
  left join (
    select payment_id, sum(amount) refunded
    from public.payment_refunds
    where organization_id=p_organization_id and status='active'
    group by payment_id
  ) r on r.payment_id=pay.id
  where pp.organization_id=p_organization_id
    and pp.procedure_id=v_procedure_id
    and pay.status in ('paid','refunded');

  if v_total_net_paid_usd >= v_nominal_due - 0.01 then v_new_status:='paid';
  elsif v_total_net_paid_usd > 0 then v_new_status:='partial';
  else v_new_status:='pending'; end if;

  update public.procedures set payment_status=v_new_status, updated_at=now()
  where id=v_procedure_id and organization_id=p_organization_id;
end;
$$;

create or replace function public.update_payment_refund(
  p_organization_id uuid,
  p_refund_id uuid,
  p_refund_date date,
  p_amount numeric,
  p_reason text,
  p_external_reference text
)
returns public.payment_refunds
language plpgsql
set search_path=public
as $$
declare
  v_refund public.payment_refunds;
  v_payment public.payments;
  v_other_refunds numeric;
begin
  if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;

  select * into v_refund from public.payment_refunds
  where id=p_refund_id and organization_id=p_organization_id for update;
  if v_refund.id is null then raise exception 'Refund not found'; end if;
  if v_refund.status <> 'active' then raise exception 'Voided refunds cannot be edited'; end if;

  select * into v_payment from public.payments where id=v_refund.payment_id and organization_id=p_organization_id;
  if v_payment.reconciliation_status <> 'pending' then raise exception 'Reconciled payments cannot change refunds'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Refund amount must be greater than zero'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Refund reason is required'; end if;

  select coalesce(sum(amount),0) into v_other_refunds
  from public.payment_refunds
  where payment_id=v_refund.payment_id and organization_id=p_organization_id and status='active' and id<>p_refund_id;
  if v_other_refunds + p_amount > v_payment.final_amount + 0.01 then raise exception 'Refund exceeds paid amount'; end if;

  update public.payment_refunds
  set refund_date=p_refund_date, amount=p_amount, reason=trim(p_reason), external_reference=nullif(trim(p_external_reference),''), updated_at=now()
  where id=p_refund_id
  returning * into v_refund;

  perform public.recalculate_payment_after_refunds(p_organization_id, v_refund.payment_id);
  return v_refund;
end;
$$;

create or replace function public.void_payment_refund(
  p_organization_id uuid,
  p_refund_id uuid,
  p_void_reason text
)
returns public.payment_refunds
language plpgsql
set search_path=public
as $$
declare
  v_refund public.payment_refunds;
  v_payment public.payments;
begin
  if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
  if nullif(trim(p_void_reason),'') is null then raise exception 'Void reason is required'; end if;

  select * into v_refund from public.payment_refunds
  where id=p_refund_id and organization_id=p_organization_id for update;
  if v_refund.id is null then raise exception 'Refund not found'; end if;
  if v_refund.status <> 'active' then raise exception 'Refund already voided'; end if;

  select * into v_payment from public.payments where id=v_refund.payment_id and organization_id=p_organization_id;
  if v_payment.reconciliation_status <> 'pending' then raise exception 'Reconciled payments cannot change refunds'; end if;

  update public.payment_refunds
  set status='voided', void_reason=trim(p_void_reason), updated_at=now()
  where id=p_refund_id
  returning * into v_refund;

  perform public.recalculate_payment_after_refunds(p_organization_id, v_refund.payment_id);
  return v_refund;
end;
$$;

create or replace function public.register_payment_refund(p_organization_id uuid, p_payment_id uuid, p_refund_date date, p_amount numeric, p_reason text, p_external_reference text, p_created_by uuid)
returns public.payment_refunds
language plpgsql
set search_path=public
as $$
declare
  v_payment public.payments;
  v_refund public.payment_refunds;
  v_refunded numeric;
begin
  if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
  select * into v_payment from public.payments where id=p_payment_id and organization_id=p_organization_id for update;
  if v_payment.id is null then raise exception 'Payment not found'; end if;
  if v_payment.status not in ('paid','refunded') then raise exception 'Only paid payments can be refunded'; end if;
  if v_payment.reconciliation_status <> 'pending' then raise exception 'Reconciled payments cannot be refunded in this flow'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Refund amount must be greater than zero'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Refund reason is required'; end if;

  select coalesce(sum(amount),0) into v_refunded from public.payment_refunds
  where payment_id=p_payment_id and organization_id=p_organization_id and status='active';
  if v_refunded + p_amount > v_payment.final_amount + 0.01 then raise exception 'Refund exceeds paid amount'; end if;

  insert into public.payment_refunds(organization_id,payment_id,refund_date,amount,reason,external_reference,created_by,status)
  values(p_organization_id,p_payment_id,p_refund_date,p_amount,trim(p_reason),nullif(trim(p_external_reference),''),p_created_by,'active')
  returning * into v_refund;

  perform public.recalculate_payment_after_refunds(p_organization_id, p_payment_id);
  return v_refund;
end;
$$;
