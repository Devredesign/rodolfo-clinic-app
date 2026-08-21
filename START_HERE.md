# START HERE — Contexto maestro

Este archivo está pensado para abrir un nuevo chat o incorporar una persona nueva al proyecto sin perder el contexto.

## Qué estamos construyendo

Una webapp responsive, mobile-first, para el Dr. Rodolfo Cabezas, médico estético que atiende pacientes propios dentro de una clínica.

Rodolfo trabaja con una secretaria/asistente (Andrea) y necesita controlar de forma independiente:

- clientes y su historial,
- servicios y procedimientos,
- inventario,
- pagos,
- 70/30 con la clínica,
- comisiones bancarias,
- IVA,
- gastos,
- cuentas por pagar,
- CRM/remarketing,
- tareas operativas.

## Principio central

La app debe ser un **sistema interdependiente**.

Ejemplos:

- Crear cliente → aparece inmediatamente en dropdown de procedimiento.
- Crear producto → aparece en inventario, compras, servicios, procedimientos y gastos de insumos.
- Registrar procedimiento → actualiza historial, inventario, estado de pago y remarketing.
- Registrar pago → actualiza estado del procedimiento, 70/30, conciliación y margen.
- Registrar compra → actualiza inventario, histórico de precio y cuenta por pagar.
- Registrar gasto pendiente con vencimiento → puede crear tarea CRM automáticamente.
- Pagar una cuenta → actualiza cuenta, histórico financiero y tarea CRM asociada.

## Usuarios

### Rodolfo — Administrador
Acceso total. Puede editar precios, costos, reglas, catálogos, usuarios, finanzas y configuraciones.

### Andrea — Asistente
Puede registrar operaciones necesarias, pero no debe acceder a información financiera sensible ni cambiar precios/reglas maestras.

## Terminología final

- **Servicio**: catálogo maestro de lo que Rodolfo ofrece (Botox, relleno, Profilo, etc.).
- **Procedimiento**: instancia real de un servicio aplicado o programado para un paciente.
- **Producto**: ítem maestro de inventario.
- **Pago**: dinero recibido de un paciente.
- **Cuenta por pagar**: obligación financiera pendiente.
- **Conciliación**: cierre 70/30 entre Rodolfo y clínica.
- **CRM/Tarea**: acción pendiente, realizada o archivada.

## Reglas financieras clave

- Servicio tiene precio maestro en USD.
- El tipo de cambio editable sirve para cotizar/convertir cuando corresponde.
- El registro final conserva la moneda real del movimiento.
- CRC y USD se reportan por separado.
- 70/30 se calcula sobre el monto final pagado por el paciente, después de descuentos y antes de comisiones.
- Rodolfo recibe 70%; clínica 30%.
- Si el pago entra por datáfono de Rodolfo, Rodolfo absorbe comisión.
- Datáfono estándar: 6.5%.
- Tasa Cero 3 meses: 6.5% + 4% = 10.5%.
- Si el pago entra por datáfono de clínica, la comisión la absorbe clínica y no se registra como gasto de Rodolfo.
- IVA 4% está incluido dentro de la parte de Rodolfo y se extrae para calcular margen.
- IVA incluido = parte Rodolfo × 4 / 104.
- El 70/30 no se altera por IVA ni por comisión bancaria.

## Inventario

Hay productos:
- de un solo uso,
- multiuso reutilizable.

Para multiuso **no se mide remanente exacto**.

Se controla:
- unidades cerradas,
- frascos abiertos,
- fecha de apertura,
- estado: abierto / agotado / descartado.

Siempre se prioriza usar el frasco abierto más antiguo.

El costo económico estándar de un servicio puede usar fracciones de una unidad aunque físicamente no se mida el remanente.

## Margen

Margen estándar de un procedimiento:

Parte Rodolfo 70%
- IVA 4% incluido
- comisiones bancarias que asume Rodolfo
- costo estándar de productos
= margen estimado del procedimiento

A nivel global:
márgenes
- mermas
- otros gastos
= resultado neto estimado

## Estado del proyecto

La maqueta final V3.0 ya existe y funciona localmente.

Siguiente etapa:
1. congelar modelo funcional,
2. diseñar base de datos,
3. definir backend/autenticación/hosting,
4. implementar webapp real,
5. probar con Rodolfo y Andrea,
6. desplegar.
