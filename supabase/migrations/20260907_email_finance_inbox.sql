-- Email-driven finance inbox staging layer.
-- Raw email-derived records are reviewed by an admin before they touch operational finance tables.

create table if not exists public.finance_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null default 'gmail' check (source in ('gmail','manual')),
  source_message_id text not null,
  source_thread_id text,
  sender_email text,
  sender_name text,
  subject text,
  received_at timestamptz,
  body_excerpt text,
  processing_status text not null default 'received' check (processing_status in ('received','processing','processed','needs_review','error','ignored')),
  raw_headers jsonb not null default '{}'::jsonb,
  processing_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, source_message_id)
);

create table if not exists public.finance_inbox_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.finance_inbox_messages(id) on delete cascade,
  source_attachment_id text,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  sha256 text,
  parsed_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (message_id, source_attachment_id)
);

create table if not exists public.finance_inbox_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.finance_inbox_messages(id) on delete cascade,
  primary_document_id uuid references public.finance_inbox_documents(id) on delete set null,
  entry_type text not null default 'unknown' check (entry_type in ('income','expense','unknown')),
  status text not null default 'detected' check (status in ('detected','needs_review','confirmed','sent','ignored','error')),
  document_date date,
  currency text check (currency in ('CRC','USD')),
  amount numeric(14,2) check (amount is null or amount >= 0),
  counterparty_name text,
  description text,
  category_id uuid references public.expense_categories(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  external_reference text,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  extraction jsonb not null default '{}'::jsonb,
  dedupe_key text,
  review_notes text,
  confirmed_by uuid,
  confirmed_at timestamptz,
  sent_record_type text check (sent_record_type is null or sent_record_type in ('payment','expense','purchase')),
  sent_record_id uuid,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);

create index if not exists finance_inbox_messages_org_received_idx on public.finance_inbox_messages(organization_id, received_at desc);
create index if not exists finance_inbox_entries_org_status_idx on public.finance_inbox_entries(organization_id, status, created_at desc);
create index if not exists finance_inbox_entries_message_idx on public.finance_inbox_entries(message_id);
create index if not exists finance_inbox_documents_message_idx on public.finance_inbox_documents(message_id);

alter table public.finance_inbox_messages enable row level security;
alter table public.finance_inbox_documents enable row level security;
alter table public.finance_inbox_entries enable row level security;

drop policy if exists finance_inbox_messages_admin_all on public.finance_inbox_messages;
create policy finance_inbox_messages_admin_all on public.finance_inbox_messages
for all to authenticated
using ((select private.is_org_admin(organization_id)))
with check ((select private.is_org_admin(organization_id)));

drop policy if exists finance_inbox_documents_admin_all on public.finance_inbox_documents;
create policy finance_inbox_documents_admin_all on public.finance_inbox_documents
for all to authenticated
using ((select private.is_org_admin(organization_id)))
with check ((select private.is_org_admin(organization_id)));

drop policy if exists finance_inbox_entries_admin_all on public.finance_inbox_entries;
create policy finance_inbox_entries_admin_all on public.finance_inbox_entries
for all to authenticated
using ((select private.is_org_admin(organization_id)))
with check ((select private.is_org_admin(organization_id)));

grant select, insert, update, delete on public.finance_inbox_messages to authenticated;
grant select, insert, update, delete on public.finance_inbox_documents to authenticated;
grant select, insert, update, delete on public.finance_inbox_entries to authenticated;

drop trigger if exists finance_inbox_messages_set_updated_at on public.finance_inbox_messages;
create trigger finance_inbox_messages_set_updated_at before update on public.finance_inbox_messages
for each row execute function public.set_updated_at();

drop trigger if exists finance_inbox_entries_set_updated_at on public.finance_inbox_entries;
create trigger finance_inbox_entries_set_updated_at before update on public.finance_inbox_entries
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-inbox',
  'finance-inbox',
  false,
  10485760,
  array['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp','text/plain']
)
on conflict (id) do nothing;

drop policy if exists finance_inbox_storage_select_admin on storage.objects;
create policy finance_inbox_storage_select_admin on storage.objects
for select to authenticated
using (
  bucket_id = 'finance-inbox'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = (select auth.uid())
      and om.active = true
      and om.role = 'admin'
      and om.organization_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists finance_inbox_storage_insert_admin on storage.objects;
create policy finance_inbox_storage_insert_admin on storage.objects
for insert to authenticated
with check (
  bucket_id = 'finance-inbox'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = (select auth.uid())
      and om.active = true
      and om.role = 'admin'
      and om.organization_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists finance_inbox_storage_update_admin on storage.objects;
create policy finance_inbox_storage_update_admin on storage.objects
for update to authenticated
using (
  bucket_id = 'finance-inbox'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = (select auth.uid())
      and om.active = true
      and om.role = 'admin'
      and om.organization_id::text = (storage.foldername(name))[1]
  )
)
with check (
  bucket_id = 'finance-inbox'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = (select auth.uid())
      and om.active = true
      and om.role = 'admin'
      and om.organization_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists finance_inbox_storage_delete_admin on storage.objects;
create policy finance_inbox_storage_delete_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'finance-inbox'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = (select auth.uid())
      and om.active = true
      and om.role = 'admin'
      and om.organization_id::text = (storage.foldername(name))[1]
  )
);
