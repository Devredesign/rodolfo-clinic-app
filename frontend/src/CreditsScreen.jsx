import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import { supabase } from './supabase.js'

const today = () => new Date().toISOString().slice(0, 10)
const money = (amount, currency) => new Intl.NumberFormat('es-CR', { style: 'currency', currency }).format(Number(amount || 0))

function AdvanceCreditDialog({ open, onClose, onSaved, organization, userId, clients, methods }) {
  const [form, setForm] = useState({ client_id: '', currency: 'USD', amount: '', method_id: '', receiver: 'rodolfo', payment_date: today(), reason: '', external_reference: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fx = Number(organization.default_fx_crc_per_usd || 0)
  const settings = organization.settings || {}
  const method = methods.find((m) => m.id === form.method_id)
  const amount = Number(form.amount || 0)
  const feeRate = form.receiver === 'rodolfo' ? Number(method?.fee_rate || 0) : 0
  const feeAmount = amount * feeRate

  useEffect(() => {
    if (!open) return
    setForm({ client_id: '', currency: 'USD', amount: '', method_id: '', receiver: 'rodolfo', payment_date: today(), reason: '', external_reference: '', notes: '' })
    setError('')
  }, [open])

  const save = async () => {
    if (!form.client_id) return setError('Seleccioná un cliente.')
    if (!method) return setError('Seleccioná un método de pago.')
    if (!Number.isFinite(amount) || amount <= 0) return setError('Ingresá un monto válido.')
    if (!form.reason.trim()) return setError('Indicá el motivo del crédito.')
    if (form.currency === 'CRC' && (!Number.isFinite(fx) || fx <= 0)) return setError('Configurá un tipo de cambio válido.')
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('register_client_credit_payment', {
      p_organization_id: organization.id,
      p_client_id: form.client_id,
      p_payment_date: form.payment_date,
      p_currency: form.currency,
      p_amount: amount,
      p_fx_crc_per_usd_snapshot: form.currency === 'CRC' ? fx : null,
      p_method_id: method.id,
      p_receiver: form.receiver,
      p_rodolfo_share_rate_snapshot: Number(settings.rodolfo_share_rate ?? 0.70),
      p_clinic_share_rate_snapshot: Number(settings.clinic_share_rate ?? 0.30),
      p_vat_rate_snapshot: Number(settings.vat_rate ?? 0.04),
      p_processor_fee_rate_snapshot: feeRate,
      p_processor_fee_amount: feeAmount,
      p_reason: form.reason,
      p_external_reference: form.external_reference,
      p_notes: form.notes,
      p_created_by: userId
    })
    if (rpcError) { console.error(rpcError); setError('No se pudo registrar el crédito.'); setSaving(false); return }
    onSaved(); setSaving(false); onClose()
  }

  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
    <DialogTitle>Registrar crédito adelantado</DialogTitle>
    <DialogContent><Stack spacing={2.5} mt={1}>
      {error && <Alert severity="error">{error}</Alert>}
      <Alert severity="info">Este dinero entra realmente, pero queda como saldo a favor del cliente hasta aplicarlo a un procedimiento.</Alert>
      <FormControl fullWidth><InputLabel>Cliente</InputLabel><Select value={form.client_id} label="Cliente" onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}>{clients.filter((c) => c.active).map((c) => <MenuItem key={c.id} value={c.id}>{c.full_name}</MenuItem>)}</Select></FormControl>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FormControl fullWidth><InputLabel>Moneda</InputLabel><Select value={form.currency} label="Moneda" onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}><MenuItem value="USD">USD</MenuItem><MenuItem value="CRC">CRC</MenuItem></Select></FormControl>
        <TextField label="Monto" type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} inputProps={{ min: 0.01, step: '0.01' }} fullWidth />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FormControl fullWidth><InputLabel>Método de pago</InputLabel><Select value={form.method_id} label="Método de pago" onChange={(e) => setForm((f) => ({ ...f, method_id: e.target.value }))}>{methods.filter((m) => m.active).map((m) => <MenuItem key={m.id} value={m.id}>{m.label}</MenuItem>)}</Select></FormControl>
        <FormControl fullWidth><InputLabel>Recibido en</InputLabel><Select value={form.receiver} label="Recibido en" onChange={(e) => setForm((f) => ({ ...f, receiver: e.target.value }))}><MenuItem value="rodolfo">Datáfono / cuenta de Rodolfo</MenuItem><MenuItem value="clinic">Datáfono / cuenta de la clínica</MenuItem></Select></FormControl>
      </Stack>
      <Card variant="outlined"><CardContent><Stack spacing={0.75}><Stack direction="row" justifyContent="space-between"><Typography>Crédito que recibe el cliente</Typography><Typography fontWeight={800}>{money(amount, form.currency)}</Typography></Stack><Stack direction="row" justifyContent="space-between"><Typography>Comisión bancaria registrada</Typography><Typography fontWeight={700}>{money(feeAmount, form.currency)} ({(feeRate * 100).toFixed(1)}%)</Typography></Stack></Stack></CardContent></Card>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField label="Fecha" type="date" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth /><TextField label="Referencia / comprobante" value={form.external_reference} onChange={(e) => setForm((f) => ({ ...f, external_reference: e.target.value }))} fullWidth /></Stack>
      <TextField label="Motivo" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Ej: Reserva Botox" required />
      <TextField label="Notas" multiline minRows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
    </Stack></DialogContent>
    <DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Registrando…' : 'Registrar crédito'}</Button></DialogActions>
  </Dialog>
}

function ApplyCreditDialog({ client, open, onClose, onSaved, organization, userId, procedures, balances }) {
  const [procedureId, setProcedureId] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('Aplicación de crédito del cliente')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const clientProcedures = procedures.filter((p) => p.client_id === client?.id && ['pending', 'partial'].includes(p.payment_status))
  const available = Number(balances?.[currency] || 0)

  useEffect(() => {
    if (!open) return
    const preferred = Number(balances?.USD || 0) > 0 ? 'USD' : 'CRC'
    setCurrency(preferred)
    setProcedureId('')
    setAmount('')
    setReason('Aplicación de crédito del cliente')
    setError('')
  }, [open, client])

  if (!client) return null
  const apply = async () => {
    const value = Number(amount)
    if (!procedureId) return setError('Seleccioná un procedimiento.')
    if (!Number.isFinite(value) || value <= 0) return setError('Ingresá un monto válido.')
    if (value > available + 0.01) return setError('El monto supera el crédito disponible en esa moneda.')
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('apply_client_credit_to_procedure', {
      p_organization_id: organization.id,
      p_client_id: client.id,
      p_procedure_id: procedureId,
      p_currency: currency,
      p_amount: value,
      p_transaction_date: today(),
      p_reason: reason,
      p_created_by: userId
    })
    if (rpcError) {
      console.error(rpcError)
      const message = rpcError.message || ''
      setError(message.includes('exceeds procedure balance') ? 'Ese monto supera el saldo pendiente del procedimiento.' : message.includes('Insufficient') ? 'El cliente no tiene suficiente crédito.' : 'No se pudo aplicar el crédito.')
      setSaving(false); return
    }
    onSaved(); setSaving(false); onClose()
  }

  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>Aplicar crédito a procedimiento</DialogTitle>
    <DialogContent><Stack spacing={2} mt={1}>
      {error && <Alert severity="error">{error}</Alert>}
      <Alert severity="info">{client.full_name} · USD {money(balances?.USD || 0, 'USD')} · CRC {money(balances?.CRC || 0, 'CRC')}</Alert>
      <FormControl fullWidth><InputLabel>Procedimiento</InputLabel><Select value={procedureId} label="Procedimiento" onChange={(e) => setProcedureId(e.target.value)}>{clientProcedures.map((p) => <MenuItem key={p.id} value={p.id}>{p.service_name_snapshot} · {p.payment_status === 'partial' ? 'Parcial' : 'Pendiente'} · ${Number(p.quoted_amount ?? p.service_price_usd_snapshot ?? 0).toFixed(2)}</MenuItem>)}</Select></FormControl>
      <FormControl fullWidth><InputLabel>Usar crédito en</InputLabel><Select value={currency} label="Usar crédito en" onChange={(e) => { setCurrency(e.target.value); setAmount('') }}><MenuItem value="USD" disabled={Number(balances?.USD || 0) <= 0}>USD · disponible {money(balances?.USD || 0, 'USD')}</MenuItem><MenuItem value="CRC" disabled={Number(balances?.CRC || 0) <= 0}>CRC · disponible {money(balances?.CRC || 0, 'CRC')}</MenuItem></Select></FormControl>
      <TextField label="Monto a aplicar" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ min: 0.01, max: available, step: '0.01' }} />
      <TextField label="Motivo / nota" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Stack></DialogContent>
    <DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" onClick={apply} disabled={saving || clientProcedures.length === 0}>{saving ? 'Aplicando…' : 'Aplicar crédito'}</Button></DialogActions>
  </Dialog>
}

export default function CreditsScreen({ organization, userId }) {
  const [transactions, setTransactions] = useState([])
  const [clients, setClients] = useState([])
  const [procedures, setProcedures] = useState([])
  const [methods, setMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [applyClient, setApplyClient] = useState(null)

  const load = async () => {
    setLoading(true); setError('')
    const [txRes, clientRes, procRes, methodRes] = await Promise.all([
      supabase.from('client_credit_transactions').select('*').eq('organization_id', organization.id).order('transaction_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('clients').select('id,full_name,active').eq('organization_id', organization.id).order('full_name'),
      supabase.from('procedures').select('id,client_id,service_name_snapshot,service_price_usd_snapshot,quoted_amount,payment_status').eq('organization_id', organization.id).order('created_at', { ascending: false }),
      supabase.from('payment_methods').select('*').eq('organization_id', organization.id).order('label')
    ])
    if (txRes.error || clientRes.error || procRes.error || methodRes.error) setError('No se pudo cargar la información de créditos.')
    else { setTransactions(txRes.data ?? []); setClients(clientRes.data ?? []); setProcedures(procRes.data ?? []); setMethods(methodRes.data ?? []) }
    setLoading(false)
  }
  useEffect(() => { load() }, [organization.id])

  const balancesByClient = useMemo(() => transactions.reduce((acc, row) => {
    if (!acc[row.client_id]) acc[row.client_id] = { USD: 0, CRC: 0, equivalentUsd: 0 }
    acc[row.client_id][row.currency] += Number(row.amount || 0)
    acc[row.client_id].equivalentUsd += Number(row.equivalent_usd || 0)
    return acc
  }, {}), [transactions])
  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients])
  const totalEquivalentUsd = Object.values(balancesByClient).reduce((sum, b) => sum + Math.max(0, b.equivalentUsd), 0)
  const clientsWithCredit = clients.filter((c) => {
    const b = balancesByClient[c.id]
    return b && (b.USD > 0.005 || b.CRC > 0.5)
  })

  const kindLabel = { advance_payment: 'Pago adelantado', payment_conversion: 'Convertido desde pago', procedure_application: 'Aplicado a procedimiento', adjustment: 'Ajuste' }

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}><Box flex={1}><Typography variant="h4" fontWeight={800}>Créditos</Typography><Typography color="text.secondary">Dinero recibido que todavía está total o parcialmente a favor del cliente.</Typography></Box><Button variant="contained" size="large" onClick={() => setAdvanceOpen(true)}>+ Registrar crédito</Button></Stack>
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}><Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">Crédito disponible equivalente</Typography><Typography variant="h5" fontWeight={800}>${totalEquivalentUsd.toFixed(2)}</Typography><Typography variant="caption" color="text.secondary">Suma de saldos USD y equivalentes CRC.</Typography></CardContent></Card><Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">Clientes con saldo</Typography><Typography variant="h5" fontWeight={800}>{clientsWithCredit.length}</Typography></CardContent></Card></Stack>

    <Card variant="outlined"><CardContent sx={{ p: 0 }}>
      {loading ? <Box p={4}><Typography color="text.secondary">Cargando créditos…</Typography></Box> : clientsWithCredit.length === 0 ? <Box p={4} textAlign="center"><Typography fontWeight={700}>No hay créditos disponibles</Typography><Typography color="text.secondary" mt={1}>Podés registrar un pago adelantado o convertir parte de un pago existente en crédito.</Typography></Box> : clientsWithCredit.map((client, index) => { const b = balancesByClient[client.id]; return <Box key={client.id}>{index > 0 && <Divider />}<Box p={{ xs: 2, sm: 2.5 }}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5} alignItems={{ md: 'center' }}><Box><Typography fontWeight={800}>{client.full_name}</Typography><Typography variant="body2" color="text.secondary">USD {money(b.USD, 'USD')} · CRC {money(b.CRC, 'CRC')}</Typography></Box><Stack direction="row" spacing={1} alignItems="center"><Chip label={`≈ $${Math.max(0, b.equivalentUsd).toFixed(2)}`} /><Button variant="outlined" onClick={() => setApplyClient(client)}>Aplicar a procedimiento</Button></Stack></Stack></Box></Box> })}
    </CardContent></Card>

    <Card variant="outlined"><CardContent><Typography fontWeight={800} mb={1.5}>Historial de movimientos</Typography>{transactions.length === 0 ? <Typography color="text.secondary">Todavía no hay movimientos de crédito.</Typography> : <Stack divider={<Divider flexItem />}>{transactions.map((row) => <Stack key={row.id} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" py={1.25} spacing={1}><Box><Typography variant="body2" fontWeight={700}>{clientById[row.client_id]?.full_name || 'Cliente'}</Typography><Typography variant="caption" color="text.secondary">{new Date(`${row.transaction_date}T12:00:00`).toLocaleDateString('es-CR')} · {kindLabel[row.kind] || row.kind}{row.reason ? ` · ${row.reason}` : ''}</Typography></Box><Typography fontWeight={800}>{Number(row.amount) >= 0 ? '+' : '−'} {money(Math.abs(Number(row.amount)), row.currency)}</Typography></Stack>)}</Stack>}</CardContent></Card>

    <AdvanceCreditDialog open={advanceOpen} onClose={() => setAdvanceOpen(false)} onSaved={load} organization={organization} userId={userId} clients={clients} methods={methods} />
    <ApplyCreditDialog client={applyClient} open={Boolean(applyClient)} onClose={() => setApplyClient(null)} onSaved={load} organization={organization} userId={userId} procedures={procedures} balances={applyClient ? balancesByClient[applyClient.id] : null} />
  </Stack>
}
