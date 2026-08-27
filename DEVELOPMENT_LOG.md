# Development Log — Rodolfo Clinic App

Este archivo registra la implementación real, las decisiones técnicas y el motivo de cada paso. Su objetivo es permitir que otro desarrollador pueda continuar el proyecto sin depender del historial de conversaciones.

> Para el estado vigente y una entrada rápida al proyecto, leer primero `START_HERE.md`.

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

Se creó el esquema V1 con áreas de organizaciones/usuarios, clientes, servicios, procedimientos, productos/inventario, compras, pagos, gastos/cuentas por pagar, CRM/tareas, conciliaciones y auditoría.

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

Se separó el costo económico estándar del consumo físico. Un producto multiuso puede tener contenedores `closed`, `open`, `depleted`, `discarded`. No se exige medir remanente exacto.

---

## 2026-08-22 — RLS y permisos

Se habilitó Row Level Security y aislamiento por `organization_id`.

Roles V1:
- `admin`: Rodolfo.
- `assistant`: operación limitada, sin finanzas sensibles/configuración maestra.

Principios:
- solo miembros activos acceden a su organización,
- clientes/procedimientos/inventario/tareas son operativos,
- definiciones maestras/precios son admin,
- finanzas/conciliaciones/auditoría son admin,
- assistant puede registrar operaciones permitidas pero no consultar administración financiera completa.

Se agregó trigger Auth para crear `profiles`; posteriormente se bloqueó ejecución RPC directa del trigger `SECURITY DEFINER`. Security Advisor quedó sin lints en esa revisión.

---

## 2026-08-23 — Configuración inicial y pruebas RLS

Se configuró al Dr. Rodolfo Cabezas como admin de su organización, con módulos, categorías, métodos de pago y configuración económica inicial.

Se validó RLS simulando admin y usuario sin membresía. El usuario sin organización no pudo leer ni insertar datos tenant, confirmando aislamiento en base y no solo en frontend.

---

## 2026-08-23 — Primer vertical slice frontend

Se agregó `/frontend` con React + Vite + MUI + Supabase JS:
- login,
- recuperación de sesión,
- organización/rol,
- clientes,
- búsqueda,
- alta responsive,
- logout.

Las variables públicas de conexión se mantienen fuera de Git mediante entorno.

---

## 2026-08-24 a 2026-08-26 — Construcción de módulos interdependientes

Se evolucionó la app desde CRUDs independientes hacia flujos conectados.

### Productos, compras e inventario

- catálogo de productos,
- tipos single-use/multi-use,
- contenedores físicos para multiuso,
- compras que alimentan inventario,
- costo unitario de compra precargado desde costo actual y editable,
- cambiar costo en compra actualiza costo vigente e historial,
- compras editables,
- compra pendiente genera tarea CRM,
- registrar pago desde Finanzas actualiza compra y completa tarea,
- consumo de inventario desde procedimientos,
- soporte para frasco abierto/cerrado y agotamiento.

### Servicios y procedimientos

- catálogo de servicios,
- productos/cantidades estándar por servicio,
- procedimiento asociado a paciente,
- productos adicionales,
- estados pagado/pendiente,
- métodos de pago y comisiones,
- consumo de inventario,
- seguimiento opcional mediante checkbox,
- plazo de seguimiento y remarketing derivados de configuración.

### Clientes

- historial de procedimientos/pagos,
- nivel/ranking alimentado por actividad,
- representación visual del nivel con badge/color.

---

## 2026-08-26 — CRM v2

Se formalizó el CRM como bandeja operativa central.

Categorías base:
- Seguimiento,
- Remarketing,
- Cobros,
- Compras,
- Inventario,
- Finanzas,
- Conciliación,
- Administrativa,
- General.

`category_id` define clasificación; `reference_type/reference_id` define origen.

UX/acciones:
- filtros por categoría/fecha,
- vencidas/hoy diferenciadas,
- WhatsApp para tareas vinculadas a cliente,
- seguimiento abre cliente/procedimiento,
- compra pendiente ofrece Registrar pago + Ver compra,
- inventario ofrece acciones contextuales,
- responsables múltiples mediante `task_assignees`.

Decisión crítica: tareas automáticas que representan una obligación económica no deben completarse manualmente. Se completan cuando se registra el pago real que resuelve la obligación.

---

## 2026-08-26 — Conciliación semanal

Se consolidó conciliación como cierre por intervalo semanal explícito.

Reglas:
- CRC y USD se concilian por separado,
- prevención de intervalos ya conciliados con mensaje comprensible,
- estados visuales diferenciados,
- posibilidad de anular conciliación,
- obligaciones resultantes pueden generar tareas CRM,
- tareas de pago se completan desde el movimiento financiero real,
- Dashboard admin recuerda próxima conciliación al acercarse una semana desde el último período cerrado.

---

## 2026-08-26/27 — Dashboard y navegación

Se diseñó el Dashboard como vestíbulo operativo, evitando mostrar números financieros sensibles/agresivos como primera experiencia.

Incluye:
- urgentes/hoy,
- seguimientos,
- cobros,
- inventario bajo mínimo,
- recordatorio de conciliación para admin,
- accesos rápidos.

Se agregaron iconos de navegación y accesos contextuales entre módulos relacionados.

El 27-08 se compactaron las tarjetas: 4 métricas en una fila en desktop y 2×2 en móvil cuando el ancho lo permite, reduciendo padding/altura para lectura de una sola mirada.

---

## 2026-08-27 — Resumen financiero

`Resumen financiero` se incorporó al grupo Finanzas y como acceso desde Dashboard para admin.

Filtros separados:
- mes,
- año.

KPIs renombrados para claridad operativa:
- Procedimientos realizados,
- Pagos recibidos,
- Gastos pagados,
- Margen de Rodolfo.

Visualizaciones:
- líneas históricas: Entradas vs Gastos vs Margen,
- pastel: rendimiento estimado agrupado por servicio/procedimiento.

Rendimiento estimado:
`parte Rodolfo - IVA - comisión aplicable - costo estándar de productos`.

Se documenta como estimación operativa, no utilidad contable auditada.

---

## 2026-08-27 — Usuarios, invitaciones y Auth

Se implementó administración de usuarios para admin, reglas de responsables automáticos y Edge Functions de invitación/eliminación.

Problemas encontrados y resolución:
1. CORS en Edge Function de invitación: se ajustó función para frontend local/producción.
2. Redirect de invitación mal configurado: Supabase Site URL/Redirect URLs deben usar URL absoluta con `https://`.
3. Funciones protegidas devolvían `Missing authorization header`: frontend actualizado para enviar explícitamente `Authorization: Bearer <access_token>`.
4. Supabase devolvió `email rate limit exceeded` después de múltiples pruebas. No era bug de la app.

Para continuar QA se creó temporalmente un usuario assistant desde Supabase Auth y se vinculó a la organización. Debe eliminarse al terminar QA.

Pendiente: pulir onboarding para que una invitación nueva obligue a establecer contraseña antes de mostrar Dashboard.

---

## 2026-08-27 — Primer deploy de producción / inicio de QA real

Frontend desplegado en Vercel:
`https://rodolfo-clinic-app.vercel.app`

Configuración:
- GitHub repo: `Devredesign/rodolfo-clinic-app`,
- producción desde `main`,
- Root Directory: `frontend`,
- Vite build,
- variables públicas Supabase configuradas en Vercel.

Supabase Authentication debe mantener la URL de Vercel como Site URL y localhost únicamente como redirect adicional de desarrollo cuando sea necesario.

### Limpieza para QA

Antes de entregar el flujo a Rodolfo se eliminaron datos operativos de prueba:
- clientes,
- procedimientos,
- pagos/reembolsos/créditos de prueba,
- gastos/pagos de gastos,
- compras/items,
- inventario/contenedores/movimientos,
- conciliaciones/items/transferencias,
- tareas/asignaciones operativas,
- productos/servicios/proveedores de prueba.

Se conservaron deliberadamente:
- organización,
- configuración estructural,
- módulos,
- métodos de pago,
- categorías base,
- reglas automáticas,
- usuarios necesarios para QA.

Objetivo: Rodolfo comienza el QA cargando información real desde cero sin reconstruir la configuración del sistema.

---

## Estado de entrega al 27-08-2026

**Implementado y desplegado:** Auth, roles/RLS, Dashboard, clientes, CRM, productos, inventario, compras, servicios, procedimientos, pagos/finanzas, conciliación, resumen financiero, navegación contextual y administración básica de usuarios.

**En QA:** flujos completos con datos reales, permisos assistant, conciliación CRC/USD, responsive y lectura de métricas.

**Problemas conocidos:** onboarding de invitación/contraseña y límite de email de Supabase durante pruebas intensivas.

**Próximo trabajo:** corregir observaciones de Rodolfo durante QA, cerrar onboarding definitivo y hacer una pasada final de seguridad/UX/documentación antes de considerar V1 estable.
