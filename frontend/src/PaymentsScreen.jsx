import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import { supabase } from './supabase.js'

const today = () => new Date().toISOString().slice(0, 10)
const money = (amount, currency) => new Intl.NumberFormat('es-CR', { style: 'currency', currency }).format(Number(amount || 0))

function PaymentDialog({ open, onClose, onSaved, organization, userId, procedures, clients, methods }) {
  const [procedureId, setProcedureId] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [listAmount, setListAmount] = useState('')
  const [discount, setDiscount] = useState('0')
  const [methodId, setMethodId] = useState('')
  const [receiver, setReceiver] = useState('rodolfo')
  const [paymentDate, setPaymentDate] = useState(today())
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const procedure = procedures.find((p) => p.id === procedureId)
  const method = methods.find((m) => m.id === methodId)
  const fx = Number(organization.default_fx_crc_per_usd || 0)
  const settings = organization.settings || {}

  useEffect(() => {
    if (!open) return
    setProcedureId('')
    setCurrency('USD')
    setListAmount('')
    setDiscount('0')
    setMethodId('')
    setReceiver('rodolfo')
    setPaymentDate(today())
    setReference('')
    setNotes('')
    setError('')
  }, [open])

  useEffect(() => {
    if (!procedure) return
    const dueUsd = Number(procedure.quoted_amount ?? procedure.service_price_usd_snapshot ?? 0)
    setListAmount(currency === 'USD' ? dueUsd.toFixed(2) : (dueUsd * fx).toFixed(2))
  }, [procedureId, currency, fx])

  const list = Number(listAmount || 0)
  const discountAmount = Number(discount || 0)
  const finalAmount = Math.max(0, list - discountAmount)
  const feeRate = receiver === 'rodolfo' ? Number(method?.fee_rate || 0) : 0
  const feeAmount = finalAmount * feeRate
  const client = clients.find((c) => c.id === procedure?.client_id)

  const save = async () => {
    if (!procedure) return setError('Seleccioná un procedimiento.')
    if (!method) return setError('Seleccioná un método de pago.')
    if (!Number.isFinite(list) || list <= 0) return setError('Ingresá un monto válido.')
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > list) return setError('El descuento no puede ser negativo ni superar el monto.')
    if (currency === 'CRC' && (!Number.isFinite(fx) || fx <= 0)) return setError('Configurá un tipo de cambio válido antes de registrar pagos en colones.')

    setSaving(true)
    setError('')

    const { data, error: rpcError } = await supabase.rpc('register_procedure_payment', {
      p_organization_id: organization.id,
      p_procedure_id: procedure.id,
      p_payment_date: paymentDate,
      p_currency: currency,
      p_list_amount: list,
      p_discount_amount: discountAmount,
      p_final_amount: finalAmount,
      p_fx_crc_per_usd_snapshot: currency === 'CRC' ? fx : null,
      p_method_id: method.id,
      p_receiver: receiver,
      p_rodolfo_share_rate_snapshot: Number(settings.rodolfo_share_rate ?? 0.70),
      p_clinic_share_rate_snapshot: Number(settings.clinic_share_rate ?? 0.30),
      p_vat_rate_snapshot: Number(settings.vat_rate ?? 0.04),
      p_processor_fee_rate_snapshot: feeRate,
      p_processor_fee_amount: feeAmount,
      p_external_reference: reference,
      p_notes: notes,
      p_created_by: userId
    })

    if (rpcError) {
      console.error(rpcError)
      setError('No se pudo registrar el pago. Revisá los datos e intentá nuevamente.')
      setSaving(false)
      return
    }

    onSaved(data)
    setSaving(false)
    onClose()
  }

  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
    <DialogTitle>Registrar pago</DialogTitle>
    <DialogContent>
      <Stack spacing={2.5} mt={1}>
        {error && <Alert severity="error">{error}</Alert>}
        <FormControl fullWidth>
          <InputLabel>Procedimiento</InputLabel>
          <Select value={procedureId} label="Procedimiento" onChange={(e) => setProcedureId(e.target.value)}>
            {procedures.filter((p) => p.payment_status !== 'paid' && p.payment_status !== 'voided').map((p) => {
              const c = clients.find((clientRow) => clientRow.id === p.client_id)
              return <MenuItem key={p.id} value={p.id}>{c?.full_name || 'Cliente'} · {p.service_name_snapshot} · {p.payment_status === 'partial' ? 'Pago parcial' : 'Pendiente'}</MenuItem>
            })}
          </Select>
        </FormControl>

        {procedure && <Alert severity="info">{client?.full_name} · {procedure.service_name_snapshot} · precio base ${Number(procedure.service_price_usd_snapshot).toFixed(2)}</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl fullWidth><InputLabel>Moneda</InputLabel><Select value={currency} label="Moneda" onChange={(e) => setCurrency(e.target.value)}><MenuItem value="USD">USD</MenuItem><MenuItem value="CRC">CRC</MenuItem></Select></FormControl>
          <TextField label="Monto antes de descuento" type="number" value={listAmount} onChange={(e) => setListAmount(e.target.value)} inputProps={{ min: 0, step: '0.01' }} fullWidth />
          <TextField label="Descuento" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} inputProps={{ min: 0, step: '0.01' }} fullWidth />
        </Stack>

        {currency === 'CRC' && <Typography variant="body2" color="text.secondary">Tipo de cambio usado: ₡{fx.toLocaleString('es-CR')} por USD.</Typography>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl fullWidth><InputLabel>Método de pago</InputLabel><Select value={methodId} label="Método de pago" onChange={(e) => setMethodId(e.target.value)}>{methods.filter((m) => m.active).map((m) => <MenuItem key={m.id} value={m.id}>{m.label}</MenuItem>)}</Select></FormControl>
          <FormControl fullWidth><InputLabel>Recibido en</InputLabel><Select value={receiver} label="Recibido en" onChange={(e) => setReceiver(e.target.value)}><MenuItem value="rodolfo">Datáfono / cuenta de Rodolfo</MenuItem><MenuItem value="clinic">Datáfono / cuenta de la clínica</MenuItem></Select></FormControl>
        </Stack>

        <Card variant="outlined"><CardContent><Stack spacing={0.75}>
          <Stack direction="row" justifyContent="space-between"><Typography>Monto final</Typography><Typography fontWeight={800}>{money(finalAmount, currency)}</Typography></Stack>
          <Stack direction="row" justifyContent="space-between"><Typography>Comisión bancaria registrada</Typography><Typography fontWeight={700}>{money(feeAmount, currency)} ({(feeRate * 100).toFixed(1)}%)</Typography></Stack>
          {receiver === 'clinic' && <Typography variant="caption" color="text.secondary">La comisión del datáfono de la clínica la asume la clínica, por eso no se registra como costo de Rodolfo.</Typography>}
        </Stack></CardContent></Card>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Fecha de pago" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField label="Referencia / comprobante" value={reference} onChange={(e) => setReference(e.target.value)} fullWidth />
        </Stack>
        <TextField label="Notas" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Stack>
    </DialogContent>
    <DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Registrando…' : 'Registrar pago'}</Button></DialogActions>
  </Dialog>
}

export default function PaymentsScreen({ organization, userId }) {
  const [payments, setPayments] = useState([])
  const [procedures, setProcedures] = useState([])
  const [clients, setClients] = useState([])
  const [methods, setMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')

  const load = async () => {
    setLoading(true)
    setError('')
    const [paymentRes, procedureRes, clientRes, methodRes] = await Promise.all([
      supabase.from('payments').select('*, payment_methods(label), payment_procedures(procedure_id)').eq('organization_id', organization.id).order('payment_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('procedures').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }),
      supabase.from('clients').select('id,full_name,active').eq('organization_id', organization.id).order('full_name'),
      supabase.from('payment_methods').select('*').eq('organization_id', organization.id).order('label')
    ])
    if (paymentRes.error || procedureRes.error || clientRes.error || methodRes.error) setError('No se pudo cargar la información de pagos.')
    else {
      setPayments(paymentRes.data ?? [])
      setProcedures(procedureRes.data ?? [])
      setClients(clientRes.data ?? [])
      setMethods(methodRes.data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [organization.id])

  const pendingProcedures = useMemo(() => procedures.filter((p) => p.payment_status === 'pending' || p.payment_status === 'partial'), [procedures])
  const visiblePayments = useMemo(() => statusFilter === 'all' ? payments : payments.filter((p) => p.status === statusFilter), [payments, statusFilter])
  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients])
  const procedureById = useMemo(() => Object.fromEntries(procedures.map((p) => [p.id, p])), [procedures])

  const pendingUsd = pendingProcedures.reduce((sum, p) => sum + Number(p.quoted_amount ?? p.service_price_usd_snapshot ?? 0), 0)

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
      <Box flex={1}><Typography variant="h4" fontWeight={800}>Pagos</Typography><Typography color="text.secondary">Cobros de pacientes vinculados a procedimientos y su estado de pago.</Typography></Box>
      <Button variant="contained" size="large" onClick={() => setOpen(true)}>+ Registrar pago</Button>
    </Stack>

    {error && <Alert severity="error">{error}</Alert>}

    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      <Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">Procedimientos pendientes / parciales</Typography><Typography variant="h5" fontWeight={800}>{pendingProcedures.length}</Typography></CardContent></Card>
      <Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">Valor nominal pendiente</Typography><Typography variant="h5" fontWeight={800}>${pendingUsd.toFixed(2)}</Typography><Typography variant="caption" color="text.secondary">Antes de descuentos y pagos parciales ya realizados.</Typography></CardContent></Card>
    </Stack>

    <FormControl sx={{ maxWidth: 220 }}><InputLabel>Estado del pago</InputLabel><Select value={statusFilter} label="Estado del pago" onChange={(e) => setStatusFilter(e.target.value)}><MenuItem value="all">Todos</MenuItem><MenuItem value="paid">Pagados</MenuItem><MenuItem value="voided">Anulados</MenuItem><MenuItem value="refunded">Reembolsados</MenuItem></Select></FormControl>

    <Card variant="outlined"><CardContent sx={{ p: 0 }}>
      {loading ? <Box p={4}><Typography color="text.secondary">Cargando pagos…</Typography></Box> : visiblePayments.length === 0 ? <Box p={4} textAlign="center"><Typography fontWeight={700}>Todavía no hay pagos registrados</Typography><Typography color="text.secondary" mt={1}>Los cobros aparecerán aquí y actualizarán el procedimiento relacionado.</Typography></Box> : visiblePayments.map((payment, index) => {
        const procedureId = payment.payment_procedures?.[0]?.procedure_id
        const procedure = procedureById[procedureId]
        const client = clientById[payment.client_id]
        return <Box key={payment.id}>{index > 0 && <Divider />}<Box p={{ xs: 2, sm: 2.5 }}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5}><Box><Typography fontWeight={800}>{client?.full_name || 'Cliente'}</Typography><Typography variant="body2" color="text.secondary">{procedure?.service_name_snapshot || 'Procedimiento'} · {new Date(`${payment.payment_date}T12:00:00`).toLocaleDateString('es-CR')} · {payment.payment_methods?.label || 'Método'}</Typography><Typography variant="caption" color="text.secondary">Recibido por {payment.receiver === 'rodolfo' ? 'Rodolfo' : 'clínica'}{payment.external_reference ? ` · Ref. ${payment.external_reference}` : ''}</Typography></Box><Stack direction="row" spacing={1} alignItems="center"><Chip label={money(payment.final_amount, payment.currency)} /><Chip variant="outlined" label={payment.status === 'paid' ? 'Pagado' : payment.status} /></Stack></Stack></Box></Box>
      })}
    </CardContent></Card>

    <PaymentDialog open={open} onClose={() => setOpen(false)} onSaved={() => load()} organization={organization} userId={userId} procedures={procedures} clients={clients} methods={methods} />
  </Stack>
}
