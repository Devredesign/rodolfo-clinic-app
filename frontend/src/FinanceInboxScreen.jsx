import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem, Select, Stack,
  TextField, Typography
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import { supabase } from './supabase.js'

const money = (amount, currency = 'CRC') => new Intl.NumberFormat('es-CR', { style: 'currency', currency }).format(Number(amount || 0))
const dateLabel = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('es-CR') : 'Sin fecha'
const statusLabel = {
  detected: 'Detectado', needs_review: 'Revisar', confirmed: 'Confirmado', sent: 'Enviado', ignored: 'Ignorado', error: 'Error'
}
const statusColor = { detected: 'info', needs_review: 'warning', confirmed: 'success', sent: 'default', ignored: 'default', error: 'error' }

export default function FinanceInboxScreen({ organization, userId }) {
  const [entries, setEntries] = useState([])
  const [messages, setMessages] = useState([])
  const [documents, setDocuments] = useState([])
  const [categories, setCategories] = useState([])
  const [procedures, setProcedures] = useState([])
  const [clients, setClients] = useState([])
  const [methods, setMethods] = useState([])
  const [filter, setFilter] = useState('pending')
  const [editing, setEditing] = useState(null)
  const [sendingOpen, setSendingOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true)
    const [entryRes, messageRes, documentRes, catRes, procedureRes, clientRes, methodRes] = await Promise.all([
      supabase.from('finance_inbox_entries').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }),
      supabase.from('finance_inbox_messages').select('*').eq('organization_id', organization.id).order('received_at', { ascending: false }),
      supabase.from('finance_inbox_documents').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }),
      supabase.from('expense_categories').select('id,name,active').eq('organization_id', organization.id).order('name'),
      supabase.from('procedures').select('id,client_id,service_name_snapshot,payment_status,performed_at,scheduled_at,status').eq('organization_id', organization.id).order('created_at', { ascending: false }),
      supabase.from('clients').select('id,full_name,active').eq('organization_id', organization.id).order('full_name'),
      supabase.from('payment_methods').select('id,label,fee_rate,active').eq('organization_id', organization.id).order('label')
    ])
    if (entryRes.error || messageRes.error || documentRes.error || catRes.error || procedureRes.error || clientRes.error || methodRes.error) {
      console.error({ entryRes, messageRes, documentRes, catRes, procedureRes, clientRes, methodRes })
      setError('No se pudo cargar la bandeja financiera.')
    } else {
      setEntries(entryRes.data || [])
      setMessages(messageRes.data || [])
      setDocuments(documentRes.data || [])
      setCategories(catRes.data || [])
      setProcedures(procedureRes.data || [])
      setClients(clientRes.data || [])
      setMethods(methodRes.data || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [organization.id])

  const processInbox = async () => {
    setProcessing(true); setError(''); setNotice('')
    const { data, error: invokeError } = await supabase.functions.invoke('finance-email-poll', {
      body: { organization_id: organization.id }
    })
    if (invokeError) {
      console.error(invokeError)
      setError('No se pudieron procesar los correos. Revisá la conexión de Gmail o la sesión de administrador.')
      setProcessing(false)
      return
    }
    if (data?.error) {
      setError(data.error)
      setProcessing(false)
      return
    }
    const processed = Number(data?.processed || 0)
    const skipped = Number(data?.skipped || 0)
    const failed = Number(data?.failed || 0)
    const found = Number(data?.found || 0)
    setNotice(`Gmail revisado: ${found} correo${found === 1 ? '' : 's'} encontrado${found === 1 ? '' : 's'} · ${processed} nuevo${processed === 1 ? '' : 's'} procesado${processed === 1 ? '' : 's'} · ${skipped} ya procesado${skipped === 1 ? '' : 's'}${failed ? ` · ${failed} con error` : ''}.`)
    await load()
    setProcessing(false)
  }

  const messageById = useMemo(() => Object.fromEntries(messages.map((m) => [m.id, m])), [messages])
  const docsByMessage = useMemo(() => documents.reduce((acc, d) => { (acc[d.message_id] ||= []).push(d); return acc }, {}), [documents])
  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients])

  const visible = useMemo(() => {
    if (filter === 'all') return entries
    if (filter === 'pending') return entries.filter((e) => ['detected', 'needs_review', 'error'].includes(e.status))
    return entries.filter((e) => e.status === filter)
  }, [entries, filter])

  const confirmed = entries.filter((e) => e.status === 'confirmed')
  const pending = entries.filter((e) => ['detected', 'needs_review', 'error'].includes(e.status))
  const incomeCRC = entries.filter((e) => e.entry_type === 'income' && e.currency === 'CRC' && e.status !== 'ignored').reduce((s, e) => s + Number(e.amount || 0), 0)
  const expenseCRC = entries.filter((e) => e.entry_type === 'expense' && e.currency === 'CRC' && e.status !== 'ignored').reduce((s, e) => s + Number(e.amount || 0), 0)
  const incomeUSD = entries.filter((e) => e.entry_type === 'income' && e.currency === 'USD' && e.status !== 'ignored').reduce((s, e) => s + Number(e.amount || 0), 0)
  const expenseUSD = entries.filter((e) => e.entry_type === 'expense' && e.currency === 'USD' && e.status !== 'ignored').reduce((s, e) => s + Number(e.amount || 0), 0)
  const inboxEmail = organization.settings?.finance_inbox_email || 'Dirección pendiente de conectar'

  const openDocument = async (entry) => {
    const docs = docsByMessage[entry.message_id] || []
    const doc = docs.find((d) => d.id === entry.primary_document_id) || docs[0]
    if (!doc?.storage_path) return setError('Este correo todavía no tiene un documento almacenado.')
    const { data, error: signedError } = await supabase.storage.from('finance-inbox').createSignedUrl(doc.storage_path, 120)
    if (signedError || !data?.signedUrl) return setError('No se pudo abrir el documento original.')
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const saveEntry = async (form, confirm = false) => {
    setError(''); setNotice('')
    const amount = Number(form.amount)
    if (confirm) {
      if (form.entry_type === 'unknown') return setError('Indicá si es una entrada o un gasto.')
      if (!form.document_date || !form.currency || !Number.isFinite(amount) || amount <= 0 || !form.description?.trim()) return setError('Completá fecha, moneda, monto y descripción antes de confirmar.')
      if (form.entry_type === 'expense' && !form.category_id) return setError('Seleccioná una categoría para el gasto.')
      if (form.entry_type === 'income' && (!form.procedure_id || !form.payment_method_id || !form.receiver)) return setError('Para una entrada, vinculá procedimiento, método de pago y dónde se recibió.')
    }
    const payload = {
      entry_type: form.entry_type,
      document_date: form.document_date || null,
      due_date: form.entry_type === 'expense' ? (form.due_date || null) : null,
      currency: form.currency || null,
      amount: Number.isFinite(amount) ? amount : null,
      counterparty_name: form.counterparty_name?.trim() || null,
      description: form.description?.trim() || null,
      category_id: form.entry_type === 'expense' ? (form.category_id || null) : null,
      procedure_id: form.entry_type === 'income' ? (form.procedure_id || null) : null,
      payment_method_id: form.entry_type === 'income' ? (form.payment_method_id || null) : null,
      receiver: form.entry_type === 'income' ? (form.receiver || null) : null,
      external_reference: form.external_reference?.trim() || null,
      review_notes: form.review_notes?.trim() || null,
      ...(confirm ? { status: 'confirmed', confirmed_by: userId, confirmed_at: new Date().toISOString(), error_message: null } : {})
    }
    const { error: updateError } = await supabase.from('finance_inbox_entries').update(payload).eq('id', form.id).eq('organization_id', organization.id)
    if (updateError) return setError('No se pudo guardar la revisión.')
    setEditing(null)
    setNotice(confirm ? 'Movimiento confirmado y listo para enviar.' : 'Cambios guardados.')
    await load()
  }

  const ignoreEntry = async (entry) => {
    const { error: updateError } = await supabase.from('finance_inbox_entries').update({ status: 'ignored' }).eq('id', entry.id).eq('organization_id', organization.id)
    if (updateError) return setError('No se pudo ignorar el movimiento.')
    await load()
  }

  const sendExpense = async (entry) => {
    const fx = Number(organization.default_fx_crc_per_usd || 0)
    const note = `Importado desde bandeja de correo${messageById[entry.message_id]?.subject ? ` · ${messageById[entry.message_id].subject}` : ''}`
    const { data: expense, error: expenseError } = await supabase.from('expenses').insert({
      organization_id: organization.id,
      category_id: entry.category_id,
      description: entry.description,
      currency: entry.currency,
      amount: Number(entry.amount),
      fx_crc_per_usd_snapshot: entry.currency === 'CRC' ? fx || null : null,
      expense_date: entry.document_date,
      due_date: entry.due_date || null,
      status: entry.due_date ? 'pending' : 'paid',
      notes: [note, entry.review_notes].filter(Boolean).join('\n'),
      source_type: 'email_inbox',
      source_id: entry.id,
      created_by: userId
    }).select('*').single()
    if (expenseError) throw expenseError

    if (!entry.due_date) {
      const { error: paymentError } = await supabase.from('expense_payments').insert({
        organization_id: organization.id,
        expense_id: expense.id,
        payment_date: entry.document_date,
        currency: entry.currency,
        amount: Number(entry.amount),
        fx_crc_per_usd_snapshot: entry.currency === 'CRC' ? fx || null : null,
        external_reference: entry.external_reference || null,
        notes: note,
        status: 'paid',
        created_by: userId
      })
      if (paymentError) throw paymentError
    }
    return { type: 'expense', id: expense.id }
  }

  const sendIncome = async (entry) => {
    const method = methods.find((m) => m.id === entry.payment_method_id)
    if (!method) throw new Error('Método de pago no disponible')
    const fx = Number(organization.default_fx_crc_per_usd || 0)
    const settings = organization.settings || {}
    const amount = Number(entry.amount)
    const feeRate = entry.receiver === 'rodolfo' ? Number(method.fee_rate || 0) : 0
    const feeAmount = amount * feeRate
    const { data, error: rpcError } = await supabase.rpc('register_procedure_payment', {
      p_organization_id: organization.id,
      p_procedure_id: entry.procedure_id,
      p_payment_date: entry.document_date,
      p_currency: entry.currency,
      p_list_amount: amount,
      p_discount_amount: 0,
      p_final_amount: amount,
      p_fx_crc_per_usd_snapshot: entry.currency === 'CRC' ? fx || null : null,
      p_method_id: entry.payment_method_id,
      p_receiver: entry.receiver,
      p_rodolfo_share_rate_snapshot: Number(settings.rodolfo_share_rate ?? 0.70),
      p_clinic_share_rate_snapshot: Number(settings.clinic_share_rate ?? 0.30),
      p_vat_rate_snapshot: Number(settings.vat_rate ?? 0.04),
      p_processor_fee_rate_snapshot: feeRate,
      p_processor_fee_amount: feeAmount,
      p_external_reference: entry.external_reference || '',
      p_notes: `Importado desde bandeja de correo${entry.review_notes ? ` · ${entry.review_notes}` : ''}`,
      p_created_by: userId
    })
    if (rpcError) throw rpcError
    const row = Array.isArray(data) ? data[0] : data
    return { type: 'payment', id: row?.id || null }
  }

  const sendConfirmed = async () => {
    setSending(true); setError(''); setNotice('')
    let sent = 0
    const failed = []
    for (const entry of confirmed) {
      try {
        const result = entry.entry_type === 'expense' ? await sendExpense(entry) : await sendIncome(entry)
        const { error: markError } = await supabase.from('finance_inbox_entries').update({
          status: 'sent', sent_record_type: result.type, sent_record_id: result.id, sent_at: new Date().toISOString(), error_message: null
        }).eq('id', entry.id).eq('organization_id', organization.id)
        if (markError) throw markError
        sent += 1
      } catch (sendError) {
        console.error(sendError)
        failed.push(entry.id)
        await supabase.from('finance_inbox_entries').update({ status: 'error', error_message: sendError?.message || 'No se pudo enviar a la app.' }).eq('id', entry.id).eq('organization_id', organization.id)
      }
    }
    setSending(false); setSendingOpen(false)
    setNotice(sent ? `${sent} movimiento${sent === 1 ? '' : 's'} enviado${sent === 1 ? '' : 's'} a la app.` : '')
    if (failed.length) setError(`${failed.length} movimiento${failed.length === 1 ? '' : 's'} necesita${failed.length === 1 ? '' : 'n'} revisión antes de volver a enviar.`)
    await load()
  }

  if (loading) return <Box minHeight={280} display="grid" sx={{ placeItems: 'center' }}><CircularProgress /></Box>

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} alignItems={{ md: 'center' }}>
      <Box>
        <Typography variant="h4" fontWeight={800}>Bandeja de correo</Typography>
        <Typography color="text.secondary">Correos financieros detectados antes de entrar a la contabilidad de la app.</Typography>
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="outlined" startIcon={processing ? <CircularProgress size={18} /> : <RefreshOutlinedIcon />} disabled={processing} onClick={processInbox}>
          {processing ? 'Procesando correos…' : 'Procesar correos ahora'}
        </Button>
        <Button variant="contained" startIcon={<SendOutlinedIcon />} disabled={!confirmed.length} onClick={() => setSendingOpen(true)}>
          Enviar {confirmed.length || ''} confirmados a la app
        </Button>
      </Stack>
    </Stack>

    <Alert icon={<EmailOutlinedIcon />} severity="info">
      <strong>Correo de Finanzas:</strong> {inboxEmail}. Reenviá aquí facturas, comprobantes y pagos; luego usá “Procesar correos ahora” para traerlos a esta bandeja.
    </Alert>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}

    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <Metric label="Por revisar" value={pending.length} />
      <Metric label="Confirmados" value={confirmed.length} />
      <Metric label="Entradas detectadas" value={`${money(incomeCRC, 'CRC')} · ${money(incomeUSD, 'USD')}`} compact />
      <Metric label="Gastos detectados" value={`${money(expenseCRC, 'CRC')} · ${money(expenseUSD, 'USD')}`} compact />
    </Stack>

    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {[
        ['pending', `Por revisar (${pending.length})`], ['confirmed', `Confirmados (${confirmed.length})`], ['sent', 'Enviados'], ['all', 'Todos']
      ].map(([value, label]) => <Button key={value} size="small" variant={filter === value ? 'contained' : 'outlined'} onClick={() => setFilter(value)}>{label}</Button>)}
    </Stack>

    <Card variant="outlined"><CardContent sx={{ p: 0 }}>
      {visible.length === 0 ? <Box p={5} textAlign="center">
        <Typography fontWeight={800}>No hay movimientos en esta vista</Typography>
        <Typography color="text.secondary" mt={1}>Cuando procesés correos nuevos aparecerán aquí para revisión.</Typography>
      </Box> : visible.map((entry, index) => {
        const message = messageById[entry.message_id]
        const docs = docsByMessage[entry.message_id] || []
        const procedure = procedures.find((p) => p.id === entry.procedure_id)
        const client = procedure ? clientById[procedure.client_id] : null
        return <Box key={entry.id}>
          {index > 0 && <Divider />}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} p={{ xs: 2, sm: 2.5 }} justifyContent="space-between">
            <Box flex={1} minWidth={0}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" color={statusColor[entry.status] || 'default'} label={statusLabel[entry.status] || entry.status} />
                <Chip size="small" variant="outlined" label={entry.entry_type === 'income' ? 'Entrada' : entry.entry_type === 'expense' ? 'Gasto' : 'Sin clasificar'} />
                {entry.confidence != null && <Chip size="small" variant="outlined" label={`${Math.round(Number(entry.confidence) * 100)}% confianza`} />}
              </Stack>
              <Typography fontWeight={800} mt={1}>{entry.description || message?.subject || 'Movimiento sin descripción'}</Typography>
              <Typography variant="body2" color="text.secondary">
                {[entry.counterparty_name, entry.document_date ? dateLabel(entry.document_date) : null, message?.sender_email].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
              </Typography>
              {entry.entry_type === 'income' && procedure && <Typography variant="body2" mt={0.75}>Vinculado a {client?.full_name || 'cliente'} · {procedure.service_name_snapshot}</Typography>}
              {message?.body_excerpt && <Typography variant="caption" color="text.secondary" display="block" mt={1} sx={{ maxWidth: 720 }}>{message.body_excerpt}</Typography>}
              {entry.error_message && <Alert severity="error" sx={{ mt: 1 }}>{entry.error_message}</Alert>}
            </Box>
            <Stack alignItems={{ xs: 'stretch', md: 'flex-end' }} spacing={1.25} minWidth={{ md: 235 }}>
              <Typography variant="h6" fontWeight={900}>{entry.amount != null && entry.currency ? money(entry.amount, entry.currency) : 'Monto pendiente'}</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ md: 'flex-end' }}>
                {docs.length > 0 && <Button size="small" variant="outlined" startIcon={<DescriptionOutlinedIcon />} onClick={() => openDocument(entry)}>Ver archivo</Button>}
                {entry.status !== 'sent' && entry.status !== 'ignored' && <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => setEditing(entry)}>Revisar</Button>}
                {['detected', 'needs_review', 'error'].includes(entry.status) && <Button size="small" color="inherit" onClick={() => ignoreEntry(entry)}>Ignorar</Button>}
              </Stack>
            </Stack>
          </Stack>
        </Box>
      })}
    </CardContent></Card>

    <ReviewDialog entry={editing} open={Boolean(editing)} onClose={() => setEditing(null)} onSave={saveEntry} categories={categories} procedures={procedures} clients={clients} methods={methods} />

    <Dialog open={sendingOpen} onClose={sending ? undefined : () => setSendingOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>Confirmar envío a la app</DialogTitle>
      <DialogContent><Stack spacing={2} mt={1}>
        <Typography>{confirmed.length} movimiento{confirmed.length === 1 ? '' : 's'} confirmado{confirmed.length === 1 ? '' : 's'} será{confirmed.length === 1 ? '' : 'n'} enviado{confirmed.length === 1 ? '' : 's'} a los módulos financieros reales.</Typography>
        <Alert severity="warning">Después del envío, los pagos y gastos pasan a formar parte del histórico de Rodolfo. Los documentos originales quedan asociados en esta bandeja.</Alert>
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setSendingOpen(false)} disabled={sending}>Cancelar</Button><Button variant="contained" startIcon={<SendOutlinedIcon />} onClick={sendConfirmed} disabled={sending}>{sending ? 'Enviando…' : 'Confirmar y enviar'}</Button></DialogActions>
    </Dialog>
  </Stack>
}

function Metric({ label, value, compact = false }) {
  return <Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant={compact ? 'body1' : 'h5'} fontWeight={800} mt={0.5}>{value}</Typography></CardContent></Card>
}

function ReviewDialog({ entry, open, onClose, onSave, categories, procedures, clients, methods }) {
  const [form, setForm] = useState(null)
  useEffect(() => {
    if (open && entry) setForm({
      ...entry,
      amount: entry.amount == null ? '' : String(entry.amount),
      entry_type: entry.entry_type || 'unknown',
      currency: entry.currency || 'CRC',
      document_date: entry.document_date || '',
      due_date: entry.due_date || '',
      category_id: entry.category_id || '',
      procedure_id: entry.procedure_id || '',
      payment_method_id: entry.payment_method_id || '',
      receiver: entry.receiver || 'rodolfo',
      counterparty_name: entry.counterparty_name || '',
      description: entry.description || '',
      external_reference: entry.external_reference || '',
      review_notes: entry.review_notes || ''
    })
  }, [open, entry])
  if (!form) return null
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const pendingProcedures = procedures.filter((p) => p.status !== 'cancelled' && (['pending', 'partial'].includes(p.payment_status) || p.id === form.procedure_id))
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
    <DialogTitle>Revisar movimiento detectado</DialogTitle>
    <DialogContent><Stack spacing={2.25} mt={1}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FormControl fullWidth><InputLabel>Tipo</InputLabel><Select value={form.entry_type} label="Tipo" onChange={(e) => set({ entry_type: e.target.value })}><MenuItem value="unknown">Sin clasificar</MenuItem><MenuItem value="income">Entrada</MenuItem><MenuItem value="expense">Gasto</MenuItem></Select></FormControl>
        <TextField fullWidth label="Fecha" type="date" value={form.document_date} onChange={(e) => set({ document_date: e.target.value })} InputLabelProps={{ shrink: true }} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FormControl fullWidth><InputLabel>Moneda</InputLabel><Select value={form.currency} label="Moneda" onChange={(e) => set({ currency: e.target.value })}><MenuItem value="CRC">CRC</MenuItem><MenuItem value="USD">USD</MenuItem></Select></FormControl>
        <TextField fullWidth label="Monto" type="number" value={form.amount} onChange={(e) => set({ amount: e.target.value })} inputProps={{ min: 0, step: '0.01' }} />
      </Stack>
      <TextField label="Persona / proveedor" value={form.counterparty_name} onChange={(e) => set({ counterparty_name: e.target.value })} />
      <TextField label="Descripción" value={form.description} onChange={(e) => set({ description: e.target.value })} />

      {form.entry_type === 'expense' && <>
        <FormControl fullWidth><InputLabel>Categoría de gasto</InputLabel><Select value={form.category_id} label="Categoría de gasto" onChange={(e) => set({ category_id: e.target.value })}>{categories.filter((c) => c.active).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
        <TextField label="Vencimiento (si aún no se ha pagado)" type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} InputLabelProps={{ shrink: true }} helperText="Si queda vacío, el sistema lo tratará como un gasto ya pagado." />
      </>}

      {form.entry_type === 'income' && <>
        <FormControl fullWidth><InputLabel>Procedimiento</InputLabel><Select value={form.procedure_id} label="Procedimiento" onChange={(e) => set({ procedure_id: e.target.value })}>{pendingProcedures.map((p) => { const client = clients.find((c) => c.id === p.client_id); return <MenuItem key={p.id} value={p.id}>{client?.full_name || 'Cliente'} · {p.service_name_snapshot} · {p.payment_status}</MenuItem> })}</Select></FormControl>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl fullWidth><InputLabel>Método de pago</InputLabel><Select value={form.payment_method_id} label="Método de pago" onChange={(e) => set({ payment_method_id: e.target.value })}>{methods.filter((m) => m.active).map((m) => <MenuItem key={m.id} value={m.id}>{m.label}</MenuItem>)}</Select></FormControl>
          <FormControl fullWidth><InputLabel>Recibido en</InputLabel><Select value={form.receiver} label="Recibido en" onChange={(e) => set({ receiver: e.target.value })}><MenuItem value="rodolfo">Cuenta / datáfono de Rodolfo</MenuItem><MenuItem value="clinic">Cuenta / datáfono de la clínica</MenuItem></Select></FormControl>
        </Stack>
      </>}

      <TextField label="Referencia / comprobante" value={form.external_reference} onChange={(e) => set({ external_reference: e.target.value })} />
      <TextField label="Notas de revisión" multiline minRows={2} value={form.review_notes} onChange={(e) => set({ review_notes: e.target.value })} />
    </Stack></DialogContent>
    <DialogActions sx={{ p: 2.5, flexWrap: 'wrap' }}>
      <Button onClick={onClose}>Cancelar</Button>
      <Button variant="outlined" onClick={() => onSave(form, false)}>Guardar</Button>
      <Button variant="contained" onClick={() => onSave(form, true)}>Confirmar para envío</Button>
    </DialogActions>
  </Dialog>
}