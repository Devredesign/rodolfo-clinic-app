-- Security model for Rodolfo Clinic App.
-- Tenant isolation lives in PostgreSQL RLS, not only in React.

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members om
    where om.organization_id=target_org and om.user_id=(select auth.uid()) and om.active=true);
$$;
create or replace function private.is_org_admin(target_org uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members om
    where om.organization_id=target_org and om.user_id=(select auth.uid()) and om.active=true and om.role='admin');
$$;
create or replace function private.shares_org_with(target_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id=mine.organization_id
    where mine.user_id=(select auth.uid()) and mine.active=true and theirs.user_id=target_user and theirs.active=true);
$$;
revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.is_org_admin(uuid) from public;
revoke all on function private.shares_org_with(uuid) from public;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_admin(uuid) to authenticated;
grant execute on function private.shares_org_with(uuid) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,full_name)
 values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(coalesce(new.email,'Usuario'),'@',1)))
 on conflict(id) do nothing;
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
create policy profiles_select_org_members on public.profiles for select to authenticated using(id=(select auth.uid()) or (select private.shares_org_with(id)));
create policy profiles_update_self on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));

alter table public.organizations enable row level security;
create policy organizations_select_member on public.organizations for select to authenticated using((select private.is_org_member(id)));
create policy organizations_update_admin on public.organizations for update to authenticated using((select private.is_org_admin(id))) with check((select private.is_org_admin(id)));

alter table public.organization_members enable row level security;
create policy organization_members_select_member on public.organization_members for select to authenticated using((select private.is_org_member(organization_id)));
create policy organization_members_admin_all on public.organization_members for all to authenticated using((select private.is_org_admin(organization_id))) with check((select private.is_org_admin(organization_id)));

alter table public.organization_modules enable row level security;
create policy organization_modules_select_member on public.organization_modules for select to authenticated using((select private.is_org_member(organization_id)));
create policy organization_modules_admin_all on public.organization_modules for all to authenticated using((select private.is_org_admin(organization_id))) with check((select private.is_org_admin(organization_id)));

-- Operational tables available to active organization members.
do $$ declare t text; begin
 foreach t in array array['clients','procedures','procedure_products','inventory_containers','inventory_movements','purchases','purchase_items','tasks'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('create policy %I_select_member on public.%I for select to authenticated using((select private.is_org_member(organization_id)))',t,t);
   execute format('create policy %I_insert_member on public.%I for insert to authenticated with check((select private.is_org_member(organization_id)))',t,t);
   execute format('create policy %I_update_member on public.%I for update to authenticated using((select private.is_org_member(organization_id))) with check((select private.is_org_member(organization_id)))',t,t);
   execute format('create policy %I_delete_admin on public.%I for delete to authenticated using((select private.is_org_admin(organization_id)))',t,t);
 end loop;
end $$;

-- Master data: members can use/read; only admins can change definitions/prices.
do $$ declare t text; begin
 foreach t in array array['suppliers','products','product_price_history','services','service_products','payment_methods'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('create policy %I_select_member on public.%I for select to authenticated using((select private.is_org_member(organization_id)))',t,t);
   execute format('create policy %I_admin_write on public.%I for all to authenticated using((select private.is_org_admin(organization_id))) with check((select private.is_org_admin(organization_id)))',t,t);
 end loop;
end $$;

-- Payments: assistants may record a payment but only see payments they created; admin sees/edits all.
alter table public.payments enable row level security;
create policy payments_select_admin_or_creator on public.payments for select to authenticated using((select private.is_org_admin(organization_id)) or created_by=(select auth.uid()));
create policy payments_insert_member on public.payments for insert to authenticated with check((select private.is_org_member(organization_id)) and created_by=(select auth.uid()));
create policy payments_update_admin on public.payments for update to authenticated using((select private.is_org_admin(organization_id))) with check((select private.is_org_admin(organization_id)));
create policy payments_delete_admin on public.payments for delete to authenticated using((select private.is_org_admin(organization_id)));

alter table public.payment_procedures enable row level security;
create policy payment_procedures_select_admin on public.payment_procedures for select to authenticated using((select private.is_org_admin(organization_id)));
create policy payment_procedures_insert_member on public.payment_procedures for insert to authenticated with check((select private.is_org_member(organization_id)));
create policy payment_procedures_update_admin on public.payment_procedures for update to authenticated using((select private.is_org_admin(organization_id))) with check((select private.is_org_admin(organization_id)));
create policy payment_procedures_delete_admin on public.payment_procedures for delete to authenticated using((select private.is_org_admin(organization_id)));

-- Finance is admin-only in V1.
do $$ declare t text; begin
 foreach t in array array['expense_categories','expenses','payables','payable_payments','reconciliations'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('create policy %I_admin_all on public.%I for all to authenticated using((select private.is_org_admin(organization_id))) with check((select private.is_org_admin(organization_id)))',t,t);
 end loop;
end $$;

alter table public.audit_log enable row level security;
create policy audit_log_admin_select on public.audit_log for select to authenticated using((select private.is_org_admin(organization_id)));

grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
