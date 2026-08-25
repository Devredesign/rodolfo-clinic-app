alter table public.payments
  drop constraint if exists payments_reconciliation_status_check;

alter table public.payments
  add constraint payments_reconciliation_status_check
  check (
    reconciliation_status = any (
      array[
        'pending'::text,
        'in_reconciliation'::text,
        'reconciled'::text,
        'not_applicable'::text
      ]
    )
  );
