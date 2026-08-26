-- Fix procedure inventory consumption when several multi-use products are processed.
-- Each loop iteration resets its selected container/status so one product can never reuse state from another.
create or replace function public.consume_procedure_inventory(p_organization_id uuid,p_procedure_id uuid,p_multiuse_depleted jsonb default '{}'::jsonb,p_created_by uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare r record; v_container uuid; v_status public.container_status; v_qty int; i int; v_depleted boolean;
begin
 if not private.is_org_admin(p_organization_id) then raise exception 'Admin permission required'; end if;
 if not exists(select 1 from public.procedures where id=p_procedure_id and organization_id=p_organization_id and status='performed') then raise exception 'Performed procedure not found'; end if;
 for r in select pp.id,pp.product_id,pp.standard_quantity_snapshot,p.usage_type,p.name from public.procedure_products pp join public.products p on p.id=pp.product_id where pp.organization_id=p_organization_id and pp.procedure_id=p_procedure_id and pp.inventory_outcome is null order by pp.created_at,pp.id loop
  v_container:=null; v_status:=null;
  if r.usage_type='single_use' then
   v_qty:=greatest(1,ceil(coalesce(r.standard_quantity_snapshot,1))::int);
   for i in 1..v_qty loop
    v_container:=null;
    select id into v_container from public.inventory_containers where organization_id=p_organization_id and product_id=r.product_id and status in ('open','closed') order by case when status='open' then 0 else 1 end,created_at,id limit 1 for update skip locked;
    if v_container is null then raise exception 'Not enough inventory for %',r.name; end if;
    update public.inventory_containers set status='depleted',closed_at=now(),updated_at=now() where id=v_container;
    insert into public.inventory_movements(organization_id,product_id,container_id,movement_type,quantity_units,reference_type,reference_id,notes,created_by) values(p_organization_id,r.product_id,v_container,'used',-1,'procedure',p_procedure_id,'Consumo en procedimiento',p_created_by);
   end loop;
   update public.procedure_products set inventory_container_id=v_container,inventory_outcome='consumed' where id=r.id;
  else
   select id,status into v_container,v_status from public.inventory_containers where organization_id=p_organization_id and product_id=r.product_id and status in ('open','closed') order by case when status='open' then 0 else 1 end,created_at,id limit 1 for update skip locked;
   if v_container is null then raise exception 'Not enough inventory for %',r.name; end if;
   if v_status='closed' then
    update public.inventory_containers set status='open',opened_at=coalesce(opened_at,now()),updated_at=now() where id=v_container;
    insert into public.inventory_movements(organization_id,product_id,container_id,movement_type,quantity_units,reference_type,reference_id,notes,created_by) values(p_organization_id,r.product_id,v_container,'opened',0,'procedure',p_procedure_id,'Frasco abierto para procedimiento',p_created_by);
   end if;
   v_depleted:=coalesce((p_multiuse_depleted->>r.product_id::text)::boolean,false);
   if v_depleted then
    update public.inventory_containers set status='depleted',closed_at=now(),updated_at=now() where id=v_container;
    insert into public.inventory_movements(organization_id,product_id,container_id,movement_type,quantity_units,reference_type,reference_id,notes,created_by) values(p_organization_id,r.product_id,v_container,'depleted',-1,'procedure',p_procedure_id,'Frasco agotado en procedimiento',p_created_by);
   else
    insert into public.inventory_movements(organization_id,product_id,container_id,movement_type,quantity_units,reference_type,reference_id,notes,created_by) values(p_organization_id,r.product_id,v_container,'used',0,'procedure',p_procedure_id,'Uso de frasco abierto',p_created_by);
   end if;
   update public.procedure_products set inventory_container_id=v_container,inventory_outcome=case when v_depleted then 'depleted' else 'used_open' end where id=r.id;
  end if;
  perform public.sync_low_stock_task(p_organization_id,r.product_id,p_created_by);
 end loop;
end $$;
