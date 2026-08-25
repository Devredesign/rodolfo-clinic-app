import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, IconButton, InputLabel, MenuItem, Select, Stack,
  Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import PaidIcon from '@mui/icons-material/Paid'
import { supabase } from './supabase.js'

const today = () => new Date().toISOString().slice(0, 10)
const money = (n, c = 'USD') => new Intl.NumberFormat('es-CR', { style: 'currency', currency: c }).format(Number(n || 0))

export default function FinanceScreen({ organization, userId, role }) {
  const [tab, setTab] = useState('expenses')
  const [cats, setCats] = useState([])
  const [expenses, setExpenses] = useState([])
  const [products, setProducts] = useState([])
  const [payments, setPayments] = useState([])
  const [open, setOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [paying, setPaying] = useState(null)
  const [editingPayment, setEditingPayment] = useState(null)
  const [voidingPayment, setVoidingPayment] = useState(null)
  const [error, setError] = useState('')

  const fx = Number(organization.default_fx_crc_per_usd || 0)

  const load = async () => {
    setError('')
    const [a, b, c, d] = await Promise.all([
      supabase.from('expense_categories').select('*').eq('organization_id', organization.id).order('name'),
      supabase.from('expenses').select('*,expense_categories(name),products(name,current_cost_usd)').eq('organization_id', organization.id).order('expense_date', { ascending: false }),
      supabase.from('products').select('id,name,current_cost_usd,active').eq('organization_id', organization.id).order('name'),
      supabase.from('expense_payments').select('*').eq('organization_id', organization.id).order('payment_date', { ascending: false }).order('created_at', { ascending: false })
    ])
    if (a.error || b.error || c.error || d.error) setError('No se pudo cargar Finanzas.')
    else {
      setCats(a.data || [])
      setExpenses(b.data || [])
      setProducts(c.data || [])
      setPayments(d.data || [])
    }
  }

  useEffect(() => { load() }, [organization.id])

  const paidBy = useMemo(() => payments.filter((p) => p.status === 'paid').reduce((acc, p) => {
    acc[p.expense_id] = (acc[p.expense_id] || 0) + Number(p.amount)
    return acc
  }, {}), [payments])

  const pending = expenses.filter((e) => e.status !== 'voided' && Math.max(0, Number(e.amount) - Number(paidBy[e.id] || 0)) > 0.01)
  const pendingTotal = pending.reduce((sum, e) => {
    const balance = Math.max(0, Number(e.amount) - Number(paidBy[e.id] || 0))
    return sum + (e.currency === 'USD' ? balance : (fx > 0 ? balance / fx : 0))
  }, 0)

  return <Stack spacing={3}>
    <Box>
      <Typography variant="h4" fontWeight={800}>Finanzas</Typography>
      <Typography color="text.secondary">Gastos, cuentas por pagar, categorías y su histórico de pagos.</Typography>
    </Box>

    {error && <Alert severity="error">{error}</Alert>}

    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption">Cuentas por pagar</Typography><Typography variant="h5" fontWeight={800}>{pending.length}</Typography></CardContent></Card>
      <Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption">Pendiente equivalente USD</Typography><Typography variant="h5" fontWeight={800}>${pendingTotal.toFixed(2)}</Typography></CardContent></Card>
      <Card variant="outlined" sx={{ flex: 1 }}><CardContent><Typography variant="caption">Tipo de cambio</Typography><Typography variant="h5" fontWeight={800}>₡{fx.toLocaleString('es-CR')}</Typography></CardContent></Card>
    </Stack>

    <Stack direction="row" spacing={1} flexWrap="wrap">
      <Button variant="contained" onClick={() => { setEditing(null); setOpen(true) }}>+ Registrar gasto</Button>
      {role === 'admin' && <Button variant="outlined" onClick={() => setCatOpen(true)}>+ Categoría de gasto</Button>}
    </Stack>

    <Tabs value={tab} onChange={(_, v) => setTab(v)}>
      <Tab value="expenses" label="Gastos" />
      <Tab value="payables" label={`Por pagar (${pending.length})`} />
      <Tab value="history" label="Histórico de pagos" />
    </Tabs>

    {tab === 'expenses' && <Rows rows={expenses} paidBy={paidBy} onEdit={(e) => { setEditing(e); setOpen(true) }} onPay={setPaying} />}
    {tab === 'payables' && <Rows rows={pending} paidBy={paidBy} onEdit={(e) => { setEditing(e); setOpen(true) }} onPay={setPaying} />}

    {tab === 'history' && <Card variant="outlined"><CardContent sx={{ p: 0 }}>
      {payments.length === 0 ? <Box p={3}>Sin pagos registrados.</Box> : payments.map((p, i) => (
        <Box key={p.id}>
          {i > 0 && <Divider />}
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} p={2} spacing={1}>
            <Box>
              <Typography fontWeight={700}>{new Date(p.payment_date + 'T12:00:00').toLocaleDateString('es-CR')}</Typography>
              <Typography variant="caption">{p.external_reference || 'Sin referencia'} · {p.status === 'voided' ? 'Anulado' : 'Pagado'}</Typography>
              {p.status === 'voided' && p.void_reason && <Typography variant="body2" color="error" mt={0.5}>Motivo: {p.void_reason}</Typography>}
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label={money(p.amount, p.currency)} variant={p.status === 'voided' ? 'outlined' : 'filled'} />
              {p.status === 'paid' && role === 'admin' && <>
                <Tooltip title="Editar pago"><IconButton size="small" onClick={() => setEditingPayment(p)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Anular pago"><IconButton size="small" color="error" onClick={() => setVoidingPayment(p)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
              </>}
            </Stack>
          </Stack>
        </Box>
      ))}
    </CardContent></Card>}

    <ExpenseDialog open={open} onClose={() => { setOpen(false); setEditing(null) }} saved={load} editing={editing} cats={cats} products={products} organization={organization} userId={userId} />
    <CategoryDialog open={catOpen} onClose={() => setCatOpen(false)} saved={load} organization={organization} />
    <PayDialog expense={paying} open={!!paying} onClose={() => setPaying(null)} saved={load} organization={organization} userId={userId} already={paying ? paidBy[paying.id] || 0 : 0} />
    <EditExpensePaymentDialog payment={editingPayment} open={!!editingPayment} onClose={() => setEditingPayment(null)} saved={load} organization={organization} expenses={expenses} payments={payments} />
    <VoidExpensePaymentDialog payment={voidingPayment} open={!!voidingPayment} onClose={() => setVoidingPayment(null)} saved={load} organization={organization} />
  </Stack>
}

function Rows({ rows, paidBy, onEdit, onPay }) {
  return <Card variant="outlined"><CardContent sx={{ p: 0 }}>
    {rows.length === 0 ? <Box p={3}>No hay registros.</Box> : rows.map((e, i) => {
      const bal = Math.max(0, Number(e.amount) - Number(paidBy[e.id] || 0))
      return <Box key={e.id}>{i > 0 && <Divider />}<Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" p={2} spacing={1}>
        <Box>
          <Typography fontWeight={800}>{e.description}</Typography>
          <Typography variant="body2" color="text.secondary">{e.expense_categories?.name || 'Sin categoría'} · {new Date(e.expense_date + 'T12:00:00').toLocaleDateString('es-CR')}{e.due_date ? ` · vence ${new Date(e.due_date + 'T12:00:00').toLocaleDateString('es-CR')}` : ''}</Typography>
          {e.products?.name && <Typography variant="caption">{e.products.name} × {e.product_quantity}</Typography>}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip label={money(e.amount, e.currency)} />
          <Chip variant="outlined" label={bal > .01 ? `Pend. ${money(bal, e.currency)}` : 'Pagado'} />
          <Tooltip title="Editar"><IconButton size="small" onClick={() => onEdit(e)}><EditIcon fontSize="small" /></IconButton></Tooltip>
          {bal > .01 && <Tooltip title="Registrar pago"><IconButton size="small" color="success" onClick={() => onPay(e)}><PaidIcon fontSize="small" /></IconButton></Tooltip>}
        </Stack>
      </Stack></Box>
    })}
  </CardContent></Card>
}

function ExpenseDialog({ open, onClose, saved, editing, cats, products, organization, userId }) {
  const blank = { category_id: '', description: '', currency: 'USD', amount: '', expense_date: today(), due_date: '', product_id: '', product_quantity: '1', notes: '' }
  const [f, setF] = useState(blank)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) {
      setErr('')
      setF(editing ? { ...blank, ...editing, category_id: editing.category_id || '', product_id: editing.product_id || '', due_date: editing.due_date || '', amount: String(editing.amount) } : blank)
    }
  }, [open, editing])

  const cat = cats.find((c) => c.id === f.category_id)
  const isSupply = cat?.name?.toLowerCase().includes('insumo')
  const prod = products.find((p) => p.id === f.product_id)
  const fx = Number(organization.default_fx_crc_per_usd || 0)

  useEffect(() => {
    if (isSupply && prod) {
      const usd = Number(prod.current_cost_usd) * Number(f.product_quantity || 0)
      setF((x) => ({ ...x, amount: (x.currency === 'CRC' ? usd * fx : usd).toFixed(2) }))
    }
  }, [f.product_id, f.product_quantity, f.currency, isSupply, fx])

  const save = async () => {
    if (!f.category_id || !f.description.trim() || Number(f.amount) <= 0) return setErr('Completá categoría, descripción y monto.')
    const payload = {
      category_id: f.category_id, description: f.description.trim(), currency: f.currency, amount: Number(f.amount),
      fx_crc_per_usd_snapshot: f.currency === 'CRC' ? fx : null, expense_date: f.expense_date, due_date: f.due_date || null,
      status: f.due_date ? 'pending' : 'paid', product_id: isSupply && f.product_id ? f.product_id : null,
      product_quantity: isSupply && f.product_id ? Number(f.product_quantity) : null, notes: f.notes || null, updated_at: new Date().toISOString()
    }
    const q = editing
      ? supabase.from('expenses').update(payload).eq('id', editing.id).eq('organization_id', organization.id)
      : supabase.from('expenses').insert({ ...payload, organization_id: organization.id, created_by: userId })
    const { error } = await q
    if (error) return setErr('No se pudo guardar el gasto.')
    saved(); onClose()
  }

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle>{editing ? 'Editar gasto' : 'Registrar gasto'}</DialogTitle>
    <DialogContent><Stack spacing={2} mt={1}>
      {err && <Alert severity="error">{err}</Alert>}
      <FormControl><InputLabel>Categoría</InputLabel><Select value={f.category_id} label="Categoría" onChange={(e) => setF({ ...f, category_id: e.target.value })}>{cats.filter((c) => c.active).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
      <TextField label="Descripción" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      {isSupply && <Stack direction="row" spacing={2}><FormControl fullWidth><InputLabel>Producto</InputLabel><Select value={f.product_id} label="Producto" onChange={(e) => setF({ ...f, product_id: e.target.value })}>{products.filter((p) => p.active).map((p) => <MenuItem key={p.id} value={p.id}>{p.name} · ${Number(p.current_cost_usd).toFixed(2)}</MenuItem>)}</Select></FormControl><TextField label="Cantidad" type="number" value={f.product_quantity} onChange={(e) => setF({ ...f, product_quantity: e.target.value })} /></Stack>}
      <Stack direction="row" spacing={2}><FormControl fullWidth><InputLabel>Moneda</InputLabel><Select value={f.currency} label="Moneda" onChange={(e) => setF({ ...f, currency: e.target.value })}><MenuItem value="USD">USD</MenuItem><MenuItem value="CRC">CRC</MenuItem></Select></FormControl><TextField fullWidth label="Monto" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Stack>
      {f.currency === 'CRC' && <Alert severity="info">Conversión automática con ₡{fx.toLocaleString('es-CR')} por USD.</Alert>}
      <Stack direction="row" spacing={2}><TextField fullWidth label="Fecha" type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} InputLabelProps={{ shrink: true }} /><TextField fullWidth label="Vencimiento (opcional)" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} InputLabelProps={{ shrink: true }} /></Stack>
      <TextField label="Notas" multiline minRows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={save}>Guardar</Button></DialogActions>
  </Dialog>
}

function CategoryDialog({ open, onClose, saved, organization }) {
  const [name, setName] = useState('')
  const save = async () => {
    if (!name.trim()) return
    await supabase.from('expense_categories').insert({ organization_id: organization.id, name: name.trim(), active: true })
    setName(''); saved(); onClose()
  }
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs"><DialogTitle>Nueva categoría de gasto</DialogTitle><DialogContent><TextField autoFocus fullWidth sx={{ mt: 1 }} label="Nombre" value={name} onChange={(e) => setName(e.target.value)} /></DialogContent><DialogActions><Button onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={save}>Guardar</Button></DialogActions></Dialog>
}

function PayDialog({ expense, open, onClose, saved, organization, userId, already }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [ref, setRef] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (expense) {
      setAmount(String(Math.max(0, Number(expense.amount) - Number(already))))
      setDate(today()); setRef(''); setErr('')
    }
  }, [expense, already])

  if (!expense) return null
  const save = async () => {
    const n = Number(amount)
    const remaining = Math.max(0, Number(expense.amount) - Number(already))
    if (n <= 0 || n > remaining + .01) return setErr('Ingresá un monto válido que no supere el saldo.')
    const { error } = await supabase.from('expense_payments').insert({
      organization_id: organization.id, expense_id: expense.id, payment_date: date, currency: expense.currency,
      amount: n, fx_crc_per_usd_snapshot: expense.currency === 'CRC' ? Number(organization.default_fx_crc_per_usd) : null,
      external_reference: ref || null, created_by: userId
    })
    if (error) return setErr('No se pudo registrar el pago.')
    const newPaid = Number(already) + n
    await supabase.from('expenses').update({ status: newPaid >= Number(expense.amount) - .01 ? 'paid' : 'pending', updated_at: new Date().toISOString() }).eq('id', expense.id)
    saved(); onClose()
  }

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs"><DialogTitle>Registrar pago</DialogTitle><DialogContent><Stack spacing={2} mt={1}>{err && <Alert severity="error">{err}</Alert>}<Alert severity="info">Saldo: {money(Math.max(0, Number(expense.amount) - Number(already)), expense.currency)}</Alert><TextField label="Monto pagado" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /><TextField label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} /><TextField label="Referencia" value={ref} onChange={(e) => setRef(e.target.value)} /></Stack></DialogContent><DialogActions><Button onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={save}>Registrar pago</Button></DialogActions></Dialog>
}

function EditExpensePaymentDialog({ payment, open, onClose, saved, organization, expenses, payments }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open && payment) {
      setAmount(String(payment.amount || ''))
      setDate(payment.payment_date || today())
      setRef(payment.external_reference || '')
      setNotes(payment.notes || '')
      setErr('')
    }
  }, [open, payment])

  if (!payment) return null
  const expense = expenses.find((e) => e.id === payment.expense_id)
  const otherPaid = payments.filter((p) => p.expense_id === payment.expense_id && p.status === 'paid' && p.id !== payment.id).reduce((s, p) => s + Number(p.amount), 0)
  const maxAmount = Math.max(0, Number(expense?.amount || 0) - otherPaid)

  const save = async () => {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return setErr('Ingresá un monto válido.')
    if (n > maxAmount + 0.01) return setErr('El pago no puede superar el saldo disponible del gasto.')
    const { error } = await supabase.rpc('update_expense_payment', {
      p_organization_id: organization.id,
      p_payment_id: payment.id,
      p_payment_date: date,
      p_amount: n,
      p_external_reference: ref,
      p_notes: notes
    })
    if (error) { console.error(error); return setErr('No se pudo editar el pago.') }
    saved(); onClose()
  }

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs"><DialogTitle>Editar pago de gasto</DialogTitle><DialogContent><Stack spacing={2} mt={1}>{err && <Alert severity="error">{err}</Alert>}<Alert severity="info">Máximo disponible: {money(maxAmount, payment.currency)}</Alert><TextField label="Monto pagado" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /><TextField label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} /><TextField label="Referencia" value={ref} onChange={(e) => setRef(e.target.value)} /><TextField label="Notas" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Stack></DialogContent><DialogActions><Button onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={save}>Guardar cambios</Button></DialogActions></Dialog>
}

function VoidExpensePaymentDialog({ payment, open, onClose, saved, organization }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { if (open) { setReason(''); setErr('') } }, [open])
  if (!payment) return null

  const confirm = async () => {
    if (!reason.trim()) return setErr('Indicá el motivo de la anulación.')
    setSaving(true); setErr('')
    const { error } = await supabase.rpc('void_expense_payment', {
      p_organization_id: organization.id,
      p_payment_id: payment.id,
      p_void_reason: reason
    })
    if (error) { console.error(error); setErr('No se pudo anular el pago.'); setSaving(false); return }
    saved(); setSaving(false); onClose()
  }

  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs"><DialogTitle>Anular pago</DialogTitle><DialogContent><Stack spacing={2} mt={1}>{err && <Alert severity="error">{err}</Alert>}<Alert severity="warning">El pago no se borra. Quedará en el histórico como anulado y la cuenta por pagar se recalculará automáticamente.</Alert><TextField label="Motivo de anulación" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={3} required /></Stack></DialogContent><DialogActions><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" color="error" onClick={confirm} disabled={saving}>{saving ? 'Anulando…' : 'Anular pago'}</Button></DialogActions></Dialog>
}
