# 15 — Corrección tardía de procedimientos

## Problema

En operación real un error puede descubrirse después de que el procedimiento ya produjo consecuencias: consumo de inventario, apertura de frascos multiuso, tareas, pagos u otros movimientos posteriores.

La app no debe obligar a elegir entre borrar historia real o dejar un error imposible de corregir.

## Regla general

- Si el procedimiento está limpio, puede editarse o eliminarse.
- Si todas sus consecuencias todavía son reversibles, puede usarse la reversión completa existente.
- Si existe historia posterior, se usa **Corregir procedimiento**: el procedimiento se anula, se restauran únicamente los movimientos físicos que siguen siendo seguros y se preserva el estado actual de todo contenedor con movimientos posteriores.
- Pagos, créditos o conciliaciones vinculadas no se modifican silenciosamente. Deben resolverse primero mediante su flujo financiero correspondiente.

La regla de diseño es:

> Lo que todavía no produjo consecuencias se edita. Lo que ya produjo historia se corrige mediante movimientos compensatorios y conserva trazabilidad.

## Vista previa de corrección

RPC: `admin_preview_procedure_correction`.

Antes de cambiar datos, analiza:
- pagos vinculados,
- items de conciliación,
- movimientos de crédito,
- contenedores afectados por el procedimiento,
- movimientos posteriores de cada contenedor.

Para cada contenedor devuelve una acción propuesta:
- `restore`: puede restaurarse físicamente,
- `preserve_history`: tiene movimientos posteriores; no se modifica su estado físico,
- `audit_only`: no requiere ajuste físico, pero se registra la corrección.

La interfaz muestra este plan antes de habilitar la confirmación.

## Anulación con historia preservada

RPC: `admin_cancel_procedure_preserving_history`.

Solo admin puede ejecutarla y debe indicar un motivo. La función valida que el usuario que firma la corrección sea el usuario autenticado.

Si existen pagos, créditos o conciliaciones relacionados, bloquea la ejecución para evitar correcciones financieras implícitas.

Si puede continuar:
1. analiza cada contenedor afectado;
2. restaura unidades single-use que no tengan historia posterior;
3. restaura frascos multiuso cuando su estado previo puede recuperarse con seguridad;
4. si un frasco ya tuvo movimientos posteriores, mantiene exactamente su estado físico actual;
5. crea movimientos compensatorios `movement_type = reversal` con `reference_type = procedure_cancellation`;
6. archiva tareas pendientes de cobro, seguimiento y remarketing asociadas;
7. marca el procedimiento `cancelled`;
8. guarda `cancelled_at`, `cancelled_by` y `cancellation_reason`;
9. desactiva seguimiento y deja el pago del procedimiento en estado `voided` cuando no existen pagos vinculados.

Los movimientos de inventario originales no se borran.

## Diferencia entre reversión y corrección tardía

### Revertir consumo

`admin_reverse_procedure_inventory` sigue siendo útil cuando todo el inventario afectado puede devolverse sin alterar historia posterior.

### Corregir procedimiento

Se usa cuando el error fue descubierto tarde y existen movimientos posteriores. Permite que una parte del inventario se restaure y otra conserve su historia, sin que un solo frasco bloquee toda la corrección.

## Estado `cancelled`

Un procedimiento anulado permanece visible en el histórico y muestra el motivo/fecha de anulación.

Los módulos operativos y analíticos deben tratar `status = cancelled` como un procedimiento no realizado para producción, ranking, seguimiento y rendimiento. Los cálculos que ya filtran `status = performed` quedan naturalmente protegidos.

## Eliminación definitiva

`Eliminar definitivamente` queda reservado a procedimientos limpios, sin pagos, conciliaciones, créditos ni consumo de inventario.

Un procedimiento con historia no debe borrarse para corregir un error.

## Auditoría

La corrección conserva:
- procedimiento original,
- selección original de productos,
- movimientos físicos originales,
- movimientos posteriores,
- movimientos compensatorios,
- usuario, fecha y motivo de anulación.

Esto permite reconstruir qué ocurrió sin crear contradicciones como cerrar retroactivamente un frasco que después fue utilizado por otro procedimiento.

## Limitación intencional de esta versión

La primera versión automatiza la corrección tardía de inventario y tareas. Si encuentra pagos, créditos o conciliaciones, informa el bloqueo y exige resolverlos mediante su flujo específico antes de continuar.

Esto evita que una corrección de procedimiento modifique dinero silenciosamente. Una futura capa de corrección financiera puede reutilizar el mismo patrón de `preview → plan → confirmación → movimientos compensatorios`.
