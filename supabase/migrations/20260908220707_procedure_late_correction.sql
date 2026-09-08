alter table public.procedures
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid,
  add column if not exists cancellation_reason text;

-- Existing procedure inventory reversal code writes movement_type='reversal'.
-- Keep the constraint aligned with the audit model.
alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type = any (array[
    'purchase_in'::text, 'opened'::text, 'used'::text, 'depleted'::text,
    'discarded'::text, 'lost'::text, 'damaged'::text, 'expired'::text,
    'courtesy'::text, 'exchange'::text, 'adjustment'::text, 'reversal'::text
  ]));

create or replace function public.admin_preview_procedure_correction(
  p_organization_id uuid,
  p_procedure_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_proc public.procedures%rowtype;
  v_payment_count integer := 0;
  v_reconciliation_count integer := 0;
  v_credit_count integer := 0;
  v_inventory jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
begin
  if not private.is_org_admin(p_organization_id) then
    raise exception 'Admin access required';
  end if;

  select * into v_proc
  from public.procedures
  where id = p_procedure_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'Procedure not found';
  end if;

  select count(*),
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'payment_id', pay.id,
               'status', pay.status,
               'reconciliation_status', pay.reconciliation_status,
               'currency', pay.currency,
               'amount', pay.final_amount,
               'payment_date', pay.payment_date
             )
             order by pay.payment_date, pay.created_at
           ),
           '[]'::jsonb
         )
  into v_payment_count, v_payments
  from public.payment_procedures pp
  join public.payments pay on pay.id = pp.payment_id
  where pp.organization_id = p_organization_id
    and pp.procedure_id = p_procedure_id;

  select count(*)
  into v_reconciliation_count
  from public.reconciliation_payment_items
  where organization_id = p_organization_id
    and procedure_id = p_procedure_id;

  select count(*)
  into v_credit_count
  from public.client_credit_transactions
  where organization_id = p_organization_id
    and procedure_id = p_procedure_id;

  with own_movements as (
    select
      im.container_id,
      im.product_id,
      bool_or(im.movement_type = 'opened') as opened_by_procedure,
      bool_or(im.movement_type = 'depleted') as depleted_by_procedure,
      coalesce(sum(case when im.movement_type = 'used' then im.quantity_units else 0 end), 0) as used_delta,
      (array_agg(im.created_at order by im.created_at desc, im.id desc))[1] as latest_at,
      (array_agg(im.id order by im.created_at desc, im.id desc))[1] as latest_id
    from public.inventory_movements im
    where im.organization_id = p_organization_id
      and im.reference_type = 'procedure'
      and im.reference_id = p_procedure_id
      and im.container_id is not null
      and im.movement_type in ('used','opened','depleted')
    group by im.container_id, im.product_id
  ),
  inspected as (
    select
      om.container_id,
      om.product_id,
      pr.name as product_name,
      pr.usage_type,
      om.opened_by_procedure,
      om.depleted_by_procedure,
      om.used_delta,
      (
        select count(*)
        from public.inventory_movements later
        where later.organization_id = p_organization_id
          and later.container_id = om.container_id
          and (later.created_at, later.id) > (om.latest_at, om.latest_id)
          and not (
            later.reference_type = 'procedure'
            and later.reference_id = p_procedure_id
          )
      ) as later_movement_count
    from own_movements om
    join public.products pr
      on pr.id = om.product_id
     and pr.organization_id = p_organization_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'container_id', container_id,
        'product_id', product_id,
        'product_name', product_name,
        'usage_type', usage_type,
        'later_movement_count', later_movement_count,
        'action',
          case
            when later_movement_count > 0 then 'preserve_history'
            when usage_type = 'single_use' and used_delta < 0 then 'restore'
            when depleted_by_procedure then 'restore'
            when opened_by_procedure then 'restore'
            else 'audit_only'
          end,
        'reason',
          case
            when later_movement_count > 0 then 'Tiene movimientos posteriores y su estado físico no se modificará.'
            when usage_type = 'single_use' and used_delta < 0 then 'La unidad puede volver al inventario.'
            when depleted_by_procedure then 'El frasco agotado puede restaurarse.'
            when opened_by_procedure then 'El frasco abierto por este procedimiento puede volver a su estado previo.'
            else 'No requiere cambio físico; se conservará una marca de auditoría.'
          end
      )
      order by product_name, container_id
    ),
    '[]'::jsonb
  )
  into v_inventory
  from inspected;

  return jsonb_build_object(
    'procedure_id', p_procedure_id,
    'status', v_proc.status,
    'already_cancelled', v_proc.status = 'cancelled',
    'can_cancel_now',
      v_proc.status <> 'cancelled'
      and v_payment_count = 0
      and v_reconciliation_count = 0
      and v_credit_count = 0,
    'blockers', jsonb_build_object(
      'payment_links', v_payment_count,
      'reconciliation_items', v_reconciliation_count,
      'credit_items', v_credit_count
    ),
    'payments', v_payments,
    'inventory', v_inventory,
    'summary', jsonb_build_object(
      'restore', (
        select count(*)
        from jsonb_array_elements(v_inventory) item
        where item->>'action' = 'restore'
      ),
      'preserve_history', (
        select count(*)
        from jsonb_array_elements(v_inventory) item
        where item->>'action' = 'preserve_history'
      ),
      'audit_only', (
        select count(*)
        from jsonb_array_elements(v_inventory) item
        where item->>'action' = 'audit_only'
      )
    )
  );
end;
$$;

revoke all on function public.admin_preview_procedure_correction(uuid,uuid) from public, anon;
grant execute on function public.admin_preview_procedure_correction(uuid,uuid) to authenticated;

create or replace function public.admin_cancel_procedure_preserving_history(
  p_organization_id uuid,
  p_procedure_id uuid,
  p_reason text,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_proc public.procedures%rowtype;
  m record;
  v_later_count integer;
  v_restored integer := 0;
  v_preserved integer := 0;
  v_audit_only integer := 0;
begin
  if not private.is_org_admin(p_organization_id) then
    raise exception 'Admin access required';
  end if;

  if p_created_by is distinct from auth.uid() then
    raise exception 'Invalid creator';
  end if;

  if nullif(trim(coalesce(p_reason,'')), '') is null then
    raise exception 'Cancellation reason is required';
  end if;

  select * into v_proc
  from public.procedures
  where id = p_procedure_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Procedure not found';
  end if;

  if v_proc.status = 'cancelled' then
    raise exception 'Procedure is already cancelled';
  end if;

  if exists (
    select 1
    from public.payment_procedures
    where organization_id = p_organization_id
      and procedure_id = p_procedure_id
  ) then
    raise exception 'Procedure has linked payments that must be resolved first';
  end if;

  if exists (
    select 1
    from public.reconciliation_payment_items
    where organization_id = p_organization_id
      and procedure_id = p_procedure_id
  ) then
    raise exception 'Procedure has reconciliation history and requires financial correction first';
  end if;

  if exists (
    select 1
    from public.client_credit_transactions
    where organization_id = p_organization_id
      and procedure_id = p_procedure_id
  ) then
    raise exception 'Procedure has client credit history and requires financial correction first';
  end if;

  for m in
    with own_movements as (
      select
        im.container_id,
        im.product_id,
        bool_or(im.movement_type = 'opened') as opened_by_procedure,
        bool_or(im.movement_type = 'depleted') as depleted_by_procedure,
        coalesce(sum(case when im.movement_type = 'used' then im.quantity_units else 0 end), 0) as used_delta,
        (array_agg(im.created_at order by im.created_at desc, im.id desc))[1] as latest_at,
        (array_agg(im.id order by im.created_at desc, im.id desc))[1] as latest_id
      from public.inventory_movements im
      where im.organization_id = p_organization_id
        and im.reference_type = 'procedure'
        and im.reference_id = p_procedure_id
        and im.container_id is not null
        and im.movement_type in ('used','opened','depleted')
      group by im.container_id, im.product_id
    )
    select om.*, pr.usage_type
    from own_movements om
    join public.products pr
      on pr.id = om.product_id
     and pr.organization_id = p_organization_id
    order by om.latest_at, om.latest_id
  loop
    select count(*)
    into v_later_count
    from public.inventory_movements later
    where later.organization_id = p_organization_id
      and later.container_id = m.container_id
      and (later.created_at, later.id) > (m.latest_at, m.latest_id)
      and not (
        later.reference_type = 'procedure'
        and later.reference_id = p_procedure_id
      );

    if v_later_count > 0 then
      insert into public.inventory_movements(
        organization_id, product_id, container_id, movement_type,
        quantity_units, reference_type, reference_id, notes, created_by
      ) values (
        p_organization_id, m.product_id, m.container_id, 'reversal',
        0, 'procedure_cancellation', p_procedure_id,
        'Procedimiento anulado: estado físico preservado porque existen movimientos posteriores.',
        p_created_by
      );
      v_preserved := v_preserved + 1;

    elsif m.usage_type = 'single_use' and m.used_delta < 0 then
      update public.inventory_containers
      set status = 'closed',
          opened_at = null,
          closed_at = null,
          updated_at = now()
      where id = m.container_id
        and organization_id = p_organization_id;

      insert into public.inventory_movements(
        organization_id, product_id, container_id, movement_type,
        quantity_units, reference_type, reference_id, notes, created_by
      ) values (
        p_organization_id, m.product_id, m.container_id, 'reversal',
        abs(m.used_delta), 'procedure_cancellation', p_procedure_id,
        'Procedimiento anulado: unidad de un solo uso devuelta al inventario.',
        p_created_by
      );
      v_restored := v_restored + 1;

    elsif m.depleted_by_procedure then
      update public.inventory_containers
      set status = case
                     when m.opened_by_procedure then 'closed'::public.container_status
                     else 'open'::public.container_status
                   end,
          opened_at = case when m.opened_by_procedure then null else opened_at end,
          closed_at = null,
          updated_at = now()
      where id = m.container_id
        and organization_id = p_organization_id;

      insert into public.inventory_movements(
        organization_id, product_id, container_id, movement_type,
        quantity_units, reference_type, reference_id, notes, created_by
      ) values (
        p_organization_id, m.product_id, m.container_id, 'reversal',
        1, 'procedure_cancellation', p_procedure_id,
        'Procedimiento anulado: frasco agotado restaurado al estado previo.',
        p_created_by
      );
      v_restored := v_restored + 1;

    elsif m.opened_by_procedure then
      update public.inventory_containers
      set status = 'closed',
          opened_at = null,
          closed_at = null,
          updated_at = now()
      where id = m.container_id
        and organization_id = p_organization_id;

      insert into public.inventory_movements(
        organization_id, product_id, container_id, movement_type,
        quantity_units, reference_type, reference_id, notes, created_by
      ) values (
        p_organization_id, m.product_id, m.container_id, 'reversal',
        0, 'procedure_cancellation', p_procedure_id,
        'Procedimiento anulado: frasco abierto por este procedimiento restaurado al estado previo.',
        p_created_by
      );
      v_restored := v_restored + 1;

    else
      insert into public.inventory_movements(
        organization_id, product_id, container_id, movement_type,
        quantity_units, reference_type, reference_id, notes, created_by
      ) values (
        p_organization_id, m.product_id, m.container_id, 'reversal',
        0, 'procedure_cancellation', p_procedure_id,
        'Procedimiento anulado: uso de frasco registrado como corrección sin cambio físico.',
        p_created_by
      );
      v_audit_only := v_audit_only + 1;
    end if;

    perform public.sync_low_stock_task(
      p_organization_id,
      m.product_id,
      p_created_by
    );
  end loop;

  update public.tasks
  set status = 'archived',
      archived_at = coalesce(archived_at, now()),
      updated_at = now(),
      notes = concat_ws(
        E'\n',
        nullif(notes,''),
        'Archivada automáticamente por anulación del procedimiento: ' || trim(p_reason)
      )
  where organization_id = p_organization_id
    and reference_id = p_procedure_id
    and reference_type in (
      'procedure_collection',
      'procedure_followup',
      'procedure_remarketing'
    )
    and status = 'pending';

  update public.procedures
  set status = 'cancelled',
      payment_status = 'voided',
      followup_requested = false,
      cancelled_at = now(),
      cancelled_by = p_created_by,
      cancellation_reason = trim(p_reason),
      updated_at = now()
  where id = p_procedure_id
    and organization_id = p_organization_id;

  return jsonb_build_object(
    'procedure_id', p_procedure_id,
    'status', 'cancelled',
    'restored', v_restored,
    'preserved_history', v_preserved,
    'audit_only', v_audit_only
  );
end;
$$;

revoke all on function public.admin_cancel_procedure_preserving_history(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.admin_cancel_procedure_preserving_history(uuid,uuid,text,uuid) to authenticated;
