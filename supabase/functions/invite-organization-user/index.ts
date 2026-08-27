import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  const headers = { 'Content-Type': 'application/json' }
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: userData, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !userData.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
    const body = await req.json()
    const organizationId = String(body.organization_id || '')
    const email = String(body.email || '').trim().toLowerCase()
    const fullName = String(body.full_name || '').trim()
    const role = body.role === 'admin' ? 'admin' : 'assistant'
    if (!organizationId || !email || !fullName) return new Response(JSON.stringify({ error: 'Nombre, correo y organización son obligatorios.' }), { status: 400, headers })
    const { data: member } = await admin.from('organization_members').select('role,active').eq('organization_id', organizationId).eq('user_id', userData.user.id).maybeSingle()
    if (!member?.active || member.role !== 'admin') return new Response(JSON.stringify({ error: 'Solo un administrador puede invitar usuarios.' }), { status: 403, headers })
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName } })
    if (inviteError || !invited.user) return new Response(JSON.stringify({ error: inviteError?.message || 'No se pudo enviar la invitación.' }), { status: 400, headers })
    const userId = invited.user.id
    const { error: profileError } = await admin.from('profiles').upsert({ id: userId, full_name: fullName, email, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (profileError) return new Response(JSON.stringify({ error: profileError.message }), { status: 400, headers })
    const { error: memberError } = await admin.from('organization_members').upsert({ organization_id: organizationId, user_id: userId, role, active: true }, { onConflict: 'organization_id,user_id' })
    if (memberError) return new Response(JSON.stringify({ error: memberError.message }), { status: 400, headers })
    return new Response(JSON.stringify({ ok: true, user_id: userId, email }), { status: 200, headers })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unexpected error' }), { status: 500, headers })
  }
})
