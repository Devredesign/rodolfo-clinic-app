create or replace function public.sync_purchase_from_expense_payment(p_expense_id uuid)
returns void language plpgsql set search_path=public as $$
declare v_purchase uuid; v_org uuid; v_expense_amount numeric; v_paid numeric; v_new_status public.payable_status; v_actor uuid;
begin
 select e.source_id,e.organization_id,e.amount,e.created_by into v_purchase,v_org,v_expense_amount,v_actor from public.expenses e where e.id=p_expense_id and e.source_type='purchase';
 if v_purchase is null then return; end if;
 select coalesce(sum(ep.amount),0) into v_paid from public.expense_payments ep where ep.expense_id=p_expense_id and ep.status='paid';
 v_new_status:=case when v_paid >= v_expense_amount-0.01 then 'paid'::public.payable_status else 'pending'::public.payable_status end;
 update public.purchases set status=v_new_status,updated_at=now() where id=v_purchase and organization_id=v_org;
 update public.expenses set status=v_new_status,updated_at=now() where id=p_expense_id;
 perform public.sync_purchase_payment_task(v_org,v_purchase,coalesce(auth.uid(),v_actor));
end $$;
create or replace function public.trg_sync_purchase_from_expense_payment() returns trigger language plpgsql set search_path=public as $$ begin perform public.sync_purchase_from_expense_payment(coalesce(new.expense_id,old.expense_id)); if tg_op='UPDATE' and old.expense_id is distinct from new.expense_id then perform public.sync_purchase_from_expense_payment(old.expense_id); end if; return coalesce(new,old); end $$;
drop trigger if exists trg_expense_payment_sync_purchase on public.expense_payments;
create trigger trg_expense_payment_sync_purchase after insert or update or delete on public.expense_payments for each row execute function public.trg_sync_purchase_from_expense_payment();
do $$ declare r record; begin for r in select id from public.expenses where source_type='purchase' loop perform public.sync_purchase_from_expense_payment(r.id); end loop; end $$;