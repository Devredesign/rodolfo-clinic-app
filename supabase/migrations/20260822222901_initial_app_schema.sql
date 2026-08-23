create extension if not exists pgcrypto;

do $$ begin create type public.app_role as enum ('admin','assistant'); exception when duplicate_object then null; end $$;
do $$ begin create type public.procedure_status as enum ('pending','performed','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_status as enum ('pending','paid','partial','refunded','voided'); exception when duplicate_object then null; end $$;
do $$ begin create type public.currency_code as enum ('USD','CRC'); exception when duplicate_object then null; end $$;
do $$ begin create type public.product_usage_type as enum ('single_use','multi_use'); exception when duplicate_object then null; end $$;
do $$ begin create type public.container_status as enum ('closed','open','depleted','discarded'); exception when duplicate_object then null; end $$;
do $$ begin create type public.task_status as enum ('pending','completed','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payable_status as enum ('pending','partial','paid','overdue','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.reconciliation_status as enum ('open','ready','reconciled'); exception when duplicate_object then null; end $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_path text,
  default_fx_crc_per_usd numeric(12,4) not null default 515 check(default_fx_crc_per_usd>0),
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null,
  enabled boolean not null default true,
  primary key (organization_id,module_key)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  identification text,
  phone text,
  email text,
  birth_date date,
  notes text,
  tier text not null default 'bronze' check(tier in ('bronze','silver','gold','platinum')),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,identification)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  brand text,
  default_supplier_id uuid references public.suppliers(id),
  usage_type public.product_usage_type not null,
  current_cost_usd numeric(12,2) not null check(current_cost_usd>=0),
  low_stock_threshold integer not null default 0 check(low_stock_threshold>=0),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_org_name_brand_unique on public.products(organization_id,lower(name),coalesce(lower(brand),''));

create table public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  cost_usd numeric(12,2) not null check(cost_usd>=0),
  effective_at timestamptz not null default now(),
  source text not null default 'manual',
  created_by uuid references public.profiles(id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  price_usd numeric(12,2) not null check(price_usd>=0),
  remarketing_months integer check(remarketing_months is null or remarketing_months>=0),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,name)
);

create table public.service_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  product_id uuid not null references public.products(id),
  standard_quantity numeric(12,4) not null check(standard_quantity>0),
  sort_order integer not null default 0,
  unique(service_id,product_id)
);

create table public.procedures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  service_id uuid not null references public.services(id),
  scheduled_at timestamptz,
  performed_at timestamptz,
  status public.procedure_status not null default 'pending',
  payment_status public.payment_status not null default 'pending',
  notes text,
  service_name_snapshot text not null,
  service_price_usd_snapshot numeric(12,2) not null check(service_price_usd_snapshot>=0),
  fx_crc_per_usd_snapshot numeric(12,4) check(fx_crc_per_usd_snapshot is null or fx_crc_per_usd_snapshot>0),
  quoted_currency public.currency_code not null default 'USD',
  quoted_amount numeric(14,2) check(quoted_amount is null or quoted_amount>=0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_containers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id),
  status public.container_status not null default 'closed',
  opened_at timestamptz,
  closed_at timestamptz,
  expires_on date,
  purchase_item_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.procedure_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  procedure_id uuid not null references public.procedures(id) on delete cascade,
  product_id uuid not null references public.products(id),
  inventory_container_id uuid references public.inventory_containers(id),
  standard_quantity_snapshot numeric(12,4) not null check(standard_quantity_snapshot>0),
  product_cost_usd_snapshot numeric(12,2) not null check(product_cost_usd_snapshot>=0),
  standard_cost_usd numeric(14,4) generated always as (standard_quantity_snapshot*product_cost_usd_snapshot) stored,
  inventory_outcome text check(inventory_outcome in ('still_open','depleted','discarded','single_use_consumed')),
  discard_reason text,
  created_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id),
  invoice_number text,
  purchase_date date not null default current_date,
  currency public.currency_code not null default 'USD',
  total_amount numeric(14,2) not null default 0 check(total_amount>=0),
  due_date date,
  status public.payable_status not null default 'pending',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check(quantity>0),
  unit_cost numeric(12,2) not null check(unit_cost>=0),
  expiry_date date,
  created_at timestamptz not null default now()
);

alter table public.inventory_containers add constraint inventory_containers_purchase_item_id_fkey foreign key(purchase_item_id) references public.purchase_items(id) on delete set null;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id),
  container_id uuid references public.inventory_containers(id),
  movement_type text not null check(movement_type in ('purchase_in','opened','used','depleted','discarded','lost','damaged','expired','courtesy','exchange','adjustment')),
  quantity_units numeric(12,4),
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  label text not null,
  fee_rate numeric(8,6) not null default 0 check(fee_rate>=0),
  active boolean not null default true,
  unique(organization_id,key)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  payment_date date not null default current_date,
  currency public.currency_code not null,
  list_amount numeric(14,2) check(list_amount is null or list_amount>=0),
  discount_amount numeric(14,2) not null default 0 check(discount_amount>=0),
  final_amount numeric(14,2) not null check(final_amount>=0),
  fx_crc_per_usd_snapshot numeric(12,4) check(fx_crc_per_usd_snapshot is null or fx_crc_per_usd_snapshot>0),
  method_id uuid references public.payment_methods(id),
  receiver text not null check(receiver in ('rodolfo','clinic')),
  rodolfo_share_rate_snapshot numeric(8,6) not null default 0.70 check(rodolfo_share_rate_snapshot between 0 and 1),
  clinic_share_rate_snapshot numeric(8,6) not null default 0.30 check(clinic_share_rate_snapshot between 0 and 1),
  vat_rate_snapshot numeric(8,6) not null default 0.04 check(vat_rate_snapshot between 0 and 1),
  processor_fee_rate_snapshot numeric(8,6) not null default 0 check(processor_fee_rate_snapshot>=0),
  processor_fee_amount numeric(14,2) not null default 0 check(processor_fee_amount>=0),
  status public.payment_status not null default 'paid',
  reconciliation_status text not null default 'pending' check(reconciliation_status in ('pending','reconciled','not_applicable')),
  external_reference text,
  notes text,
  void_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(abs((rodolfo_share_rate_snapshot+clinic_share_rate_snapshot)-1.0)<0.000001)
);

create table public.payment_procedures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  procedure_id uuid not null references public.procedures(id),
  allocated_amount numeric(14,2) check(allocated_amount is null or allocated_amount>=0),
  unique(payment_id,procedure_id)
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique(organization_id,name)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid not null references public.expense_categories(id),
  description text not null,
  currency public.currency_code not null,
  amount numeric(14,2) not null check(amount>=0),
  fx_crc_per_usd_snapshot numeric(12,4) check(fx_crc_per_usd_snapshot is null or fx_crc_per_usd_snapshot>0),
  expense_date date not null default current_date,
  due_date date,
  status public.payable_status not null default 'paid',
  product_id uuid references public.products(id),
  product_quantity numeric(12,4),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null check(source_type in ('purchase','expense','manual')),
  source_id uuid,
  vendor_name text,
  currency public.currency_code not null,
  amount numeric(14,2) not null check(amount>=0),
  paid_amount numeric(14,2) not null default 0 check(paid_amount>=0),
  due_date date,
  status public.payable_status not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(paid_amount<=amount)
);

create table public.payable_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payable_id uuid not null references public.payables(id) on delete cascade,
  payment_date date not null default current_date,
  currency public.currency_code not null,
  amount numeric(14,2) not null check(amount>0),
  method text,
  reference text,
  status public.payment_status not null default 'paid',
  void_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  category text not null,
  status public.task_status not null default 'pending',
  due_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  assigned_to uuid references public.profiles(id),
  client_id uuid references public.clients(id),
  reference_type text,
  reference_id uuid,
  auto_generated boolean not null default false,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  currency public.currency_code not null,
  rodolfo_to_clinic_amount numeric(14,2) not null default 0 check(rodolfo_to_clinic_amount>=0),
  rodolfo_to_clinic_paid boolean not null default false,
  rodolfo_to_clinic_paid_at timestamptz,
  rodolfo_to_clinic_reference text,
  clinic_to_rodolfo_amount numeric(14,2) not null default 0 check(clinic_to_rodolfo_amount>=0),
  clinic_to_rodolfo_paid boolean not null default false,
  clinic_to_rodolfo_paid_at timestamptz,
  clinic_to_rodolfo_reference text,
  status public.reconciliation_status not null default 'open',
  reconciled_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(period_end>=period_start),
  unique(organization_id,period_start,period_end,currency)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id),
  table_name text not null,
  record_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index idx_members_user on public.organization_members(user_id);
create index idx_clients_org_name on public.clients(organization_id,full_name);
create index idx_products_org_active on public.products(organization_id,active);
create index idx_product_price_history_product_time on public.product_price_history(organization_id,product_id,effective_at desc);
create index idx_services_org_active on public.services(organization_id,active);
create index idx_procedures_org_client on public.procedures(organization_id,client_id);
create index idx_procedures_org_performed on public.procedures(organization_id,performed_at desc);
create index idx_inventory_containers_product_status on public.inventory_containers(organization_id,product_id,status);
create index idx_inventory_movements_product_time on public.inventory_movements(organization_id,product_id,created_at desc);
create index idx_payments_org_date on public.payments(organization_id,payment_date desc);
create index idx_payments_org_reconciliation on public.payments(organization_id,reconciliation_status);
create index idx_tasks_org_status_due on public.tasks(organization_id,status,due_at);
create index idx_payables_org_status_due on public.payables(organization_id,status,due_date);
create index idx_reconciliations_org_period on public.reconciliations(organization_id,period_start,period_end);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','clients','suppliers','products','services','procedures','inventory_containers','purchases','payments','expenses','payables','tasks','reconciliations']
  loop
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
  end loop;
end $$;
