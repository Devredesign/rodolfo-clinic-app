import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Tooltip, Typography } from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { supabase } from './supabase.js'

const today = () => new Date().toISOString().slice(0, 10)
const money = (amount, currency) => new Intl.NumberFormat('es-CR', { style: 'currency', currency }).format(Number(amount || 0))

function PaymentFields({ payment, organization, methods, onChange }) {
  const fx = Number(organization.default_fx_crc_per_usd || 0)
  const method = methods.find((m) => m.id === payment.method_id)
  const feeRate = payment.receiver === 'rodolfo' ? Number(method?.fee_rate || 0) : 0
  const list = Number(payment.list_amount || 0)
  const discount = Number(payment.discount_amount || 0)
  const final = Math.max(0, list - discount)
  const fee = final * feeRate
  return <Stack spacing={2.5} mt={1}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <FormControl fullWidth><InputLabel>Moneda</InputLabel><Select value={payment.currency} label="Moneda" onChange={(e) => onChange({ currency: e.target.value })}><MenuItem value="USD">USD</MenuItem><MenuItem value="CRC">CRC</MenuItem></Select></FormControl>
      <TextField label="Monto antes de descuento" type="number" value={payment.list_amount} onChange={(e) => onChange({ list_amount: e.target.value })} inputProps={{ min: 0, step: '0.01' }} fullWidth />
      <TextField label="Descuento" type="number" value={payment.discount_amount} onChange={(e) => onChange({ discount_amount: e.target.value })} inputProps={{ min: 0, step: '0.01' }} fullWidth />
    </Stack>
    {payment.currency === 'CRC' && <Typography variant="body2" color="text.secondary">Tipo de cambio usado: ₡{fx.toLocaleString('es-CR')} por USD.</Typography>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <FormControl fullWidth><InputLabel>Método de pago</InputLabel><Select value={payment.method_id || ''} label="Método de pago" onChange={(e) => onChange({ method_id: e.target.value })}>{methods.filter((m) => m.active).map((m) => <MenuItem key={m.id} value={m.id}>{m.label}</MenuItem>)}</Select></FormControl>
      <FormControl fullWidth><InputLabel>Recibido en</InputLabel><Select value={payment.receiver} label="Recibido en" onChange={(e) => onChange({ receiver: e.target.value })}><MenuItem value="rodolfo">Datáfono / cuenta de Rodolfo</MenuItem><MenuItem value="clinic">Datáfono / cuenta de la clínica</MenuItem></Select></FormControl>
    </Stack>
    <Card variant="outlined"><CardContent><Stack spacing={0.75}>
      <Stack direction="row" justifyContent="space-between"><Typography>Monto final</Typography><Typography fontWeight={800}>{money(final, payment.currency)}</Typography></Stack>
      <Stack direction="row" justifyContent="space-between"><Typography>Comisión bancaria registrada</Typography><Typography fontWeight={700}>{money(fee, payment.currency)} ({(feeRate * 100).toFixed(1)}%)</Typography></Stack>
      {payment.receiver === 'clinic' && <Typography variant="caption" color="text.secondary">La comisión del datáfono de la clínica no se registra como costo de Rodolfo.</Typography>}
    </Stack></CardContent></Card>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField label="Fecha de pago" type="date" value={payment.payment_date} onChange={(e) => onChange({ payment_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
      <TextField label="Referencia / comprobante" value={payment.external_reference || ''} onChange={(e) => onChange({ external_reference: e.target.value })} fullWidth />
    </Stack>
    <TextField label="Notas" multiline minRows={2} value={payment.notes || ''} onChange={(e) => onChange({ notes: e.target.value })} />
  </Stack>
}

function PaymentDialog({ open, onClose, onSaved, organization, userId, procedures, clients, methods }) {
  const [procedureId, setProcedureId] = useState('')
  const [form, setForm] = useState({ currency: 'USD', list_amount: '', discount_amount: '0', method_id: '', receiver: 'rodolfo', payment_date: today(), external_reference: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const procedure = procedures.find((p) => p.id === procedureId)
  const client = clients.find((c) => c.id === procedure?.client_id)
  const fx = Number(organization.default_fx_crc_per_usd || 0)
  const settings = organization.settings || {}

  useEffect(() => { if (open) { setProcedureId(''); setForm({ currency: 'USD', list_amount: '', discount_amount: '0', method_id: '', receiver: 'rodolfo', payment_date: today(), external_reference: '', notes: '' }); setError('') } }, [open])
  useEffect(() => { if (!procedure) return; const dueUsd = Number(procedure.quoted_amount ?? procedure.service_price_usd_snapshot ?? 0); setForm((f) => ({ ...f, list_amount: f.currency === 'USD' ? dueUsd.toFixed(2) : (dueUsd * fx).toFixed(2) })) }, [procedureId, form.currency, fx])

  const save = async () => {
    const method = methods.find((m) => m.id === form.method_id)
    const list = Number(form.list_amount || 0), discount = Number(form.discount_amount || 0), final = Math.max(0, list - discount)
    const feeRate = form.receiver === 'rodolfo' ? Number(method?.fee_rate || 0) : 0, feeAmount = final * feeRate
    if (!procedure) return setError('Seleccioná un procedimiento.')
    if (!method) return setError('Seleccioná un método de pago.')
    if (!Number.isFinite(list) || list <= 0) return setError('Ingresá un monto válido.')
    if (discount < 0 || discount > list) return setError('El descuento no puede ser negativo ni superar el monto.')
    if (form.currency === 'CRC' && (!Number.isFinite(fx) || fx <= 0)) return setError('Configurá un tipo de cambio válido antes de registrar pagos en colones.')
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('register_procedure_payment', {
      p_organization_id: organization.id, p_procedure_id: procedure.id, p_payment_date: form.payment_date, p_currency: form.currency,
      p_list_amount: list, p_discount_amount: discount, p_final_amount: final, p_fx_crc_per_usd_snapshot: form.currency === 'CRC' ? fx : null,
      p_method_id: method.id, p_receiver: form.receiver, p_rodolfo_share_rate_snapshot: Number(settings.rodolfo_share_rate ?? 0.70),
      p_clinic_share_rate_snapshot: Number(settings.clinic_share_rate ?? 0.30), p_vat_rate_snapshot: Number(settings.vat_rate ?? 0.04),
      p_processor_fee_rate_snapshot: feeRate, p_processor_fee_amount: feeAmount, p_external_reference: form.external_reference, p_notes: form.notes, p_created_by: userId
    })
    if (rpcError) { console.error(rpcError); setError('No se pudo registrar el pago.'); setSaving(false); return }
    onSaved(); setSaving(false); onClose()
  }

  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md"><DialogTitle>Registrar pago</DialogTitle><DialogContent><Stack spacing={2.5} mt={1}>{error && <Alert severity="error">{error}</Alert>}<FormControl fullWidth><InputLabel>Procedimiento</InputLabel><Select value={procedureId} label="Procedimiento" onChange={(e) => setProcedureId(e.target.value)}>{procedures.filter((p) => p.payment_status !== 'paid' && p.payment_status !== 'voided').map((p) => { const c = clients.find((x) => x.id === p.client_id); return <MenuItem key={p.id} value={p.id}>{c?.full_name || 'Cliente'} · {p.service_name_snapshot} · {p.payment_status === 'partial' ? 'Pago parcial' : 'Pendiente'}</MenuItem> })}</Select></FormControl>{procedure && <Alert severity="info">{client?.full_name} · {procedure.service_name_snapshot} · precio base ${Number(procedure.service_price_usd_snapshot).toFixed(2)}</Alert>}<PaymentFields payment={form} organization={organization} methods={methods} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} /></Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Registrando…' : 'Registrar pago'}</Button></DialogActions></Dialog>
}

function EditPaymentDialog({ payment, open, onClose, onSaved, organization, methods }) {
  const [form, setForm] = useState(null), [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (open && payment) { setForm({ ...payment, list_amount: String(payment.list_amount ?? ''), discount_amount: String(payment.discount_amount ?? 0) }); setError('') } }, [open, payment])
  if (!form) return null
  const save = async () => {
    const method = methods.find((m) => m.id === form.method_id)
    const list = Number(form.list_amount || 0), discount = Number(form.discount_amount || 0), final = Math.max(0, list - discount)
    const fx = Number(organization.default_fx_crc_per_usd || 0), feeRate = form.receiver === 'rodolfo' ? Number(method?.fee_rate || 0) : 0, feeAmount = final * feeRate
    if (!method) return setError('Seleccioná un método de pago.')
    if (!Number.isFinite(list) || list <= 0 || discount < 0 || discount > list) return setError('Revisá el monto y el descuento.')
    if (form.currency === 'CRC' && (!Number.isFinite(fx) || fx <= 0)) return setError('El tipo de cambio no es válido.')
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('update_procedure_payment', {
      p_organization_id: organization.id, p_payment_id: payment.id, p_payment_date: form.payment_date, p_currency: form.currency,
      p_list_amount: list, p_discount_amount: discount, p_final_amount: final, p_fx_crc_per_usd_snapshot: form.currency === 'CRC' ? fx : null,
      p_method_id: form.method_id, p_receiver: form.receiver, p_processor_fee_rate_snapshot: feeRate, p_processor_fee_amount: feeAmount,
      p_external_reference: form.external_reference || '', p_notes: form.notes || ''
    })
    if (rpcError) { console.error(rpcError); setError(rpcError.message?.includes('Reconciled') ? 'Un pago conciliado ya no puede editarse.' : 'No se pudo editar el pago.'); setSaving(false); return }
    onSaved(); setSaving(false); onClose()
  }
  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md"><DialogTitle>Editar pago</DialogTitle><DialogContent>{error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}<PaymentFields payment={form} organization={organization} methods={methods} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} /><Alert severity="warning" sx={{ mt: 2 }}>La edición recalcula automáticamente el estado de pago del procedimiento relacionado.</Alert></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button></DialogActions></Dialog>
}

function VoidPaymentDialog({ payment, open, onClose, onSaved, organization }) {
  const [reason, setReason] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (open) { setReason(''); setError('') } }, [open])
  if (!payment) return null
  const confirm = async () => {
    if (!reason.trim()) return setError('Indicá el motivo de la anulación.')
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('void_procedure_payment', { p_organization_id: organization.id, p_payment_id: payment.id, p_void_reason: reason })
    if (rpcError) { console.error(rpcError); setError(rpcError.message?.includes('Reconciled') ? 'Un pago conciliado ya no puede anularse.' : 'No se pudo anular el pago.'); setSaving(false); return }
    onSaved(); setSaving(false); onClose()
  }
  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm"><DialogTitle>Anular pago</DialogTitle><DialogContent><Stack spacing={2} mt={1}>{error && <Alert severity="error">{error}</Alert>}<Alert severity="warning">El pago no se borra: quedará en el histórico como anulado y el procedimiento volverá a calcular su saldo.</Alert><TextField label="Motivo de anulación" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={3} required /></Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button color="error" variant="contained" onClick={confirm} disabled={saving}>{saving ? 'Anulando…' : 'Anular pago'}</Button></DialogActions></Dialog>
}

export default function PaymentsScreen({ organization, userId }) {
  const [payments, setPayments] = useState([]), [procedures, setProcedures] = useState([]), [clients, setClients] = useState([]), [methods, setMethods] = useState([])
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [open, setOpen] = useState(false), [statusFilter, setStatusFilter] = useState('all')
  const [editing, setEditing] = useState(null), [voiding, setVoiding] = useState(null)

  const load = async () => {
    setLoading(true); setError('')
    const [paymentRes, procedureRes, clientRes, methodRes] = await Promise.all([
      supabase.from('payments').select('*, payment_methods(label), payment_procedures(procedure_id)').eq('organization_id', organization.id).order('payment_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('procedures').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }),
      supabase.from('clients').select('id,full_name,active').eq('organization_id', organization.id).order('full_name'),
      supabase.from('payment_methods').select('*').eq('organization_id', organization.id).order('label')
    ])
    if (paymentRes.error || procedureRes.error || clientRes.error || methodRes.error) setError('No se pudo cargar la información de pagos.')
    else { setPayments(paymentRes.data ?? []); setProcedures(procedureRes.data ?? []); setClients(clientRes.data ?? []); setMethods(methodRes.data ?? []) }
    setLoading(false)
  }
  useEffect(() => { load() }, [organization.id])

  const pendingProcedures = useMemo(() => procedures.filter((p) => p.payment_status === 'pending' || p.payment_status === 'partial'), [procedures])
  const visiblePayments = useMemo(() => statusFilter === 'all' ? payments : payments.filter((p) => p.status === statusFilter), [payments, statusFilter])
  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients])
  const procedureById = useMemo(() => Object.fromEntries(procedures.map((p) => [p.id, p])), [procedures])
  const pendingUsd = pendingProcedures.reduce((sum, p) => sum + Number(p.quoted_amount ?? p.service_price_usd_snapshot ?? 0), 0)

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}><Box flex={1}><Typography variant="h4" fontWeight={800}>Pagos</Typography><Typography color="text.secondary">Cobros de pacientes vinculados a procedimientos y su estado de pago.</Typography></Box><Button variant="contained" size="large" onClick={() => setOpen(true)}>+ Registrar pago</Button></Stack>
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}><Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">Procedimientos pendientes / parciales</Typography><Typography variant="h5" fontWeight={800}>{pendingProcedures.length}</Typography></CardContent></Card><Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">Valor nominal pendiente</Typography><Typography variant="h5" fontWeight={800}>${pendingUsd.toFixed(2)}</Typography><Typography variant="caption" color="text.secondary">Antes de descuentos y pagos parciales ya realizados.</Typography></CardContent></Card></Stack>
    <FormControl sx={{ maxWidth: 220 }}><InputLabel>Estado del pago</InputLabel><Select value={statusFilter} label="Estado del pago" onChange={(e) => setStatusFilter(e.target.value)}><MenuItem value="all">Todos</MenuItem><MenuItem value="paid">Pagados</MenuItem><MenuItem value="voided">Anulados</MenuItem><MenuItem value="refunded">Reembolsados</MenuItem></Select></FormControl>
    <Card variant="outlined"><CardContent sx={{ p: 0 }}>{loading ? <Box p={4}><Typography color="text.secondary">Cargando pagos…</Typography></Box> : visiblePayments.length === 0 ? <Box p={4} textAlign="center"><Typography fontWeight={700}>Todavía no hay pagos registrados</Typography><Typography color="text.secondary" mt={1}>Los cobros aparecerán aquí y actualizarán el procedimiento relacionado.</Typography></Box> : visiblePayments.map((payment, index) => {
      const procedureId = payment.payment_procedures?.[0]?.procedure_id, procedure = procedureById[procedureId], client = clientById[payment.client_id]
      const canChange = payment.status === 'paid' && payment.reconciliation_status === 'pending'
      return <Box key={payment.id}>{index > 0 && <Divider />}<Box p={{ xs: 2, sm: 2.5 }}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5}><Box><Typography fontWeight={800}>{client?.full_name || 'Cliente'}</Typography><Typography variant="body2" color="text.secondary">{procedure?.service_name_snapshot || 'Procedimiento'} · {new Date(`${payment.payment_date}T12:00:00`).toLocaleDateString('es-CR')} · {payment.payment_methods?.label || 'Método'}</Typography><Typography variant="caption" color="text.secondary">Recibido por {payment.receiver === 'rodolfo' ? 'Rodolfo' : 'clínica'}{payment.external_reference ? ` · Ref. ${payment.external_reference}` : ''}</Typography>{payment.status === 'voided' && payment.void_reason && <Typography variant="body2" color="error" mt={0.5}>Anulado: {payment.void_reason}</Typography>}</Box><Stack spacing={1} alignItems={{ md: 'flex-end' }}><Stack direction="row" spacing={1}><Chip label={money(payment.final_amount, payment.currency)} /><Chip variant="outlined" label={payment.status === 'paid' ? 'Pagado' : payment.status === 'voided' ? 'Anulado' : payment.status} /></Stack>{canChange && <Stack direction="row" spacing={0.5}><Tooltip title="Editar pago"><IconButton size="small" aria-label="Editar pago" onClick={() => setEditing(payment)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip><Tooltip title="Anular pago"><IconButton size="small" color="error" aria-label="Anular pago" onClick={() => setVoiding(payment)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip></Stack>}{payment.reconciliation_status !== 'pending' && <Typography variant="caption" color="text.secondary">Conciliado · bloqueado para cambios</Typography>}</Stack></Stack></Box></Box>
    })}</CardContent></Card>
    <PaymentDialog open={open} onClose={() => setOpen(false)} onSaved={load} organization={organization} userId={userId} procedures={procedures} clients={clients} methods={methods} />
    <EditPaymentDialog payment={editing} open={Boolean(editing)} onClose={() => setEditing(null)} onSaved={load} organization={organization} methods={methods} />
    <VoidPaymentDialog payment={voiding} open={Boolean(voiding)} onClose={() => setVoiding(null)} onSaved={load} organization={organization} />
  </Stack>
}
