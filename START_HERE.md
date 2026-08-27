# START HERE — Contexto maestro

> **Fuente de verdad para retomar el proyecto en un chat nuevo.**
> Actualizado: **27 de agosto de 2026**.

## Qué estamos construyendo

Webapp responsive/mobile-first para el Dr. Rodolfo Cabezas, médico estético independiente que trabaja dentro de una clínica. La aplicación centraliza pacientes, procedimientos, inventario, CRM, pagos, gastos, conciliación con la clínica y análisis financiero.

Stack actual:
- React + Vite + MUI.
- Supabase: PostgreSQL, Auth, RLS y Edge Functions.
- Vercel: frontend de producción.
- GitHub: código, documentación y migraciones.
- Arquitectura tenant-ready mediante `organizations` + `organization_id`, aunque V1 es para una sola organización.

Producción:
- `https://rodolfo-clinic-app.vercel.app`
- rama de producción: `main`.
- Root Directory en Vercel: `frontend`.
- Las variables públicas de Supabase se configuran como variables de entorno en Vercel; nunca guardar secretos en Git.

## Estado al 27-08-2026

La app **ya está desplegada y entró en QA con datos reales**. Ya no estamos en etapa de maqueta.

Antes del QA se eliminaron los datos operativos de prueba para que Rodolfo pueda comenzar desde cero. Se conservaron configuración estructural, organización, métodos de pago, categorías, módulos, reglas y usuarios necesarios.

Usuarios QA actuales:
- Dr. Rodolfo Cabezas — `admin`.
- María José — `assistant` de prueba. Debe eliminarse al terminar el QA; no documentar su contraseña.

## Principio central

La app es un **sistema interdependiente**, no una colección de formularios.

Ejemplos vigentes:
- Crear cliente → disponible en procedimientos y CRM.
- Crear producto → disponible en inventario, compras, servicios y procedimientos.
- Registrar compra → alimenta inventario, histórico de costo y, si queda pendiente, genera tarea CRM.
- Pagar una compra desde Finanzas → actualiza el estado de la compra y completa la tarea automática asociada.
- Registrar procedimiento → historial del paciente + consumo de inventario + pago/pendiente + seguimiento opcional.
- Registrar pago → actualiza procedimiento/cobro y entra en la lógica de conciliación.
- Conciliación cerrada → genera obligaciones/tareas cuando corresponde.
- Las tareas automáticas vinculadas a pagos no deben poder marcarse manualmente como realizadas: se completan al registrar el pago real.

## Navegación y Dashboard

El Dashboard es un **vestíbulo operativo**, no una pantalla financiera invasiva.

Al entrar se priorizan:
- tareas urgentes/hoy,
- seguimientos,
- cobros,
- alertas de inventario,
- recordatorio de conciliación para admin,
- accesos rápidos.

Las tarjetas del Dashboard fueron compactadas para permitir lectura de una sola mirada: cuatro en fila en desktop y 2×2 en móvil cuando el ancho lo permite.

El administrador tiene acceso desde el Dashboard al **Resumen financiero**, pero los números financieros detallados viven en el grupo Finanzas.

Existen accesos contextuales entre módulos relacionados, por ejemplo Procedimientos ↔ Servicios, Inventario ↔ Productos y Finanzas ↔ Resumen financiero/Conciliación.

## Usuarios y permisos

### Admin — Rodolfo
Acceso completo a operación, catálogos, precios, finanzas, conciliación, usuarios y configuración.

### Assistant
Acceso operativo sin información financiera sensible ni administración de usuarios/precios/reglas maestras.

Las tareas manuales registran creador y permiten responsables. Las tareas automáticas usan reglas de asignación configurables por el admin.

La eliminación de un usuario de prueba puede quitar asignaciones de tareas sin borrar las tareas; actividad clínica/financiera histórica real debe impedir un borrado destructivo.

### Invitaciones

Existe Edge Function `invite-organization-user` y flujo de eliminación de usuarios. El frontend debe enviar explícitamente el `Authorization: Bearer <access_token>` al invocar funciones protegidas.

Durante QA se alcanzó el límite de envío de emails de Supabase (`email rate limit exceeded`). Esto no era un error del frontend. Para continuar QA se creó temporalmente el assistant desde Supabase Auth.

**Pendiente de pulido:** al aceptar una invitación, el usuario debe quedar obligado a crear/establecer contraseña antes de entrar al Dashboard. Revisar este flujo después del QA operativo.

## Clientes y ranking

El cliente tiene historial de procedimientos y pagos. El nivel del cliente se alimenta de la actividad/procedimientos y se representa visualmente con badge/color asociado (Bronce, Plata, Oro, etc.).

## Servicios y procedimientos

- **Servicio** = catálogo maestro (Botox, relleno, etc.).
- **Procedimiento** = instancia real para un paciente.
- Un servicio puede definir productos/cantidades estándar y plazos de seguimiento/remarketing.
- El procedimiento puede agregar productos adicionales.
- El procedimiento tiene checkbox **Dar seguimiento**. Si no se marca, no se crea tarea automática de seguimiento.
- Si se marca, el plazo se deriva de la configuración del servicio/procedimiento.
- Remarketing usa su propio plazo configurable y no debe confundirse con seguimiento clínico.

## CRM / tareas

El CRM es la bandeja operativa central.

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

`category_id` clasifica la tarea; `reference_type/reference_id` identifica su origen.

Acciones contextuales implementadas:
- seguimiento/remarketing → WhatsApp del cliente + acceso a cliente/procedimiento,
- compra pendiente → Registrar pago + Ver compra,
- alertas de inventario → acceso al inventario/producto,
- obligaciones de conciliación → deben resolverse mediante el pago correspondiente, no mediante un check manual.

## Inventario

Tipos:
- un solo uso,
- multiuso.

Para multiuso no se mide remanente exacto. Se controlan contenedores/frascos:
- `closed`,
- `open`,
- `depleted`,
- `discarded`.

Se prioriza el frasco abierto más antiguo. Es posible consumir un frasco cerrado cuando corresponde y registrar cuándo un frasco se agota.

Compras:
- producto seleccionado → costo unitario se precarga con el costo actual,
- el costo sigue siendo editable,
- si cambia al guardar compra, ese valor se convierte en el costo actual y alimenta historial de precios,
- una compra pendiente genera tarea CRM,
- al registrar su pago desde Finanzas se actualizan compra y tarea.

## Finanzas

El tipo de cambio editable permanece en **Finanzas**. CRC y USD se registran y concilian por separado; el tipo de cambio sirve para conversión/visualización cuando corresponde, no para destruir la moneda histórica del movimiento.

Reglas base:
- distribución clínica/Rodolfo: 30% / 70% después de descuentos,
- IVA/control fiscal: 4% incluido; no se suma encima del precio,
- IVA incluido de la parte Rodolfo = parte Rodolfo × 4 / 104,
- datáfono Rodolfo: comisión 6.5%,
- Tasa Cero 3 meses: 6.5% + 4% adicional,
- datáfono clínica: la comisión no se carga como costo de Rodolfo.

### Resumen financiero

Está dentro del grupo Finanzas y también accesible desde Dashboard para admin.

Filtros:
- Mes (dropdown),
- Año (dropdown).

KPIs con lenguaje no contable:
- **Procedimientos realizados**: valor de procedimientos del período, aunque estén pendientes de cobro.
- **Pagos recibidos**: dinero efectivamente recibido de pacientes.
- **Gastos pagados**: egresos efectivamente pagados.
- **Margen de Rodolfo**: resultado proveniente de conciliaciones cerradas según reglas económicas.

Visualizaciones:
- gráfico histórico de líneas enfrentando Entradas / Gastos / Margen,
- gráfico de pastel de rendimiento estimado por servicio/procedimiento para el período seleccionado.

Rendimiento estimado por procedimiento/servicio:
`parte Rodolfo - IVA - comisión aplicable - costo estándar de productos`.

No presentar este cálculo como utilidad contable auditada; es rendimiento estimado basado en la información registrada.

## Conciliación

- Las conciliaciones son por intervalo semanal definido, no por mes implícito.
- CRC y USD se concilian por separado.
- No se puede crear una conciliación duplicada para fechas ya conciliadas; la UI debe explicar que esas fechas ya están conciliadas.
- Una conciliación puede anularse; el estado visual debe distinguir abierta/pendiente/cerrada/anulada.
- Para cerrar correctamente deben resolverse las obligaciones/pagos exigidos por el flujo.
- Las tareas derivadas de una obligación de conciliación se completan cuando se registra el pago correspondiente.
- Dashboard admin recuerda revisar la siguiente conciliación al aproximarse una semana desde el último período cerrado.

## Datos y snapshots

El histórico no debe reescribirse al cambiar precios/configuración:
- procedimiento conserva snapshot del servicio/precio,
- consumo conserva costo estándar,
- pagos conservan moneda/tipo de cambio relevante,
- compras alimentan histórico de costo del producto,
- conciliaciones conservan el resultado económico del período.

## QA actual

La base operativa fue limpiada para que Rodolfo cargue información real desde cero.

QA prioritario:
1. Login admin y assistant.
2. Confirmar permisos reales (RLS), no solo menú oculto.
3. Crear cliente.
4. Crear productos/servicios reales.
5. Registrar compra y comprobar inventario + tarea si queda pendiente.
6. Registrar procedimiento y consumo de inventario.
7. Probar pago inmediato y pago pendiente.
8. Probar seguimiento/remarketing y WhatsApp.
9. Probar gasto/cuenta pendiente y cierre automático de tarea al pagar.
10. Ejecutar conciliación semanal CRC y USD.
11. Verificar anulación y prevención de períodos duplicados.
12. Revisar Dashboard y Resumen financiero con datos reales.
13. Probar responsive móvil/desktop.
14. Al terminar QA, eliminar el usuario assistant temporal y volver a probar el onboarding/invitación definitiva.

## Problemas conocidos / pendientes post-QA

- Pulir onboarding de invitación para obligar a establecer contraseña antes de Dashboard.
- Revisar límites/configuración de email de Supabase para uso real de invitaciones.
- Completar QA de permisos assistant con datos reales.
- Ajustar UX/estilos según observaciones de Rodolfo sin cambiar reglas económicas silenciosamente.
- Mantener documentación y migraciones sincronizadas con cada cambio.

## Cómo retomar en un chat nuevo

Dar acceso al repositorio `Devredesign/rodolfo-clinic-app` y pedir explícitamente leer primero:
1. `START_HERE.md` — contexto maestro y estado actual.
2. `DEVELOPMENT_LOG.md` — historia técnica/decisiones.
3. `03-business-rules.md` — reglas de negocio.
4. `06-finance.md` — reglas financieras.
5. `07-inventory.md` — inventario.
6. `08-crm-clients.md` — CRM/clientes.
7. `05-users-permissions.md` — roles/RLS.
8. `supabase/migrations/` — implementación de DB.
9. `frontend/src/` — comportamiento actual del frontend.

Prompt recomendado:

> Estoy continuando el proyecto Rodolfo Clinic App. Usa el repositorio `Devredesign/rodolfo-clinic-app` como fuente de verdad. Lee primero `START_HERE.md` y `DEVELOPMENT_LOG.md`, luego consulta las especificaciones/migraciones relevantes antes de modificar código. La app ya está desplegada y en QA con datos reales. No cambies reglas de negocio o financieras sin señalarlo explícitamente y mantén la documentación actualizada con los cambios que implementes.
