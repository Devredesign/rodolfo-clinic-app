alter table public.profiles add column if not exists email text;
create index if not exists profiles_email_idx on public.profiles(lower(email));

create or replace function public.admin_update_member(p_organization_id uuid,p_user_id uuid,p_role public.app_role,p_active boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
 if p_user_id=auth.uid() and p_active=false then raise exception 'No podés desactivar tu propio usuario.'; end if;
 update public.organization_members set role=p_role,active=p_active where organization_id=p_organization_id and user_id=p_user_id;
 if not found then raise exception 'Member not found'; end if;
end $$;
grant execute on function public.admin_update_member(uuid,uuid,public.app_role,boolean) to authenticated;

create or replace function public.set_task_assignees(p_organization_id uuid,p_task_id uuid,p_user_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
declare uid uuid; first_uid uuid;
begin
 if not private.is_org_member(p_organization_id) then raise exception 'Organization membership required'; end if;
 if not exists(select 1 from public.tasks where id=p_task_id and organization_id=p_organization_id) then raise exception 'Task not found'; end if;
 if coalesce(array_length(p_user_ids,1),0)=0 then raise exception 'Seleccioná al menos un responsable.'; end if;
 if exists(select 1 from unnest(p_user_ids) u(user_id) left join public.organization_members om on om.organization_id=p_organization_id and om.user_id=u.user_id and om.active=true where om.user_id is null) then raise exception 'Todos los responsables deben ser miembros activos.'; end if;
 delete from public.task_assignees where organization_id=p_organization_id and task_id=p_task_id;
 foreach uid in array p_user_ids loop insert into public.task_assignees(organization_id,task_id,user_id,assigned_by) values(p_organization_id,p_task_id,uid,auth.uid()) on conflict do nothing; end loop;
 first_uid:=p_user_ids[1];
 update public.tasks set assigned_to=first_uid,updated_at=now() where id=p_task_id and organization_id=p_organization_id;
end $$;
grant execute on function public.set_task_assignees(uuid,uuid,uuid[]) to authenticated;

insert into public.task_assignees(organization_id,task_id,user_id,assigned_by)
select t.organization_id,t.id,t.assigned_to,coalesce(t.created_by,t.assigned_to)
from public.tasks t join public.organization_members om on om.organization_id=t.organization_id and om.user_id=t.assigned_to and om.active=true
where t.assigned_to is not null on conflict do nothing;
