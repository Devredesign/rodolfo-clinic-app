-- Initial tenant configuration for Dr. Rodolfo Cabezas.
-- This file contains reproducible application seed data only.
-- Auth users are intentionally NOT hardcoded here.

insert into public.organizations(name,slug,default_fx_crc_per_usd,settings)
values (
  'Dr. Rodolfo Cabezas',
  'rodolfo-cabezas',
  515,
  '{"rodolfo_share_rate":0.70,"clinic_share_rate":0.30,"vat_rate":0.04}'::jsonb
)
on conflict(slug) do update
set name=excluded.name,
    settings=public.organizations.settings || excluded.settings;

insert into public.organization_modules(organization_id,module_key,enabled)
select o.id,m.module_key,true
from public.organizations o
cross join (values ('crm'),('inventory'),('payments'),('finance'),('analytics')) m(module_key)
where o.slug='rodolfo-cabezas'
on conflict(organization_id,module_key) do update set enabled=excluded.enabled;

insert into public.expense_categories(organization_id,name)
select o.id,c.name
from public.organizations o
cross join (values
  ('Publicidad'),('Insumos'),('Capacitación'),('Viajes'),
  ('Software'),('Equipo'),('Transporte'),('Otros')
) c(name)
where o.slug='rodolfo-cabezas'
on conflict(organization_id,name) do nothing;

insert into public.payment_methods(organization_id,key,label,fee_rate)
select o.id,p.key,p.label,p.fee_rate
from public.organizations o
cross join (values
  ('cash','Efectivo',0::numeric),
  ('sinpe','SINPE',0::numeric),
  ('transfer','Transferencia',0::numeric),
  ('card','Tarjeta',0.065::numeric),
  ('tasa_cero_3m','Tasa Cero 3 meses',0.105::numeric)
) p(key,label,fee_rate)
where o.slug='rodolfo-cabezas'
on conflict(organization_id,key) do update
set label=excluded.label, fee_rate=excluded.fee_rate;
