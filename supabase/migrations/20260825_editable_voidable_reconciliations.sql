-- Open reconciliations can be recalculated or voided; closed reconciliations remain immutable.
alter table public.reconciliation_batches add column if not exists void_reason text;
alter table public.reconciliation_batches add column if not exists voided_at timestamptz;
alter table public.reconciliation_batches add column if not exists voided_by uuid;
alter table public.reconciliation_batches drop constraint if exists reconciliation_batches_status_check;
alter table public.reconciliation_batches add constraint reconciliation_batches_status_check check (status in ('open','closed','voided'));
alter table public.reconciliation_batches drop constraint if exists reconciliation_batches_organization_id_week_start_week_end_key;
create unique index if not exists reconciliation_batches_active_period_uidx on public.reconciliation_batches(organization_id,week_start,week_end) where status <> 'voided';

-- recalculate_weekly_reconciliation releases the current items, rebuilds them from eligible payments,
-- resets transfer confirmations because the amounts may have changed, and locks the rebuilt items again.
-- void_weekly_reconciliation preserves the batch/items for audit and releases its payments back to pending.
