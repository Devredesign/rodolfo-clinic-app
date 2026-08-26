-- Purchase -> CRM task sync and multi-assignee-ready task model.
create table if not exists public.task_assignees (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id),
  primary key(task_id,user_id)
);
alter table public.task_assignees enable row level security;
create policy task_assignees_select_member on public.task_assignees for select using (private.is_org_member(organization_id));
create policy task_assignees_write_member on public.task_assignees for all using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));

create or replace function public.sync_purchase_payment_task(p_organization_id uuid,p_purchase_id uuid,p_actor uuid)
returns void language plpgsql set search_path=public as $$
declare v_status text; v_due date; v_invoice text; v_supplier text; v_task uuid;
begin
 select p.status::text,p.due_date,p.invoice_number,s.name into v_status,v_due,v_invoice,v_supplier from public.purchases p left join public.suppliers s on s.id=p.supplier_id where p.id=p_purchase_id and p.organization_id=p_organization_id;
 if v_status is null then return; end if;
 select id into v_task from public.tasks where organization_id=p_organization_id and reference_type='purchase_payment' and reference_id=p_purchase_id and status='pending' limit 1;
 if v_status='pending' then
   if v_task is null then
     insert into public.tasks(organization_id,title,category,status,due_at,reference_type,reference_id,auto_generated,created_by,assigned_to,notes)
     values(p_organization_id,'Pagar compra'||case when v_supplier is not null then ' · '||v_supplier else '' end,'Finanzas','pending',case when v_due is not null then v_due::timestamp+interval '12 hours' else null end,'purchase_payment',p_purchase_id,true,p_actor,p_actor,case when v_invoice is not null then 'Factura / referencia: '||v_invoice else null end) returning id into v_task;
     if p_actor is not null then insert into public.task_assignees(organization_id,task_id,user_id,assigned_by) values(p_organization_id,v_task,p_actor,p_actor) on conflict do nothing; end if;
   else
     update public.tasks set due_at=case when v_due is not null then v_due::timestamp+interval '12 hours' else null end,title='Pagar compra'||case when v_supplier is not null then ' · '||v_supplier else '' end,notes=case when v_invoice is not null then 'Factura / referencia: '||v_invoice else null end,updated_at=now() where id=v_task;
   end if;
 else
   update public.tasks set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where organization_id=p_organization_id and reference_type='purchase_payment' and reference_id=p_purchase_id and status='pending';
 end if;
end $$;

create or replace function public.sync_purchase_task_trigger() returns trigger language plpgsql set search_path=public as $$ begin perform public.sync_purchase_payment_task(new.organization_id,new.id,coalesce(new.created_by,auth.uid())); return new; end $$;
drop trigger if exists trg_sync_purchase_payment_task on public.purchases;
create trigger trg_sync_purchase_payment_task after insert or update of status,due_date,supplier_id,invoice_number on public.purchases for each row execute function public.sync_purchase_task_trigger();

insert into public.task_assignees(organization_id,task_id,user_id,assigned_by) select t.organization_id,t.id,t.assigned_to,t.created_by from public.tasks t where t.assigned_to is not null on conflict do nothing;

-- Existing pending purchases are backfilled when this migration is deployed to an existing environment.
select public.sync_purchase_payment_task(organization_id,id,created_by) from public.purchases where status='pending';
