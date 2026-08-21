# 02 — Especificación funcional

## Módulos

### Inicio
No mostrar grandes resúmenes financieros.
Debe priorizar:
- tareas pendientes,
- alertas,
- remarketing,
- pedidos,
- pagos pendientes,
- productos bajos,
- protocolos/seguimientos.

### Clientes
- Crear, editar y consultar.
- Buscar por nombre, cédula o teléfono.
- Mostrar:
  - nombre,
  - cédula,
  - teléfono,
  - correo,
  - fecha de nacimiento,
  - notas,
  - nivel,
  - historial de procedimientos,
  - pagos,
  - remarketing,
  - protocolos.
- Niveles: Bronze, Silver, Gold, Platinum.
- Nivel inicialmente basado en cantidad de pagos; dejar configurable.

### Servicios
Catálogo maestro.
Campos:
- nombre,
- precio USD,
- costo estándar,
- regla de remarketing,
- productos habituales,
- cantidad estándar de cada producto,
- activo/inactivo.

Solo Admin modifica precios/costos/reglas.

### Procedimientos
Instancia real de un servicio.
Campos:
- paciente,
- servicio,
- fecha programada,
- fecha realizada,
- estado procedimiento,
- estado pago,
- productos realmente utilizados,
- notas,
- valores históricos del servicio.

Estados procedimiento:
- Pendiente
- Realizado
- Cancelado

Estados pago:
- Pendiente
- Pagado
- Parcial (preparado para futuro)
- Reembolsado/Anulado

### Productos
Catálogo maestro.
Campos:
- nombre,
- marca,
- proveedor habitual,
- tipo uso,
- costo USD actual,
- activo/inactivo,
- histórico de precios.

### Inventario
- unidades cerradas,
- frascos abiertos,
- vencimiento,
- movimientos,
- ajustes,
- compras,
- histórico de precios,
- gráfico de líneas de compras por producto.

### Pagos de clientes
- cliente,
- fecha,
- monto,
- moneda,
- descuento,
- método,
- origen del dinero,
- referencia,
- procedimientos asociados,
- estado,
- conciliación.

### Métodos de pago
- Efectivo
- SINPE
- Transferencia
- Tarjeta
- Tasa Cero 3 meses

### Gastos
- categoría,
- moneda,
- monto,
- fecha,
- vencimiento,
- estado,
- notas,
- comprobante,
- relación opcional con producto.

### Categorías de gasto
Creables/editables por Admin.
Alimentan dropdown de gastos.

### Cuentas por pagar
Estados:
- Pendiente
- Parcial
- Pagada
- Vencida
- Cancelada

Cada cuenta:
- proveedor/concepto,
- moneda,
- monto,
- saldo,
- vencimiento,
- pagos asociados.

### CRM / Tareas
Estados:
- Pendiente
- Realizada
- Archivada

Filtros:
- fecha desde/hasta,
- responsable,
- categoría,
- paciente,
- estado.

Tareas pueden crearse:
- manualmente,
- automáticamente por remarketing,
- automáticamente por gasto/cuenta pendiente,
- automáticamente por stock bajo,
- automáticamente por protocolos.

### Conciliación
Debe registrar por separado:
- Rodolfo → Clínica: Pendiente/Pagado
- Clínica → Rodolfo: Pendiente/Pagado

Solo se puede cerrar una conciliación cuando ambas obligaciones estén Pagadas.

CRC y USD se concilian por separado.
