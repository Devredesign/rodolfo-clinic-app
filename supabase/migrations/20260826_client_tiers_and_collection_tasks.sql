-- Client loyalty tier based on performed procedures.
-- Bronce 0-2, Plata 3-5, Oro 6-9, Platino 10+.
create or replace function public.sync_client_tier(p_organization_id uuid,p_client_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_count int; v_tier text;
begin
 select count(*) into v_count from public.procedures where organization_id=p_organization_id and client_id=p_client_id and status='performed';
 v_tier:=case when v_count>=10 then 'platinum' when v_count>=6 then 'gold' when v_count>=3 then 'silver' else 'bronze' end;
 update public.clients set tier=v_tier,updated_at=now() where id=p_client_id and organization_id=p_organization_id and tier is distinct from v_tier;
end $$;

create or replace function public.sync_procedure_collection_task(p_organization_id uuid,p_procedure_id uuid,p_actor uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v record; v_task uuid; v_category uuid; v_due timestamptz; v_title text;
begin
 select p.id,p.client_id,p.status::text as status,p.payment_status::text as payment_status,p.performed_at,p.scheduled_at,p.service_name_snapshot,c.full_name
 into v from public.procedures p join public.clients c on c.id=p.client_id
 where p.id=p_procedure_id and p.organization_id=p_organization_id;
 if v.id is null then return; end if;
 select id into v_category from public.task_categories where organization_id=p_organization_id and slug='collections' and active=true limit 1;
 select id into v_task from public.tasks where organization_id=p_organization_id and reference_type='procedure_collection' and reference_id=p_procedure_id and status='pending' limit 1;
 v_due:=coalesce(v.performed_at,v.scheduled_at,now());
 v_title:='Cobrar · '||coalesce(v.service_name_snapshot,'Procedimiento')||' · '||coalesce(v.full_name,'Cliente');
 if v.status='performed' and v.payment_status in ('pending','partial') then
   if v_task is null then
     insert into public.tasks(organization_id,title,category,category_id,status,due_at,client_id,reference_type,reference_id,auto_generated,created_by,assigned_to,notes)
     values(p_organization_id,v_title,'Cobros',v_category,'pending',v_due,v.client_id,'procedure_collection',p_procedure_id,true,p_actor,p_actor,case when v.payment_status='partial' then 'El procedimiento tiene un pago parcial pendiente de completar.' else 'El procedimiento está pendiente de pago.' end)
     returning id into v_task;
     if p_actor is not null then insert into public.task_assignees(organization_id,task_id,user_id,assigned_by) values(p_organization_id,v_task,p_actor,p_actor) on conflict do nothing; end if;
   else
     update public.tasks set title=v_title,category='Cobros',category_id=v_category,due_at=v_due,client_id=v.client_id,notes=case when v.payment_status='partial' then 'El procedimiento tiene un pago parcial pendiente de completar.' else 'El procedimiento está pendiente de pago.' end,updated_at=now() where id=v_task;
   end if;
 else
   update public.tasks set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where organization_id=p_organization_id and reference_type='procedure_collection' and reference_id=p_procedure_id and status='pending';
 end if;
end $$;

create or replace function public.trg_procedure_sync_crm_and_tier() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' then
   perform public.sync_client_tier(old.organization_id,old.client_id);
   update public.tasks set status='archived',archived_at=coalesce(archived_at,now()),updated_at=now() where organization_id=old.organization_id and reference_type='procedure_collection' and reference_id=old.id and status='pending';
   return old;
 end if;
 perform public.sync_client_tier(new.organization_id,new.client_id);
 if tg_op='UPDATE' and old.client_id is distinct from new.client_id then perform public.sync_client_tier(old.organization_id,old.client_id); end if;
 perform public.sync_procedure_collection_task(new.organization_id,new.id,coalesce(auth.uid(),new.created_by));
 return new;
end $$;
drop trigger if exists trg_procedure_sync_crm_and_tier on public.procedures;
create trigger trg_procedure_sync_crm_and_tier after insert or update of status,payment_status,performed_at,scheduled_at,client_id,service_name_snapshot or delete on public.procedures for each row execute function public.trg_procedure_sync_crm_and_tier();

do $$ declare r record; begin
 for r in select distinct organization_id,client_id from public.procedures loop perform public.sync_client_tier(r.organization_id,r.client_id); end loop;
 for r in select organization_id,id,created_by from public.procedures loop perform public.sync_procedure_collection_task(r.organization_id,r.id,r.created_by); end loop;
end $$;
