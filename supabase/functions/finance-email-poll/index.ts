import { createClient } from 'npm:@supabase/supabase-js@2.115.0'

type GmailHeader = { name?: string; value?: string }
type GmailPart = { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string; attachmentId?: string }; parts?: GmailPart[] }
type GmailMessage = { id: string; threadId?: string; internalDate?: string; snippet?: string; payload?: GmailPart }
type Attachment = { attachmentId: string; filename: string; mimeType: string; bytes: Uint8Array; base64: string }
type Entry = {
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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}
const SUPPORTED = new Set(['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp','text/plain'])
const MAX_AI_ATTACHMENTS = 3
const MAX_AI_ATTACHMENT_BYTES = 8 * 1024 * 1024

function env(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required secret: ${name}`)
  return value
}
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }) }
function b64urlBytes(value = '') {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(normalized), c => c.charCodeAt(0))
}
function bytesB64(bytes: Uint8Array) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}
function decodeText(value = '') { return new TextDecoder().decode(b64urlBytes(value)) }
function stripHtml(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').trim()
}
function header(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
}
function sender(raw: string) {
  const m = raw.match(/^(.*?)\s*<([^>]+)>$/)
  if (m) return { name: m[1].replace(/^"|"$/g,'').trim() || null, email: m[2].trim().toLowerCase() }
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || null
  return { name: email ? raw.replace(email,'').replace(/[<>]/g,'').trim() || null : raw.trim() || null, email }
}
function collectText(part?: GmailPart) {
  const plain: string[] = [], html: string[] = []
  const walk = (p?: GmailPart) => {
    if (!p) return
    if (p.mimeType === 'text/plain' && p.body?.data) plain.push(decodeText(p.body.data))
    if (p.mimeType === 'text/html' && p.body?.data) html.push(stripHtml(decodeText(p.body.data)))
    p.parts?.forEach(walk)
  }
  walk(part)
  return { plain, html }
}
function collectAttachmentParts(part?: GmailPart) {
  const out: GmailPart[] = []
  const walk = (p?: GmailPart) => {
    if (!p) return
    if (p.filename && p.body?.attachmentId) out.push(p)
    p.parts?.forEach(walk)
  }
  walk(part)
  return out
}
async function sha256(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest).map(b => b.toString(16).padStart(2,'0')).join('')
}
function safeFilename(value: string) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,140) || 'documento'
}

async function gmailAccessToken() {
  const params = new URLSearchParams({ client_id: env('GMAIL_CLIENT_ID'), client_secret: env('GMAIL_CLIENT_SECRET'), refresh_token: env('GMAIL_REFRESH_TOKEN'), grant_type: 'refresh_token' })
  const response = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: params })
  const data = await response.json()
  if (!response.ok || !data.access_token) throw new Error(`Gmail OAuth refresh failed: ${data.error_description || data.error || response.status}`)
  return String(data.access_token)
}
async function gmailJson(token: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers:{ Authorization:`Bearer ${token}` } })
  const data = await response.json()
  if (!response.ok) throw new Error(`Gmail API failed (${response.status}): ${data?.error?.message || 'Unknown error'}`)
  return data
}
async function getAttachment(token: string, messageId: string, part: GmailPart): Promise<Attachment> {
  const attachmentId = String(part.body?.attachmentId || '')
  const data = await gmailJson(token, `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`)
  const bytes = b64urlBytes(data.data || '')
  return { attachmentId, filename: part.filename || 'documento', mimeType: part.mimeType || 'application/octet-stream', bytes, base64: bytesB64(bytes) }
}

function xmlDecode(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim()
}
function xmlValue(xml: string, tag: string) {
  const re = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${tag}\\s*>`, 'i')
  const match = xml.match(re)
  return match ? xmlDecode(match[1].replace(/<[^>]+>/g,' ')) : null
}
function xmlBlock(xml: string, tag: string) {
  const re = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${tag}\\s*>`, 'i')
  return xml.match(re)?.[1] || ''
}
function normalizeDate(value: string | null) { return value?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || null }
function parseCRXml(xml: string, taxId: string | null): Entry | null {
  const totalRaw = xmlValue(xml,'TotalComprobante')
  const total = totalRaw ? Number(totalRaw.replace(/,/g,'')) : NaN
  if (!Number.isFinite(total) || total <= 0) return null
  const issuerBlock = xmlBlock(xml,'Emisor'), receiverBlock = xmlBlock(xml,'Receptor')
  const issuer = { name: xmlValue(issuerBlock,'Nombre'), id: xmlValue(issuerBlock,'Numero') }
  const receiver = { name: xmlValue(receiverBlock,'Nombre'), id: xmlValue(receiverBlock,'Numero') }
  const cur = (xmlValue(xml,'CodigoMoneda') || xmlValue(xml,'Moneda') || '').toUpperCase()
  const currency: 'CRC'|'USD'|null = cur.includes('USD') ? 'USD' : (cur.includes('CRC') || cur.includes('COL')) ? 'CRC' : null
  const cleanTax = taxId?.replace(/\D/g,'') || '', issuerId = issuer.id?.replace(/\D/g,'') || '', receiverId = receiver.id?.replace(/\D/g,'') || ''
  let entry_type: Entry['entry_type'] = 'unknown', counterparty = issuer.name
  if (cleanTax && issuerId === cleanTax) { entry_type = 'income'; counterparty = receiver.name }
  else if (cleanTax && receiverId === cleanTax) { entry_type = 'expense'; counterparty = issuer.name }
  return {
    entry_type, document_date: normalizeDate(xmlValue(xml,'FechaEmision')), currency, amount: total,
    counterparty_name: counterparty,
    description: entry_type === 'income' ? 'Factura emitida' : entry_type === 'expense' ? 'Factura recibida' : 'Factura electrónica',
    external_reference: xmlValue(xml,'NumeroConsecutivo') || xmlValue(xml,'Clave'),
    confidence: entry_type === 'unknown' ? 0.82 : 0.99,
    category_suggestion: null, evidence: 'Datos estructurados extraídos del XML de factura electrónica.'
  }
}

function outputText(data: any) {
  for (const item of data?.output || []) if (item?.type === 'message') for (const c of item.content || []) if (c?.type === 'output_text' && c.text) return String(c.text)
  return ''
}
async function analyzeAI(p: { subject:string; sender:string; body:string; attachments:Attachment[]; org:string; taxId:string|null }): Promise<Entry[]> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) return []
  const content: any[] = [{ type:'input_text', text:`Analizá este correo reenviado a la bandeja financiera de ${p.org}.\nRemitente: ${p.sender || 'desconocido'}\nAsunto: ${p.subject || '(sin asunto)'}\nTexto:\n${p.body.slice(0,18000)}\n\nExtraé SOLO movimientos financieros explícitos. No inventés datos. No hagás inferencias médicas. income = dinero recibido por el negocio; expense = dinero pagado o adeudado por el negocio; si no es claro usá unknown. Si factura y comprobante representan el mismo movimiento devolvé uno solo. Moneda solo CRC o USD.${p.taxId ? ` Identificación fiscal del negocio: ${p.taxId}.` : ''}` }]
  for (const a of p.attachments.filter(a => a.bytes.length <= MAX_AI_ATTACHMENT_BYTES).slice(0,MAX_AI_ATTACHMENTS)) {
    if (a.mimeType.startsWith('image/')) content.push({ type:'input_image', image_url:`data:${a.mimeType};base64,${a.base64}`, detail:'high' })
    else if (a.mimeType === 'application/pdf' || a.mimeType === 'text/plain') content.push({ type:'input_file', filename:a.filename, file_data:a.base64 })
  }
  const schema = { type:'object', additionalProperties:false, required:['entries'], properties:{ entries:{ type:'array', maxItems:10, items:{ type:'object', additionalProperties:false, required:['entry_type','document_date','currency','amount','counterparty_name','description','external_reference','confidence','category_suggestion','evidence'], properties:{ entry_type:{type:'string',enum:['income','expense','unknown']}, document_date:{type:['string','null']}, currency:{type:['string','null'],enum:['CRC','USD',null]}, amount:{type:['number','null'],minimum:0}, counterparty_name:{type:['string','null']}, description:{type:['string','null']}, external_reference:{type:['string','null']}, confidence:{type:'number',minimum:0,maximum:1}, category_suggestion:{type:['string','null']}, evidence:{type:['string','null']} } } } } }
  const response = await fetch('https://api.openai.com/v1/responses', { method:'POST', headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' }, body:JSON.stringify({ model:Deno.env.get('FINANCE_AI_MODEL') || 'gpt-5.6-luna', input:[{role:'user',content}], reasoning:{effort:'low'}, text:{format:{type:'json_schema',name:'finance_email_extraction',strict:true,schema}} }) })
  const data = await response.json()
  if (!response.ok) throw new Error(`OpenAI analysis failed (${response.status}): ${data?.error?.message || 'Unknown error'}`)
  const text = outputText(data)
  if (!text) throw new Error('OpenAI returned no structured output')
  return JSON.parse(text).entries || []
}
function mergeEntries(xml: Entry[], ai: Entry[]) {
  const out = [...xml]
  for (const item of ai) {
    const duplicate = out.find(x => (x.external_reference && item.external_reference && x.external_reference === item.external_reference) || (x.amount != null && item.amount != null && x.currency === item.currency && Math.abs(x.amount-item.amount)<0.01 && x.document_date === item.document_date && x.counterparty_name && item.counterparty_name && x.counterparty_name.toLowerCase() === item.counterparty_name.toLowerCase()))
    if (!duplicate) out.push(item)
    else if (duplicate.entry_type === 'unknown' && item.entry_type !== 'unknown' && item.confidence >= duplicate.confidence) Object.assign(duplicate, item, { confidence:Math.max(item.confidence, duplicate.confidence) })
  }
  return out
}
async function dedupeKey(entry: Entry, messageId: string, index: number) {
  if (!entry.external_reference || entry.amount == null || !entry.currency) return `gmail:${messageId}:${index}`
  return sha256([entry.entry_type,entry.counterparty_name?.trim().toLowerCase() || '',entry.external_reference.trim().toLowerCase(),entry.currency,Number(entry.amount).toFixed(2)].join('|'))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers:CORS })
  if (req.method !== 'POST') return json({ error:'Method not allowed' },405)
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i,'')
    if (!jwt) return json({ error:'Unauthorized' },401)
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth:{autoRefreshToken:false,persistSession:false} })
    const { data:userData, error:userError } = await admin.auth.getUser(jwt)
    if (userError || !userData.user) return json({ error:'Unauthorized' },401)
    const body = await req.json().catch(() => ({}))
    const organizationId = String(body.organization_id || env('FINANCE_ORGANIZATION_ID'))
    const { data:member } = await admin.from('organization_members').select('role,active').eq('organization_id',organizationId).eq('user_id',userData.user.id).maybeSingle()
    if (!member?.active || member.role !== 'admin') return json({ error:'Solo un administrador puede procesar la bandeja financiera.' },403)
    const { data:org, error:orgError } = await admin.from('organizations').select('id,name,settings').eq('id',organizationId).single()
    if (orgError || !org) throw new Error('Organization not found')
    const taxId = String(org.settings?.finance_tax_id || Deno.env.get('FINANCE_TAX_ID') || '').trim() || null
    const token = await gmailAccessToken()
    const query = String(body.query || Deno.env.get('FINANCE_GMAIL_QUERY') || 'in:inbox newer_than:30d')
    const maxResults = Math.min(Math.max(Number(body.max_results || 25),1),100)
    const list = await gmailJson(token, `messages?${new URLSearchParams({q:query,maxResults:String(maxResults)}).toString()}`)
    const refs = Array.isArray(list.messages) ? list.messages : []
    let processed=0, skipped=0, failed=0

    for (const ref of refs) {
      const messageId = String(ref.id || '')
      if (!messageId) continue
      const { data:existing } = await admin.from('finance_inbox_messages').select('id').eq('organization_id',organizationId).eq('source','gmail').eq('source_message_id',messageId).maybeSingle()
      if (existing) { skipped++; continue }
      let inboxMessageId: string | null = null
      try {
        const gmail: GmailMessage = await gmailJson(token, `messages/${encodeURIComponent(messageId)}?format=full`)
        const headers = gmail.payload?.headers || [], subject = header(headers,'Subject'), fromRaw = header(headers,'From'), from = sender(fromRaw)
        const text = collectText(gmail.payload)
        const messageBody = (text.plain.join('\n\n').trim() || text.html.join('\n\n').trim() || gmail.snippet || '').slice(0,40000)
        const receivedAt = gmail.internalDate ? new Date(Number(gmail.internalDate)).toISOString() : new Date().toISOString()
        const { data:msg, error:msgErr } = await admin.from('finance_inbox_messages').insert({ organization_id:organizationId, source:'gmail', source_message_id:messageId, source_thread_id:gmail.threadId || null, sender_email:from.email, sender_name:from.name, subject:subject || null, received_at:receivedAt, body_excerpt:messageBody.slice(0,1200) || null, processing_status:'processing', raw_headers:{from:fromRaw || null,subject:subject || null,date:header(headers,'Date') || null} }).select('id').single()
        if (msgErr || !msg) throw msgErr || new Error('Could not create inbox message')
        inboxMessageId = msg.id

        const attachments: Attachment[] = [], docs: any[] = [], xmlEntries: Entry[] = []
        for (const part of collectAttachmentParts(gmail.payload)) {
          const a = await getAttachment(token,messageId,part)
          if (!SUPPORTED.has(a.mimeType) && !a.filename.toLowerCase().endsWith('.xml')) continue
          attachments.push(a)
          const hash = await sha256(a.bytes), path = `${organizationId}/${messageId}/${hash.slice(0,12)}-${safeFilename(a.filename)}`
          const { error:upErr } = await admin.storage.from('finance-inbox').upload(path,a.bytes,{contentType:a.mimeType,upsert:false})
          if (upErr && !String(upErr.message || '').toLowerCase().includes('already exists')) throw upErr
          let parsed: Record<string,unknown> = {}
          if (a.mimeType === 'application/xml' || a.mimeType === 'text/xml' || a.filename.toLowerCase().endsWith('.xml')) {
            const e = parseCRXml(new TextDecoder().decode(a.bytes),taxId)
            if (e) { xmlEntries.push(e); parsed={costa_rica_invoice:true,...e} }
          }
          const { data:doc, error:docErr } = await admin.from('finance_inbox_documents').insert({ organization_id:organizationId, message_id:inboxMessageId, source_attachment_id:a.attachmentId, filename:a.filename, mime_type:a.mimeType, size_bytes:a.bytes.length, storage_path:path, sha256:hash, parsed_fields:parsed }).select('id,mime_type,filename,storage_path').single()
          if (docErr || !doc) throw docErr || new Error('Could not create document row')
          docs.push(doc)
        }

        let aiEntries: Entry[] = []
        try { aiEntries = await analyzeAI({ subject, sender:fromRaw, body:messageBody, attachments, org:org.name, taxId }) } catch (e) { console.error('AI extraction failed',e) }
        const entries = mergeEntries(xmlEntries,aiEntries)
        if (!entries.length) entries.push({ entry_type:'unknown', document_date:receivedAt.slice(0,10), currency:null, amount:null, counterparty_name:from.name || from.email, description:subject || 'Correo financiero por revisar', external_reference:null, confidence:0.2, category_suggestion:null, evidence:'No fue posible extraer un movimiento; requiere revisión manual.' })
        for (let i=0;i<entries.length;i++) {
          const e=entries[i], status = e.entry_type === 'unknown' || e.amount == null || !e.currency || e.confidence < 0.85 ? 'needs_review':'detected'
          const { error:entryErr } = await admin.from('finance_inbox_entries').insert({ organization_id:organizationId, message_id:inboxMessageId, primary_document_id:docs[0]?.id || null, entry_type:e.entry_type, status, document_date:e.document_date, currency:e.currency, amount:e.amount, counterparty_name:e.counterparty_name, description:e.description, external_reference:e.external_reference, confidence:Math.min(Math.max(Number(e.confidence || 0),0),1), extraction:{ source:xmlEntries.includes(e)?'xml':'ai', category_suggestion:e.category_suggestion, evidence:e.evidence }, dedupe_key:await dedupeKey(e,messageId,i) })
          if (entryErr && entryErr.code !== '23505') throw entryErr
        }
        const needsReview = entries.some(e => e.entry_type === 'unknown' || e.amount == null || !e.currency || e.confidence < 0.85)
        await admin.from('finance_inbox_messages').update({ processing_status:needsReview?'needs_review':'processed', processed_at:new Date().toISOString(), processing_error:null }).eq('id',inboxMessageId)
        processed++
      } catch (e) {
        failed++; console.error('Finance inbox message failed',messageId,e)
        if (inboxMessageId) await admin.from('finance_inbox_messages').update({ processing_status:'error', processing_error:e instanceof Error ? e.message:'Unknown processing error', processed_at:new Date().toISOString() }).eq('id',inboxMessageId)
      }
    }
    return json({ ok:true, processed, skipped, failed, found:refs.length })
  } catch (e) {
    console.error(e)
    return json({ error:e instanceof Error ? e.message:'Unexpected error' },500)
  }
})