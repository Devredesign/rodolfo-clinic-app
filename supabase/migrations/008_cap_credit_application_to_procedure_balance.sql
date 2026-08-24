create or replace function public.apply_client_credit_to_procedure(
  p_organization_id uuid,
  p_client_id uuid,
  p_procedure_id uuid,
  p_currency public.currency_code,
  p_amount numeric,
  p_transaction_date date,
  p_reason text,
  p_created_by uuid
)
returns public.client_credit_transactions
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_balance numeric;
  v_fx numeric;
  v_equivalent_usd numeric;
  v_tx public.client_credit_transactions;
  v_due_usd numeric;
  v_cash_settled_usd numeric;
  v_credit_applied_usd numeric;
  v_remaining_usd numeric;
begin
  if not private.is_org_member(p_organization_id) then raise exception 'Organization membership required'; end if;
  if p_created_by is distinct from auth.uid() then raise exception 'Invalid creator'; end if;
  select coalesce(quoted_amount,service_price_usd_snapshot) into v_due_usd
  from public.procedures where id=p_procedure_id and organization_id=p_organization_id and client_id=p_client_id;
  if v_due_usd is null then raise exception 'Procedure not found for client'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Amount must be greater than zero'; end if;

  select coalesce(sum(amount),0) into v_balance from public.client_credit_transactions
  where organization_id=p_organization_id and client_id=p_client_id and currency=p_currency;
  if p_amount>v_balance+0.01 then raise exception 'Insufficient client credit'; end if;

  if p_currency='USD' then v_fx:=null; v_equivalent_usd:=p_amount;
  else
    select default_fx_crc_per_usd into v_fx from public.organizations where id=p_organization_id;
    if v_fx is null or v_fx<=0 then raise exception 'Valid organization FX required'; end if;
    v_equivalent_usd:=p_amount/v_fx;
  end if;

  select coalesce(sum(case
    when pay.currency='USD' then greatest(coalesce(pay.list_amount,0)-coalesce(r.refunded,0)-coalesce(c.converted,0),0)
    when pay.currency='CRC' and pay.fx_crc_per_usd_snapshot>0 then greatest(coalesce(pay.list_amount,0)-coalesce(r.refunded,0)-coalesce(c.converted,0),0)/pay.fx_crc_per_usd_snapshot
    else 0 end),0)
  into v_cash_settled_usd
  from public.payment_procedures pp join public.payments pay on pay.id=pp.payment_id
  left join (select payment_id,sum(amount) refunded from public.payment_refunds where organization_id=p_organization_id group by payment_id) r on r.payment_id=pay.id
  left join (select source_payment_id payment_id,sum(amount) converted from public.client_credit_transactions where organization_id=p_organization_id and kind='payment_conversion' and amount>0 group by source_payment_id) c on c.payment_id=pay.id
  where pp.organization_id=p_organization_id and pp.procedure_id=p_procedure_id and pay.status in ('paid','refunded');

  select coalesce(sum(-equivalent_usd),0) into v_credit_applied_usd
  from public.client_credit_transactions
  where organization_id=p_organization_id and procedure_id=p_procedure_id and kind='procedure_application' and amount<0;

  v_remaining_usd:=greatest(v_due_usd-v_cash_settled_usd-v_credit_applied_usd,0);
  if v_equivalent_usd>v_remaining_usd+0.01 then raise exception 'Credit application exceeds procedure balance'; end if;

  insert into public.client_credit_transactions(organization_id,client_id,transaction_date,currency,amount,fx_crc_per_usd_snapshot,equivalent_usd,kind,procedure_id,reason,created_by)
  values(p_organization_id,p_client_id,p_transaction_date,p_currency,-p_amount,v_fx,-v_equivalent_usd,'procedure_application',p_procedure_id,nullif(trim(p_reason),''),p_created_by)
  returning * into v_tx;

  perform private.recalculate_procedure_payment_status(p_organization_id,p_procedure_id);
  return v_tx;
end;
$$;

revoke all on function public.apply_client_credit_to_procedure(uuid,uuid,uuid,public.currency_code,numeric,date,text,uuid) from public;
grant execute on function public.apply_client_credit_to_procedure(uuid,uuid,uuid,public.currency_code,numeric,date,text,uuid) to authenticated;