import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import { LineChart } from '@mui/x-charts/LineChart'
import dayjs from 'dayjs'
import { supabase } from './supabase.js'

const emptyProduct = {
  name: '',
  brand: '',
  usage_type: 'single_use',
  current_cost_usd: '',
  low_stock_threshold: '0'
}

const usageLabel = {
  single_use: 'Un solo uso',
  multi_use: 'Varios usos'
}

function ProductFormDialog({ open, onClose, onSaved, organizationId, userId, product }) {
  const [form, setForm] = useState(emptyProduct)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(product)

  useEffect(() => {
    if (open) {
      setForm(product ? {
        name: product.name || '',
        brand: product.brand || '',
        usage_type: product.usage_type || 'single_use',
        current_cost_usd: String(product.current_cost_usd ?? ''),
        low_stock_threshold: String(product.low_stock_threshold ?? 0)
      } : emptyProduct)
      setError('')
    }
  }, [open, product])

  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const save = async () => {
    const cost = Number(form.current_cost_usd)
    const threshold = Number(form.low_stock_threshold || 0)
    if (!form.name.trim()) return setError('El nombre del producto es obligatorio.')
    if (!Number.isFinite(cost) || cost < 0) return setError('Ingresá un precio válido en dólares.')
    if (!Number.isInteger(threshold) || threshold < 0) return setError('El stock mínimo debe ser un número entero igual o mayor a 0.')

    setSaving(true)
    setError('')

    const payload = {
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      usage_type: form.usage_type,
      current_cost_usd: cost,
      low_stock_threshold: threshold
    }

    let result
    if (editing) {
      result = await supabase
        .from('products')
        .update(payload)
        .eq('id', product.id)
        .eq('organization_id', organizationId)
        .select('*')
        .single()
    } else {
      result = await supabase
        .from('products')
        .insert({ ...payload, organization_id: organizationId, created_by: userId })
        .select('*')
        .single()
    }

    if (result.error) {
      setSaving(false)
      setError(result.error.code === '23505' ? 'Ya existe un producto con ese nombre y marca.' : 'No se pudo guardar el producto.')
      return
    }

    const saved = result.data
    const previousCost = editing ? Number(product.current_cost_usd) : null
    if (!editing || previousCost !== cost) {
      const { error: historyError } = await supabase.from('product_price_history').insert({
        organization_id: organizationId,
        product_id: saved.id,
        cost_usd: cost,
        source: editing ? 'manual_edit' : 'initial',
        created_by: userId
      })
      if (historyError) console.error('No se pudo registrar historial de precio', historyError)
    }

    onSaved(saved)
    setSaving(false)
    onClose()
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{editing ? 'Editar producto' : 'Nuevo producto'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Nombre del producto" value={form.name} onChange={change('name')} required autoFocus />
          <TextField label="Marca" value={form.brand} onChange={change('brand')} />
          <FormControl fullWidth>
            <InputLabel>Tipo de uso</InputLabel>
            <Select value={form.usage_type} label="Tipo de uso" onChange={change('usage_type')}>
              <MenuItem value="single_use">Un solo uso</MenuItem>
              <MenuItem value="multi_use">Varios usos / frasco abierto</MenuItem>
            </Select>
          </FormControl>
          <TextField label="Costo actual (USD)" type="number" value={form.current_cost_usd} onChange={change('current_cost_usd')} inputProps={{ min: 0, step: '0.01' }} required />
          <TextField label="Stock mínimo de alerta" type="number" value={form.low_stock_threshold} onChange={change('low_stock_threshold')} inputProps={{ min: 0, step: 1 }} />
          <Alert severity="info">
            {form.usage_type === 'multi_use'
              ? 'Para productos de varios usos la app controlará frascos cerrados/abiertos, no un remanente exacto.'
              : 'Cada unidad se considerará consumida en un solo uso.'}
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2.5 }}>
        <Button onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar producto'}</Button>
      </DialogActions>
    </Dialog>
  )
}

function ProductDetailDialog({ product, open, onClose, onEdit, onToggleActive, organizationId }) {
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [range, setRange] = useState('all')

  useEffect(() => {
    if (!open || !product) return
    const load = async () => {
      setLoadingHistory(true)
      const { data } = await supabase
        .from('product_price_history')
        .select('id,cost_usd,effective_at,source')
        .eq('organization_id', organizationId)
        .eq('product_id', product.id)
        .order('effective_at', { ascending: true })
      setHistory(data ?? [])
      setLoadingHistory(false)
    }
    load()
  }, [open, product, organizationId])

  useEffect(() => {
    if (open) setRange('all')
  }, [open, product?.id])

  const filteredHistory = useMemo(() => {
    if (range === 'all') return history
    const months = range === '6m' ? 6 : 12
    const cutoff = dayjs().subtract(months, 'month')
    return history.filter((row) => dayjs(row.effective_at).isAfter(cutoff) || dayjs(row.effective_at).isSame(cutoff))
  }, [history, range])

  const chartRows = filteredHistory.map((row) => ({
    date: new Date(row.effective_at),
    cost: Number(row.cost_usd)
  }))

  if (!product) return null

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Ficha del producto</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="h5" fontWeight={800}>{product.name}</Typography>
            <Chip size="small" label={usageLabel[product.usage_type]} />
            <Chip size="small" variant="outlined" label={product.active ? 'Activo' : 'Archivado'} />
          </Stack>
          <Divider />
          <Box><Typography variant="caption" color="text.secondary">Marca</Typography><Typography>{product.brand || 'No registrada'}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Costo actual</Typography><Typography fontWeight={700}>${Number(product.current_cost_usd).toFixed(2)}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Stock mínimo de alerta</Typography><Typography>{product.low_stock_threshold}</Typography></Box>
          <Divider />
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <Box flex={1}>
                <Typography fontWeight={700}>Historial de precios</Typography>
                <Typography variant="body2" color="text.secondary">Evolución del costo registrado en USD.</Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Rango</InputLabel>
                <Select value={range} label="Rango" onChange={(e) => setRange(e.target.value)}>
                  <MenuItem value="6m">6 meses</MenuItem>
                  <MenuItem value="1y">1 año</MenuItem>
                  <MenuItem value="all">Todo</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            {loadingHistory ? (
              <Typography color="text.secondary">Cargando…</Typography>
            ) : chartRows.length === 0 ? (
              <Typography color="text.secondary">Todavía no hay cambios registrados en este rango.</Typography>
            ) : (
              <Box sx={{ width: '100%', minHeight: 280 }}>
                <LineChart
                  height={280}
                  dataset={chartRows}
                  xAxis={[{
                    dataKey: 'date',
                    scaleType: 'time',
                    valueFormatter: (value) => dayjs(value).format('DD/MM/YYYY')
                  }]}
                  yAxis={[{
                    valueFormatter: (value) => `$${Number(value).toFixed(2)}`
                  }]}
                  series={[{
                    dataKey: 'cost',
                    label: 'Costo USD',
                    valueFormatter: (value) => value == null ? '' : `$${Number(value).toFixed(2)}`,
                    showMark: true
                  }]}
                  grid={{ horizontal: true }}
                  margin={{ left: 70, right: 20, top: 20, bottom: 30 }}
                />
              </Box>
            )}

            {filteredHistory.length > 0 && (
              <Stack divider={<Divider flexItem />}>
                {[...filteredHistory].reverse().slice(0, 10).map((row) => (
                  <Stack key={row.id} direction="row" justifyContent="space-between" py={1}>
                    <Typography variant="body2">{dayjs(row.effective_at).format('DD/MM/YYYY')}</Typography>
                    <Typography variant="body2" fontWeight={700}>${Number(row.cost_usd).toFixed(2)}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2.5, justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Button color={product.active ? 'error' : 'success'} onClick={() => onToggleActive(product)}>{product.active ? 'Archivar producto' : 'Reactivar producto'}</Button>
        <Stack direction="row" spacing={1}><Button onClick={onClose}>Cerrar</Button><Button variant="contained" onClick={() => onEdit(product)}>Editar</Button></Stack>
      </DialogActions>
    </Dialog>
  )
}

export default function ProductsScreen({ organization, userId, role }) {
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [selectedProduct, setSelectedProduct] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data, error: loadError } = await supabase.from('products').select('*').eq('organization_id', organization.id).order('name')
      if (loadError) setError('No se pudieron cargar los productos.')
      else setProducts(data ?? [])
      setLoading(false)
    }
    load()
  }, [organization.id])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((product) =>
      (statusFilter === 'all' || (statusFilter === 'active' ? product.active : !product.active)) &&
      (!term || [product.name, product.brand].some((value) => value?.toLowerCase().includes(term)))
    )
  }, [products, search, statusFilter])

  const upsertProduct = (saved) => {
    setProducts((current) => {
      const exists = current.some((p) => p.id === saved.id)
      const next = exists ? current.map((p) => p.id === saved.id ? saved : p) : [...current, saved]
      return next.sort((a, b) => a.name.localeCompare(b.name))
    })
    setSelectedProduct((current) => current?.id === saved.id ? saved : current)
  }

  const toggleActive = async (product) => {
    if (role !== 'admin') return
    const { data, error: updateError } = await supabase.from('products').update({ active: !product.active }).eq('id', product.id).eq('organization_id', organization.id).select('*').single()
    if (updateError) setError('No se pudo actualizar el producto.')
    else { upsertProduct(data); setSelectedProduct(null) }
  }

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Box flex={1}>
          <Typography variant="h4" fontWeight={800}>Productos</Typography>
          <Typography color="text.secondary">Catálogo maestro que alimentará inventario, compras y servicios.</Typography>
        </Box>
        {role === 'admin' && <Button variant="contained" size="large" onClick={() => { setEditingProduct(null); setFormOpen(true) }}>+ Nuevo producto</Button>}
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField placeholder="Buscar por nombre o marca" value={search} onChange={(e) => setSearch(e.target.value)} fullWidth />
        <FormControl sx={{ minWidth: { sm: 180 } }}>
          <InputLabel>Estado</InputLabel>
          <Select value={statusFilter} label="Estado" onChange={(e) => setStatusFilter(e.target.value)}>
            <MenuItem value="active">Activos</MenuItem><MenuItem value="archived">Archivados</MenuItem><MenuItem value="all">Todos</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <Card variant="outlined"><CardContent sx={{ p: 0 }}>
        {loading ? <Box p={4}><Typography color="text.secondary">Cargando productos…</Typography></Box> : filtered.length === 0 ? <Box p={4} textAlign="center"><Typography fontWeight={700}>No hay productos para mostrar</Typography><Typography color="text.secondary" mt={1}>Registrá el primer producto para comenzar a alimentar el inventario.</Typography></Box> : filtered.map((product, index) => (
          <Box key={product.id}>{index > 0 && <Divider />}<Box p={{ xs: 2, sm: 2.5 }} onClick={() => setSelectedProduct(product)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
              <Box><Typography fontWeight={800}>{product.name}</Typography><Typography variant="body2" color="text.secondary">{[product.brand, usageLabel[product.usage_type]].filter(Boolean).join(' · ')}</Typography></Box>
              <Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={`$${Number(product.current_cost_usd).toFixed(2)}`} /><Chip size="small" variant="outlined" label={product.active ? 'Activo' : 'Archivado'} /></Stack>
            </Stack>
          </Box></Box>
        ))}
      </CardContent></Card>

      <ProductFormDialog open={formOpen} onClose={() => { setFormOpen(false); setEditingProduct(null) }} onSaved={upsertProduct} organizationId={organization.id} userId={userId} product={editingProduct} />
      <ProductDetailDialog product={selectedProduct} open={Boolean(selectedProduct)} onClose={() => setSelectedProduct(null)} onEdit={(product) => { setSelectedProduct(null); setEditingProduct(product); setFormOpen(true) }} onToggleActive={toggleActive} organizationId={organization.id} />
    </Stack>
  )
}
