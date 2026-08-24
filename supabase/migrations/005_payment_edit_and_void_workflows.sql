-- Payment correction workflows.
-- Active, unreconciled payments may be edited or voided.
-- Every change recalculates the linked procedure payment status.

create or replace function public.recalculate_procedure_payment_status(p_organization_id uuid, p_procedure_id uuid)
returns public.payment_status
language plpgsql
set search_path = public
as $$
declare
  v_procedure public.procedures;
  v_nominal_due numeric;
  v_total_nominal_paid_usd numeric;
  v_new_status public.payment_status;
begin
  select * into v_procedure
  from public.procedures
  where id = p_procedure_id and organization_id = p_organization_id
  for update;
  if v_procedure.id is null then raise exception 'Procedure not found or inaccessible'; end if;
  v_nominal_due := coalesce(v_procedure.quoted_amount, v_procedure.service_price_usd_snapshot);

  select coalesce(sum(case
    when pay.currency = 'USD' then pay.list_amount
    when pay.currency = 'CRC' and pay.fx_crc_per_usd_snapshot > 0 then pay.list_amount / pay.fx_crc_per_usd_snapshot
    else 0 end), 0)
  into v_total_nominal_paid_usd
  from public.payment_procedures pp
  join public.payments pay on pay.id = pp.payment_id
  where pp.organization_id = p_organization_id
    and pp.procedure_id = p_procedure_id
    and pay.status = 'paid';

  if v_total_nominal_paid_usd >= (v_nominal_due - 0.01) then v_new_status := 'paid';
  elsif v_total_nominal_paid_usd > 0 then v_new_status := 'partial';
  else v_new_status := 'pending';
  end if;

  update public.procedures set payment_status = v_new_status
  where id = p_procedure_id and organization_id = p_organization_id;
  return v_new_status;
end;
$$;

revoke all on function public.recalculate_procedure_payment_status(uuid,uuid) from public, anon, authenticated;

create or replace function public.update_procedure_payment(
  p_organization_id uuid, p_payment_id uuid, p_payment_date date,
  p_currency public.currency_code, p_list_amount numeric, p_discount_amount numeric,
  p_final_amount numeric, p_fx_crc_per_usd_snapshot numeric, p_method_id uuid,
  p_receiver text, p_processor_fee_rate_snapshot numeric, p_processor_fee_amount numeric,
  p_external_reference text, p_notes text
)
returns public.payments
language plpgsql
set search_path = public
as $$
declare
  v_payment public.payments;
  v_procedure_id uuid;
begin
  select * into v_payment from public.payments
  where id = p_payment_id and organization_id = p_organization_id for update;
  if v_payment.id is null then raise exception 'Payment not found or inaccessible'; end if;
  if v_payment.status <> 'paid' then raise exception 'Only active paid payments can be edited'; end if;
  if v_payment.reconciliation_status <> 'pending' then raise exception 'Reconciled payments cannot be edited'; end if;
  if p_list_amount < 0 or p_discount_amount < 0 or p_final_amount < 0 then raise exception 'Payment amounts cannot be negative'; end if;
  if abs((p_list_amount - p_discount_amount) - p_final_amount) > 0.01 then raise exception 'Final amount must equal list amount minus discount'; end if;
  if p_currency = 'CRC' and (p_fx_crc_per_usd_snapshot is null or p_fx_crc_per_usd_snapshot <= 0) then raise exception 'A valid FX rate is required for CRC payments'; end if;

  select procedure_id into v_procedure_id from public.payment_procedures
  where organization_id = p_organization_id and payment_id = p_payment_id limit 1;
  if v_procedure_id is null then raise exception 'Linked procedure not found'; end if;

  update public.payments set payment_date=p_payment_date, currency=p_currency,
    list_amount=p_list_amount, discount_amount=p_discount_amount, final_amount=p_final_amount,
    fx_crc_per_usd_snapshot=p_fx_crc_per_usd_snapshot, method_id=p_method_id,
    receiver=p_receiver, processor_fee_rate_snapshot=p_processor_fee_rate_snapshot,
    processor_fee_amount=p_processor_fee_amount,
    external_reference=nullif(trim(p_external_reference),''), notes=nullif(trim(p_notes),''), updated_at=now()
  where id=p_payment_id and organization_id=p_organization_id returning * into v_payment;

  update public.payment_procedures set allocated_amount=p_final_amount
  where organization_id=p_organization_id and payment_id=p_payment_id and procedure_id=v_procedure_id;
  perform public.recalculate_procedure_payment_status(p_organization_id, v_procedure_id);
  return v_payment;
end;
$$;

grant execute on function public.update_procedure_payment(uuid,uuid,date,public.currency_code,numeric,numeric,numeric,numeric,uuid,text,numeric,numeric,text,text) to authenticated;

create or replace function public.void_procedure_payment(p_organization_id uuid, p_payment_id uuid, p_void_reason text)
returns public.payments
language plpgsql
set search_path = public
as $$
declare
  v_payment public.payments;
  v_procedure_id uuid;
begin
  select * into v_payment from public.payments
  where id=p_payment_id and organization_id=p_organization_id for update;
  if v_payment.id is null then raise exception 'Payment not found or inaccessible'; end if;
  if v_payment.status <> 'paid' then raise exception 'Only active paid payments can be voided'; end if;
  if v_payment.reconciliation_status <> 'pending' then raise exception 'Reconciled payments cannot be voided'; end if;
  if nullif(trim(p_void_reason),'') is null then raise exception 'Void reason is required'; end if;

  select procedure_id into v_procedure_id from public.payment_procedures
  where organization_id=p_organization_id and payment_id=p_payment_id limit 1;

  update public.payments set status='voided', void_reason=trim(p_void_reason), updated_at=now()
  where id=p_payment_id and organization_id=p_organization_id returning * into v_payment;
  if v_procedure_id is not null then perform public.recalculate_procedure_payment_status(p_organization_id, v_procedure_id); end if;
  return v_payment;
end;
$$;

grant execute on function public.void_procedure_payment(uuid,uuid,text) to authenticated;
