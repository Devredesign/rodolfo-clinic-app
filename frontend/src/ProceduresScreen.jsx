import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import { supabase } from './supabase.js'

const statusLabel = { pending: 'Pendiente', performed: 'Realizado', cancelled: 'Cancelado' }
const paymentLabel = { pending: 'Pago pendiente', paid: 'Pagado', partial: 'Pago parcial', refunded: 'Reembolsado', voided: 'Anulado' }

function ProcedureFormDialog({ open, onClose, onSaved, organization, userId, clients, services, products }) {
  const [client, setClient] = useState(null)
  const [service, setService] = useState(null)
  const [serviceRecipe, setServiceRecipe] = useState([])
  const [status, setStatus] = useState('performed')
  const [performedAt, setPerformedAt] = useState('')
  const [notes, setNotes] = useState('')
  const [loadingRecipe, setLoadingRecipe] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setClient(null)
    setService(null)
    setServiceRecipe([])
    setStatus('performed')
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    setPerformedAt(now.toISOString().slice(0, 16))
    setNotes('')
    setError('')
  }, [open])

  useEffect(() => {
    if (!service) {
      setServiceRecipe([])
      return
    }
    const loadRecipe = async () => {
      setLoadingRecipe(true)
      const { data, error: recipeError } = await supabase
        .from('service_products')
        .select('product_id,standard_quantity,sort_order')
        .eq('organization_id', organization.id)
        .eq('service_id', service.id)
        .order('sort_order')
      if (recipeError) setError('No se pudieron cargar los productos estándar del servicio.')
      setServiceRecipe(data ?? [])
      setLoadingRecipe(false)
    }
    loadRecipe()
  }, [service, organization.id])

  const save = async () => {
    if (!client) return setError('Seleccioná un cliente.')
    if (!service) return setError('Seleccioná un servicio.')
    if (!performedAt) return setError('Seleccioná la fecha y hora del procedimiento.')

    setSaving(true)
    setError('')

    const procedurePayload = {
      organization_id: organization.id,
      client_id: client.id,
      service_id: service.id,
      scheduled_at: status === 'pending' ? new Date(performedAt).toISOString() : null,
      performed_at: status === 'performed' ? new Date(performedAt).toISOString() : null,
      status,
      payment_status: 'pending',
      notes: notes.trim() || null,
      service_name_snapshot: service.name,
      service_price_usd_snapshot: Number(service.price_usd),
      fx_crc_per_usd_snapshot: Number(organization.default_fx_crc_per_usd || 0) || null,
      quoted_currency: 'USD',
      quoted_amount: Number(service.price_usd),
      created_by: userId
    }

    const { data: savedProcedure, error: procedureError } = await supabase
      .from('procedures')
      .insert(procedurePayload)
      .select('*')
      .single()

    if (procedureError) {
      setSaving(false)
      setError('No se pudo registrar el procedimiento.')
      return
    }

    if (serviceRecipe.length) {
      const productById = Object.fromEntries(products.map((product) => [product.id, product]))
      const rows = serviceRecipe.map((row) => ({
        organization_id: organization.id,
        procedure_id: savedProcedure.id,
        product_id: row.product_id,
        standard_quantity_snapshot: Number(row.standard_quantity),
        product_cost_usd_snapshot: Number(productById[row.product_id]?.current_cost_usd || 0)
      }))
      const { error: productsError } = await supabase.from('procedure_products').insert(rows)
      if (productsError) {
        setSaving(false)
        setError('El procedimiento se creó, pero no se pudieron registrar sus productos estándar.')
        return
      }
    }

    onSaved(savedProcedure)
    setSaving(false)
    onClose()
  }

  const productById = Object.fromEntries(products.map((product) => [product.id, product]))
  const standardCost = serviceRecipe.reduce((sum, row) => sum + Number(row.standard_quantity) * Number(productById[row.product_id]?.current_cost_usd || 0), 0)

  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
    <DialogTitle>Nuevo procedimiento</DialogTitle>
    <DialogContent>
      <Stack spacing={2.5} mt={1}>
        {error && <Alert severity="error">{error}</Alert>}
        <Autocomplete
          options={clients.filter((item) => item.active)}
          value={client}
          onChange={(_event, value) => setClient(value)}
          getOptionLabel={(option) => `${option.full_name}${option.identification ? ` · ${option.identification}` : ''}`}
          renderInput={(params) => <TextField {...params} label="Cliente" placeholder="Buscar cliente" />}
        />
        <Autocomplete
          options={services.filter((item) => item.active)}
          value={service}
          onChange={(_event, value) => setService(value)}
          getOptionLabel={(option) => `${option.name} · $${Number(option.price_usd).toFixed(2)}`}
          renderInput={(params) => <TextField {...params} label="Servicio" placeholder="Buscar servicio" />}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl fullWidth>
            <InputLabel>Estado</InputLabel>
            <Select value={status} label="Estado" onChange={(event) => setStatus(event.target.value)}>
              <MenuItem value="performed">Realizado</MenuItem>
              <MenuItem value="pending">Programado / pendiente</MenuItem>
            </Select>
          </FormControl>
          <TextField label={status === 'performed' ? 'Fecha y hora realizada' : 'Fecha y hora programada'} type="datetime-local" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
        </Stack>

        {service && <Card variant="outlined"><CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" justifyContent="space-between"><Typography fontWeight={700}>{service.name}</Typography><Typography fontWeight={800}>${Number(service.price_usd).toFixed(2)}</Typography></Stack>
            <Typography variant="body2" color="text.secondary">Este precio queda guardado como snapshot aunque el servicio cambie de precio después.</Typography>
            <Divider />
            <Typography fontWeight={700}>Productos estándar</Typography>
            {loadingRecipe ? <Typography color="text.secondary">Cargando…</Typography> : serviceRecipe.length === 0 ? <Typography color="text.secondary">Este servicio no tiene productos asociados.</Typography> : serviceRecipe.map((row) => <Stack key={row.product_id} direction="row" justifyContent="space-between"><Typography variant="body2">{productById[row.product_id]?.name || 'Producto'}</Typography><Typography variant="body2" fontWeight={700}>{Number(row.standard_quantity)} unidad(es)</Typography></Stack>)}
            <Divider />
            <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Costo estándar estimado</Typography><Typography variant="body2" fontWeight={700}>${standardCost.toFixed(2)}</Typography></Stack>
          </Stack>
        </CardContent></Card>}

        <Alert severity="info">El procedimiento se crea con pago pendiente. Cuando construyamos Pagos, registrar un cobro actualizará automáticamente este estado y permitirá pagos adelantados.</Alert>
        <TextField label="Notas del procedimiento" value={notes} onChange={(event) => setNotes(event.target.value)} multiline minRows={3} />
      </Stack>
    </DialogContent>
    <DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" onClick={save} disabled={saving || loadingRecipe}>{saving ? 'Guardando…' : 'Registrar procedimiento'}</Button></DialogActions>
  </Dialog>
}

function ProcedureDetailDialog({ procedure, open, onClose, clients, products, organizationId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !procedure) return
    const load = async () => {
      setLoading(true)
      const { data } = await supabase.from('procedure_products').select('*').eq('organization_id', organizationId).eq('procedure_id', procedure.id)
      setRows(data ?? [])
      setLoading(false)
    }
    load()
  }, [open, procedure, organizationId])

  if (!procedure) return null
  const client = clients.find((item) => item.id === procedure.client_id)
  const productById = Object.fromEntries(products.map((product) => [product.id, product]))
  const standardCost = rows.reduce((sum, row) => sum + Number(row.standard_cost_usd || 0), 0)
  const dateValue = procedure.performed_at || procedure.scheduled_at

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle>Detalle del procedimiento</DialogTitle>
    <DialogContent><Stack spacing={2} mt={1}>
      <Box><Typography variant="h5" fontWeight={800}>{procedure.service_name_snapshot}</Typography><Typography color="text.secondary">{client?.full_name || 'Cliente'}</Typography></Box>
      <Stack direction="row" spacing={1} flexWrap="wrap"><Chip size="small" label={statusLabel[procedure.status] || procedure.status} /><Chip size="small" variant="outlined" label={paymentLabel[procedure.payment_status] || procedure.payment_status} /></Stack>
      <Divider />
      <Box><Typography variant="caption" color="text.secondary">Fecha</Typography><Typography>{dateValue ? new Date(dateValue).toLocaleString('es-CR') : 'Sin fecha'}</Typography></Box>
      <Box><Typography variant="caption" color="text.secondary">Precio guardado</Typography><Typography fontWeight={700}>${Number(procedure.service_price_usd_snapshot).toFixed(2)}</Typography></Box>
      <Box><Typography variant="caption" color="text.secondary">Notas</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{procedure.notes || 'Sin notas'}</Typography></Box>
      <Divider />
      <Typography fontWeight={700}>Productos del procedimiento</Typography>
      {loading ? <Typography color="text.secondary">Cargando…</Typography> : rows.length === 0 ? <Typography color="text.secondary">No hay productos asociados.</Typography> : rows.map((row) => <Stack key={row.id} direction="row" justifyContent="space-between"><Box><Typography variant="body2">{productById[row.product_id]?.name || 'Producto'}</Typography><Typography variant="caption" color="text.secondary">{Number(row.standard_quantity_snapshot)} unidad(es)</Typography></Box><Typography variant="body2" fontWeight={700}>${Number(row.standard_cost_usd).toFixed(2)}</Typography></Stack>)}
      <Divider />
      <Stack direction="row" justifyContent="space-between"><Typography fontWeight={700}>Costo estándar total</Typography><Typography fontWeight={800}>${standardCost.toFixed(2)}</Typography></Stack>
    </Stack></DialogContent>
    <DialogActions sx={{ p: 2.5 }}><Button onClick={onClose}>Cerrar</Button></DialogActions>
  </Dialog>
}

export default function ProceduresScreen({ organization, userId }) {
  const [procedures, setProcedures] = useState([])
  const [clients, setClients] = useState([])
  const [services, setServices] = useState([])
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [procedureResult, clientResult, serviceResult, productResult] = await Promise.all([
        supabase.from('procedures').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }),
        supabase.from('clients').select('*').eq('organization_id', organization.id).order('full_name'),
        supabase.from('services').select('*').eq('organization_id', organization.id).order('name'),
        supabase.from('products').select('*').eq('organization_id', organization.id).order('name')
      ])
      if (procedureResult.error || clientResult.error || serviceResult.error || productResult.error) setError('No se pudo cargar la información de procedimientos.')
      else {
        setProcedures(procedureResult.data ?? [])
        setClients(clientResult.data ?? [])
        setServices(serviceResult.data ?? [])
        setProducts(productResult.data ?? [])
      }
      setLoading(false)
    }
    load()
  }, [organization.id])

  const clientById = useMemo(() => Object.fromEntries(clients.map((client) => [client.id, client])), [clients])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return procedures.filter((procedure) => {
      const matchesStatus = statusFilter === 'all' || procedure.status === statusFilter
      const clientName = clientById[procedure.client_id]?.full_name || ''
      const matchesSearch = !term || procedure.service_name_snapshot.toLowerCase().includes(term) || clientName.toLowerCase().includes(term)
      return matchesStatus && matchesSearch
    })
  }, [procedures, search, statusFilter, clientById])

  const addProcedure = (saved) => setProcedures((current) => [saved, ...current])

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
      <Box flex={1}><Typography variant="h4" fontWeight={800}>Procedimientos</Typography><Typography color="text.secondary">Registro real que conecta clientes, servicios, productos y pagos.</Typography></Box>
      <Button variant="contained" size="large" onClick={() => setFormOpen(true)}>+ Nuevo procedimiento</Button>
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField placeholder="Buscar por cliente o servicio" value={search} onChange={(event) => setSearch(event.target.value)} fullWidth />
      <FormControl sx={{ minWidth: { sm: 190 } }}><InputLabel>Estado</InputLabel><Select value={statusFilter} label="Estado" onChange={(event) => setStatusFilter(event.target.value)}><MenuItem value="all">Todos</MenuItem><MenuItem value="performed">Realizados</MenuItem><MenuItem value="pending">Pendientes</MenuItem><MenuItem value="cancelled">Cancelados</MenuItem></Select></FormControl>
    </Stack>

    <Card variant="outlined"><CardContent sx={{ p: 0 }}>
      {loading ? <Box p={4}><Typography color="text.secondary">Cargando procedimientos…</Typography></Box> : filtered.length === 0 ? <Box p={4} textAlign="center"><Typography fontWeight={700}>No hay procedimientos para mostrar</Typography><Typography color="text.secondary" mt={1}>Registrá el primero para comenzar a generar historial y métricas.</Typography></Box> : filtered.map((procedure, index) => {
        const client = clientById[procedure.client_id]
        const dateValue = procedure.performed_at || procedure.scheduled_at
        return <Box key={procedure.id}>{index > 0 && <Divider />}<Box p={{ xs: 2, sm: 2.5 }} onClick={() => setSelected(procedure)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}><Box><Typography fontWeight={800}>{procedure.service_name_snapshot}</Typography><Typography variant="body2" color="text.secondary">{client?.full_name || 'Cliente'} · {dateValue ? new Date(dateValue).toLocaleDateString('es-CR') : 'Sin fecha'}</Typography></Box><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap"><Chip size="small" label={`$${Number(procedure.service_price_usd_snapshot).toFixed(2)}`} /><Chip size="small" label={statusLabel[procedure.status] || procedure.status} /><Chip size="small" variant="outlined" label={paymentLabel[procedure.payment_status] || procedure.payment_status} /></Stack></Stack></Box></Box>
      })}
    </CardContent></Card>

    <ProcedureFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSaved={addProcedure} organization={organization} userId={userId} clients={clients} services={services} products={products} />
    <ProcedureDetailDialog procedure={selected} open={Boolean(selected)} onClose={() => setSelected(null)} clients={clients} products={products} organizationId={organization.id} />
  </Stack>
}
