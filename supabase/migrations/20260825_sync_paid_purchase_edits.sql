create or replace function public.update_inventory_purchase(p_organization_id uuid,p_purchase_id uuid,p_supplier_id uuid,p_invoice_number text,p_purchase_date date,p_currency public.currency_code,p_due_date date,p_notes text,p_actor uuid,p_items jsonb)
returns void language plpgsql set search_path=public as $$
declare oldrec record; it jsonb; v_qty int; v_unit numeric; v_total numeric:=0; v_fx numeric; v_product uuid; v_cost_usd numeric; v_expense uuid; v_item_id uuid; i int;
begin
 if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
 select * into oldrec from public.purchases where id=p_purchase_id and organization_id=p_organization_id for update;
 if oldrec.id is null then raise exception 'Purchase not found'; end if;
 if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'At least one item is required'; end if;
 select default_fx_crc_per_usd into v_fx from public.organizations where id=p_organization_id;
 if p_currency='CRC' and coalesce(v_fx,0)<=0 then raise exception 'Valid FX rate required'; end if;
 for it in select * from jsonb_array_elements(p_items) loop v_qty=(it->>'quantity')::int; v_unit=(it->>'unit_cost')::numeric; if v_qty<=0 or v_unit<0 then raise exception 'Invalid purchase item'; end if; v_total=v_total+v_qty*v_unit; end loop;
 if exists(select 1 from public.inventory_containers where organization_id=p_organization_id and purchase_item_id in(select id from public.purchase_items where purchase_id=p_purchase_id) and status<>'closed') then raise exception 'Purchase inventory already used; quantities/products cannot be edited'; end if;
 delete from public.inventory_movements where organization_id=p_organization_id and reference_type='purchase' and reference_id=p_purchase_id;
 delete from public.inventory_containers where organization_id=p_organization_id and purchase_item_id in(select id from public.purchase_items where purchase_id=p_purchase_id);
 delete from public.purchase_items where organization_id=p_organization_id and purchase_id=p_purchase_id;
 update public.purchases set supplier_id=p_supplier_id,invoice_number=nullif(trim(p_invoice_number),''),purchase_date=p_purchase_date,currency=p_currency,total_amount=v_total,due_date=p_due_date,notes=p_notes,updated_at=now() where id=p_purchase_id;
 for it in select * from jsonb_array_elements(p_items) loop
   v_product=(it->>'product_id')::uuid; v_qty=(it->>'quantity')::int; v_unit=(it->>'unit_cost')::numeric;
   insert into public.purchase_items(organization_id,purchase_id,product_id,quantity,unit_cost,expiry_date) values(p_organization_id,p_purchase_id,v_product,v_qty,v_unit,nullif(it->>'expiry_date','')::date) returning id into v_item_id;
   for i in 1..v_qty loop insert into public.inventory_containers(organization_id,product_id,status,expires_on,purchase_item_id) values(p_organization_id,v_product,'closed',nullif(it->>'expiry_date','')::date,v_item_id); end loop;
   insert into public.inventory_movements(organization_id,product_id,movement_type,quantity_units,reference_type,reference_id,notes,created_by) values(p_organization_id,v_product,'purchase_in',v_qty,'purchase',p_purchase_id,'Entrada por compra editada',p_actor);
   v_cost_usd=case when p_currency='USD' then v_unit else v_unit/v_fx end;
   update public.products set current_cost_usd=v_cost_usd,updated_at=now() where id=v_product and organization_id=p_organization_id;
   insert into public.product_price_history(organization_id,product_id,cost_usd,source,created_by) values(p_organization_id,v_product,v_cost_usd,'purchase_edit',p_actor);
   perform public.sync_low_stock_task(p_organization_id,v_product,p_actor);
 end loop;
 select id into v_expense from public.expenses where organization_id=p_organization_id and source_type='purchase' and source_id=p_purchase_id limit 1;
 if v_expense is not null then
   update public.expenses set description='Compra de insumos'||case when nullif(trim(p_invoice_number),'') is not null then ' · '||trim(p_invoice_number) else '' end,currency=p_currency,amount=v_total,fx_crc_per_usd_snapshot=case when p_currency='CRC' then v_fx else null end,expense_date=p_purchase_date,due_date=p_due_date,notes=p_notes,updated_at=now() where id=v_expense;
   if oldrec.status='paid' then update public.expense_payments set payment_date=p_purchase_date,currency=p_currency,amount=v_total,fx_crc_per_usd_snapshot=case when p_currency='CRC' then v_fx else null end,updated_at=now() where expense_id=v_expense and status='paid'; end if;
 end if;
 perform public.sync_purchase_payment_task(p_organization_id,p_purchase_id,p_actor);
end $$;
