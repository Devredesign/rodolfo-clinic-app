create table if not exists public.task_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(organization_id,slug),
  unique(organization_id,name)
);
alter table public.task_categories enable row level security;
create policy task_categories_select_member on public.task_categories for select using (private.is_org_member(organization_id));
create policy task_categories_write_admin on public.task_categories for all using (private.is_org_admin(organization_id)) with check (private.is_org_admin(organization_id));

alter table public.tasks add column if not exists category_id uuid references public.task_categories(id);

create or replace function public.ensure_default_task_categories(p_organization_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.task_categories(organization_id,name,slug) values
    (p_organization_id,'Seguimiento','follow_up'),
    (p_organization_id,'Remarketing','remarketing'),
    (p_organization_id,'Cobros','collections'),
    (p_organization_id,'Compras','purchases'),
    (p_organization_id,'Inventario','inventory'),
    (p_organization_id,'Finanzas','finance'),
    (p_organization_id,'Conciliación','reconciliation'),
    (p_organization_id,'Administrativa','administrative'),
    (p_organization_id,'General','general')
  on conflict (organization_id,slug) do update set active=true;
end $$;

create or replace function public.seed_task_categories_for_new_org() returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.ensure_default_task_categories(new.id);
  return new;
end $$;
create trigger trg_seed_task_categories_for_new_org after insert on public.organizations for each row execute function public.seed_task_categories_for_new_org();

do $$ declare r record; begin for r in select id from public.organizations loop perform public.ensure_default_task_categories(r.id); end loop; end $$;

create or replace function public.sync_task_category_id() returns trigger language plpgsql set search_path=public as $$
declare v_id uuid;
begin
  if new.category_id is null and new.category is not null then
    select id into v_id from public.task_categories where organization_id=new.organization_id and lower(name)=lower(new.category) and active=true limit 1;
    if v_id is null then select id into v_id from public.task_categories where organization_id=new.organization_id and slug='general' limit 1; end if;
    new.category_id:=v_id;
  elsif new.category_id is not null then
    select name into new.category from public.task_categories where id=new.category_id and organization_id=new.organization_id;
  end if;
  return new;
end $$;
create trigger trg_sync_task_category_id before insert or update of category,category_id,organization_id on public.tasks for each row execute function public.sync_task_category_id();

update public.tasks t set category_id=c.id from public.task_categories c where c.organization_id=t.organization_id and lower(c.name)=lower(t.category) and t.category_id is null;
update public.tasks t set category_id=c.id from public.task_categories c where c.organization_id=t.organization_id and c.slug='general' and t.category_id is null;
