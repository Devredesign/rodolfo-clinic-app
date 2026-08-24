import React, { useEffect, useState } from 'react'
import { Alert, AppBar, Box, Button, CircularProgress, Container, Stack, Tab, Tabs, TextField, Toolbar, Typography } from '@mui/material'
import { supabase } from './supabase.js'
import ClientsModule from './ClientsModule.jsx'
import ProductsScreen from './ProductsScreen.jsx'
import ServicesScreen from './ServicesScreen.jsx'
import ProceduresScreen from './ProceduresScreen.jsx'
import PaymentsScreen from './PaymentsScreen.jsx'
import RefundsScreen from './RefundsScreen.jsx'

function LoginScreen({ onSession }) {
  const [email, setEmail] = useState('drrodolfocabezas@gmail.com')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (loginError) {
      setError('No pudimos iniciar sesión. Revisá el correo y la contraseña.')
      setLoading(false)
      return
    }
    onSession(data.session)
    setLoading(false)
  }

  return <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center', p: 2 }}>
    <Box component="form" onSubmit={submit} sx={{ width: '100%', maxWidth: 430, bgcolor: 'background.paper', p: { xs: 3, sm: 4 }, borderRadius: 3, boxShadow: '0 20px 60px rgba(20,20,60,.10)' }}>
      <Stack spacing={3}>
        <Box><Typography variant="overline" color="text.secondary">Gestión clínica</Typography><Typography variant="h4" fontWeight={800}>Dr. Rodolfo Cabezas</Typography><Typography color="text.secondary" mt={1}>Ingresá para administrar clientes y operaciones.</Typography></Box>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack spacing={2}>
          <TextField label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth />
          <TextField label="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth />
          <Button type="submit" variant="contained" size="large" disabled={loading}>{loading ? 'Ingresando…' : 'Iniciar sesión'}</Button>
        </Stack>
      </Stack>
    </Box>
  </Box>
}

export default function ClinicApp() {
  const [session, setSession] = useState(undefined)
  const [organization, setOrganization] = useState(null)
  const [role, setRole] = useState('')
  const [section, setSection] = useState('clients')
  const [loadingMembership, setLoadingMembership] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user?.id) {
      setOrganization(null)
      setRole('')
      return
    }
    const loadMembership = async () => {
      setLoadingMembership(true)
      setError('')
      const { data, error: membershipError } = await supabase
        .from('organization_members')
        .select('role, organization_id, organizations(id,name,slug,default_fx_crc_per_usd,settings)')
        .eq('user_id', session.user.id)
        .eq('active', true)
        .limit(1)
      if (membershipError || !data?.length) setError('Tu usuario no está asociado a una organización activa.')
      else {
        setRole(data[0].role)
        setOrganization(data[0].organizations)
      }
      setLoadingMembership(false)
    }
    loadMembership()
  }, [session?.user?.id])

  if (session === undefined) return <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center' }}><CircularProgress /></Box>
  if (!session) return <LoginScreen onSession={setSession} />
  if (loadingMembership) return <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center' }}><CircularProgress /></Box>
  if (!organization) return <Container sx={{ py: 5 }}>{error && <Alert severity="error">{error}</Alert>}</Container>

  return <Box minHeight="100vh">
    <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Toolbar sx={{ gap: 2 }}>
        <Box flex={1}><Typography fontWeight={800}>{organization.name}</Typography><Typography variant="caption" color="text.secondary">{role === 'admin' ? 'Administrador' : 'Asistente'}</Typography></Box>
        <Button color="inherit" onClick={async () => { await supabase.auth.signOut(); setSession(null) }}>Salir</Button>
      </Toolbar>
      <Tabs value={section} onChange={(_event, value) => setSection(value)} variant="scrollable" scrollButtons="auto" sx={{ px: { xs: 1, sm: 2 } }}>
        <Tab value="clients" label="Clientes" />
        <Tab value="products" label="Productos" />
        <Tab value="services" label="Servicios" />
        <Tab value="procedures" label="Procedimientos" />
        <Tab value="payments" label="Pagos" />
        {role === 'admin' && <Tab value="refunds" label="Reembolsos" />}
      </Tabs>
    </AppBar>

    <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 5 } }}>
      {section === 'clients' && <ClientsModule organization={organization} userId={session.user.id} role={role} />}
      {section === 'products' && <ProductsScreen organization={organization} userId={session.user.id} role={role} />}
      {section === 'services' && <ServicesScreen organization={organization} userId={session.user.id} role={role} />}
      {section === 'procedures' && <ProceduresScreen organization={organization} userId={session.user.id} role={role} />}
      {section === 'payments' && <PaymentsScreen organization={organization} userId={session.user.id} role={role} />}
      {section === 'refunds' && role === 'admin' && <RefundsScreen organization={organization} userId={session.user.id} />}
    </Container>
  </Box>
}
