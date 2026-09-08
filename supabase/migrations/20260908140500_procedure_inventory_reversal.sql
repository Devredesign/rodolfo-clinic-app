create or replace function public.admin_reverse_procedure_inventory(
  p_organization_id uuid,
  p_procedure_id uuid,
  p_created_by uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  m record;
  v_opened_by_procedure boolean;
  v_has_later_movement boolean;
begin
  if not private.is_org_admin(p_organization_id) then
    raise exception 'Admin access required';
  end if;

  if not exists (
    select 1 from public.procedures
    where id = p_procedure_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Procedure not found';
  end if;

  if not exists (
    select 1 from public.procedure_products
    where organization_id = p_organization_id
      and procedure_id = p_procedure_id
      and inventory_outcome is not null
  ) then
    raise exception 'Procedure has no inventory consumption to reverse';
  end if;

  -- A reversal is only safe while none of the affected containers has been
  -- used by another later operation. This prevents rewriting real inventory history.
  for m in
    select im.*
    from public.inventory_movements im
    where im.organization_id = p_organization_id
      and im.reference_type = 'procedure'
      and im.reference_id = p_procedure_id
      and im.container_id is not null
      and im.movement_type in ('used','opened','depleted')
    order by im.created_at, im.id
  loop
    select exists (
      select 1
      from public.inventory_movements later
      where later.organization_id = p_organization_id
        and later.container_id = m.container_id
        and (later.created_at, later.id) > (m.created_at, m.id)
        and not (
          later.reference_type = 'procedure'
          and later.reference_id = p_procedure_id
        )
    ) into v_has_later_movement;

    if v_has_later_movement then
      raise exception 'Inventory cannot be reversed because an affected container has later movements';
    end if;
  end loop;

  for r in
    select pp.id,
           pp.product_id,
           pp.inventory_outcome,
           pp.inventory_container_id,
           p.usage_type
    from public.procedure_products pp
    join public.products p on p.id = pp.product_id
    where pp.organization_id = p_organization_id
      and pp.procedure_id = p_procedure_id
      and pp.inventory_outcome is not null
    order by pp.created_at, pp.id
    for update of pp
  loop
    if r.usage_type = 'single_use' then
      -- Restore every single-use container consumed by this procedure.
      for m in
        select im.*
        from public.inventory_movements im
        where im.organization_id = p_organization_id
          and im.product_id = r.product_id
          and im.reference_type = 'procedure'
          and im.reference_id = p_procedure_id
          and im.movement_type = 'used'
          and im.quantity_units = -1
        order by im.created_at, im.id
      loop
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
          p_organization_id, r.product_id, m.container_id, 'reversal',
          1, 'procedure_reversal', p_procedure_id,
          'Reversión de consumo de procedimiento', p_created_by
        );
      end loop;

    else
      if r.inventory_container_id is null then
        raise exception 'Consumed multi-use product has no inventory container';
      end if;

      select exists (
        select 1 from public.inventory_movements im
        where im.organization_id = p_organization_id
          and im.product_id = r.product_id
          and im.container_id = r.inventory_container_id
          and im.reference_type = 'procedure'
          and im.reference_id = p_procedure_id
          and im.movement_type = 'opened'
      ) into v_opened_by_procedure;

      if r.inventory_outcome = 'depleted' then
        update public.inventory_containers
        set status = case when v_opened_by_procedure then 'closed'::public.container_status else 'open'::public.container_status end,
            opened_at = case when v_opened_by_procedure then null else opened_at end,
            closed_at = null,
            updated_at = now()
        where id = r.inventory_container_id
          and organization_id = p_organization_id;

        insert into public.inventory_movements(
          organization_id, product_id, container_id, movement_type,
          quantity_units, reference_type, reference_id, notes, created_by
        ) values (
          p_organization_id, r.product_id, r.inventory_container_id, 'reversal',
          1, 'procedure_reversal', p_procedure_id,
          'Reversión de frasco agotado en procedimiento', p_created_by
        );
      else
        -- Multi-use consumption does not decrement units. If this procedure
        -- opened the bottle and nobody used it afterwards, restore it to closed.
        if v_opened_by_procedure then
          update public.inventory_containers
          set status = 'closed',
              opened_at = null,
              closed_at = null,
              updated_at = now()
          where id = r.inventory_container_id
            and organization_id = p_organization_id;
        end if;

        insert into public.inventory_movements(
          organization_id, product_id, container_id, movement_type,
          quantity_units, reference_type, reference_id, notes, created_by
        ) values (
          p_organization_id, r.product_id, r.inventory_container_id, 'reversal',
          0, 'procedure_reversal', p_procedure_id,
          'Reversión de uso de frasco en procedimiento', p_created_by
        );
      end if;
    end if;

    update public.procedure_products
    set inventory_container_id = null,
        inventory_outcome = null,
        discard_reason = null
    where id = r.id;

    perform public.sync_low_stock_task(p_organization_id, r.product_id, p_created_by);
  end loop;
end;
$$;

revoke all on function public.admin_reverse_procedure_inventory(uuid,uuid,uuid) from public, anon;
grant execute on function public.admin_reverse_procedure_inventory(uuid,uuid,uuid) to authenticated;
