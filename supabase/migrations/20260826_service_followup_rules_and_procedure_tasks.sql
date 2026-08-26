alter table public.services add column if not exists followup_enabled boolean not null default false;
alter table public.services add column if not exists followup_value integer;
alter table public.services add column if not exists followup_unit text;
alter table public.services drop constraint if exists services_followup_unit_check;
alter table public.services add constraint services_followup_unit_check check (followup_unit is null or followup_unit in ('days','months'));
alter table public.services drop constraint if exists services_followup_value_check;
alter table public.services add constraint services_followup_value_check check (followup_value is null or followup_value > 0);
update public.services set followup_enabled=true,followup_value=remarketing_months,followup_unit='months' where remarketing_months is not null and remarketing_months>0 and followup_value is null;
create or replace function public.sync_procedure_followup_task(p_procedure_id uuid)
returns void language plpgsql set search_path=public as $$
declare p record; s record; v_task uuid; v_due timestamptz; v_title text; v_assignee uuid;
begin
 select * into p from public.procedures where id=p_procedure_id;
 if p.id is null then return; end if;
 select id,name,followup_enabled,followup_value,followup_unit into s from public.services where id=p.service_id and organization_id=p.organization_id;
 select id into v_task from public.tasks where organization_id=p.organization_id and reference_type='procedure_followup' and reference_id=p.id order by created_at desc limit 1;
 if p.status::text<>'performed' or p.performed_at is null or s.followup_enabled is distinct from true or coalesce(s.followup_value,0)<=0 or s.followup_unit is null then
   if v_task is not null then update public.tasks set status='archived',archived_at=coalesce(archived_at,now()),updated_at=now() where id=v_task and status='pending'; end if;
   return;
 end if;
 v_due:=case when s.followup_unit='days' then p.performed_at + make_interval(days=>s.followup_value) else p.performed_at + make_interval(months=>s.followup_value) end;
 v_title:='Seguimiento · '||coalesce(s.name,p.service_name_snapshot);
 v_assignee:=coalesce(p.created_by,auth.uid());
 if v_task is null then
   insert into public.tasks(organization_id,title,category,status,due_at,client_id,reference_type,reference_id,auto_generated,notes,created_by,assigned_to)
   values(p.organization_id,v_title,'Remarketing','pending',v_due,p.client_id,'procedure_followup',p.id,true,'Seguimiento automático generado por la regla del servicio.',v_assignee,v_assignee)
   returning id into v_task;
   if v_assignee is not null then insert into public.task_assignees(organization_id,task_id,user_id,assigned_by) values(p.organization_id,v_task,v_assignee,v_assignee) on conflict do nothing; end if;
 else
   update public.tasks set title=v_title,due_at=v_due,client_id=p.client_id,updated_at=now(),status=case when status='archived' then 'pending' else status end,archived_at=case when status='archived' then null else archived_at end where id=v_task and status<>'completed';
 end if;
end $$;
create or replace function public.trg_sync_procedure_followup_task() returns trigger language plpgsql set search_path=public as $$ begin perform public.sync_procedure_followup_task(new.id); return new; end $$;
drop trigger if exists trg_procedure_followup_task on public.procedures;
create trigger trg_procedure_followup_task after insert or update of status,performed_at,client_id,service_id on public.procedures for each row execute function public.trg_sync_procedure_followup_task();
create or replace function public.trg_resync_service_followups() returns trigger language plpgsql set search_path=public as $$ declare r record; begin if old.followup_enabled is distinct from new.followup_enabled or old.followup_value is distinct from new.followup_value or old.followup_unit is distinct from new.followup_unit or old.name is distinct from new.name then for r in select id from public.procedures where organization_id=new.organization_id and service_id=new.id loop perform public.sync_procedure_followup_task(r.id); end loop; end if; return new; end $$;
drop trigger if exists trg_resync_service_followups on public.services;
create trigger trg_resync_service_followups after update of followup_enabled,followup_value,followup_unit,name on public.services for each row execute function public.trg_resync_service_followups();
do $$ declare r record; begin for r in select id from public.procedures where status='performed' loop perform public.sync_procedure_followup_task(r.id); end loop; end $$;