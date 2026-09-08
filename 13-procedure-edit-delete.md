# 13 — Edición y eliminación segura de procedimientos

## Decisión

Los procedimientos pueden corregirse o eliminarse desde su detalle, pero únicamente mientras no tengan movimientos históricos que deban preservarse.

La edición/eliminación completa se reserva al rol `admin`.

## Edición

Mientras el procedimiento esté limpio, el administrador puede editar:
- cliente,
- servicio,
- estado (realizado / programado),
- fecha y hora,
- checkbox de seguimiento,
- notas,
- productos realmente utilizados y cantidades.

Al cambiar de servicio se cargan los productos sugeridos del nuevo servicio, pero siguen siendo editables antes de guardar.

La actualización se ejecuta mediante `admin_update_clean_procedure`, que reemplaza procedimiento + productos dentro de una operación transaccional y vuelve a tomar snapshots de nombre/precio del servicio y costo vigente de los productos.

## Cuándo se bloquea la edición

No se permite editar un procedimiento que ya tenga cualquiera de estos vínculos:
- pagos (`payment_procedures`),
- items de conciliación (`reconciliation_payment_items`),
- movimientos de crédito de cliente (`client_credit_transactions`),
- consumo de inventario ya registrado (`procedure_products.inventory_outcome`).

Esto evita reescribir retrospectivamente pagos, conciliaciones o inventario.

## Eliminación

El botón **Eliminar** aparece para admin únicamente cuando el procedimiento sigue limpio.

La eliminación se ejecuta mediante `admin_delete_clean_procedure` y:
1. valida nuevamente que no existan movimientos financieros/inventario,
2. elimina las tareas automáticas asociadas al procedimiento (`procedure_collection`, `procedure_followup`, `procedure_remarketing`),
3. elimina el procedimiento,
4. `procedure_products` se eliminan por cascade.

Si ya existen movimientos históricos, la app bloquea la eliminación y muestra el motivo. No se intenta revertir silenciosamente inventario, pagos ni conciliaciones.

## UX

En el detalle de un procedimiento limpio aparecen:
- **Editar**,
- **Eliminar**,
- **Registrar consumo** cuando corresponde.

Si ya tiene movimientos asociados, Editar/Eliminar se ocultan y se muestra un aviso indicando que el historial está protegido.

## Motivo de diseño

Este comportamiento permite corregir errores de digitación durante la preparación/QA sin introducir inconsistencias después de que el procedimiento ya tuvo consecuencias financieras o físicas en inventario.
