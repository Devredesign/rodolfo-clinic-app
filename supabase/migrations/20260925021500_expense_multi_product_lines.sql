alter table public.expenses
  add column if not exists purchase_id uuid null references public.purchases(id) on delete set null;

create index if not exists idx_expenses_purchase_id
  on public.expenses(purchase_id);

update public.expenses e
set purchase_id = e.source_id
where e.purchase_id is null
  and e.source_type = 'purchase'
  and exists (
    select 1 from public.purchases p
    where p.id = e.source_id
      and p.organization_id = e.organization_id
  );

CREATE OR REPLACE FUNCTION public.save_expense_with_purchase_items(p_organization_id uuid, p_expense_id uuid, p_category_id uuid, p_description text, p_currency currency_code, p_amount numeric, p_expense_date date, p_due_date date, p_notes text, p_actor uuid, p_manage_items boolean, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_expense public.expenses%rowtype;
  v_existing public.expenses%rowtype;
  v_purchase uuid;
  v_item jsonb;
  v_product uuid;
  v_qty integer;
  v_unit numeric;
  v_item_id uuid;
  v_fx numeric;
  v_cost_usd numeric;
  v_status public.payable_status;
  v_purchase_exists boolean := false;
  i integer;
begin
  if not private.is_org_admin(p_organization_id) then
    raise exception 'Admin permission required';
  end if;

  if auth.uid() is not null and p_actor is distinct from auth.uid() then
    raise exception 'Actor mismatch';
  end if;

  if p_category_id is null
     or nullif(trim(p_description), '') is null
     or p_amount is null
     or p_amount <= 0
     or p_expense_date is null then
    raise exception 'Invalid expense data';
  end if;

  select default_fx_crc_per_usd
    into v_fx
  from public.organizations
  where id = p_organization_id;

  if p_currency = 'CRC' and coalesce(v_fx, 0) <= 0 then
    raise exception 'Valid FX rate required';
  end if;

  if p_expense_id is not null then
    select *
      into v_existing
    from public.expenses
    where id = p_expense_id
      and organization_id = p_organization_id
    for update;

    if v_existing.id is null then
      raise exception 'Expense not found';
    end if;

    v_purchase := v_existing.purchase_id;

    if v_purchase is null and v_existing.source_type = 'purchase' then
      select p.id
        into v_purchase
      from public.purchases p
      where p.id = v_existing.source_id
        and p.organization_id = p_organization_id
      limit 1;
    end if;

    if p_manage_items and v_purchase is not null then
      if exists (
        select 1
        from public.inventory_containers c
        where c.organization_id = p_organization_id
          and c.purchase_item_id in (
            select pi.id
            from public.purchase_items pi
            where pi.purchase_id = v_purchase
              and pi.organization_id = p_organization_id
          )
          and c.status <> 'closed'
      ) then
        raise exception 'Purchase inventory already used; quantities/products cannot be edited';
      end if;
    end if;
  end if;

  v_status := case when p_due_date is null then 'paid'::public.payable_status else 'pending'::public.payable_status end;

  if p_expense_id is null then
    insert into public.expenses(
      organization_id, category_id, description, currency, amount,
      fx_crc_per_usd_snapshot, expense_date, due_date, status, notes, created_by
    )
    values(
      p_organization_id, p_category_id, trim(p_description), p_currency, p_amount,
      case when p_currency = 'CRC' then v_fx else null end,
      p_expense_date, p_due_date, v_status, nullif(trim(p_notes), ''), p_actor
    )
    returning * into v_expense;
  else
    update public.expenses
    set category_id = p_category_id,
        description = trim(p_description),
        currency = p_currency,
        amount = p_amount,
        fx_crc_per_usd_snapshot = case when p_currency = 'CRC' then v_fx else null end,
        expense_date = p_expense_date,
        due_date = p_due_date,
        status = v_status,
        notes = nullif(trim(p_notes), ''),
        product_id = null,
        product_quantity = null,
        updated_at = now()
    where id = p_expense_id
      and organization_id = p_organization_id
    returning * into v_expense;
  end if;

  if not p_manage_items then
    return v_expense.id;
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    if v_purchase is not null then
      raise exception 'At least one purchase item is required for an existing linked purchase';
    end if;
    return v_expense.id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := nullif(v_item->>'product_id', '')::uuid;
    v_qty := nullif(v_item->>'quantity', '')::integer;
    v_unit := nullif(v_item->>'unit_cost', '')::numeric;

    if v_product is null or v_qty is null or v_qty <= 0 or v_unit is null or v_unit < 0 then
      raise exception 'Invalid purchase item';
    end if;

    if not exists (
      select 1 from public.products p
      where p.id = v_product
        and p.organization_id = p_organization_id
    ) then
      raise exception 'Product not found in organization';
    end if;
  end loop;

  if v_purchase is null then
    insert into public.purchases(
      organization_id, supplier_id, invoice_number, purchase_date, currency,
      total_amount, due_date, status, notes, created_by
    )
    values(
      p_organization_id, null, null, p_expense_date, p_currency,
      p_amount, p_due_date, v_status, nullif(trim(p_notes), ''), p_actor
    )
    returning id into v_purchase;

    update public.expenses
    set purchase_id = v_purchase,
        updated_at = now()
    where id = v_expense.id
      and organization_id = p_organization_id;
  else
    select exists(
      select 1 from public.purchases p
      where p.id = v_purchase
        and p.organization_id = p_organization_id
    ) into v_purchase_exists;

    if not v_purchase_exists then
      raise exception 'Linked purchase not found';
    end if;

    delete from public.inventory_movements
    where organization_id = p_organization_id
      and reference_type = 'purchase'
      and reference_id = v_purchase;

    delete from public.inventory_containers
    where organization_id = p_organization_id
      and purchase_item_id in (
        select id
        from public.purchase_items
        where purchase_id = v_purchase
          and organization_id = p_organization_id
      );

    delete from public.purchase_items
    where organization_id = p_organization_id
      and purchase_id = v_purchase;

    update public.purchases
    set purchase_date = p_expense_date,
        currency = p_currency,
        total_amount = p_amount,
        due_date = p_due_date,
        status = v_status,
        notes = nullif(trim(p_notes), ''),
        updated_at = now()
    where id = v_purchase
      and organization_id = p_organization_id;

    update public.expenses
    set purchase_id = v_purchase,
        updated_at = now()
    where id = v_expense.id
      and organization_id = p_organization_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_unit := (v_item->>'unit_cost')::numeric;

    insert into public.purchase_items(
      organization_id, purchase_id, product_id, quantity, unit_cost, expiry_date
    )
    values(
      p_organization_id, v_purchase, v_product, v_qty, v_unit,
      nullif(v_item->>'expiry_date', '')::date
    )
    returning id into v_item_id;

    for i in 1..v_qty loop
      insert into public.inventory_containers(
        organization_id, product_id, status, expires_on, purchase_item_id
      )
      values(
        p_organization_id, v_product, 'closed',
        nullif(v_item->>'expiry_date', '')::date, v_item_id
      );
    end loop;

    insert into public.inventory_movements(
      organization_id, product_id, movement_type, quantity_units,
      reference_type, reference_id, notes, created_by
    )
    values(
      p_organization_id, v_product, 'purchase_in', v_qty,
      'purchase', v_purchase, 'Entrada por factura / gasto', p_actor
    );

    v_cost_usd := case when p_currency = 'USD' then v_unit else v_unit / v_fx end;

    update public.products
    set current_cost_usd = v_cost_usd,
        updated_at = now()
    where id = v_product
      and organization_id = p_organization_id;

    insert into public.product_price_history(
      organization_id, product_id, cost_usd, source, created_by
    )
    values(
      p_organization_id, v_product, v_cost_usd, 'expense_invoice', p_actor
    );

    perform public.sync_low_stock_task(p_organization_id, v_product, p_actor);
  end loop;

  return v_expense.id;
end;
$function$


revoke execute on function public.save_expense_with_purchase_items(
  uuid, uuid, uuid, text, public.currency_code, numeric, date, date, text, uuid, boolean, jsonb
) from public, anon;

grant execute on function public.save_expense_with_purchase_items(
  uuid, uuid, uuid, text, public.currency_code, numeric, date, date, text, uuid, boolean, jsonb
) to authenticated;
