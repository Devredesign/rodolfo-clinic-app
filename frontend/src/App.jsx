import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Toolbar,
  Typography
} from '@mui/material'
import { supabase } from './supabase.js'

const emptyClient = {
  full_name: '',
  identification: '',
  phone: '',
  email: '',
  birth_date: '',
  notes: ''
}

function LoginScreen({ onSession }) {
  const [email, setEmail] = useState('drrodolfocabezas@gmail.com')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    })

    if (loginError) {
      setError('No pudimos iniciar sesión. Revisá el correo y la contraseña.')
      setLoading(false)
      return
    }

    onSession(data.session)
    setLoading(false)
  }

  return (
    <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 430, boxShadow: '0 20px 60px rgba(20,20,60,.10)' }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={3}>
            <Box>
              <Typography variant="overline" color="text.secondary">Gestión clínica</Typography>
              <Typography variant="h4" fontWeight={800}>Dr. Rodolfo Cabezas</Typography>
              <Typography color="text.secondary" mt={1}>Ingresá para administrar clientes y operaciones.</Typography>
            </Box>

            {error && <Alert severity="error">{error}</Alert>}

            <Box component="form" onSubmit={submit}>
              <Stack spacing={2}>
                <TextField
                  label="Correo"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  fullWidth
                />
                <TextField
                  label="Contraseña"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  fullWidth
                />
                <Button type="submit" variant="contained" size="large" disabled={loading}>
                  {loading ? 'Ingresando…' : 'Iniciar sesión'}
                </Button>
              </Stack>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}

function ClientDialog({ open, onClose, onCreated, organizationId, userId }) {
  const [form, setForm] = useState(emptyClient)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setForm(emptyClient)
      setError('')
    }
  }, [open])

  const change = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
  }

  const save = async () => {
    if (!form.full_name.trim()) {
      setError('El nombre del cliente es obligatorio.')
      return
    }

    setSaving(true)
    setError('')

    const payload = {
      organization_id: organizationId,
      full_name: form.full_name.trim(),
      identification: form.identification.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      birth_date: form.birth_date || null,
      notes: form.notes.trim() || null,
      created_by: userId
    }

    const { data, error: insertError } = await supabase
      .from('clients')
      .insert(payload)
      .select('*')
      .single()

    if (insertError) {
      setError(insertError.code === '23505'
        ? 'Ya existe un cliente con esa identificación.'
        : 'No se pudo guardar el cliente. Intentá nuevamente.')
      setSaving(false)
      return
    }

    onCreated(data)
    setSaving(false)
    onClose()
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nuevo cliente</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Nombre completo" value={form.full_name} onChange={change('full_name')} required autoFocus />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Cédula / identificación" value={form.identification} onChange={change('identification')} fullWidth />
            <TextField label="Teléfono" value={form.phone} onChange={change('phone')} fullWidth />
          </Stack>
          <TextField label="Correo" type="email" value={form.email} onChange={change('email')} />
          <TextField
            label="Fecha de nacimiento"
            type="date"
            value={form.birth_date}
            onChange={change('birth_date')}
            InputLabelProps={{ shrink: true }}
          />
          <TextField label="Notas" value={form.notes} onChange={change('notes')} multiline minRows={3} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2.5 }}>
        <Button onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={save} variant="contained" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cliente'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ClientsScreen({ session, onLogout }) {
  const [organization, setOrganization] = useState(null)
  const [role, setRole] = useState('')
  const [clients, setClients] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')

      const { data: memberships, error: membershipError } = await supabase
        .from('organization_members')
        .select('role, organization_id, organizations(id,name,slug)')
        .eq('user_id', session.user.id)
        .eq('active', true)
        .limit(1)

      if (membershipError || !memberships?.length) {
        setError('Tu usuario no está asociado a una organización activa.')
        setLoading(false)
        return
      }

      const membership = memberships[0]
      setOrganization(membership.organizations)
      setRole(membership.role)

      const { data: clientRows, error: clientsError } = await supabase
        .from('clients')
        .select('*')
        .eq('organization_id', membership.organization_id)
        .eq('active', true)
        .order('full_name', { ascending: true })

      if (clientsError) {
        setError('No pudimos cargar los clientes.')
      } else {
        setClients(clientRows ?? [])
      }

      setLoading(false)
    }

    load()
  }, [session.user.id])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return clients

    return clients.filter((client) => [
      client.full_name,
      client.identification,
      client.phone,
      client.email
    ].some((value) => value?.toLowerCase().includes(term)))
  }, [clients, search])

  const addClient = (client) => {
    setClients((current) => [...current, client].sort((a, b) => a.full_name.localeCompare(b.full_name)))
  }

  if (loading) {
    return <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center' }}><CircularProgress /></Box>
  }

  return (
    <Box minHeight="100vh">
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Box flex={1}>
            <Typography fontWeight={800}>{organization?.name ?? 'Clínica'}</Typography>
            <Typography variant="caption" color="text.secondary">{role === 'admin' ? 'Administrador' : 'Asistente'}</Typography>
          </Box>
          <Button color="inherit" onClick={onLogout}>Salir</Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 5 } }}>
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <Box flex={1}>
              <Typography variant="h4" fontWeight={800}>Clientes</Typography>
              <Typography color="text.secondary">Primer módulo conectado a la base de datos real.</Typography>
            </Box>
            <Button variant="contained" size="large" onClick={() => setDialogOpen(true)}>+ Nuevo cliente</Button>
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            placeholder="Buscar por nombre, cédula, teléfono o correo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
          />

          <Card variant="outlined">
            <CardContent sx={{ p: 0 }}>
              {filtered.length === 0 ? (
                <Box p={4} textAlign="center">
                  <Typography fontWeight={700}>{clients.length === 0 ? 'Todavía no hay clientes' : 'No encontramos resultados'}</Typography>
                  <Typography color="text.secondary" mt={1}>
                    {clients.length === 0 ? 'Creá el primer cliente para validar el flujo completo.' : 'Probá con otra búsqueda.'}
                  </Typography>
                </Box>
              ) : (
                filtered.map((client, index) => (
                  <Box key={client.id}>
                    {index > 0 && <Divider />}
                    <Box p={{ xs: 2, sm: 2.5 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
                        <Box>
                          <Typography fontWeight={800}>{client.full_name}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {[client.identification, client.phone, client.email].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                          </Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                          {client.tier}
                        </Typography>
                      </Stack>
                      {client.notes && <Typography variant="body2" mt={1.5}>{client.notes}</Typography>}
                    </Box>
                  </Box>
                ))
              )}
            </CardContent>
          </Card>
        </Stack>
      </Container>

      {organization && (
        <ClientDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={addClient}
          organizationId={organization.id}
          userId={session.user.id}
        />
      )}
    </Box>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center' }}><CircularProgress /></Box>
  }

  if (!session) {
    return <LoginScreen onSession={setSession} />
  }

  return (
    <ClientsScreen
      session={session}
      onLogout={async () => {
        await supabase.auth.signOut()
        setSession(null)
      }}
    />
  )
}
