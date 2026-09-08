# 14 — Reversión segura de consumo de inventario

## Objetivo

Permitir corregir o eliminar un procedimiento después de haber registrado consumo de inventario, sin borrar silenciosamente el historial físico.

## Regla

Solo `admin` puede revertir consumo mediante `admin_reverse_procedure_inventory`.

La reversión:
- conserva los movimientos originales;
- crea movimientos compensatorios `movement_type = reversal` con `reference_type = procedure_reversal`;
- restaura el estado de los contenedores cuando es seguro;
- limpia `inventory_outcome`, `inventory_container_id` y `discard_reason` de `procedure_products`;
- vuelve a sincronizar la tarea de stock bajo.

## Single-use

Cada movimiento original `used = -1` del procedimiento se compensa con `reversal = +1` y el contenedor consumido vuelve a `closed`.

Esto permite recuperar correctamente cantidades mayores a 1 aunque `procedure_products.inventory_container_id` solo guarde el último contenedor consumido.

## Multi-use

Si el frasco fue abierto por el mismo procedimiento y no tuvo uso posterior, vuelve a `closed` y se limpia `opened_at`.

Si el frasco ya estaba abierto antes del procedimiento, una reversión de uso normal lo deja abierto.

Si el procedimiento lo marcó como agotado, la reversión recupera la unidad. Vuelve a `closed` si fue abierto por el mismo procedimiento; si ya estaba abierto, vuelve a `open`.

## Protección de historial posterior

Antes de revertir, la RPC revisa todos los contenedores afectados. Si alguno tiene un movimiento posterior perteneciente a otra operación/procedimiento, la reversión se bloquea.

Esto evita cerrar o recuperar un frasco que ya fue utilizado posteriormente por otro paciente.

## UX

Cuando un procedimiento tiene `inventory_outcome`, el detalle muestra **Revertir consumo** para admin.

La confirmación explica que:
- los productos volverán al inventario;
- los movimientos originales permanecerán;
- se crearán movimientos compensatorios;
- después de la reversión, Editar/Eliminar se habilitan únicamente si no existen otras dependencias financieras.

## Flujo recomendado de corrección

1. Anular un pago activo si existe y es anulable.
2. Revertir el consumo de inventario.
3. Confirmar que no queden conciliaciones o créditos asociados.
4. Editar o eliminar el procedimiento.

No se borran movimientos históricos para forzar el desbloqueo.
