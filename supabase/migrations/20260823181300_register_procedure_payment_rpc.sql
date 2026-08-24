create or replace function public.register_procedure_payment(
  p_organization_id uuid,
  p_procedure_id uuid,
  p_payment_date date,
  p_currency public.currency_code,
  p_list_amount numeric,
  p_discount_amount numeric,
  p_final_amount numeric,
  p_fx_crc_per_usd_snapshot numeric,
  p_method_id uuid,
  p_receiver text,
  p_rodolfo_share_rate_snapshot numeric,
  p_clinic_share_rate_snapshot numeric,
  p_vat_rate_snapshot numeric,
  p_processor_fee_rate_snapshot numeric,
  p_processor_fee_amount numeric,
  p_external_reference text,
  p_notes text,
  p_created_by uuid
) returns public.payments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.payments;
  v_procedure public.procedures;
  v_nominal_due numeric;
  v_total_nominal_paid_usd numeric;
  v_new_status public.payment_status;
begin
  select * into v_procedure
  from public.procedures
  where id = p_procedure_id
    and organization_id = p_organization_id
  for update;

  if v_procedure.id is null then
    raise exception 'Procedure not found or inaccessible';
  end if;

  if p_final_amount < 0 or p_list_amount < 0 or p_discount_amount < 0 then
    raise exception 'Payment amounts cannot be negative';
  end if;

  if abs((p_list_amount - p_discount_amount) - p_final_amount) > 0.01 then
    raise exception 'Final amount must equal list amount minus discount';
  end if;

  if p_currency = 'CRC' and (p_fx_crc_per_usd_snapshot is null or p_fx_crc_per_usd_snapshot <= 0) then
    raise exception 'A valid FX rate is required for CRC payments';
  end if;

  insert into public.payments (
    organization_id, client_id, payment_date, currency,
    list_amount, discount_amount, final_amount, fx_crc_per_usd_snapshot,
    method_id, receiver,
    rodolfo_share_rate_snapshot, clinic_share_rate_snapshot, vat_rate_snapshot,
    processor_fee_rate_snapshot, processor_fee_amount,
    status, reconciliation_status, external_reference, notes, created_by
  ) values (
    p_organization_id, v_procedure.client_id, p_payment_date, p_currency,
    p_list_amount, p_discount_amount, p_final_amount, p_fx_crc_per_usd_snapshot,
    p_method_id, p_receiver,
    p_rodolfo_share_rate_snapshot, p_clinic_share_rate_snapshot, p_vat_rate_snapshot,
    p_processor_fee_rate_snapshot, p_processor_fee_amount,
    'paid', 'pending', nullif(trim(p_external_reference), ''), nullif(trim(p_notes), ''), p_created_by
  ) returning * into v_payment;

  insert into public.payment_procedures (
    organization_id, payment_id, procedure_id, allocated_amount
  ) values (
    p_organization_id, v_payment.id, p_procedure_id, p_final_amount
  );

  v_nominal_due := coalesce(v_procedure.quoted_amount, v_procedure.service_price_usd_snapshot);

  select coalesce(sum(
    case
      when pay.currency = 'USD' then pay.list_amount
      when pay.currency = 'CRC' and pay.fx_crc_per_usd_snapshot > 0 then pay.list_amount / pay.fx_crc_per_usd_snapshot
      else 0
    end
  ), 0)
  into v_total_nominal_paid_usd
  from public.payment_procedures pp
  join public.payments pay on pay.id = pp.payment_id
  where pp.organization_id = p_organization_id
    and pp.procedure_id = p_procedure_id
    and pay.status = 'paid';

  if v_total_nominal_paid_usd >= (v_nominal_due - 0.01) then
    v_new_status := 'paid';
  elsif v_total_nominal_paid_usd > 0 then
    v_new_status := 'partial';
  else
    v_new_status := 'pending';
  end if;

  update public.procedures
  set payment_status = v_new_status
  where id = p_procedure_id
    and organization_id = p_organization_id;

  return v_payment;
end;
$$;

revoke all on function public.register_procedure_payment(uuid,uuid,date,public.currency_code,numeric,numeric,numeric,numeric,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) from public, anon;
grant execute on function public.register_procedure_payment(uuid,uuid,date,public.currency_code,numeric,numeric,numeric,numeric,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) to authenticated;
