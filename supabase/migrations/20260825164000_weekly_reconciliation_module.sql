-- Weekly reconciliation module.
-- Mirrors the Supabase migration applied from ChatGPT on 2026-08-25.

create table if not exists public.reconciliation_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  status text not null default 'open' check (status in ('open','closed')),
  eligible_revenue_usd numeric not null default 0,
  clinic_to_rodolfo_due_usd numeric not null default 0,
  rodolfo_to_clinic_due_usd numeric not null default 0,
  vat_cost_usd numeric not null default 0,
  processor_fees_usd numeric not null default 0,
  product_cost_usd numeric not null default 0,
  rodolfo_margin_usd numeric not null default 0,
  clinic_to_rodolfo_status text not null default 'pending' check (clinic_to_rodolfo_status in ('pending','paid','not_required')),
  clinic_to_rodolfo_paid_at timestamptz,
  clinic_to_rodolfo_reference text,
  rodolfo_to_clinic_status text not null default 'pending' check (rodolfo_to_clinic_status in ('pending','paid','not_required')),
  rodolfo_to_clinic_paid_at timestamptz,
  rodolfo_to_clinic_reference text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  unique (organization_id, week_start, week_end)
);

create table if not exists public.reconciliation_payment_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reconciliation_id uuid not null references public.reconciliation_batches(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  procedure_id uuid references public.procedures(id),
  receiver text not null,
  currency public.currency_code not null,
  gross_amount numeric not null,
  refunded_amount numeric not null default 0,
  eligible_amount_usd numeric not null,
  rodolfo_share_usd numeric not null,
  clinic_share_usd numeric not null,
  vat_cost_usd numeric not null,
  processor_fee_usd numeric not null,
  created_at timestamptz not null default now(),
  unique (reconciliation_id, payment_id)
);

alter table public.reconciliation_batches enable row level security;
alter table public.reconciliation_payment_items enable row level security;

drop policy if exists reconciliation_batches_org_read on public.reconciliation_batches;
create policy reconciliation_batches_org_read on public.reconciliation_batches for select using (private.is_org_member(organization_id));
drop policy if exists reconciliation_batches_admin_write on public.reconciliation_batches;
create policy reconciliation_batches_admin_write on public.reconciliation_batches for all using (private.is_org_admin(organization_id)) with check (private.is_org_admin(organization_id));
drop policy if exists reconciliation_items_org_read on public.reconciliation_payment_items;
create policy reconciliation_items_org_read on public.reconciliation_payment_items for select using (private.is_org_member(organization_id));
drop policy if exists reconciliation_items_admin_write on public.reconciliation_payment_items;
create policy reconciliation_items_admin_write on public.reconciliation_payment_items for all using (private.is_org_admin(organization_id)) with check (private.is_org_admin(organization_id));

-- RPCs installed in Supabase:
-- create_weekly_reconciliation(org, week_start, week_end, created_by)
-- set_reconciliation_transfer_status(org, reconciliation_id, direction, paid, reference)
-- close_weekly_reconciliation(org, reconciliation_id, closed_by)
-- They snapshot eligible patient payments, refunds, 70/30 shares, VAT, processor fees and procedure product costs.
