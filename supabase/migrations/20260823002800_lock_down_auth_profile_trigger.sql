-- The auth trigger must be callable by PostgreSQL's trigger mechanism only,
-- not exposed as an RPC to anon/authenticated clients.
revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.handle_new_auth_user() from anon;
revoke all on function public.handle_new_auth_user() from authenticated;
