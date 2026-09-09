# 12 · Bandeja financiera por correo

## Objetivo

Reducir al mínimo la carga administrativa de Rodolfo. En lugar de registrar manualmente cada pago o gasto, Rodolfo reenvía correos financieros a una cuenta dedicada. El sistema prepara los movimientos y Rodolfo solo revisa excepciones y confirma el envío a la app.

Flujo:

`Correo dedicado → procesamiento → bandeja de revisión → confirmación humana → pagos/gastos reales`

## Qué ya existe

### Base de datos de staging

- `finance_inbox_messages`: correo recibido y estado de procesamiento.
- `finance_inbox_documents`: PDFs, XMLs, imágenes y otros documentos soportados.
- `finance_inbox_entries`: movimientos financieros propuestos.
- RLS: solo administradores de la organización pueden acceder.
- Bucket privado `finance-inbox` para documentos originales.

### Interfaz

`Finanzas → Bandeja de correo`

Permite:

- ver movimientos detectados;
- separar entradas y gastos;
- ver nivel de confianza;
- abrir el documento original mediante URL firmada temporal;
- corregir fecha, moneda, monto, contraparte, descripción y referencia;
- asignar categoría cuando es gasto;
- asignar procedimiento, método de pago y cuenta receptora cuando es ingreso;
- ignorar falsos positivos;
- confirmar movimientos;
- enviar por lote los movimientos confirmados a la app.

Al enviar:

- un gasto confirmado crea `expenses` y, si ya está pagado, su correspondiente `expense_payments`;
- un ingreso confirmado usa el RPC existente `register_procedure_payment`, por lo que conserva las reglas financieras actuales de la app;
- la entrada de staging queda marcada como `sent` con referencia al registro creado.

## Motor de correo

Edge Function prevista: `finance-email-poll`.

Responsabilidades:

1. Obtener un access token de Gmail mediante refresh token OAuth.
2. Consultar los mensajes que cumplan `FINANCE_GMAIL_QUERY`.
3. Evitar reprocesar mensajes usando el Gmail message id.
4. Guardar cuerpo, remitente, asunto y metadatos básicos.
5. Descargar adjuntos soportados.
6. Guardar los archivos en Storage privado bajo:
   `<organization_id>/<gmail_message_id>/<hash>-<filename>`
7. Intentar primero extracción determinística de XML de factura electrónica.
8. Usar IA como segundo nivel para texto, PDF e imágenes cuando esté configurada.
9. Crear uno o más `finance_inbox_entries`.
10. Marcar como `needs_review` cualquier caso ambiguo o de baja confianza.

## Regla de seguridad del MVP

La automatización NO escribe directamente en `payments` ni `expenses`.

Solo la acción humana `Confirmar para envío` + `Enviar confirmados a la app` puede convertir un movimiento detectado en un registro financiero real.

## Configuración necesaria

Crear una cuenta dedicada de Google/Gmail para Finanzas. Para el MVP no se requiere acceso al buzón personal de Rodolfo.

La Edge Function necesita los siguientes secretos:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `FINANCE_ORGANIZATION_ID`
- `FINANCE_GMAIL_QUERY` (por defecto: `in:inbox newer_than:30d`)
- `OPENAI_API_KEY` (opcional hasta activar análisis de PDF/imágenes)
- `FINANCE_AI_MODEL` (opcional)
- `FINANCE_TAX_ID` (recomendado para determinar si un XML representa factura emitida o recibida)

Nunca guardar estos valores en Git.

En `organizations.settings` se pueden guardar datos no secretos:

```json
{
  "finance_inbox_email": "finanzas@ejemplo.com",
  "finance_tax_id": "identificacion-fiscal-del-negocio"
}
```

## OAuth Gmail

Usar el scope mínimo de lectura:

`https://www.googleapis.com/auth/gmail.readonly`

El sistema solo necesita listar mensajes, obtener su contenido y descargar adjuntos. No necesita enviar correo ni modificar el buzón para la primera versión.

## IA y privacidad

- XML estructurado se procesa localmente cuando sea posible.
- La IA recibe únicamente el contenido necesario para extraer información financiera.
- El prompt prohíbe inferir información médica o completar datos faltantes.
- Los documentos originales permanecen en un bucket privado.
- La bandeja dedicada reduce la exposición frente a leer el correo general de Rodolfo.

## Programación automática

Primera versión recomendada:

- ejecutar `finance-email-poll` periódicamente;
- mantener el proceso idempotente mediante `source_message_id` y `dedupe_key`;
- no es necesario Gmail Push/PubSub para validar el producto.

Una vez probado el uso real, se puede migrar a Gmail push notifications si la inmediatez aporta valor.

## Checklist para activar

- [ ] Crear correo dedicado de Finanzas.
- [ ] Crear/configurar proyecto Google Cloud y habilitar Gmail API.
- [ ] Configurar OAuth consent y scope `gmail.readonly`.
- [ ] Autorizar la cuenta dedicada y obtener refresh token.
- [ ] Guardar secretos en Supabase.
- [ ] Configurar `finance_inbox_email` y `finance_tax_id`.
- [ ] Desplegar/probar `finance-email-poll`.
- [ ] Enviar 5–10 correos de prueba variados (XML, PDF, imagen, texto).
- [ ] Revisar precisión y duplicados.
- [ ] Desplegar la rama frontend.
- [ ] Solo después, programar ejecución recurrente.
