# Development Log — Rodolfo Clinic App

Este archivo registra la implementación real, las decisiones técnicas y el motivo de cada paso. Su objetivo es permitir que otro desarrollador pueda continuar el proyecto sin depender del historial de conversaciones.

## Arquitectura acordada

- Frontend: React + Vite + MUI.
- Backend/data platform: Supabase (PostgreSQL, Auth, RLS; Storage cuando sea necesario).
- Deploy frontend: Vercel.
- Código y migraciones: GitHub.
- Casa Luarma permanece como proyecto independiente.
- V1 se diseña para Rodolfo, pero el modelo de datos es tenant-ready mediante `organizations` + `organization_id` para una posible evolución futura a MyClinic.
- No se construye todavía billing SaaS, planes ni onboarding multi-clínica.

## Regla de mantenimiento

Todo cambio de estructura de base de datos debe:
1. Aplicarse como migración en Supabase.
2. Guardarse en `supabase/migrations/`.
3. Documentar aquí las decisiones que cambien arquitectura o reglas del negocio.
4. Revisar los Security Advisors de Supabase después de DDL/RLS relevante.

---

## 2026-08-22 — Creación del proyecto Supabase

Proyecto: `rodolfo-clinic-app`.

Estado inicial verificado: proyecto nuevo, sin tablas de aplicación en `public`.

### Migración 001 — `initial_app_schema`

Se creó el esquema V1 con 26 tablas.

Áreas principales:
- organizaciones y usuarios,
- clientes,
- servicios,
- procedimientos,
- productos e inventario,
- compras,
- pagos,
- gastos y cuentas por pagar,
- CRM/tareas,
- conciliaciones,
- auditoría.

### Decisiones económicas preservadas como snapshots

Para no reescribir el pasado cuando cambien configuraciones futuras:
- el procedimiento guarda nombre/precio del servicio al momento de realizarse,
- el costo estándar de productos usados se guarda como snapshot,
- los pagos guardan tipo de cambio cuando corresponde,
- participación Rodolfo 70%, clínica 30%,
- IVA/control fiscal 4%,
- comisión bancaria del método de pago.

USD y CRC se mantienen como registros separados; el tipo de cambio sirve para conversión/cálculo, no para convertir silenciosamente todo el histórico a una sola moneda.

### Inventario

Se separó el costo económico estándar del consumo físico.

Un producto multiuso puede tener un frasco/contenedor con estado:
- closed,
- open,
- depleted,
- discarded.

No se exige medir el remanente físico exacto. La app puede priorizar frascos abiertos y documentar descarte/desperdicio, mientras la rentabilidad usa la cantidad estándar definida para el servicio.

---

## 2026-08-22 — RLS y permisos

### Migración 002 — `tenant_rls_and_auth_profiles`

Se habilitó Row Level Security en las 26 tablas públicas y se implementó aislamiento por `organization_id`.

Roles V1:
- `admin`: Rodolfo.
- `assistant`: Andrea.

Principios:
- un usuario autenticado solo accede a datos de organizaciones de las que es miembro activo,
- clientes/procedimientos/inventario/tareas son operativos para miembros,
- definiciones maestras y precios de productos/servicios son editables solo por admin,
- finanzas, cuentas por pagar, conciliaciones y auditoría son admin-only,
- un assistant puede registrar un pago; el admin controla el historial financiero completo,
- las eliminaciones operativas sensibles se reservan al admin.

Se agregó trigger de Auth para crear automáticamente `profiles` cuando se crea un usuario de Supabase Auth.

### Migración 003 — `lock_down_auth_profile_trigger`

El Security Advisor detectó que `handle_new_auth_user()` era `SECURITY DEFINER` y podía ser invocado como RPC por roles cliente.

Se revocó `EXECUTE` a `public`, `anon` y `authenticated`. El trigger interno sigue funcionando, pero no puede invocarse desde la API.

Resultado después de la corrección: **0 Security Advisor lints**.

## Próximo paso

1. Crear/sembrar la organización `Dr. Rodolfo Cabezas`.
2. Crear usuarios Auth Rodolfo y Andrea.
3. Asociarlos como admin/assistant.
4. Sembrar módulos, categorías de gasto y métodos de pago.
5. Probar RLS con ambos roles antes de conectar React.
