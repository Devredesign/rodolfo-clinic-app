alter table public.finance_inbox_entries
  add column if not exists procedure_id uuid references public.procedures(id) on delete set null,
  add column if not exists receiver text check (receiver is null or receiver in ('rodolfo','clinic')),
  add column if not exists due_date date;

create index if not exists finance_inbox_entries_procedure_idx on public.finance_inbox_entries(procedure_id);
