create table if not exists public.client_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  transaction_date date not null default current_date,
  currency public.currency_code not null,
  amount numeric not null check (amount <> 0),
  fx_crc_per_usd_snapshot numeric,
  equivalent_usd numeric not null,
  kind text not null check (kind in ('advance_payment','payment_conversion','procedure_application','adjustment')),
  source_payment_id uuid references public.payments(id) on delete restrict,
  procedure_id uuid references public.procedures(id) on delete restrict,
  reason text,
  external_reference text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_tx_org_client on public.client_credit_transactions(organization_id, client_id, transaction_date desc);
create index if not exists idx_credit_tx_source_payment on public.client_credit_transactions(source_payment_id) where source_payment_id is not null;
create index if not exists idx_credit_tx_procedure on public.client_credit_transactions(procedure_id) where procedure_id is not null;

alter table public.client_credit_transactions enable row level security;
drop policy if exists client_credit_transactions_select_member on public.client_credit_transactions;
create policy client_credit_transactions_select_member on public.client_credit_transactions
for select using ((select private.is_org_member(organization_id)));

create or replace function private.recalculate_procedure_payment_status(p_organization_id uuid, p_procedure_id uuid)
returns public.payment_status language plpgsql security definer set search_path = public, private as $$
declare v_nominal_due numeric; v_cash_settled_usd numeric; v_credit_applied_usd numeric; v_new_status public.payment_status;
begin
  select coalesce(quoted_amount, service_price_usd_snapshot) into v_nominal_due from public.procedures where id=p_procedure_id and organization_id=p_organization_id;
  if v_nominal_due is null then raise exception 'Procedure not found'; end if;
  select coalesce(sum(case when pay.currency='USD' then greatest(coalesce(pay.list_amount,0)-coalesce(r.refunded,0)-coalesce(c.converted,0),0) when pay.currency='CRC' and pay.fx_crc_per_usd_snapshot>0 then greatest(coalesce(pay.list_amount,0)-coalesce(r.refunded,0)-coalesce(c.converted,0),0)/pay.fx_crc_per_usd_snapshot else 0 end),0)
  into v_cash_settled_usd
  from public.payment_procedures pp join public.payments pay on pay.id=pp.payment_id
  left join (select payment_id,sum(amount) refunded from public.payment_refunds where organization_id=p_organization_id group by payment_id) r on r.payment_id=pay.id
  left join (select source_payment_id payment_id,sum(amount) converted from public.client_credit_transactions where organization_id=p_organization_id and kind='payment_conversion' and amount>0 group by source_payment_id) c on c.payment_id=pay.id
  where pp.organization_id=p_organization_id and pp.procedure_id=p_procedure_id and pay.status in ('paid','refunded');
  select coalesce(sum(-equivalent_usd),0) into v_credit_applied_usd from public.client_credit_transactions where organization_id=p_organization_id and procedure_id=p_procedure_id and kind='procedure_application' and amount<0;
  if v_cash_settled_usd+v_credit_applied_usd >= v_nominal_due-0.01 then v_new_status:='paid'; elsif v_cash_settled_usd+v_credit_applied_usd>0 then v_new_status:='partial'; else v_new_status:='pending'; end if;
  update public.procedures set payment_status=v_new_status,updated_at=now() where id=p_procedure_id and organization_id=p_organization_id;
  return v_new_status;
end; $$;

create or replace function public.convert_payment_to_credit(p_organization_id uuid,p_payment_id uuid,p_amount numeric,p_transaction_date date,p_reason text,p_external_reference text,p_created_by uuid)
returns public.client_credit_transactions language plpgsql security definer set search_path=public,private as $$
declare v_payment public.payments; v_tx public.client_credit_transactions; v_refunded numeric; v_converted numeric; v_available numeric; v_equivalent_usd numeric; v_procedure_id uuid;
begin
  if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
  if p_created_by is distinct from auth.uid() then raise exception 'Invalid creator'; end if;
  select * into v_payment from public.payments where id=p_payment_id and organization_id=p_organization_id for update;
  if v_payment.id is null then raise exception 'Payment not found'; end if;
  if v_payment.status not in ('paid','refunded') then raise exception 'Only paid payments can be converted to credit'; end if;
  if v_payment.reconciliation_status<>'pending' then raise exception 'Reconciled payments cannot be converted to credit'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Credit amount must be greater than zero'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Reason is required'; end if;
  select coalesce(sum(amount),0) into v_refunded from public.payment_refunds where organization_id=p_organization_id and payment_id=p_payment_id;
  select coalesce(sum(amount),0) into v_converted from public.client_credit_transactions where organization_id=p_organization_id and source_payment_id=p_payment_id and kind='payment_conversion' and amount>0;
  v_available:=greatest(v_payment.final_amount-v_refunded-v_converted,0);
  if p_amount>v_available+0.01 then raise exception 'Credit conversion exceeds available payment amount'; end if;
  if v_payment.currency='USD' then v_equivalent_usd:=p_amount; elsif v_payment.fx_crc_per_usd_snapshot>0 then v_equivalent_usd:=p_amount/v_payment.fx_crc_per_usd_snapshot; else raise exception 'Payment has no valid FX snapshot'; end if;
  insert into public.client_credit_transactions(organization_id,client_id,transaction_date,currency,amount,fx_crc_per_usd_snapshot,equivalent_usd,kind,source_payment_id,reason,external_reference,created_by)
  values(p_organization_id,v_payment.client_id,p_transaction_date,v_payment.currency,p_amount,v_payment.fx_crc_per_usd_snapshot,v_equivalent_usd,'payment_conversion',p_payment_id,trim(p_reason),nullif(trim(p_external_reference),''),p_created_by) returning * into v_tx;
  select procedure_id into v_procedure_id from public.payment_procedures where organization_id=p_organization_id and payment_id=p_payment_id limit 1;
  if v_procedure_id is not null then perform private.recalculate_procedure_payment_status(p_organization_id,v_procedure_id); end if;
  return v_tx;
end; $$;

create or replace function public.register_client_credit_payment(p_organization_id uuid,p_client_id uuid,p_payment_date date,p_currency public.currency_code,p_amount numeric,p_fx_crc_per_usd_snapshot numeric,p_method_id uuid,p_receiver text,p_rodolfo_share_rate_snapshot numeric,p_clinic_share_rate_snapshot numeric,p_vat_rate_snapshot numeric,p_processor_fee_rate_snapshot numeric,p_processor_fee_amount numeric,p_reason text,p_external_reference text,p_notes text,p_created_by uuid)
returns public.payments language plpgsql security definer set search_path=public,private as $$
declare v_payment public.payments; v_equivalent_usd numeric;
begin
  if not private.is_org_member(p_organization_id) then raise exception 'Organization membership required'; end if;
  if p_created_by is distinct from auth.uid() then raise exception 'Invalid creator'; end if;
  if not exists(select 1 from public.clients where id=p_client_id and organization_id=p_organization_id) then raise exception 'Client not found'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  if p_currency='CRC' and (p_fx_crc_per_usd_snapshot is null or p_fx_crc_per_usd_snapshot<=0) then raise exception 'Valid FX required'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Reason is required'; end if;
  if p_currency='USD' then v_equivalent_usd:=p_amount; else v_equivalent_usd:=p_amount/p_fx_crc_per_usd_snapshot; end if;
  insert into public.payments(organization_id,client_id,payment_date,currency,list_amount,discount_amount,final_amount,fx_crc_per_usd_snapshot,method_id,receiver,rodolfo_share_rate_snapshot,clinic_share_rate_snapshot,vat_rate_snapshot,processor_fee_rate_snapshot,processor_fee_amount,status,reconciliation_status,external_reference,notes,created_by)
  values(p_organization_id,p_client_id,p_payment_date,p_currency,p_amount,0,p_amount,p_fx_crc_per_usd_snapshot,p_method_id,p_receiver,p_rodolfo_share_rate_snapshot,p_clinic_share_rate_snapshot,p_vat_rate_snapshot,p_processor_fee_rate_snapshot,p_processor_fee_amount,'paid','pending',nullif(trim(p_external_reference),''),nullif(trim(p_notes),''),p_created_by) returning * into v_payment;
  insert into public.client_credit_transactions(organization_id,client_id,transaction_date,currency,amount,fx_crc_per_usd_snapshot,equivalent_usd,kind,source_payment_id,reason,external_reference,created_by)
  values(p_organization_id,p_client_id,p_payment_date,p_currency,p_amount,p_fx_crc_per_usd_snapshot,v_equivalent_usd,'advance_payment',v_payment.id,trim(p_reason),nullif(trim(p_external_reference),''),p_created_by);
  return v_payment;
end; $$;

create or replace function public.register_payment_refund(p_organization_id uuid,p_payment_id uuid,p_refund_date date,p_amount numeric,p_reason text,p_external_reference text,p_created_by uuid)
returns public.payment_refunds language plpgsql security definer set search_path=public,private as $$
declare v_payment public.payments; v_refund public.payment_refunds; v_refunded numeric; v_converted numeric; v_procedure_id uuid;
begin
  if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
  if p_created_by is distinct from auth.uid() then raise exception 'Invalid creator'; end if;
  select * into v_payment from public.payments where id=p_payment_id and organization_id=p_organization_id for update;
  if v_payment.id is null then raise exception 'Payment not found'; end if;
  if v_payment.status not in ('paid','refunded') then raise exception 'Only paid payments can be refunded'; end if;
  if v_payment.reconciliation_status<>'pending' then raise exception 'Reconciled payments cannot be refunded in this flow'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Refund amount must be greater than zero'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Refund reason is required'; end if;
  select coalesce(sum(amount),0) into v_refunded from public.payment_refunds where payment_id=p_payment_id and organization_id=p_organization_id;
  select coalesce(sum(amount),0) into v_converted from public.client_credit_transactions where source_payment_id=p_payment_id and organization_id=p_organization_id and kind='payment_conversion' and amount>0;
  if v_refunded+v_converted+p_amount>v_payment.final_amount+0.01 then raise exception 'Refund exceeds available paid amount'; end if;
  insert into public.payment_refunds(organization_id,payment_id,refund_date,amount,reason,external_reference,created_by) values(p_organization_id,p_payment_id,p_refund_date,p_amount,trim(p_reason),nullif(trim(p_external_reference),''),p_created_by) returning * into v_refund;
  select coalesce(sum(amount),0) into v_refunded from public.payment_refunds where payment_id=p_payment_id and organization_id=p_organization_id;
  if v_refunded>=v_payment.final_amount-0.01 then update public.payments set status='refunded',updated_at=now() where id=p_payment_id; end if;
  select procedure_id into v_procedure_id from public.payment_procedures where payment_id=p_payment_id and organization_id=p_organization_id limit 1;
  if v_procedure_id is not null then perform private.recalculate_procedure_payment_status(p_organization_id,v_procedure_id); end if;
  return v_refund;
end; $$;

revoke all on function public.convert_payment_to_credit(uuid,uuid,numeric,date,text,text,uuid) from public;
grant execute on function public.convert_payment_to_credit(uuid,uuid,numeric,date,text,text,uuid) to authenticated;
revoke all on function public.register_client_credit_payment(uuid,uuid,date,public.currency_code,numeric,numeric,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,text,uuid) from public;
grant execute on function public.register_client_credit_payment(uuid,uuid,date,public.currency_code,numeric,numeric,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,text,uuid) to authenticated;