import React, { useEffect, useMemo, useState } from 'react'
import { Alert, AppBar, Box, Button, Card, CardContent, Chip, CircularProgress, Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Toolbar, Typography } from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import 'dayjs/locale/es'
import { supabase } from './supabase.js'

const emptyClient = { full_name: '', identification: '', phone: '', email: '', birth_date: '', notes: '' }
const tierLabel = { bronze: 'Bronce', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' }

function LoginScreen({ onSession }) {
  const [email, setEmail] = useState('drrodolfocabezas@gmail.com')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setLoading(true); setError('')
    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (loginError) { setError('No pudimos iniciar sesión. Revisá el correo y la contraseña.'); setLoading(false); return }
    onSession(data.session); setLoading(false)
  }
  return <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center', p: 2 }}><Card sx={{ width: '100%', maxWidth: 430, boxShadow: '0 20px 60px rgba(20,20,60,.10)' }}><CardContent sx={{ p: { xs: 3, sm: 4 } }}><Stack spacing={3}><Box><Typography variant="overline" color="text.secondary">Gestión clínica</Typography><Typography variant="h4" fontWeight={800}>Dr. Rodolfo Cabezas</Typography><Typography color="text.secondary" mt={1}>Ingresá para administrar clientes y operaciones.</Typography></Box>{error && <Alert severity="error">{error}</Alert>}<Box component="form" onSubmit={submit}><Stack spacing={2}><TextField label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth /><TextField label="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth /><Button type="submit" variant="contained" size="large" disabled={loading}>{loading ? 'Ingresando…' : 'Iniciar sesión'}</Button></Stack></Box></Stack></CardContent></Card></Box>
}

function ClientFormDialog({ open, onClose, onSaved, organizationId, userId, client }) {
  const [form, setForm] = useState(emptyClient)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(client)
  useEffect(() => {
    if (open) setForm(client ? { full_name: client.full_name || '', identification: client.identification || '', phone: client.phone || '', email: client.email || '', birth_date: client.birth_date || '', notes: client.notes || '' } : emptyClient)
    else { setForm(emptyClient); setError('') }
  }, [open, client])
  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const save = async () => {
    if (!form.full_name.trim()) { setError('El nombre del cliente es obligatorio.'); return }
    setSaving(true); setError('')
    const payload = { full_name: form.full_name.trim(), identification: form.identification.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null, birth_date: form.birth_date || null, notes: form.notes.trim() || null }
    let query
    if (editing) query = supabase.from('clients').update(payload).eq('id', client.id).eq('organization_id', organizationId)
    else query = supabase.from('clients').insert({ ...payload, organization_id: organizationId, created_by: userId })
    const { data, error: saveError } = await query.select('*').single()
    if (saveError) { setError(saveError.code === '23505' ? 'Ya existe un cliente con esa identificación.' : 'No se pudo guardar el cliente. Intentá nuevamente.'); setSaving(false); return }
    onSaved(data); setSaving(false); onClose()
  }
  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm"><DialogTitle>{editing ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle><DialogContent><Stack spacing={2} mt={1}>{error && <Alert severity="error">{error}</Alert>}<TextField label="Nombre completo" value={form.full_name} onChange={change('full_name')} required autoFocus /><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField label="Cédula / identificación" value={form.identification} onChange={change('identification')} fullWidth /><TextField label="Teléfono" value={form.phone} onChange={change('phone')} fullWidth /></Stack><TextField label="Correo" type="email" value={form.email} onChange={change('email')} /><LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="es"><DatePicker label="Fecha de nacimiento" format="DD/MM/YYYY" value={form.birth_date ? dayjs(form.birth_date) : null} onChange={(value) => setForm((current) => ({ ...current, birth_date: value?.isValid() ? value.format('YYYY-MM-DD') : '' }))} maxDate={dayjs()} slotProps={{ textField: { fullWidth: true, placeholder: 'DD/MM/YYYY' } }} /></LocalizationProvider><TextField label="Notas" value={form.notes} onChange={change('notes')} multiline minRows={3} /></Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={save} variant="contained" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar cliente'}</Button></DialogActions></Dialog>
}

function ClientDetailDialog({ client, open, onClose, onEdit, onToggleActive }) {
  if (!client) return null
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"><DialogTitle>Ficha del cliente</DialogTitle><DialogContent><Stack spacing={2} mt={1}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap"><Typography variant="h5" fontWeight={800}>{client.full_name}</Typography><Chip size="small" label={tierLabel[client.tier] || client.tier} /><Chip size="small" variant="outlined" label={client.active ? 'Activo' : 'Archivado'} /></Stack><Divider /><Box><Typography variant="caption" color="text.secondary">Cédula / identificación</Typography><Typography>{client.identification || 'No registrada'}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Teléfono</Typography><Typography>{client.phone || 'No registrado'}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Correo</Typography><Typography>{client.email || 'No registrado'}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Fecha de nacimiento</Typography><Typography>{client.birth_date ? dayjs(client.birth_date).format('DD/MM/YYYY') : 'No registrada'}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Notas</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{client.notes || 'Sin notas'}</Typography></Box><Divider /><Typography variant="body2" color="text.secondary">El historial de procedimientos, pagos y remarketing aparecerá aquí conforme construyamos esos módulos.</Typography></Stack></DialogContent><DialogActions sx={{ p: 2.5, justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}><Button color={client.active ? 'error' : 'success'} onClick={() => onToggleActive(client)}>{client.active ? 'Archivar cliente' : 'Reactivar cliente'}</Button><Stack direction="row" spacing={1}><Button onClick={onClose}>Cerrar</Button><Button variant="contained" onClick={() => onEdit(client)}>Editar</Button></Stack></DialogActions></Dialog>
}

function ConfirmArchiveDialog({ client, open, onClose, onConfirm, saving }) {
  if (!client) return null
  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs"><DialogTitle>{client.active ? 'Archivar cliente' : 'Reactivar cliente'}</DialogTitle><DialogContent><Typography>{client.active ? `¿Archivar a ${client.full_name}? Dejará de aparecer entre los clientes activos, pero conservará su información e historial.` : `¿Reactivar a ${client.full_name}? Volverá a aparecer entre los clientes activos.`}</Typography></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="contained" color={client.active ? 'error' : 'success'} onClick={onConfirm} disabled={saving}>{saving ? 'Guardando…' : client.active ? 'Archivar' : 'Reactivar'}</Button></DialogActions></Dialog>
}

function ClientsScreen({ session, onLogout }) {
  const [organization, setOrganization] = useState(null), [role, setRole] = useState(''), [clients, setClients] = useState([]), [search, setSearch] = useState(''), [statusFilter, setStatusFilter] = useState('active'), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false), [editingClient, setEditingClient] = useState(null), [selectedClient, setSelectedClient] = useState(null), [archiveClient, setArchiveClient] = useState(null), [archiving, setArchiving] = useState(false)
  useEffect(() => { const load = async () => { setLoading(true); setError(''); const { data: memberships, error: membershipError } = await supabase.from('organization_members').select('role, organization_id, organizations(id,name,slug)').eq('user_id', session.user.id).eq('active', true).limit(1); if (membershipError || !memberships?.length) { setError('Tu usuario no está asociado a una organización activa.'); setLoading(false); return } const membership = memberships[0]; setOrganization(membership.organizations); setRole(membership.role); const { data: rows, error: clientsError } = await supabase.from('clients').select('*').eq('organization_id', membership.organization_id).order('full_name', { ascending: true }); if (clientsError) setError('No pudimos cargar los clientes.'); else setClients(rows ?? []); setLoading(false) }; load() }, [session.user.id])
  const filtered = useMemo(() => { const term = search.trim().toLowerCase(); return clients.filter((client) => (statusFilter === 'all' || (statusFilter === 'active' ? client.active : !client.active)) && (!term || [client.full_name, client.identification, client.phone, client.email].some((value) => value?.toLowerCase().includes(term)))) }, [clients, search, statusFilter])
  const upsertClient = (saved) => { setClients((current) => { const exists = current.some((c) => c.id === saved.id); const next = exists ? current.map((c) => c.id === saved.id ? saved : c) : [...current, saved]; return next.sort((a, b) => a.full_name.localeCompare(b.full_name)) }); setSelectedClient((current) => current?.id === saved.id ? saved : current) }
  const openCreate = () => { setEditingClient(null); setFormOpen(true) }
  const openEdit = (client) => { setSelectedClient(null); setEditingClient(client); setFormOpen(true) }
  const toggleActive = async () => { if (!archiveClient || !organization) return; setArchiving(true); const { data, error: updateError } = await supabase.from('clients').update({ active: !archiveClient.active }).eq('id', archiveClient.id).eq('organization_id', organization.id).select('*').single(); if (updateError) setError('No se pudo actualizar el estado del cliente.'); else { upsertClient(data); setSelectedClient(null) } setArchiving(false); setArchiveClient(null) }
  if (loading) return <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center' }}><CircularProgress /></Box>
  return <Box minHeight="100vh"><AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}><Toolbar sx={{ gap: 2 }}><Box flex={1}><Typography fontWeight={800}>{organization?.name ?? 'Clínica'}</Typography><Typography variant="caption" color="text.secondary">{role === 'admin' ? 'Administrador' : 'Asistente'}</Typography></Box><Button color="inherit" onClick={onLogout}>Salir</Button></Toolbar></AppBar><Container maxWidth="lg" sx={{ py: { xs: 3, sm: 5 } }}><Stack spacing={3}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}><Box flex={1}><Typography variant="h4" fontWeight={800}>Clientes</Typography><Typography color="text.secondary">Administrá la ficha y el estado de cada cliente.</Typography></Box><Button variant="contained" size="large" onClick={openCreate}>+ Nuevo cliente</Button></Stack>{error && <Alert severity="error">{error}</Alert>}<Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField placeholder="Buscar por nombre, cédula, teléfono o correo" value={search} onChange={(e) => setSearch(e.target.value)} fullWidth /><FormControl sx={{ minWidth: { sm: 180 } }}><InputLabel>Estado</InputLabel><Select value={statusFilter} label="Estado" onChange={(e) => setStatusFilter(e.target.value)}><MenuItem value="active">Activos</MenuItem><MenuItem value="archived">Archivados</MenuItem><MenuItem value="all">Todos</MenuItem></Select></FormControl></Stack><Card variant="outlined"><CardContent sx={{ p: 0 }}>{filtered.length === 0 ? <Box p={4} textAlign="center"><Typography fontWeight={700}>No encontramos clientes</Typography><Typography color="text.secondary" mt={1}>Probá otra búsqueda o cambiá el filtro de estado.</Typography></Box> : filtered.map((client, index) => <Box key={client.id}>{index > 0 && <Divider />}<Box p={{ xs: 2, sm: 2.5 }} onClick={() => setSelectedClient(client)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between"><Box><Typography fontWeight={800}>{client.full_name}</Typography><Typography variant="body2" color="text.secondary">{[client.identification, client.phone, client.email].filter(Boolean).join(' · ') || 'Sin datos adicionales'}</Typography></Box><Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={tierLabel[client.tier] || client.tier} /><Chip size="small" variant="outlined" label={client.active ? 'Activo' : 'Archivado'} /></Stack></Stack>{client.notes && <Typography variant="body2" mt={1.5}>{client.notes}</Typography>}</Box></Box>)}</CardContent></Card></Stack></Container>{organization && <ClientFormDialog open={formOpen} onClose={() => { setFormOpen(false); setEditingClient(null) }} onSaved={upsertClient} organizationId={organization.id} userId={session.user.id} client={editingClient} />}<ClientDetailDialog client={selectedClient} open={Boolean(selectedClient)} onClose={() => setSelectedClient(null)} onEdit={openEdit} onToggleActive={(client) => setArchiveClient(client)} /><ConfirmArchiveDialog client={archiveClient} open={Boolean(archiveClient)} onClose={() => setArchiveClient(null)} onConfirm={toggleActive} saving={archiving} /></Box>
}

export default function App() {
  const [session, setSession] = useState(undefined)
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession)); return () => listener.subscription.unsubscribe() }, [])
  if (session === undefined) return <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center' }}><CircularProgress /></Box>
  if (!session) return <LoginScreen onSession={setSession} />
  return <ClientsScreen session={session} onLogout={async () => { await supabase.auth.signOut(); setSession(null) }} />
}
