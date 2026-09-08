-- Fix payment void/edit flows failing when they call the internal
-- procedure payment-status recalculation helper as an authenticated user.
--
-- The helper is deterministic: it recalculates the procedure payment status
-- from existing payment links. Running it as SECURITY DEFINER lets it read the
-- required payment rows even though those rows are admin-only under RLS.

alter function public.recalculate_procedure_payment_status(uuid, uuid) security definer;

revoke all on function public.recalculate_procedure_payment_status(uuid, uuid) from public, anon;
grant execute on function public.recalculate_procedure_payment_status(uuid, uuid) to authenticated, service_role;
