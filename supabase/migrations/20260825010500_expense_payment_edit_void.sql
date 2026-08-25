create or replace function public.recalculate_expense_status(p_organization_id uuid, p_expense_id uuid)
returns void
language plpgsql
set search_path=public
as $$
declare
  v_amount numeric;
  v_paid numeric;
begin
  select amount into v_amount from public.expenses where id=p_expense_id and organization_id=p_organization_id;
  if v_amount is null then return; end if;
  select coalesce(sum(amount),0) into v_paid from public.expense_payments
  where expense_id=p_expense_id and organization_id=p_organization_id and status='paid';
  update public.expenses
  set status=case when v_paid >= v_amount - 0.01 then 'paid'::payable_status else 'pending'::payable_status end,
      updated_at=now()
  where id=p_expense_id and organization_id=p_organization_id and status <> 'voided';
end;
$$;

create or replace function public.void_expense_payment(
  p_organization_id uuid,
  p_payment_id uuid,
  p_void_reason text
)
returns public.expense_payments
language plpgsql
set search_path=public
as $$
declare
  v_payment public.expense_payments;
begin
  if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
  if nullif(trim(p_void_reason),'') is null then raise exception 'Void reason is required'; end if;

  select * into v_payment from public.expense_payments
  where id=p_payment_id and organization_id=p_organization_id for update;
  if v_payment.id is null then raise exception 'Expense payment not found'; end if;
  if v_payment.status='voided' then raise exception 'Expense payment already voided'; end if;

  update public.expense_payments
  set status='voided', void_reason=trim(p_void_reason), voided_at=now(), updated_at=now()
  where id=p_payment_id and organization_id=p_organization_id
  returning * into v_payment;

  perform public.recalculate_expense_status(p_organization_id,v_payment.expense_id);
  return v_payment;
end;
$$;

create or replace function public.update_expense_payment(
  p_organization_id uuid,
  p_payment_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_external_reference text,
  p_notes text
)
returns public.expense_payments
language plpgsql
set search_path=public
as $$
declare
  v_payment public.expense_payments;
  v_expense_amount numeric;
  v_other_paid numeric;
begin
  if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;

  select * into v_payment from public.expense_payments
  where id=p_payment_id and organization_id=p_organization_id for update;
  if v_payment.id is null then raise exception 'Expense payment not found'; end if;
  if v_payment.status <> 'paid' then raise exception 'Only active payments can be edited'; end if;

  select amount into v_expense_amount from public.expenses
  where id=v_payment.expense_id and organization_id=p_organization_id;

  select coalesce(sum(amount),0) into v_other_paid from public.expense_payments
  where expense_id=v_payment.expense_id and organization_id=p_organization_id and status='paid' and id<>p_payment_id;

  if v_other_paid + p_amount > v_expense_amount + 0.01 then raise exception 'Payment exceeds expense balance'; end if;

  update public.expense_payments
  set payment_date=p_payment_date,
      amount=p_amount,
      external_reference=nullif(trim(p_external_reference),''),
      notes=nullif(trim(p_notes),''),
      updated_at=now()
  where id=p_payment_id and organization_id=p_organization_id
  returning * into v_payment;

  perform public.recalculate_expense_status(p_organization_id,v_payment.expense_id);
  return v_payment;
end;
$$;