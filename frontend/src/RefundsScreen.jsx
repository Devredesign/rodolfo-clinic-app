import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, TextField, Typography } from '@mui/material'
import { supabase } from './supabase.js'

const today = () => new Date().toISOString().slice(0, 10)
const money = (amount, currency) => new Intl.NumberFormat('es-CR', { style: 'currency', currency }).format(Number(amount || 0))

function ResolutionFields({ payment, refundedSoFar, convertedSoFar }) {
  const available = Math.max(0, Number(payment?.final_amount || 0) - Number(refundedSoFar || 0) - Number(convertedSoFar || 0))
  return <Alert severity="info">Pago original: {money(payment?.final_amount || 0, payment?.currency || 'USD')} · reembolsado: {money(refundedSoFar, payment?.currency || 'USD')} · convertido a crédito: {money(convertedSoFar, payment?.currency || 'USD')} · disponible: {money(available, payment?.currency || 'USD')}</Alert>
}

function CreditConversionDialog({ payment, open, onClose, onSaved, organization, userId, refundedSoFar, convertedSoFar }) {
  const remaining = Math.max(0, Number(payment?.final_amount || 0) - Number(refundedSoFar || 0) - Number(convertedSoFar || 0))
  const [amount, setAmount] = useState('')
  const [transactionDate, setTransactionDate] = useState(today())
  const [reason, setReason] = useState('Saldo a favor del cliente')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !payment) return
    setAmount(remaining.toFixed(2))
    setTransactionDate(today())
    setReason('Saldo a favor del cliente')
    setReference('')
    setError('')
  }, [open, payment, remaining])

  if (!payment) return null
  const confirm = async () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return setError('Ingresá un monto válido.')
    if (value > remaining + 0.01) return setError('El monto supera el saldo disponible del pago.')
    if (!reason.trim()) return setError('Indicá el motivo de la conversión.')
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('convert_payment_to_credit', {
      p_organization_id: organization.id,
      p_payment_id: payment.id,
      p_amount: value,
      p_transaction_date: transactionDate,
      p_reason: reason,
      p_external_reference: reference,
      p_created_by: userId
    })
    if (rpcError) {
      console.error(rpcError)
      const message = rpcError.message || ''
      setError(message.includes('Reconciled') ? 'Este pago ya fue conciliado.' : message.includes('exceeds') ? 'El monto supera el saldo disponible.' : 'No se pudo convertir el monto en crédito.')
      setSaving(false); return
    }
    onSaved(); setSaving(false); onClose()
  }

  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>Convertir pago en crédito</DialogTitle>
    <DialogContent><Stack spacing={2} mt={1}>
      {error && <Alert severity="error">{error}</Alert>}
      <Alert severity="success">Esta opción mantiene el dinero dentro de la operación y lo deja disponible para un procedimiento futuro del cliente. La comisión bancaria original se conserva.</Alert>
      <ResolutionFields payment={payment} refundedSoFar={refundedSoFar} convertedSoFar={convertedSoFar} />
      <TextField label="Monto a convertir" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ min: 0.01, max: remaining, step: '0.01' }} fullWidth />
      <TextField label="Fecha" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
      <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} required />
      <TextField label="Referencia / nota" value={reference} onChange={(e) => setReference(e.target.value)} fullWidth />
    </Stack></DialogContent>
    <DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" color="success" onClick={confirm} disabled={saving || remaining <= 0}>{saving ? 'Convirtiendo…' : 'Convertir a crédito'}</Button></DialogActions>
  </Dialog>
}

function RefundDialog({ payment, open, onClose, onSaved, organization, userId, refundedSoFar, convertedSoFar }) {
  const remaining = Math.max(0, Number(payment?.final_amount || 0) - Number(refundedSoFar || 0) - Number(convertedSoFar || 0))
  const [amount, setAmount] = useState('')
  const [refundDate, setRefundDate] = useState(today())
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !payment) return
    setAmount(remaining.toFixed(2)); setRefundDate(today()); setReason(''); setReference(''); setError('')
  }, [open, payment, remaining])

  if (!payment) return null
  const confirm = async () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return setError('Ingresá un monto de reembolso válido.')
    if (value > remaining + 0.01) return setError('El reembolso no puede superar el saldo disponible.')
    if (!reason.trim()) return setError('Indicá el motivo del reembolso.')
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('register_payment_refund', {
      p_organization_id: organization.id,
      p_payment_id: payment.id,
      p_refund_date: refundDate,
      p_amount: value,
      p_reason: reason,
      p_external_reference: reference,
      p_created_by: userId
    })
    if (rpcError) {
      console.error(rpcError)
      const message = rpcError.message || ''
      setError(message.includes('Reconciled') ? 'Este pago ya fue conciliado y no puede reembolsarse.' : message.includes('exceeds') ? 'El monto excede el saldo disponible.' : 'No se pudo registrar el reembolso.')
      setSaving(false); return
    }
    onSaved(); setSaving(false); onClose()
  }

  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>Registrar reembolso de dinero</DialogTitle>
    <DialogContent><Stack spacing={2} mt={1}>
      {error && <Alert severity="error">{error}</Alert>}
      <Alert severity="warning">Usá este flujo cuando el dinero realmente sale de la operación. Si el cliente puede conservarlo para otro servicio, preferí convertirlo en crédito.</Alert>
      <ResolutionFields payment={payment} refundedSoFar={refundedSoFar} convertedSoFar={convertedSoFar} />
      <TextField label="Monto a reembolsar" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ min: 0.01, max: remaining, step: '0.01' }} fullWidth />
      <TextField label="Fecha de reembolso" type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
      <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={3} required />
      <TextField label="Referencia / comprobante" value={reference} onChange={(e) => setReference(e.target.value)} fullWidth />
      <Alert severity="info">La comisión bancaria original se conserva como costo histórico.</Alert>
    </Stack></DialogContent>
    <DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" color="warning" onClick={confirm} disabled={saving || remaining <= 0}>{saving ? 'Reembolsando…' : 'Reembolsar dinero'}</Button></DialogActions>
  </Dialog>
}

export default function RefundsScreen({ organization, userId }) {
  const [payments, setPayments] = useState([])
  const [refunds, setRefunds] = useState([])
  const [creditTransactions, setCreditTransactions] = useState([])
  const [clients, setClients] = useState([])
  const [procedures, setProcedures] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refundPayment, setRefundPayment] = useState(null)
  const [creditPayment, setCreditPayment] = useState(null)

  const load = async () => {
    setLoading(true); setError('')
    const [paymentRes, refundRes, creditRes, clientRes, procedureRes] = await Promise.all([
      supabase.from('payments').select('*, payment_methods(label), payment_procedures(procedure_id)').eq('organization_id', organization.id).order('payment_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('payment_refunds').select('*').eq('organization_id', organization.id).order('refund_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('client_credit_transactions').select('*').eq('organization_id', organization.id).eq('kind', 'payment_conversion').order('transaction_date', { ascending: false }),
      supabase.from('clients').select('id,full_name').eq('organization_id', organization.id),
      supabase.from('procedures').select('id,service_name_snapshot').eq('organization_id', organization.id)
    ])
    if (paymentRes.error || refundRes.error || creditRes.error || clientRes.error || procedureRes.error) setError('No se pudo cargar la información de resolución de pagos.')
    else { setPayments(paymentRes.data ?? []); setRefunds(refundRes.data ?? []); setCreditTransactions(creditRes.data ?? []); setClients(clientRes.data ?? []); setProcedures(procedureRes.data ?? []) }
    setLoading(false)
  }
  useEffect(() => { load() }, [organization.id])

  const refundedByPayment = useMemo(() => refunds.reduce((acc, row) => { acc[row.payment_id] = (acc[row.payment_id] || 0) + Number(row.amount || 0); return acc }, {}), [refunds])
  const convertedByPayment = useMemo(() => creditTransactions.reduce((acc, row) => { acc[row.source_payment_id] = (acc[row.source_payment_id] || 0) + Number(row.amount || 0); return acc }, {}), [creditTransactions])
  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients])
  const procedureById = useMemo(() => Object.fromEntries(procedures.map((p) => [p.id, p])), [procedures])
  const resolvable = useMemo(() => payments.filter((p) => ['paid', 'refunded'].includes(p.status)), [payments])

  return <Stack spacing={3}>
    <Box><Typography variant="h4" fontWeight={800}>Resolver pagos</Typography><Typography color="text.secondary">Priorizá convertir el monto en crédito del cliente; usá reembolso cuando exista una salida real de dinero.</Typography></Box>
    {error && <Alert severity="error">{error}</Alert>}
    <Alert severity="success"><strong>Flujo recomendado:</strong> Convertir a crédito mantiene el dinero disponible para futuros servicios y reduce reembolsos innecesarios.</Alert>

    <Card variant="outlined"><CardContent sx={{ p: 0 }}>
      {loading ? <Box p={4}><Typography color="text.secondary">Cargando pagos…</Typography></Box> : resolvable.length === 0 ? <Box p={4} textAlign="center"><Typography fontWeight={700}>No hay pagos para resolver</Typography></Box> : resolvable.map((payment, index) => {
        const refunded = Number(refundedByPayment[payment.id] || 0)
        const converted = Number(convertedByPayment[payment.id] || 0)
        const remaining = Math.max(0, Number(payment.final_amount || 0) - refunded - converted)
        const procedureId = payment.payment_procedures?.[0]?.procedure_id
        const procedure = procedureById[procedureId]
        const client = clientById[payment.client_id]
        const reconciled = payment.reconciliation_status !== 'pending'
        return <Box key={payment.id}>{index > 0 && <Divider />}<Box p={{ xs: 2, sm: 2.5 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ md: 'center' }}>
            <Box><Typography fontWeight={800}>{client?.full_name || 'Cliente'}</Typography><Typography variant="body2" color="text.secondary">{procedure?.service_name_snapshot || 'Crédito / pago sin procedimiento'} · {payment.payment_methods?.label || 'Método'} · {new Date(`${payment.payment_date}T12:00:00`).toLocaleDateString('es-CR')}</Typography><Typography variant="caption" color="text.secondary">Pago {money(payment.final_amount, payment.currency)} · Crédito {money(converted, payment.currency)} · Reembolso {money(refunded, payment.currency)} · Disponible {money(remaining, payment.currency)}</Typography></Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              {converted > 0 && <Chip color="success" label={`Crédito ${money(converted, payment.currency)}`} />}
              {refunded > 0 && <Chip color="warning" label={`Reembolso ${money(refunded, payment.currency)}`} />}
              {reconciled && <Chip variant="outlined" label="Conciliado" />}
              <Button variant="contained" color="success" disabled={remaining <= 0.01 || reconciled} onClick={() => setCreditPayment(payment)}>Convertir a crédito</Button>
              <Button variant="outlined" color="warning" disabled={remaining <= 0.01 || reconciled} onClick={() => setRefundPayment(payment)}>Reembolsar</Button>
            </Stack>
          </Stack>
        </Box></Box>
      })}
    </CardContent></Card>

    <Card variant="outlined"><CardContent><Typography fontWeight={800} mb={1.5}>Historial de reembolsos reales</Typography>{refunds.length === 0 ? <Typography color="text.secondary">Todavía no hay reembolsos registrados.</Typography> : <Stack divider={<Divider flexItem />}>{refunds.map((refund) => { const payment = payments.find((p) => p.id === refund.payment_id); const client = clientById[payment?.client_id]; return <Stack key={refund.id} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" py={1.25} spacing={1}><Box><Typography variant="body2" fontWeight={700}>{client?.full_name || 'Cliente'}</Typography><Typography variant="caption" color="text.secondary">{new Date(`${refund.refund_date}T12:00:00`).toLocaleDateString('es-CR')} · {refund.reason}{refund.external_reference ? ` · Ref. ${refund.external_reference}` : ''}</Typography></Box><Typography fontWeight={800}>− {money(refund.amount, payment?.currency || 'USD')}</Typography></Stack> })}</Stack>}</CardContent></Card>

    <CreditConversionDialog payment={creditPayment} open={Boolean(creditPayment)} onClose={() => setCreditPayment(null)} onSaved={load} organization={organization} userId={userId} refundedSoFar={creditPayment ? refundedByPayment[creditPayment.id] || 0 : 0} convertedSoFar={creditPayment ? convertedByPayment[creditPayment.id] || 0 : 0} />
    <RefundDialog payment={refundPayment} open={Boolean(refundPayment)} onClose={() => setRefundPayment(null)} onSaved={load} organization={organization} userId={userId} refundedSoFar={refundPayment ? refundedByPayment[refundPayment.id] || 0 : 0} convertedSoFar={refundPayment ? convertedByPayment[refundPayment.id] || 0 : 0} />
  </Stack>
}
