-- BAYU BAR · ventas directas y ticket interno
alter table public.orders
  add column if not exists sales_channel text not null default 'web';

alter table public.orders
  drop constraint if exists orders_sales_channel_check;
alter table public.orders
  add constraint orders_sales_channel_check
  check (sales_channel in ('web','presencial','verbal','whatsapp'));

alter table public.orders
  drop constraint if exists orders_payment_check;
alter table public.orders
  add constraint orders_payment_check
  check (payment in ('Yape / Plin','Efectivo','Yape','Plin'));

create or replace function public.award_loyalty_points()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  c public.customers%rowtype;
  s public.loyalty_settings%rowtype;
  pts integer;
  inserted_count integer := 0;
begin
  if new.status='entregado' and old.status is distinct from 'entregado'
     and nullif(trim(coalesce(new.phone,'')),'') is not null then
    insert into public.customers(phone,full_name,last_order_at,lifetime_spend,marketing_consent)
    values(new.phone,new.customer_name,new.delivered_at,new.total,new.marketing_consent)
    on conflict(phone) do update
      set full_name=excluded.full_name,
          last_order_at=excluded.last_order_at,
          lifetime_spend=public.customers.lifetime_spend+excluded.lifetime_spend,
          marketing_consent=(public.customers.marketing_consent or excluded.marketing_consent),
          updated_at=now()
    returning * into c;

    select * into s from public.loyalty_settings where id=1;
    if coalesce(s.enabled,true) then
      pts:=floor(new.subtotal/coalesce(s.soles_per_point,10))::integer;
      if pts>0 then
        insert into public.loyalty_transactions(customer_id,order_id,points,kind,note)
        values(c.id,new.id,pts,'earned','Puntos por pedido '||new.number)
        on conflict(order_id,kind) do nothing;
        get diagnostics inserted_count = row_count;
        if inserted_count > 0 then
          update public.customers set points_balance=points_balance+pts where id=c.id;
        end if;
      end if;
    end if;
  end if;
  return new;
end
$function$;

create or replace function public.register_direct_sale(
  p_customer_name text,
  p_phone text,
  p_payment text,
  p_channel text,
  p_note text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_name text := coalesce(nullif(trim(p_customer_name),''),'Público general');
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_note text := nullif(left(trim(coalesce(p_note,'')),300),'');
  v_id uuid := gen_random_uuid();
  v_num text;
  v_sub numeric := 0;
  v_cost numeric;
  v_p public.products%rowtype;
  v_c public.combos%rowtype;
  v_pid uuid;
  v_qty integer;
  v_item jsonb;
  v_need record;
  v_session uuid;
  v_cash_recorded boolean := false;
  v_items jsonb;
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  if not public.is_admin() or auth.uid() is null then
    raise exception 'No tienes permiso para registrar ventas.';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'El nombre del cliente debe tener entre 2 y 80 caracteres.';
  end if;
  if v_phone <> '' and v_phone !~ '^[0-9]{7,15}$' then
    raise exception 'El celular debe tener entre 7 y 15 dígitos.';
  end if;
  if p_payment not in ('Efectivo','Yape','Plin','Yape / Plin') then
    raise exception 'Selecciona un método de pago válido.';
  end if;
  if p_channel not in ('presencial','verbal','whatsapp') then
    raise exception 'Selecciona el origen de la venta.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 60 then
    raise exception 'Agrega al menos un producto a la venta.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or (v_item ? 'product_id') = (v_item ? 'combo_id')
       or coalesce(v_item->>'product_id',v_item->>'combo_id','') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(v_item->>'qty','') !~ '^[0-9]{1,2}$'
       or (v_item->>'qty')::integer not between 1 and 99 then
      raise exception 'Hay un producto o cantidad no válida.';
    end if;
  end loop;

  insert into public.orders(id,number,customer_name,phone,address,zone_name,payment,note,status,sales_channel)
  values(v_id,'TMP-'||v_id::text,v_name,v_phone,'Venta directa',
         case p_channel when 'presencial' then 'Venta presencial' when 'verbal' then 'Venta verbal / teléfono' else 'Venta por WhatsApp' end,
         p_payment,v_note,'nuevo',p_channel);

  -- _order_needs expande los combos a sus componentes; bloquear y validar stock.
  for v_need in select * from public._order_needs(p_items) order by pid loop
    select * into v_p from public.products where id=v_need.pid for update;
    if not found or not v_p.active then
      raise exception 'Un producto ya no está disponible.';
    end if;
    if v_p.stock < v_need.qty then
      raise exception 'Stock insuficiente de % (disponibles: %).',v_p.name,v_p.stock;
    end if;
  end loop;

  for v_need in
    select (x->>'product_id')::uuid as pid, sum((x->>'qty')::integer) as qty
    from jsonb_array_elements(p_items) x
    where x ? 'product_id'
    group by 1 order by 1
  loop
    select * into v_p from public.products where id=v_need.pid;
    insert into public.order_items(order_id,product_id,product_name,qty,unit_price,unit_cost)
    values(v_id,v_p.id,v_p.name,v_need.qty,public.effective_price(v_p),v_p.cost);
    v_sub := v_sub + v_need.qty * public.effective_price(v_p);
  end loop;

  for v_need in
    select (x->>'combo_id')::uuid as cid, sum((x->>'qty')::integer) as qty
    from jsonb_array_elements(p_items) x
    where x ? 'combo_id'
    group by 1 order by 1
  loop
    select * into v_c from public.combos
    where id=v_need.cid and active and (ends_on is null or ends_on>=v_today)
      and exists(select 1 from public.combo_items where combo_id=v_need.cid);
    if not found then raise exception 'Un combo ya no está disponible.'; end if;
    select coalesce(sum(ci.qty * p.cost),0) into v_cost
    from public.combo_items ci
    join public.products p on p.id=ci.product_id
    where ci.combo_id=v_c.id;
    insert into public.order_items(order_id,product_id,combo_id,product_name,qty,unit_price,unit_cost)
    values(v_id,null,v_c.id,v_c.name,v_need.qty,v_c.price,v_cost);
    v_sub := v_sub + v_need.qty * v_c.price;
  end loop;

  v_num := 'VD-'||lpad(nextval('public.order_seq')::text,5,'0');
  update public.orders
  set number=v_num,subtotal=v_sub,delivery_fee=0,total=v_sub,confirmed_at=now()
  where id=v_id;

  insert into public.stock_movements(product_id,qty,kind,ref,note,created_by)
  select pid,-qty,'venta',v_num,'Venta directa '||v_num,auth.uid()
  from public._order_needs(p_items);

  -- Registrar efectivo en caja solo cuando existe una sesión abierta.
  if p_payment='Efectivo' then
    select id into v_session
    from public.cash_sessions
    where status='open'
    order by opened_at desc
    limit 1
    for update;
    if v_session is not null then
      insert into public.cash_movements(session_id,kind,amount,description,order_id,created_by)
      values(v_session,'income',v_sub,'Venta directa '||v_num,v_id,auth.uid());
      v_cash_recorded := true;
    end if;
  end if;

  -- La transición dispara la fidelización existente; sin celular no crea cliente genérico.
  update public.orders
  set status='entregado',delivered_at=now(),updated_by=auth.uid()
  where id=v_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_name',oi.product_name,'qty',oi.qty,'unit_price',oi.unit_price,
    'unit_cost',oi.unit_cost,'is_gift',oi.is_gift
  ) order by oi.id),'[]'::jsonb)
  into v_items
  from public.order_items oi where oi.order_id=v_id;

  return jsonb_build_object(
    'ticket',jsonb_build_object(
      'id',v_id,'number',v_num,'customer_name',v_name,'phone',v_phone,
      'payment',p_payment,'sales_channel',p_channel,'note',v_note,
      'subtotal',v_sub,'total',v_sub,'created_at',(select created_at from public.orders where id=v_id),
      'items',v_items
    ),
    'cash_recorded',v_cash_recorded
  );
end
$function$;

revoke all on function public.register_direct_sale(text,text,text,text,text,jsonb) from public, anon;
grant execute on function public.register_direct_sale(text,text,text,text,text,jsonb) to authenticated;
