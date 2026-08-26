# Conciliación: monedas y anulaciones

## Decisiones

- USD y CRC se concilian por separado. Los montos de transferencia entre Clínica y Rodolfo no se convierten ni se mezclan.
- Cada conciliación genera hasta cuatro transferencias: Clínica→Rodolfo USD, Clínica→Rodolfo CRC, Rodolfo→Clínica USD y Rodolfo→Clínica CRC. Si una no tiene monto, queda como `not_required`.
- La conciliación solo puede cerrarse cuando todas las transferencias requeridas de ambas monedas estén pagadas.
- Los pagos en CRC conservan su monto nativo; su tipo de cambio snapshot se usa únicamente para reportes analíticos equivalentes en USD y para costos que requieran comparación.
- Los pagos en USD conservan su monto nativo en USD.
- Una conciliación cerrada también puede anularse. La anulación exige motivo, conserva el registro histórico y devuelve los pagos incluidos a estado `pending` para poder generar una nueva conciliación.
- Una conciliación anulada nunca se elimina físicamente.
- Las conciliaciones abiertas pueden editar rango o recalcular; al recalcular se reconstruyen sus pagos y transferencias y cualquier transferencia previamente marcada como pagada vuelve a pendiente si corresponde.

## Modelo

Se agregó `reconciliation_transfers` para separar dirección y moneda, y campos de monto nativo en `reconciliation_payment_items`. `reconciliation_batches` conserva métricas USD/CRC y un margen equivalente en USD para análisis, sin usar ese equivalente para las transferencias reales.

## Regla de integridad

Las transferencias reales usan siempre la moneda original del pago. El equivalente USD es solo informativo y no debe sustituir el ledger nativo de CRC o USD.
