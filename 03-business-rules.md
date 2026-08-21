# 03 — Reglas de negocio

1. Los datos maestros se crean una sola vez y alimentan todos los módulos relacionados.
2. Cambios de precio/costo no modifican históricos.
3. Solo Admin modifica precios, costos y reglas financieras.
4. Los registros históricos guardan snapshot de valores relevantes.
5. Un procedimiento puede usar múltiples productos.
6. Un pago puede cubrir uno o varios procedimientos.
7. Un procedimiento puede existir pagado pero pendiente de realizar.
8. Un procedimiento realizado puede quedar pendiente de pago.
9. Un pago anticipado crea o se vincula con procedimiento futuro.
10. Los pagos no se borran físicamente: se anulan.
11. Las cuentas por pagar guardan histórico de pagos.
12. Las tareas realizadas pueden archivarse.
13. Los gastos pendientes pueden crear tarea CRM con vencimiento.
14. Al pagar un gasto/cuenta, su tarea vinculada puede pasar a Realizada.
15. Si se edita/anula un pago, recalcular 70/30, comisiones, conciliación y margen.
16. Crear producto debe alimentarlo inmediatamente en:
   - inventario,
   - compra,
   - servicios,
   - procedimientos,
   - gastos de insumos.
17. Registrar compra:
   - incrementa inventario,
   - registra costo real,
   - actualiza histórico de precio,
   - crea cuenta por pagar si aplica.
18. Los productos multiuso no usan remanente exacto.
19. Siempre priorizar producto abierto.
20. Frasco abierto termina como:
   - sigue abierto,
   - agotado,
   - descartado.
21. Descartes/ineficiencias se reflejan como merma estimada.
