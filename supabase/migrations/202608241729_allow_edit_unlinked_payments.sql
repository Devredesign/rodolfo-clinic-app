create or replace function public.update_procedure_payment(
  p_organization_id uuid,
  p_payment_id uuid,
  p_payment_date date,
  p_currency public.currency_code,
  p_list_amount numeric,
  p_discount_amount numeric,
  p_final_amount numeric,
  p_fx_crc_per_usd_snapshot numeric,
  p_method_id uuid,
  p_receiver text,
  p_processor_fee_rate_snapshot numeric,
  p_processor_fee_amount numeric,
  p_external_reference text,
  p_notes text
)
returns public.payments
language plpgsql
set search_path = public
as $$
declare
  v_payment public.payments;
  v_procedure_id uuid;
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
    and organization_id = p_organization_id
  for update;

  if v_payment.id is null then
    raise exception 'Payment not found or inaccessible';
  end if;
  if v_payment.status <> 'paid' then
    raise exception 'Only active paid payments can be edited';
  end if;
  if v_payment.reconciliation_status <> 'pending' then
    raise exception 'Reconciled payments cannot be edited';
  end if;
  if p_list_amount < 0 or p_discount_amount < 0 or p_final_amount < 0 then
    raise exception 'Payment amounts cannot be negative';
  end if;
  if abs((p_list_amount - p_discount_amount) - p_final_amount) > 0.01 then
    raise exception 'Final amount must equal list amount minus discount';
  end if;
  if p_currency = 'CRC' and (p_fx_crc_per_usd_snapshot is null or p_fx_crc_per_usd_snapshot <= 0) then
    raise exception 'A valid FX rate is required for CRC payments';
  end if;

  select procedure_id into v_procedure_id
  from public.payment_procedures
  where organization_id = p_organization_id
    and payment_id = p_payment_id
  limit 1;

  update public.payments set
    payment_date = p_payment_date,
    currency = p_currency,
    list_amount = p_list_amount,
    discount_amount = p_discount_amount,
    final_amount = p_final_amount,
    fx_crc_per_usd_snapshot = p_fx_crc_per_usd_snapshot,
    method_id = p_method_id,
    receiver = p_receiver,
    processor_fee_rate_snapshot = p_processor_fee_rate_snapshot,
    processor_fee_amount = p_processor_fee_amount,
    external_reference = nullif(trim(p_external_reference), ''),
    notes = nullif(trim(p_notes), ''),
    updated_at = now()
  where id = p_payment_id
    and organization_id = p_organization_id
  returning * into v_payment;

  if v_procedure_id is not null then
    update public.payment_procedures
    set allocated_amount = p_final_amount
    where organization_id = p_organization_id
      and payment_id = p_payment_id
      and procedure_id = v_procedure_id;

    perform public.recalculate_procedure_payment_status(p_organization_id, v_procedure_id);
  end if;

  return v_payment;
end;
$$;
