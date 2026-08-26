alter table public.procedures add column if not exists followup_requested boolean not null default false;

-- Follow-up CRM tasks require both a service rule and explicit opt-in on the procedure.
create or replace function public.sync_procedure_followup_task(p_procedure_id uuid)
returns void language plpgsql set search_path=public as $$
declare p record; s record; v_task uuid; v_due timestamptz; v_title text; v_assignee uuid; v_cat uuid;
begin
 select * into p from public.procedures where id=p_procedure_id; if p.id is null then return; end if;
 select id,name,followup_enabled,followup_value,followup_unit into s from public.services where id=p.service_id and organization_id=p.organization_id;
 select id into v_task from public.tasks where organization_id=p.organization_id and reference_type='procedure_followup' and reference_id=p.id order by created_at desc limit 1;
 if p.status::text<>'performed' or p.performed_at is null or p.followup_requested is distinct from true or s.followup_enabled is distinct from true or coalesce(s.followup_value,0)<=0 or s.followup_unit is null then
  if v_task is not null then update public.tasks set status='archived',archived_at=coalesce(archived_at,now()),updated_at=now() where id=v_task and status='pending'; end if; return;
 end if;
 select id into v_cat from public.task_categories where organization_id=p.organization_id and slug='follow_up' and active=true limit 1;
 v_due:=case when s.followup_unit='days' then p.performed_at+make_interval(days=>s.followup_value) else p.performed_at+make_interval(months=>s.followup_value) end;
 v_title:='Seguimiento · '||coalesce(s.name,p.service_name_snapshot); v_assignee:=coalesce(p.created_by,auth.uid());
 if v_task is null then
  insert into public.tasks(organization_id,title,category,category_id,status,due_at,client_id,reference_type,reference_id,auto_generated,notes,created_by,assigned_to) values(p.organization_id,v_title,'Seguimiento',v_cat,'pending',v_due,p.client_id,'procedure_followup',p.id,true,'Seguimiento solicitado al registrar el procedimiento.',v_assignee,v_assignee) returning id into v_task;
  if v_assignee is not null then insert into public.task_assignees(organization_id,task_id,user_id,assigned_by) values(p.organization_id,v_task,v_assignee,v_assignee) on conflict do nothing; end if;
 else update public.tasks set title=v_title,category='Seguimiento',category_id=v_cat,due_at=v_due,client_id=p.client_id,updated_at=now(),status=case when status='archived' then 'pending' else status end,completed_at=case when status='archived' then null else completed_at end,archived_at=case when status='archived' then null else archived_at end where id=v_task and status<>'completed'; end if;
end $$;
drop trigger if exists trg_sync_procedure_followup_task on public.procedures;
create trigger trg_sync_procedure_followup_task after insert or update of status,performed_at,service_id,client_id,followup_requested on public.procedures for each row execute function public.trg_sync_procedure_followup_task();

-- System financial tasks cannot be manually completed before their source transaction is paid.
create or replace function public.enforce_system_task_completion() returns trigger language plpgsql set search_path=public as $$
declare v_status text; begin
 if new.status='completed' and old.status is distinct from new.status and old.auto_generated=true then
  if old.reference_type='reconciliation_transfer' then select status into v_status from public.reconciliation_transfers where id=old.reference_id and organization_id=old.organization_id; if coalesce(v_status,'pending')<>'paid' then raise exception 'La tarea solo puede completarse registrando la transferencia como pagada en Conciliación.'; end if;
  elsif old.reference_type='purchase_payment' and exists(select 1 from public.purchases where id=old.reference_id and organization_id=old.organization_id and status<>'paid') then raise exception 'La tarea solo puede completarse pagando la compra.';
  elsif old.reference_type='procedure_collection' and exists(select 1 from public.procedures where id=old.reference_id and organization_id=old.organization_id and payment_status<>'paid') then raise exception 'La tarea solo puede completarse pagando el procedimiento.'; end if;
 end if; return new; end $$;
drop trigger if exists trg_enforce_system_task_completion on public.tasks;
create trigger trg_enforce_system_task_completion before update of status on public.tasks for each row execute function public.enforce_system_task_completion();
