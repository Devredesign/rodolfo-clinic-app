alter table public.services add column if not exists remarketing_enabled boolean not null default false;
alter table public.services add column if not exists remarketing_value integer;
alter table public.services add column if not exists remarketing_unit text;
-- Remarketing is automatic per service; clinical follow-up remains opt-in per procedure.
-- Database functions/triggers are applied in the project migration history.