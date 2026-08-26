-- Align inventory RPC movement_type values with the existing inventory_movements check constraint.
-- Allowed values include purchase_in, adjustment, discarded, etc.

create or replace function public.register_inventory_purchase(p_organization_id uuid, p_supplier_id uuid, p_invoice_number text, p_purchase_date date, p_currency currency_code, p_due_date date, p_notes text, p_created_by uuid, p_paid boolean, p_external_reference text, p_items jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare v_purchase uuid; v_item jsonb; v_item_id uuid; v_product uuid; v_qty int; v_unit numeric; v_total numeric:=0; v_fx numeric; v_cost_usd numeric; v_category uuid; v_expense uuid; i int;
begin
 if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
 if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'At least one item is required'; end if;
 select default_fx_crc_per_usd into v_fx from public.organizations where id=p_organization_id;
 if p_currency='CRC' and coalesce(v_fx,0)<=0 then raise exception 'Valid FX rate required for CRC purchase'; end if;
 for v_item in select * from jsonb_array_elements(p_items) loop
   v_qty:=(v_item->>'quantity')::int; v_unit:=(v_item->>'unit_cost')::numeric;
   if v_qty<=0 or v_unit<0 then raise exception 'Invalid purchase item'; end if; v_total:=v_total+(v_qty*v_unit);
 end loop;
 insert into public.purchases(organization_id,supplier_id,invoice_number,purchase_date,currency,total_amount,due_date,status,notes,created_by)
 values(p_organization_id,p_supplier_id,nullif(trim(p_invoice_number),''),coalesce(p_purchase_date,current_date),p_currency,v_total,p_due_date,case when p_paid then 'paid'::public.payable_status else 'pending'::public.payable_status end,p_notes,p_created_by) returning id into v_purchase;
 for v_item in select * from jsonb_array_elements(p_items) loop
   v_product:=(v_item->>'product_id')::uuid; v_qty:=(v_item->>'quantity')::int; v_unit:=(v_item->>'unit_cost')::numeric;
   insert into public.purchase_items(organization_id,purchase_id,product_id,quantity,unit_cost,expiry_date)
   values(p_organization_id,v_purchase,v_product,v_qty,v_unit,nullif(v_item->>'expiry_date','')::date) returning id into v_item_id;
   for i in 1..v_qty loop
     insert into public.inventory_containers(organization_id,product_id,status,expires_on,purchase_item_id) values(p_organization_id,v_product,'closed',nullif(v_item->>'expiry_date','')::date,v_item_id);
   end loop;
   insert into public.inventory_movements(organization_id,product_id,movement_type,quantity_units,reference_type,reference_id,notes,created_by)
   values(p_organization_id,v_product,'purchase_in',v_qty,'purchase',v_purchase,'Entrada por compra',p_created_by);
   v_cost_usd:=case when p_currency='USD' then v_unit else v_unit/v_fx end;
   update public.products set current_cost_usd=v_cost_usd,updated_at=now() where id=v_product and organization_id=p_organization_id;
   insert into public.product_price_history(organization_id,product_id,cost_usd,source,created_by) values(p_organization_id,v_product,v_cost_usd,'purchase',p_created_by);
 end loop;
 select id into v_category from public.expense_categories where organization_id=p_organization_id and lower(name)='insumos' and active=true limit 1;
 if v_category is null then insert into public.expense_categories(organization_id,name,active) values(p_organization_id,'Insumos',true) returning id into v_category; end if;
 insert into public.expenses(organization_id,category_id,description,currency,amount,fx_crc_per_usd_snapshot,expense_date,due_date,status,notes,created_by,source_type,source_id)
 values(p_organization_id,v_category,'Compra de insumos'||case when nullif(trim(p_invoice_number),'') is not null then ' · '||trim(p_invoice_number) else '' end,p_currency,v_total,case when p_currency='CRC' then v_fx else null end,coalesce(p_purchase_date,current_date),p_due_date,case when p_paid then 'paid'::public.payable_status else 'pending'::public.payable_status end,p_notes,p_created_by,'purchase',v_purchase) returning id into v_expense;
 if p_paid then insert into public.expense_payments(organization_id,expense_id,payment_date,currency,amount,fx_crc_per_usd_snapshot,external_reference,status,created_by) values(p_organization_id,v_expense,coalesce(p_purchase_date,current_date),p_currency,v_total,case when p_currency='CRC' then v_fx else null end,nullif(trim(p_external_reference),''),'paid',p_created_by); end if;
 for v_item in select * from jsonb_array_elements(p_items) loop perform public.sync_low_stock_task(p_organization_id,(v_item->>'product_id')::uuid,p_created_by); end loop;
 return v_purchase;
end$function$;

create or replace function public.adjust_inventory(p_organization_id uuid, p_product_id uuid, p_adjustment integer, p_reason text, p_notes text, p_created_by uuid)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare v_container uuid; i int;
begin
 if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
 if p_adjustment=0 then raise exception 'Adjustment cannot be zero'; end if;
 if nullif(trim(p_reason),'') is null then raise exception 'Reason required'; end if;
 if p_adjustment>0 then
   for i in 1..p_adjustment loop insert into public.inventory_containers(organization_id,product_id,status,notes) values(p_organization_id,p_product_id,'closed',p_notes); end loop;
 else
   for i in 1..abs(p_adjustment) loop
     select id into v_container from public.inventory_containers where organization_id=p_organization_id and product_id=p_product_id and status in ('open','closed') order by case when status='open' then 0 else 1 end,created_at limit 1 for update skip locked;
     if v_container is null then raise exception 'Not enough stock to remove'; end if;
     update public.inventory_containers set status='discarded',closed_at=now(),notes=coalesce(p_notes,notes),updated_at=now() where id=v_container;
   end loop;
 end if;
 insert into public.inventory_movements(organization_id,product_id,movement_type,quantity_units,reference_type,notes,created_by)
 values(p_organization_id,p_product_id,case when p_adjustment>0 then 'adjustment' else 'discarded' end,p_adjustment,'manual_adjustment',trim(p_reason)||case when nullif(trim(p_notes),'') is not null then ' · '||trim(p_notes) else '' end,p_created_by);
 perform public.sync_low_stock_task(p_organization_id,p_product_id,p_created_by);
end$function$;
