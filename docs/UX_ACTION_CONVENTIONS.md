# Convención UX de acciones

## Regla general

En listados, fichas e históricos, las acciones secundarias deben mostrarse de forma compacta y consistente:

- Editar: icono de lápiz (`EditOutlined`).
- Anular / archivar: icono de papelera (`DeleteOutline`).
- Reactivar: icono de restaurar (`RestoreFromTrashOutlined`).

Todos los iconos deben incluir `Tooltip` y `aria-label` con la acción exacta.

## Semántica

El icono de papelera no implica borrado físico. En registros financieros y clínicos se conserva la trazabilidad:

- Pagos: Anular pago.
- Reembolsos: Anular reembolso.
- Clientes, productos y servicios: Archivar.

Los registros conciliados deben bloquear acciones que alteren el histórico financiero.

## Confirmaciones

Las acciones destructivas o reversibles deben pedir confirmación y, cuando corresponda, un motivo. Anular nunca debe borrar el registro original.

Esta convención se debe aplicar a todos los módulos nuevos y durante las revisiones de módulos existentes.
