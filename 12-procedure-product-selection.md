# 12 — Productos por procedimiento

## Problema observado en QA

Algunos procedimientos no usan siempre la misma combinación de productos. El producto exacto depende del paciente y solo se conoce al momento de registrar el procedimiento.

El catálogo de productos ya existe en **Productos / Inventario**, por lo que no se deben crear productos nuevos desde Procedimientos: solamente seleccionar productos activos ya registrados.

## Decisión de producto

Se separan claramente dos conceptos:

- **`service_products` = productos sugeridos del servicio.** Funcionan como plantilla/predeterminado.
- **`procedure_products` = productos realmente utilizados/seleccionados para el procedimiento concreto.** Son la fuente de verdad histórica.

Los productos del servicio dejaron de interpretarse como una receta obligatoria.

## Flujo implementado

1. Usuario selecciona cliente y servicio.
2. La app carga `service_products` y los precarga en **Productos utilizados**.
3. Antes de guardar el procedimiento, el usuario puede:
   - quitar cualquiera de los sugeridos,
   - modificar su cantidad,
   - agregar cualquier producto activo del catálogo aunque no esté asociado al servicio,
   - registrar el procedimiento sin productos si el caso no requiere ninguno.
4. Al guardar, la selección final se inserta en `procedure_products` con snapshots de cantidad y costo actual.
5. El consumo físico de inventario se confirma posteriormente desde **Registrar consumo**, usando únicamente las filas guardadas en `procedure_products`.
6. Costo estimado, inventario e indicadores financieros deben usar los productos del procedimiento, no volver a consultar la receta actual del servicio.

## UX

En **Servicios**:
- `Productos utilizados` → `Productos sugeridos`.
- `Cantidad estándar` → `Cantidad sugerida`.
- Se explica que pueden modificarse al registrar cada procedimiento.

En **Nuevo procedimiento**:
- sección `Productos utilizados`,
- sugeridos precargados con badge `Sugerido`,
- productos agregados durante el procedimiento con badge `Agregado`,
- botón `Agregar producto`,
- selector limitado a productos activos ya registrados,
- cantidad editable,
- acción para quitar una fila,
- validación para evitar productos duplicados y cantidades <= 0,
- costo estimado recalculado con la selección final.

En **Detalle del procedimiento**:
- se muestran como `Productos utilizados`, independientemente de si originalmente fueron sugeridos o agregados manualmente.

## Arquitectura / impacto

No fue necesaria una migración de base de datos. El modelo existente ya permitía que `procedure_products.product_id` apuntara a cualquier producto válido de la organización; no existe una restricción que obligue a que el producto también esté en `service_products`.

Por ello el cambio se concentra en UX y lógica de creación del procedimiento, minimizando impacto en:
- inventario,
- costos,
- pagos,
- conciliación,
- analytics,
- historial.

## Regla histórica

Una vez creado el procedimiento, cambiar los productos sugeridos del servicio **no debe alterar** los productos guardados en procedimientos anteriores.

`procedure_products` conserva el snapshot de:
- producto,
- cantidad,
- costo unitario al momento del procedimiento.

## QA específico

Probar al menos:

1. Servicio sin productos sugeridos → agregar 2 productos desde Procedimientos → guardar → confirmar detalle y consumo.
2. Servicio con 2 sugeridos → eliminar 1 → agregar otro no sugerido → cambiar cantidad → guardar.
3. Intentar repetir el mismo producto dos veces → debe bloquear y pedir consolidar cantidad.
4. Cantidad 0 o negativa → debe bloquear.
5. Procedimiento con productos multiuso → confirmar que el diálogo de consumo presenta exactamente la selección guardada y mantiene la lógica de frasco abierto/agotado.
6. Cambiar posteriormente los sugeridos del servicio → procedimiento histórico debe permanecer intacto.
