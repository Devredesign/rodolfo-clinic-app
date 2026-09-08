import { createClient } from 'jsr:@supabase/supabase-js@2'

type GmailHeader = { name?: string; value?: string }
type GmailPart = {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailPart[]
}
type GmailMessage = {
  id: string
  threadId?: string
  internalDate?: string
  snippet?: string
  payload?: GmailPart
}
type Attachment = {
  attachmentId: string
  filename: string
  mimeType: string
  bytes: Uint8Array
  base64: string
}
type ExtractedEntry = {
  entry_type: 'income' | 'expense' | 'unknown'
  document_date: string | null
  currency: 'CRC' | 'USD' | null
  amount: number | null
  counterparty_name: string | null
  description: string | null
  external_reference: string | null
  confidence: number
  category_suggestion: string | null
  evidence: string | null
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const SUPPORTED_MIME = new Set([
  'application/pdf', 'application/xml', 'text/xml', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'
])
const MAX_AI_ATTACHMENTS = 3
const MAX_AI_ATTACHMENT_BYTES = 8 * 1024 * 1024

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required secret: ${name}`)
  return value
}

function base64UrlToBytes(value = '') {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(normalized)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function decodeBase64UrlText(value = '') {
  return new TextDecoder().decode(base64UrlToBytes(value))
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function headerValue(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

function parseSender(raw: string) {
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/)
  if (match) return { name: match[1].replace(/^"|"$/g, '').trim() || null, email: match[2].trim().toLowerCase() }
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || null
  return { name: email ? raw.replace(email, '').replace(/[<>]/g, '').trim() || null : raw.trim() || null, email }
}

function collectText(part?: GmailPart): { plain: string[]; html: string[] } {
  const out = { plain: [] as string[], html: [] as string[] }
  const walk = (p?: GmailPart) => {
    if (!p) return
    if (p.mimeType === 'text/plain' && p.body?.data) out.plain.push(decodeBase64UrlText(p.body.data))
    if (p.mimeType === 'text/html' && p.body?.data) out.html.push(stripHtml(decodeBase64UrlText(p.body.data)))
    p.parts?.forEach(walk)
  }
  walk(part)
  return out
}

function collectAttachmentParts(part?: GmailPart): GmailPart[] {
  const out: GmailPart[] = []
  const walk = (p?: GmailPart) => {
    if (!p) return
    if (p.filename && p.body?.attachmentId) out.push(p)
    p.parts?.forEach(walk)
  }
  walk(part)
  return out
}

async function sha256Hex(bytes: Uint8Array | string) {
  const source = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source))
  return Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeFilename(value: string) {
  const cleaned = value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned.slice(0, 140) || 'documento'
}

async function gmailAccessToken() {
  const params = new URLSearchParams({
    client_id: requiredEnv('GMAIL_CLIENT_ID'),
    client_secret: requiredEnv('GMAIL_CLIENT_SECRET'),
    refresh_token: requiredEnv('GMAIL_REFRESH_TOKEN'),
    grant_type: 'refresh_token'
  })
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) throw new Error(`Gmail OAuth refresh failed: ${data.error_description || data.error || response.status}`)
  return String(data.access_token)
}

async function gmailJson(token: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`Gmail API failed (${response.status}): ${data?.error?.message || 'Unknown error'}`)
  return data
}

async function fetchAttachment(token: string, messageId: string, part: GmailPart): Promise<Attachment> {
  const attachmentId = String(part.body?.attachmentId || '')
  const data = await gmailJson(token, `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`)
  const bytes = base64UrlToBytes(data.data || '')
  return {
    attachmentId,
    filename: part.filename || 'documento',
    mimeType: part.mimeType || 'application/octet-stream',
    bytes,
    base64: bytesToBase64(bytes)
  }
}

function xmlLocalText(doc: Document, localName: string) {
  const all = Array.from(doc.getElementsByTagName('*'))
  return all.find((node) => node.localName === localName)?.textContent?.trim() || null
}

function xmlParty(doc: Document, partyName: 'Emisor' | 'Receptor') {
  const all = Array.from(doc.getElementsByTagName('*'))
  const party = all.find((node) => node.localName === partyName)
  if (!party) return { name: null as string | null, id: null as string | null }
  const descendants = Array.from(party.getElementsByTagName('*'))
  const name = descendants.find((node) => node.localName === 'Nombre')?.textContent?.trim() || null
  const id = descendants.find((node) => node.localName === 'Numero')?.textContent?.trim() || null
  return { name, id }
}

function normalizeDate(value: string | null) {
  if (!value) return null
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || null
}

function parseCostaRicaXml(xml: string, businessTaxId: string | null): ExtractedEntry | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (!doc) return null
    const totalRaw = xmlLocalText(doc, 'TotalComprobante')
    const total = totalRaw ? Number(totalRaw) : NaN
    if (!Number.isFinite(total) || total <= 0) return null
    const issuer = xmlParty(doc, 'Emisor')
    const receiver = xmlParty(doc, 'Receptor')
    const currencyRaw = (xmlLocalText(doc, 'CodigoMoneda') || xmlLocalText(doc, 'Moneda') || '').toUpperCase()
    const currency: 'CRC' | 'USD' | null = currencyRaw.includes('USD') ? 'USD' : currencyRaw.includes('CRC') || currencyRaw.includes('COL') ? 'CRC' : null
    const ref = xmlLocalText(doc, 'NumeroConsecutivo') || xmlLocalText(doc, 'Clave')
    const cleanTax = businessTaxId?.replace(/\D/g, '') || ''
    const issuerId = issuer.id?.replace(/\D/g, '') || ''
    const receiverId = receiver.id?.replace(/\D/g, '') || ''
    let entryType: 'income' | 'expense' | 'unknown' = 'unknown'
    let counterparty = issuer.name
    if (cleanTax && issuerId === cleanTax) { entryType = 'income'; counterparty = receiver.name }
    else if (cleanTax && receiverId === cleanTax) { entryType = 'expense'; counterparty = issuer.name }
    return {
      entry_type: entryType,
      document_date: normalizeDate(xmlLocalText(doc, 'FechaEmision')),
      currency,
      amount: total,
      counterparty_name: counterparty,
      description: entryType === 'income' ? 'Factura emitida' : entryType === 'expense' ? 'Factura recibida' : 'Factura electrónica',
      external_reference: ref,
      confidence: entryType === 'unknown' ? 0.82 : 0.99,
      category_suggestion: null,
      evidence: 'Datos estructurados extraídos del XML de factura electrónica.'
    }
  } catch {
    return null
  }
}

function extractResponseText(data: any) {
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue
    for (const content of item.content || []) if (content?.type === 'output_text' && content.text) return String(content.text)
  }
  return ''
}

async function analyzeWithOpenAI(params: {
  subject: string
  sender: string
  body: string
  attachments: Attachment[]
  organizationName: string
  businessTaxId: string | null
}) : Promise<ExtractedEntry[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return []
  const content: any[] = [{
    type: 'input_text',
    text: `Analizá este correo reenviado a una bandeja financiera de ${params.organizationName}.
Remitente: ${params.sender || 'desconocido'}
Asunto: ${params.subject || '(sin asunto)'}
Texto del correo:\n${params.body.slice(0, 18000)}

Extraé SOLO movimientos financieros explícitos. No inventés información faltante y no hagás inferencias médicas. Una entrada es dinero recibido por el negocio; un gasto es dinero pagado o adeudado por el negocio. Si la dirección del dinero no es clara, usá unknown. Si hay factura y comprobante del mismo movimiento, devolvé un solo movimiento. Las monedas permitidas son CRC o USD. La confianza debe representar qué tan claramente están sustentados tipo, monto, fecha y contraparte.${params.businessTaxId ? ` Identificación fiscal del negocio: ${params.businessTaxId}.` : ''}`
  }]

  for (const attachment of params.attachments.filter((a) => a.bytes.length <= MAX_AI_ATTACHMENT_BYTES).slice(0, MAX_AI_ATTACHMENTS)) {
    if (attachment.mimeType.startsWith('image/')) {
      content.push({ type: 'input_image', image_url: `data:${attachment.mimeType};base64,${attachment.base64}`, detail: 'high' })
    } else if (attachment.mimeType === 'application/pdf' || attachment.mimeType === 'text/plain') {
      content.push({ type: 'input_file', filename: attachment.filename, file_data: attachment.base64 })
    }
  }

  const schema = {
    type: 'object', additionalProperties: false, required: ['entries'], properties: {
      entries: { type: 'array', maxItems: 10, items: {
        type: 'object', additionalProperties: false,
        required: ['entry_type','document_date','currency','amount','counterparty_name','description','external_reference','confidence','category_suggestion','evidence'],
        properties: {
          entry_type: { type: 'string', enum: ['income','expense','unknown'] },
          document_date: { type: ['string','null'], description: 'YYYY-MM-DD when explicit or reliably present.' },
          currency: { type: ['string','null'], enum: ['CRC','USD',null] },
          amount: { type: ['number','null'], minimum: 0 },
          counterparty_name: { type: ['string','null'] },
          description: { type: ['string','null'] },
          external_reference: { type: ['string','null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          category_suggestion: { type: ['string','null'] },
          evidence: { type: ['string','null'], description: 'Breve motivo basado solo en el documento.' }
        }
      }}
    }
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('FINANCE_AI_MODEL') || 'gpt-5.6-luna',
      input: [{ role: 'user', content }],
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'finance_email_extraction', strict: true, schema } }
    })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`OpenAI analysis failed (${response.status}): ${data?.error?.message || 'Unknown error'}`)
  const text = extractResponseText(data)
  if (!text) throw new Error('OpenAI returned no structured output')
  const parsed = JSON.parse(text)
  return Array.isArray(parsed.entries) ? parsed.entries : []
}

function mergeEntries(xmlEntries: ExtractedEntry[], aiEntries: ExtractedEntry[]) {
  const result: ExtractedEntry[] = [...xmlEntries]
  for (const ai of aiEntries) {
    const duplicate = result.find((x) => {
      if (x.external_reference && ai.external_reference && x.external_reference === ai.external_reference) return true
      return x.amount != null && ai.amount != null && x.currency === ai.currency && Math.abs(x.amount - ai.amount) < 0.01 && x.document_date === ai.document_date && x.counterparty_name && ai.counterparty_name && x.counterparty_name.toLowerCase() === ai.counterparty_name.toLowerCase()
    })
    if (!duplicate) result.push(ai)
    else if (ai.entry_type !== 'unknown' && duplicate.entry_type === 'unknown' && ai.confidence >= duplicate.confidence) {
      Object.assign(duplicate, { ...ai, confidence: Math.max(ai.confidence, duplicate.confidence) })
    }
  }
  return result
}

async function createDedupeKey(entry: ExtractedEntry, messageId: string, index: number) {
  if (!entry.external_reference || entry.amount == null || !entry.currency) return `gmail:${messageId}:${index}`
  return sha256Hex([
    entry.entry_type,
    entry.counterparty_name?.trim().toLowerCase() || '',
    entry.external_reference.trim().toLowerCase(),
    entry.currency,
    Number(entry.amount).toFixed(2)
  ].join('|'))
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: JSON_HEADERS })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HEADERS })

    const url = requiredEnv('SUPABASE_URL')
    const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: userData, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !userData.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HEADERS })

    const body = await req.json().catch(() => ({}))
    const organizationId = String(body.organization_id || requiredEnv('FINANCE_ORGANIZATION_ID'))
    const { data: membership } = await admin.from('organization_members').select('role,active').eq('organization_id', organizationId).eq('user_id', userData.user.id).maybeSingle()
    if (!membership?.active || membership.role !== 'admin') return new Response(JSON.stringify({ error: 'Solo un administrador puede procesar la bandeja financiera.' }), { status: 403, headers: JSON_HEADERS })

    const { data: organization, error: orgError } = await admin.from('organizations').select('id,name,settings').eq('id', organizationId).single()
    if (orgError || !organization) throw new Error('Organization not found')
    const settings = organization.settings || {}
    const businessTaxId = String(settings.finance_tax_id || Deno.env.get('FINANCE_TAX_ID') || '').trim() || null

    const token = await gmailAccessToken()
    const query = String(body.query || Deno.env.get('FINANCE_GMAIL_QUERY') || 'in:inbox newer_than:30d')
    const maxResults = Math.min(Math.max(Number(body.max_results || 25), 1), 100)
    const listParams = new URLSearchParams({ q: query, maxResults: String(maxResults) })
    const list = await gmailJson(token, `messages?${listParams.toString()}`)
    const messageRefs = Array.isArray(list.messages) ? list.messages : []

    let processed = 0
    let skipped = 0
    let failed = 0

    for (const ref of messageRefs) {
      const messageId = String(ref.id || '')
      if (!messageId) continue
      const { data: existing } = await admin.from('finance_inbox_messages').select('id').eq('organization_id', organizationId).eq('source', 'gmail').eq('source_message_id', messageId).maybeSingle()
      if (existing) { skipped += 1; continue }

      let inboxMessageId: string | null = null
      try {
        const gmail: GmailMessage = await gmailJson(token, `messages/${encodeURIComponent(messageId)}?format=full`)
        const headers = gmail.payload?.headers || []
        const subject = headerValue(headers, 'Subject')
        const senderRaw = headerValue(headers, 'From')
        const sender = parseSender(senderRaw)
        const textParts = collectText(gmail.payload)
        const messageBody = (textParts.plain.join('\n\n').trim() || textParts.html.join('\n\n').trim() || gmail.snippet || '').slice(0, 40000)
        const receivedAt = gmail.internalDate ? new Date(Number(gmail.internalDate)).toISOString() : new Date().toISOString()

        const { data: insertedMessage, error: messageError } = await admin.from('finance_inbox_messages').insert({
          organization_id: organizationId,
          source: 'gmail',
          source_message_id: messageId,
          source_thread_id: gmail.threadId || null,
          sender_email: sender.email,
          sender_name: sender.name,
          subject: subject || null,
          received_at: receivedAt,
          body_excerpt: messageBody.slice(0, 1200) || null,
          processing_status: 'processing',
          raw_headers: { from: senderRaw || null, subject: subject || null, date: headerValue(headers, 'Date') || null }
        }).select('id').single()
        if (messageError || !insertedMessage) throw messageError || new Error('Could not create inbox message')
        inboxMessageId = insertedMessage.id

        const parts = collectAttachmentParts(gmail.payload)
        const attachments: Attachment[] = []
        const documentRows: { id: string; mime_type: string; filename: string; storage_path: string | null }[] = []
        const xmlEntries: ExtractedEntry[] = []

        for (const part of parts) {
          const attachment = await fetchAttachment(token, messageId, part)
          if (!SUPPORTED_MIME.has(attachment.mimeType)) continue
          attachments.push(attachment)
          const hash = await sha256Hex(attachment.bytes)
          const path = `${organizationId}/${messageId}/${hash.slice(0, 12)}-${safeFilename(attachment.filename)}`
          const { error: uploadError } = await admin.storage.from('finance-inbox').upload(path, attachment.bytes, { contentType: attachment.mimeType, upsert: false })
          if (uploadError && !String(uploadError.message || '').toLowerCase().includes('already exists')) throw uploadError

          let parsedFields: Record<string, unknown> = {}
          if (attachment.mimeType === 'application/xml' || attachment.mimeType === 'text/xml' || attachment.filename.toLowerCase().endsWith('.xml')) {
            const xmlText = new TextDecoder().decode(attachment.bytes)
            const xmlEntry = parseCostaRicaXml(xmlText, businessTaxId)
            if (xmlEntry) { xmlEntries.push(xmlEntry); parsedFields = { costa_rica_invoice: true, ...xmlEntry } }
          }

          const { data: document, error: documentError } = await admin.from('finance_inbox_documents').insert({
            organization_id: organizationId,
            message_id: inboxMessageId,
            source_attachment_id: attachment.attachmentId,
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            size_bytes: attachment.bytes.length,
            storage_path: path,
            sha256: hash,
            parsed_fields: parsedFields
          }).select('id,mime_type,filename,storage_path').single()
          if (documentError || !document) throw documentError || new Error('Could not create document row')
          documentRows.push(document)
        }

        let aiEntries: ExtractedEntry[] = []
        try {
          aiEntries = await analyzeWithOpenAI({
            subject,
            sender: senderRaw,
            body: messageBody,
            attachments,
            organizationName: organization.name,
            businessTaxId
          })
        } catch (analysisError) {
          console.error('AI extraction failed', analysisError)
        }

        const entries = mergeEntries(xmlEntries, aiEntries)
        const primaryDocumentId = documentRows[0]?.id || null

        if (!entries.length) {
          const fallback: ExtractedEntry = {
            entry_type: 'unknown', document_date: receivedAt.slice(0, 10), currency: null, amount: null,
            counterparty_name: sender.name || sender.email, description: subject || 'Correo financiero por revisar',
            external_reference: null, confidence: 0.2, category_suggestion: null,
            evidence: 'No fue posible extraer un movimiento con suficiente información; requiere revisión manual.'
          }
          entries.push(fallback)
        }

        for (let i = 0; i < entries.length; i += 1) {
          const entry = entries[i]
          const dedupeKey = await createDedupeKey(entry, messageId, i)
          const status = entry.entry_type === 'unknown' || entry.amount == null || !entry.currency || entry.confidence < 0.85 ? 'needs_review' : 'detected'
          const { error: entryError } = await admin.from('finance_inbox_entries').insert({
            organization_id: organizationId,
            message_id: inboxMessageId,
            primary_document_id: primaryDocumentId,
            entry_type: entry.entry_type,
            status,
            document_date: entry.document_date,
            currency: entry.currency,
            amount: entry.amount,
            counterparty_name: entry.counterparty_name,
            description: entry.description,
            external_reference: entry.external_reference,
            confidence: Math.min(Math.max(Number(entry.confidence || 0), 0), 1),
            extraction: { source: xmlEntries.includes(entry) ? 'xml' : 'ai', category_suggestion: entry.category_suggestion, evidence: entry.evidence },
            dedupe_key: dedupeKey
          })
          if (entryError && entryError.code !== '23505') throw entryError
        }

        const needsReview = entries.some((e) => e.entry_type === 'unknown' || e.amount == null || !e.currency || e.confidence < 0.85)
        await admin.from('finance_inbox_messages').update({
          processing_status: needsReview ? 'needs_review' : 'processed',
          processed_at: new Date().toISOString(),
          processing_error: null
        }).eq('id', inboxMessageId)
        processed += 1
      } catch (messageFailure) {
        console.error('Finance inbox message failed', messageId, messageFailure)
        failed += 1
        if (inboxMessageId) await admin.from('finance_inbox_messages').update({
          processing_status: 'error',
          processing_error: messageFailure instanceof Error ? messageFailure.message : 'Unknown processing error',
          processed_at: new Date().toISOString()
        }).eq('id', inboxMessageId)
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, skipped, failed, found: messageRefs.length }), { status: 200, headers: JSON_HEADERS })
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unexpected error' }), { status: 500, headers: JSON_HEADERS })
  }
})
