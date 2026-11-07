-- ============================================================================
-- BAYU BAR · Esquema de base de datos (Supabase / PostgreSQL)
-- Ejecutar UNA vez en: Supabase → SQL Editor → New query → pegar todo → Run.
-- Se puede volver a ejecutar sin romper nada (es idempotente).
--
-- Reglas de negocio que impone la base de datos (no el navegador):
--   * Dos tipos de administrador: 'owner' (dueño) y 'helper' (ayudante).
--   * Nadie escribe directo en las tablas. Todo cambio pasa por funciones:
--       - Dueño:    el cambio se aplica al instante y queda registrado.
--       - Ayudante: el cambio queda PENDIENTE hasta que el dueño lo apruebe.
--   * El cliente solo puede ver el catálogo (sin costos) y crear pedidos.
--     El precio y el stock se validan en el servidor, nunca en el navegador.
-- ============================================================================

-- ---------- 1. Tablas -------------------------------------------------------

-- ---------- 0. Revisión previa --------------------------------------------
-- Si tu proyecto ya tenía tablas con estos nombres (de otra versión), "create table
-- if not exists" las respeta y luego fallan los índices. Aquí lo detectamos antes
-- de tocar nada y avisamos con un mensaje claro.
do $$
declare r record; v_bad text := '';
begin
  for r in select * from (values
    ('expenses','spent_on'),('products','min_stock'),('orders','delivery_fee'),
    ('order_items','unit_cost'),('stock_movements','kind'),('purchases','purchased_on'),
    ('delivery_zones','fee'),('settings','is_public'),('profiles','role'),('suppliers','name')
  ) as t(tbl, col) loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=r.tbl)
       and not exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name=r.col) then
      v_bad := v_bad || ' ' || r.tbl;
    end if;
  end loop;
  if v_bad <> '' then
    raise exception 'Tu proyecto ya tiene tablas antiguas con estos nombres:% . Ejecuta primero supabase/00_limpiar_tablas_antiguas.sql (borra esas tablas y sus datos) y luego repite este script.', v_bad;
  end if;
end $$;

create table if not exists public.admin_emails (
  email text primary key,
  role  text not null check (role in ('owner','helper'))
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null check (role in ('owner','helper')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_one_owner on public.profiles ((role)) where role = 'owner';

create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_zones (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 2 and 80),
  fee        numeric(10,2) not null default 0 check (fee >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  category    text not null default 'General',
  size        text,
  description text,
  price       numeric(10,2) not null check (price >= 0),
  cost        numeric(10,2) not null default 0 check (cost >= 0),
  stock       integer not null default 0 check (stock >= 0),
  min_stock   integer not null default 3 check (min_stock >= 0),
  image_url   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id         bigint generated always as identity primary key,
  product_id uuid not null references public.products(id),
  qty        integer not null check (qty <> 0),
  kind       text not null check (kind in ('compra','venta','ajuste','merma','devolucion')),
  ref        text,
  note       text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  phone      text,
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid references public.suppliers(id),
  purchased_on date not null,
  total        numeric(12,2) not null default 0,
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  qty         integer not null check (qty > 0),
  unit_cost   numeric(10,2) not null check (unit_cost >= 0)
);

create sequence if not exists public.order_seq;

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  customer_name text not null,
  phone         text not null,
  address       text not null,
  zone_id       uuid references public.delivery_zones(id),
  zone_name     text,
  payment       text not null check (payment in ('Yape / Plin','Efectivo')),
  note          text,
  subtotal      numeric(12,2) not null default 0,
  delivery_fee  numeric(10,2) not null default 0,
  total         numeric(12,2) not null default 0,
  status        text not null default 'nuevo' check (status in ('nuevo','confirmado','en_camino','entregado','cancelado')),
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  delivered_at  timestamptz,
  cancelled_at  timestamptz,
  updated_by    uuid
);
create index if not exists orders_status_idx  on public.orders (status, created_at desc);
create index if not exists orders_created_idx on public.orders (created_at desc);

create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  product_name text not null,
  qty          integer not null check (qty > 0),
  unit_price   numeric(10,2) not null,
  unit_cost    numeric(10,2) not null default 0
);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- ---------- 1b. Combos y promociones ----------------------------------------
-- Oferta por producto: precio promocional con fecha de fin opcional.
alter table public.products add column if not exists promo_price numeric(10,2) check (promo_price >= 0);
alter table public.products add column if not exists promo_until date;
do $$ begin
  alter table public.products add constraint products_promo_check check (promo_price is null or promo_price < price);
exception when duplicate_object then null;
end $$;

-- Combo: varios productos a un precio fijo. Al vender, descuenta el stock de cada componente.
create table if not exists public.combos (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  description text,
  price       numeric(10,2) not null check (price >= 0),
  image_url   text,
  ends_on     date,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create table if not exists public.combo_items (
  combo_id   uuid not null references public.combos(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty        integer not null check (qty between 1 and 99),
  primary key (combo_id, product_id)
);

-- Una línea de pedido puede ser un combo (sin producto propio).
alter table public.order_items alter column product_id drop not null;
alter table public.order_items add column if not exists combo_id uuid references public.combos(id) on delete set null;


create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  spent_on    date not null,
  category    text not null default 'Otros',
  description text not null check (char_length(description) between 2 and 200),
  amount      numeric(10,2) not null check (amount > 0),
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (spent_on);

create table if not exists public.change_requests (
  id           uuid primary key default gen_random_uuid(),
  entity       text not null check (entity in ('product','stock_adjust','purchase','expense','zone','setting','order_cancel','combo')),
  action       text not null check (action in ('insert','update','delete')),
  target_id    uuid,
  payload      jsonb not null default '{}'::jsonb,
  summary      text,
  status       text not null default 'pendiente' check (status in ('pendiente','aprobado','rechazado')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  review_note  text
);
create index if not exists change_requests_status_idx on public.change_requests (status, requested_at desc);

-- Instalaciones anteriores: ampliar la lista de tipos de cambio.
alter table public.change_requests drop constraint if exists change_requests_entity_check;
alter table public.change_requests add constraint change_requests_entity_check
  check (entity in ('product','stock_adjust','purchase','expense','zone','setting','order_cancel','combo'));

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_email text,
  table_name  text not null,
  action      text not null,
  row_id      text,
  old_data    jsonb,
  new_data    jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- ---------- 2. Datos iniciales de configuración -----------------------------

insert into public.settings (key, value) values
  ('store_name',            '"BAYU BAR"'),
  ('whatsapp',              '"51960577902"'),
  ('free_delivery_enabled', 'true'),
  ('free_delivery_min',     '0')
on conflict (key) do nothing;

-- Zonas de ejemplo: edítalas desde el panel (Ajustes → Zonas de delivery).
insert into public.delivery_zones (name, fee) values
  ('Centro de San Miguel', 3.00),
  ('Alrededores',          6.00)
on conflict (name) do nothing;

-- ---------- 3. Funciones de apoyo ------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'owner')
$$;

-- Al crear un usuario en Authentication, si su correo está en admin_emails
-- se le asigna perfil y rol automáticamente.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r text;
begin
  select role into r from public.admin_emails where lower(email) = lower(new.email);
  if r is not null then
    insert into public.profiles (id, email, role) values (new.id, new.email, r)
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Bitácora automática de todo cambio importante.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old jsonb; v_new jsonb; v_email text;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.audit_log (actor, actor_email, table_name, action, row_id, old_data, new_data)
  values (auth.uid(), coalesce(v_email, 'cliente / sistema'), tg_table_name, tg_op,
          coalesce(v_new->>'id', v_old->>'id', v_new->>'key', v_old->>'key'), v_old, v_new);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['products','orders','expenses','purchases','delivery_zones','settings','suppliers','profiles','combos'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Cada movimiento de inventario actualiza el stock del producto.
create or replace function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.products set stock = stock + new.qty, updated_at = now() where id = new.product_id;
  return new;
end $$;

drop trigger if exists stock_movement_apply on public.stock_movements;
create trigger stock_movement_apply after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- ---------- 4. Vista pública del catálogo (sin costos) ----------------------

-- Precio vigente de un producto (oferta si está activa, si no el normal).
create or replace function public.effective_price(p public.products) returns numeric
language sql stable set search_path = pg_catalog, public as $$
  select case when p.promo_price is not null
               and (p.promo_until is null or p.promo_until >= (now() at time zone 'America/Lima')::date)
              then p.promo_price else p.price end
$$;

create or replace view public.public_products as
  select id, name, category, size, description, price, image_url, (case when stock > 0 then 1 else 0 end)::integer as stock, (stock > 0) as available,
         case when promo_price is not null and (promo_until is null or promo_until >= (now() at time zone 'America/Lima')::date)
              then promo_price end as promo_price,
         case when promo_price is not null and (promo_until is null or promo_until >= (now() at time zone 'America/Lima')::date)
              then promo_until end as promo_until
  from public.products
  where active;

create or replace view public.public_combos as
  select c.id, c.name, c.description, c.price, c.image_url, c.ends_on,
    (select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name, 'size', p.size, 'qty', ci.qty) order by p.name)
       from public.combo_items ci join public.products p on p.id = ci.product_id where ci.combo_id = c.id) as items,
    (select coalesce(sum(ci.qty * public.effective_price(p)), 0)
       from public.combo_items ci join public.products p on p.id = ci.product_id where ci.combo_id = c.id) as regular_price,
    (select (case when coalesce(min(case when p.active then p.stock / ci.qty else 0 end), 0) > 0 then 1 else 0 end)::integer
       from public.combo_items ci join public.products p on p.id = ci.product_id where ci.combo_id = c.id) as available_units
  from public.combos c
  where c.active
    and (c.ends_on is null or c.ends_on >= (now() at time zone 'America/Lima')::date)
    and exists (select 1 from public.combo_items x where x.combo_id = c.id);

-- ---------- 5. Lógica de cambios (única vía de escritura del panel) ---------

create or replace function public._set_combo_items(p_combo uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare it jsonb; v_pid uuid; v_qty int;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El combo necesita al menos un producto.';
  end if;
  delete from combo_items where combo_id = p_combo;
  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid; v_qty := (it->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 99 then raise exception 'Cada producto del combo necesita una cantidad entre 1 y 99.'; end if;
    perform 1 from products where id = v_pid;
    if not found then raise exception 'Un producto del combo ya no existe.'; end if;
    insert into combo_items (combo_id, product_id, qty) values (p_combo, v_pid, v_qty)
    on conflict (combo_id, product_id) do update set qty = least(99, combo_items.qty + excluded.qty);
  end loop;
end $$;

create or replace function public._apply_change(
  p_entity text, p_action text, p_target uuid, p_payload jsonb, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_id uuid; v_sup uuid; v_item jsonb; v_qty int; v_cost numeric; v_pid uuid;
  v_total numeric := 0; v_cur int; v_key text; v_val jsonb; v_ord orders%rowtype;
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  ---------------------------------------------------------------- PRODUCTO
  if p_entity = 'product' then
    if p_action = 'insert' then
      insert into products (name, category, size, description, price, cost, min_stock, image_url, active, promo_price, promo_until)
      values (
        trim(p_payload->>'name'),
        coalesce(nullif(trim(p_payload->>'category'), ''), 'General'),
        nullif(trim(p_payload->>'size'), ''),
        nullif(trim(p_payload->>'description'), ''),
        (p_payload->>'price')::numeric,
        coalesce((p_payload->>'cost')::numeric, 0),
        coalesce((p_payload->>'min_stock')::int, 3),
        nullif(p_payload->>'image_url', ''),
        coalesce((p_payload->>'active')::boolean, true),
        nullif(p_payload->>'promo_price', '')::numeric,
        nullif(p_payload->>'promo_until', '')::date
      ) returning id into v_id;
      v_qty := coalesce((p_payload->>'initial_stock')::int, 0);
      if v_qty > 0 then
        insert into stock_movements (product_id, qty, kind, note, created_by)
        values (v_id, v_qty, 'ajuste', 'Stock inicial', p_actor);
      end if;
      return v_id;
    elsif p_action = 'update' then
      update products set
        name        = case when p_payload ? 'name'        then trim(p_payload->>'name') else name end,
        category    = case when p_payload ? 'category'    then coalesce(nullif(trim(p_payload->>'category'), ''), 'General') else category end,
        size        = case when p_payload ? 'size'        then nullif(trim(p_payload->>'size'), '') else size end,
        description = case when p_payload ? 'description' then nullif(trim(p_payload->>'description'), '') else description end,
        price       = case when p_payload ? 'price'       then (p_payload->>'price')::numeric else price end,
        cost        = case when p_payload ? 'cost'        then (p_payload->>'cost')::numeric else cost end,
        min_stock   = case when p_payload ? 'min_stock'   then (p_payload->>'min_stock')::int else min_stock end,
        image_url   = case when p_payload ? 'image_url'   then nullif(p_payload->>'image_url', '') else image_url end,
        active      = case when p_payload ? 'active'      then (p_payload->>'active')::boolean else active end,
        promo_price = case when p_payload ? 'promo_price' then nullif(p_payload->>'promo_price', '')::numeric else promo_price end,
        promo_until = case when p_payload ? 'promo_until' then nullif(p_payload->>'promo_until', '')::date else promo_until end,
        updated_at  = now()
      where id = p_target;
      if not found then raise exception 'El producto ya no existe.'; end if;
      return p_target;
    elsif p_action = 'delete' then
      update products set active = false, updated_at = now() where id = p_target;
      if not found then raise exception 'El producto ya no existe.'; end if;
      return p_target;
    end if;

  ------------------------------------------------------ AJUSTE DE INVENTARIO
  elsif p_entity = 'stock_adjust' and p_action = 'insert' then
    v_pid := (p_payload->>'product_id')::uuid;
    v_qty := (p_payload->>'qty')::int;
    if v_qty is null or v_qty = 0 then raise exception 'La cantidad del ajuste no puede ser 0.'; end if;
    if coalesce(p_payload->>'kind', '') not in ('ajuste','merma') then raise exception 'Tipo de ajuste no válido.'; end if;
    select stock into v_cur from products where id = v_pid for update;
    if not found then raise exception 'El producto ya no existe.'; end if;
    if v_cur + v_qty < 0 then
      raise exception 'El stock no puede quedar negativo (stock actual: %).', v_cur;
    end if;
    insert into stock_movements (product_id, qty, kind, note, created_by)
    values (v_pid, v_qty, p_payload->>'kind', nullif(trim(p_payload->>'note'), ''), p_actor);
    return v_pid;

  ----------------------------------------------------------------- COMPRA
  elsif p_entity = 'purchase' then
    if p_action <> 'insert' then
      raise exception 'Las compras no se editan. Para corregir usa un ajuste de inventario.';
    end if;
    if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') = 0 then
      raise exception 'La compra necesita al menos un producto.';
    end if;
    if nullif(trim(p_payload->>'supplier'), '') is not null then
      insert into suppliers (name) values (trim(p_payload->>'supplier'))
      on conflict (name) do update set name = excluded.name
      returning id into v_sup;
    end if;
    insert into purchases (supplier_id, purchased_on, note, created_by)
    values (v_sup, coalesce(nullif(p_payload->>'purchased_on', '')::date, v_today),
            nullif(trim(p_payload->>'note'), ''), p_actor)
    returning id into v_id;
    for v_item in select * from jsonb_array_elements(p_payload->'items') loop
      v_pid  := (v_item->>'product_id')::uuid;
      v_qty  := (v_item->>'qty')::int;
      v_cost := (v_item->>'unit_cost')::numeric;
      if v_qty is null or v_qty < 1 then raise exception 'Cada producto de la compra necesita una cantidad mayor a 0.'; end if;
      if v_cost is null or v_cost < 0 then raise exception 'El costo unitario no es válido.'; end if;
      perform 1 from products where id = v_pid for update;
      if not found then raise exception 'Un producto de la compra ya no existe.'; end if;
      insert into purchase_items (purchase_id, product_id, qty, unit_cost) values (v_id, v_pid, v_qty, v_cost);
      insert into stock_movements (product_id, qty, kind, ref, created_by)
      values (v_pid, v_qty, 'compra', v_id::text, p_actor);
      update products set cost = v_cost, updated_at = now() where id = v_pid;  -- último costo de compra
      v_total := v_total + v_qty * v_cost;
    end loop;
    update purchases set total = v_total where id = v_id;
    return v_id;

  ------------------------------------------------------------------ GASTO
  elsif p_entity = 'expense' then
    if p_action = 'insert' then
      insert into expenses (spent_on, category, description, amount, created_by)
      values (coalesce(nullif(p_payload->>'spent_on', '')::date, v_today),
              coalesce(nullif(trim(p_payload->>'category'), ''), 'Otros'),
              trim(p_payload->>'description'), (p_payload->>'amount')::numeric, p_actor)
      returning id into v_id;
      return v_id;
    elsif p_action = 'update' then
      update expenses set
        spent_on    = case when p_payload ? 'spent_on'    then (p_payload->>'spent_on')::date else spent_on end,
        category    = case when p_payload ? 'category'    then coalesce(nullif(trim(p_payload->>'category'), ''), 'Otros') else category end,
        description = case when p_payload ? 'description' then trim(p_payload->>'description') else description end,
        amount      = case when p_payload ? 'amount'      then (p_payload->>'amount')::numeric else amount end
      where id = p_target;
      if not found then raise exception 'El gasto ya no existe.'; end if;
      return p_target;
    elsif p_action = 'delete' then
      delete from expenses where id = p_target;
      if not found then raise exception 'El gasto ya no existe.'; end if;
      return p_target;
    end if;

  ------------------------------------------------------- ZONA DE DELIVERY
  elsif p_entity = 'zone' then
    if p_action = 'insert' then
      insert into delivery_zones (name, fee) values (trim(p_payload->>'name'), coalesce((p_payload->>'fee')::numeric, 0))
      returning id into v_id;
      return v_id;
    elsif p_action = 'update' then
      update delivery_zones set
        name   = case when p_payload ? 'name'   then trim(p_payload->>'name') else name end,
        fee    = case when p_payload ? 'fee'    then (p_payload->>'fee')::numeric else fee end,
        active = case when p_payload ? 'active' then (p_payload->>'active')::boolean else active end
      where id = p_target;
      if not found then raise exception 'La zona ya no existe.'; end if;
      return p_target;
    elsif p_action = 'delete' then
      update delivery_zones set active = false where id = p_target;
      if not found then raise exception 'La zona ya no existe.'; end if;
      return p_target;
    end if;

  ------------------------------------------------------------ CONFIGURACIÓN
  elsif p_entity = 'setting' and p_action = 'update' then
    v_key := p_payload->>'key';
    v_val := p_payload->'value';
    if v_key = 'free_delivery_enabled' then
      if jsonb_typeof(v_val) is distinct from 'boolean' then raise exception 'Valor no válido.'; end if;
    elsif v_key = 'free_delivery_min' then
      if jsonb_typeof(v_val) is distinct from 'number' or (v_val #>> '{}')::numeric < 0 then raise exception 'El monto mínimo no es válido.'; end if;
    elsif v_key = 'whatsapp' then
      if jsonb_typeof(v_val) is distinct from 'string' or (v_val #>> '{}') !~ '^[0-9]{8,15}$' then
        raise exception 'El WhatsApp debe tener solo números con código de país (ej. 51960577902).';
      end if;
    elsif v_key in ('msg_confirmado','msg_en_camino','msg_entregado') then
      if jsonb_typeof(v_val) is distinct from 'string' or char_length(v_val #>> '{}') not between 10 and 300 then
        raise exception 'El mensaje debe tener entre 10 y 300 caracteres.';
      end if;
    elsif v_key = 'store_name' then
      if jsonb_typeof(v_val) is distinct from 'string' or char_length(v_val #>> '{}') not between 2 and 60 then
        raise exception 'El nombre del negocio debe tener entre 2 y 60 caracteres.';
      end if;
    else
      raise exception 'Configuración desconocida.';
    end if;
    insert into settings (key, value, is_public) values (v_key, v_val, v_key !~ '^msg_')
    on conflict (key) do update set value = excluded.value, updated_at = now();
    return null;

  ----------------------------------------------------------------- COMBO
  elsif p_entity = 'combo' then
    if p_action = 'insert' then
      if nullif(trim(p_payload->>'name'), '') is null then raise exception 'El combo necesita un nombre.'; end if;
      if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') = 0 then
        raise exception 'El combo necesita al menos un producto.';
      end if;
      insert into combos (name, description, price, image_url, ends_on, active)
      values (trim(p_payload->>'name'), nullif(trim(p_payload->>'description'), ''), (p_payload->>'price')::numeric,
              nullif(p_payload->>'image_url', ''), nullif(p_payload->>'ends_on', '')::date, coalesce((p_payload->>'active')::boolean, true))
      returning id into v_id;
      perform _set_combo_items(v_id, p_payload->'items');
      return v_id;
    elsif p_action = 'update' then
      update combos set
        name        = case when p_payload ? 'name'        then trim(p_payload->>'name') else name end,
        description = case when p_payload ? 'description' then nullif(trim(p_payload->>'description'), '') else description end,
        price       = case when p_payload ? 'price'       then (p_payload->>'price')::numeric else price end,
        image_url   = case when p_payload ? 'image_url'   then nullif(p_payload->>'image_url', '') else image_url end,
        ends_on     = case when p_payload ? 'ends_on'     then nullif(p_payload->>'ends_on', '')::date else ends_on end,
        active      = case when p_payload ? 'active'      then (p_payload->>'active')::boolean else active end
      where id = p_target;
      if not found then raise exception 'El combo ya no existe.'; end if;
      if p_payload ? 'items' then perform _set_combo_items(p_target, p_payload->'items'); end if;
      return p_target;
    elsif p_action = 'delete' then
      update combos set active = false where id = p_target;
      if not found then raise exception 'El combo ya no existe.'; end if;
      return p_target;
    end if;

  ------------------------------------------------------- CANCELAR PEDIDO
  elsif p_entity = 'order_cancel' and p_action = 'update' then
    select * into v_ord from orders where id = p_target for update;
    if not found then raise exception 'El pedido no existe.'; end if;
    if v_ord.status = 'cancelado' then raise exception 'El pedido ya estaba cancelado.'; end if;
    if v_ord.status = 'entregado' then raise exception 'Un pedido entregado no se puede cancelar.'; end if;
    -- Devuelve exactamente lo que salió (incluye los componentes de combos).
    insert into stock_movements (product_id, qty, kind, ref, note, created_by)
      select product_id, -qty, 'devolucion', v_ord.number, 'Pedido cancelado', p_actor
      from stock_movements where ref = v_ord.number and kind = 'venta';
    update orders set status = 'cancelado', cancelled_at = now(), updated_by = p_actor where id = p_target;
    return p_target;
  end if;

  raise exception 'Cambio no soportado (% / %).', p_entity, p_action;
end $$;

-- El ayudante envía; el dueño aplica directo. Misma puerta para los dos.
create or replace function public.submit_change(
  p_entity text, p_action text, p_target uuid default null,
  p_payload jsonb default '{}'::jsonb, p_summary text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_res uuid; v_sum text := left(coalesce(p_summary, ''), 300);
begin
  if not is_admin() then raise exception 'No tienes permiso para esta acción.'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Datos no válidos.'; end if;
  if is_owner() then
    v_res := _apply_change(p_entity, p_action, p_target, p_payload, auth.uid());
    insert into change_requests (entity, action, target_id, payload, summary, status, requested_by, reviewed_by, reviewed_at, review_note)
    values (p_entity, p_action, p_target, p_payload, v_sum, 'aprobado', auth.uid(), auth.uid(), now(), 'Aplicado directamente por el dueño')
    returning id into v_id;
    return jsonb_build_object('status', 'aprobado', 'id', v_id, 'result_id', v_res);
  end if;
  insert into change_requests (entity, action, target_id, payload, summary, requested_by)
  values (p_entity, p_action, p_target, p_payload, v_sum, auth.uid())
  returning id into v_id;
  return jsonb_build_object('status', 'pendiente', 'id', v_id);
end $$;

create or replace function public.review_change(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r change_requests%rowtype;
begin
  if not is_owner() then raise exception 'Solo el dueño puede aprobar o rechazar.'; end if;
  select * into r from change_requests where id = p_id for update;
  if not found then raise exception 'La solicitud no existe.'; end if;
  if r.status <> 'pendiente' then raise exception 'Esta solicitud ya fue revisada.'; end if;
  if p_approve then
    perform _apply_change(r.entity, r.action, r.target_id, r.payload, r.requested_by);
  end if;
  update change_requests set
    status = case when p_approve then 'aprobado' else 'rechazado' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(trim(p_note), ''), 300)
  where id = p_id;
  return jsonb_build_object('status', case when p_approve then 'aprobado' else 'rechazado' end);
end $$;

-- Avance operativo de un pedido (confirmar / en camino / entregado).
-- Cancelar NO pasa por aquí: es un cambio que el ayudante debe pedir al dueño.
create or replace function public.set_order_status(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o orders%rowtype; v_from int; v_to int;
begin
  if not is_admin() then raise exception 'No tienes permiso para esta acción.'; end if;
  select * into o from orders where id = p_id for update;
  if not found then raise exception 'El pedido no existe.'; end if;
  if o.status in ('entregado','cancelado') then raise exception 'Este pedido ya está cerrado.'; end if;
  v_from := array_position(array['nuevo','confirmado','en_camino','entregado'], o.status);
  v_to   := array_position(array['nuevo','confirmado','en_camino','entregado'], p_status);
  if v_to is null then raise exception 'Estado no válido.'; end if;
  if v_to <= v_from then raise exception 'El pedido no puede retroceder de estado.'; end if;
  update orders set
    status = p_status,
    confirmed_at = coalesce(confirmed_at, case when v_to >= 2 then now() end),
    delivered_at = case when p_status = 'entregado' then now() else delivered_at end,
    updated_by = auth.uid()
  where id = p_id;
  return jsonb_build_object('status', p_status);
end $$;

-- ---------- 5b. Avisos de pedidos (Telegram + notificación push) -------------
-- Secretos (token del bot, clave de envío) viven en una tabla que NADIE puede leer
-- desde el navegador: solo las funciones del servidor.
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then null;
end $$;

create table if not exists public.private_config (
  key text primary key, value text not null, updated_at timestamptz not null default now()
);
alter table public.private_config enable row level security;

create table if not exists public.push_subscriptions (
  endpoint text primary key, p256dh text not null, auth text not null,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

-- Textos del mensaje que el panel prepara para el cliente (editables en Ajustes).
insert into public.settings (key, value, is_public) values
  ('msg_confirmado', to_jsonb('Hola {nombre}, tu pedido {pedido} ha sido confirmado. Ya lo estamos preparando. Gracias por elegir BAYU BAR.'::text), false),
  ('msg_en_camino',  to_jsonb('Hola {nombre}, tu pedido {pedido} está en camino hacia tu dirección. ¡Gracias por esperar!'::text), false),
  ('msg_entregado',  to_jsonb('Hola {nombre}, tu pedido {pedido} fue entregado. Gracias por tu preferencia, ¡te esperamos pronto! BAYU BAR'::text), false)
on conflict (key) do nothing;

-- Envía un aviso por los canales configurados. Nunca rompe el pedido si algo falla.
create or replace function public._notify(p_title text, p_body text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tok text; v_chat text; v_url text; v_sec text;
begin
  select value into v_tok  from private_config where key = 'telegram_token';
  select value into v_chat from private_config where key = 'telegram_chat';
  select value into v_url  from private_config where key = 'push_url';
  select value into v_sec  from private_config where key = 'push_secret';
  if v_tok is not null and v_chat is not null then
    begin
      perform net.http_post(
        url := 'https://api.telegram.org/bot' || v_tok || '/sendMessage',
        body := jsonb_build_object('chat_id', v_chat, 'text', left(p_title || E'\n' || p_body, 3900)),
        headers := '{"Content-Type":"application/json"}'::jsonb);
    exception when others then raise warning 'Aviso Telegram falló: %', sqlerrm;
    end;
  end if;
  if v_url is not null and v_sec is not null then
    begin
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('title', p_title, 'body', left(p_body, 300), 'url', 'admin.html#pedidos'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_sec));
    exception when others then raise warning 'Aviso push falló: %', sqlerrm;
    end;
  end if;
exception when others then null;
end $$;

create or replace function public._notify_new_order(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o orders%rowtype; v_items text;
begin
  select * into o from orders where id = p_id;
  if not found then return; end if;
  select string_agg(qty || ' x ' || product_name, ', ' order by product_name) into v_items from order_items where order_id = p_id;
  perform _notify(
    'Pedido nuevo ' || o.number || ' · S/ ' || to_char(o.total, 'FM999990.00'),
    o.customer_name || ' · ' || o.phone || E'\n' || coalesce(v_items, '') || E'\n' ||
    coalesce(o.zone_name, '') || ' · ' || o.address || E'\nPago: ' || o.payment ||
    case when o.note is not null then E'\nNota: ' || o.note else '' end);
exception when others then null;
end $$;

-- Solo el dueño configura los avisos.
create or replace function public.set_notify_config(p_key text, p_value text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not is_owner() then raise exception 'Solo el dueño puede configurar los avisos.'; end if;
  if p_key not in ('telegram_token','telegram_chat','push_url','push_secret') then raise exception 'Ajuste desconocido.'; end if;
  if p_key = 'push_url' and coalesce(p_value, '') <> '' and p_value !~ '^https://' then raise exception 'La dirección debe empezar con https://'; end if;
  if p_key = 'telegram_chat' and coalesce(p_value, '') <> '' and trim(p_value) !~ '^-?[0-9]{5,20}$' then raise exception 'El ID de chat de Telegram son solo números.'; end if;
  if coalesce(trim(p_value), '') = '' then delete from private_config where key = p_key;
  else insert into private_config (key, value) values (p_key, trim(p_value))
       on conflict (key) do update set value = excluded.value, updated_at = now(); end if;
end $$;

create or replace function public.get_notify_status() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not is_owner() then raise exception 'Solo el dueño puede ver esto.'; end if;
  return jsonb_build_object(
    'telegram', exists (select 1 from private_config where key = 'telegram_token') and exists (select 1 from private_config where key = 'telegram_chat'),
    'push_server', exists (select 1 from private_config where key = 'push_url') and exists (select 1 from private_config where key = 'push_secret'),
    'devices', (select count(*) from push_subscriptions));
end $$;

create or replace function public.send_test_notification() returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not is_owner() then raise exception 'Solo el dueño puede enviar la prueba.'; end if;
  perform _notify('Prueba de BAYU BAR', 'Si ves este mensaje, los avisos de pedidos funcionan.');
end $$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not is_admin() then raise exception 'No tienes permiso para esta acción.'; end if;
  if p_endpoint !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Suscripción no válida.'; end if;
  insert into push_subscriptions (endpoint, p256dh, auth, user_id) values (p_endpoint, p_p256dh, p_auth, auth.uid())
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_id = auth.uid();
end $$;

create or replace function public.remove_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not is_admin() then raise exception 'No tienes permiso para esta acción.'; end if;
  delete from push_subscriptions where endpoint = p_endpoint;
end $$;

-- ---------- 6. Pedido del cliente (único punto de entrada público) ----------

-- Productos que hay que descontar de un pedido (productos sueltos + componentes de combos).
create or replace function public._order_needs(p_items jsonb)
returns table (pid uuid, qty bigint)
language sql stable security definer set search_path = pg_catalog, public as $$
  with lines as (
    select (x->>'product_id')::uuid as pid, (x->>'combo_id')::uuid as cid, (x->>'qty')::int as qty
    from jsonb_array_elements(p_items) x
  ), direct as (
    select pid, sum(qty) as qty from lines where pid is not null group by pid
  ), via as (
    select ci.product_id as pid, sum(ci.qty * l.qty) as qty
    from lines l join combo_items ci on ci.combo_id = l.cid
    where l.cid is not null group by ci.product_id
  )
  select u.pid, sum(u.qty)::bigint from (select * from direct union all select * from via) u
  group by u.pid order by u.pid
$$;

create or replace function public.place_order(
  p_name text, p_phone text, p_address text, p_zone uuid,
  p_payment text, p_note text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_addr text := trim(coalesce(p_address, ''));
  v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
  v_zone delivery_zones%rowtype; v_p products%rowtype; v_c combos%rowtype; r record; e jsonb;
  v_sub numeric := 0; v_fee numeric := 0; v_id uuid := gen_random_uuid(); v_num text;
  v_free boolean; v_min numeric; v_ccost numeric;
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  if char_length(v_name) not between 2 and 80 then raise exception 'Escribe tu nombre completo.'; end if;
  if v_phone !~ '^\+?[0-9]{7,15}$' then raise exception 'Escribe un número de celular válido.'; end if;
  if char_length(v_addr) not between 5 and 300 then raise exception 'Escribe tu dirección de entrega (calle, número y referencia).'; end if;
  if p_payment not in ('Yape / Plin','Efectivo') then raise exception 'Elige un método de pago.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 60 then
    raise exception 'Tu pedido está vacío.';
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) is distinct from 'object'
       or (e ? 'product_id') = (e ? 'combo_id')
       or coalesce(e->>'product_id', e->>'combo_id', '') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(e->>'qty', '') !~ '^[0-9]{1,2}$' or (e->>'qty')::int < 1 then
      raise exception 'Hay un producto con datos no válidos.';
    end if;
  end loop;
  select * into v_zone from delivery_zones where id = p_zone and active;
  if not found then raise exception 'Elige una zona de entrega.'; end if;
  if (select count(*) from orders where phone = v_phone and status = 'nuevo' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Ya tienes varios pedidos pendientes. Escríbenos por WhatsApp para coordinar.';
  end if;

  -- Número provisional: el correlativo real se asigna al final, así un pedido
  -- rechazado nunca deja huecos en la numeración.
  insert into orders (id, number, customer_name, phone, address, zone_id, zone_name, payment, note)
  values (v_id, 'TMP-' || v_id::text, v_name, v_phone, v_addr, v_zone.id, v_zone.name, p_payment, v_note);

  -- 1) Bloquear y comprobar stock de todo lo que se va a descontar.
  for r in select * from public._order_needs(p_items) loop
    select * into v_p from products where id = r.pid for update;
    if not found or not v_p.active then raise exception 'Un producto de tu pedido ya no está disponible.'; end if;
    if v_p.stock < r.qty then
      raise exception 'No hay suficiente stock de % (quedan %).', v_p.name, v_p.stock;
    end if;
  end loop;

  -- 2) Productos sueltos al precio vigente (oferta si la hay).
  for r in
    select (x->>'product_id')::uuid as pid, sum((x->>'qty')::int) as qty
    from jsonb_array_elements(p_items) x where x ? 'product_id'
    group by (x->>'product_id')::uuid order by 1
  loop
    if r.qty > 99 then raise exception 'La cantidad máxima por producto es 99.'; end if;
    select * into v_p from products where id = r.pid;
    insert into order_items (order_id, product_id, product_name, qty, unit_price, unit_cost)
    values (v_id, v_p.id, v_p.name, r.qty, public.effective_price(v_p), v_p.cost);
    v_sub := v_sub + r.qty * public.effective_price(v_p);
  end loop;

  -- 3) Combos al precio del combo; el costo es la suma de sus componentes.
  for r in
    select (x->>'combo_id')::uuid as cid, sum((x->>'qty')::int) as qty
    from jsonb_array_elements(p_items) x where x ? 'combo_id'
    group by (x->>'combo_id')::uuid order by 1
  loop
    if r.qty > 99 then raise exception 'La cantidad máxima por combo es 99.'; end if;
    select * into v_c from combos where id = r.cid and active and (ends_on is null or ends_on >= v_today)
      and exists (select 1 from combo_items where combo_id = r.cid);
    if not found then raise exception 'Un combo de tu pedido ya no está disponible.'; end if;
    select coalesce(sum(ci.qty * p.cost), 0) into v_ccost
      from combo_items ci join products p on p.id = ci.product_id where ci.combo_id = v_c.id;
    insert into order_items (order_id, product_id, combo_id, product_name, qty, unit_price, unit_cost)
    values (v_id, null, v_c.id, v_c.name, r.qty, v_c.price, v_ccost);
    v_sub := v_sub + r.qty * v_c.price;
  end loop;

  v_num := 'BB-' || lpad(nextval('public.order_seq')::text, 5, '0');
  insert into stock_movements (product_id, qty, kind, ref, note)
    select pid, -qty, 'venta', v_num, 'Pedido ' || v_num from public._order_needs(p_items);

  select coalesce((value #>> '{}')::boolean, false) into v_free from settings where key = 'free_delivery_enabled';
  select coalesce((value #>> '{}')::numeric, 0)     into v_min  from settings where key = 'free_delivery_min';
  v_fee := case when coalesce(v_free, false) and v_sub >= coalesce(v_min, 0) then 0 else v_zone.fee end;

  update orders set number = v_num, subtotal = v_sub, delivery_fee = v_fee, total = v_sub + v_fee where id = v_id;
  perform _notify_new_order(v_id);
  return jsonb_build_object('number', v_num, 'subtotal', v_sub, 'delivery_fee', v_fee, 'total', v_sub + v_fee);
end $$;

-- ---------- 7. Reportes (solo dueño) ---------------------------------------
-- Venta = pedido ENTREGADO, contado en el día de entrega (hora de Lima).
-- Ganancia bruta = ventas - costo de lo vendido. Ganancia neta = bruta - gastos.

create or replace function public.report_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  if not is_owner() then raise exception 'Solo el dueño puede ver los reportes.'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'El rango de fechas no es válido.'; end if;
  if p_to - p_from > 400 then raise exception 'El rango máximo es de 400 días.'; end if;
  with ords as (
    select o.id, o.total, o.delivery_fee, o.payment, (o.delivered_at at time zone 'America/Lima')::date as d
    from orders o
    where o.status = 'entregado'
      and (o.delivered_at at time zone 'America/Lima')::date between p_from and p_to
  ), its as (
    select oi.product_name, oi.qty, oi.unit_price, oi.unit_cost, ords.d
    from order_items oi join ords on ords.id = oi.order_id
  ), exps as (
    select spent_on as d, amount from expenses where spent_on between p_from and p_to
  ), days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ), daily as (
    select days.d,
      coalesce((select sum(total) from ords where ords.d = days.d), 0) as sales,
      coalesce((select count(*) from ords where ords.d = days.d), 0) as orders,
      coalesce((select sum(qty * unit_cost) from its where its.d = days.d), 0) as cogs,
      coalesce((select sum(amount) from exps where exps.d = days.d), 0) as expenses
    from days
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'orders',          (select count(*) from ords),
    'sales',           (select coalesce(sum(total), 0) from ords),
    'delivery_income', (select coalesce(sum(delivery_fee), 0) from ords),
    'cogs',            (select coalesce(sum(qty * unit_cost), 0) from its),
    'expenses',        (select coalesce(sum(amount), 0) from exps),
    'purchases',       (select coalesce(sum(total), 0) from purchases where purchased_on between p_from and p_to),
    'pending_sales',   (select coalesce(sum(total), 0) from orders where status in ('nuevo','confirmado','en_camino')),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'sales', sales, 'orders', orders, 'cogs', cogs, 'expenses', expenses) order by d), '[]'::jsonb) from daily),
    'top_products', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select product_name as name, sum(qty) as qty, sum(qty * unit_price) as revenue, sum(qty * (unit_price - unit_cost)) as profit
        from its group by product_name order by sum(qty * unit_price) desc limit 10) t),
    'by_payment', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select payment, count(*) as orders, sum(total) as total from ords group by payment order by sum(total) desc) t)
  ) into v;
  return v;
end $$;

-- ---------- 8. Seguridad por filas (RLS) -----------------------------------

alter table public.admin_emails     enable row level security;
alter table public.profiles         enable row level security;
alter table public.settings         enable row level security;
alter table public.delivery_zones   enable row level security;
alter table public.products         enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.suppliers        enable row level security;
alter table public.purchases        enable row level security;
alter table public.purchase_items   enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.expenses         enable row level security;
alter table public.change_requests  enable row level security;
alter table public.audit_log        enable row level security;
alter table public.combos           enable row level security;
alter table public.combo_items      enable row level security;

drop policy if exists p_profiles_read  on public.profiles;        create policy p_profiles_read  on public.profiles        for select to authenticated using (public.is_admin());
drop policy if exists p_settings_read  on public.settings;        create policy p_settings_read  on public.settings        for select to anon, authenticated using (is_public or public.is_admin());
drop policy if exists p_zones_read     on public.delivery_zones;  create policy p_zones_read     on public.delivery_zones  for select to anon, authenticated using (active or public.is_admin());
drop policy if exists p_products_read  on public.products;        create policy p_products_read  on public.products        for select to authenticated using (public.is_admin());
drop policy if exists p_moves_read     on public.stock_movements; create policy p_moves_read     on public.stock_movements for select to authenticated using (public.is_admin());
drop policy if exists p_suppliers_read on public.suppliers;       create policy p_suppliers_read on public.suppliers       for select to authenticated using (public.is_admin());
drop policy if exists p_purch_read     on public.purchases;       create policy p_purch_read     on public.purchases       for select to authenticated using (public.is_admin());
drop policy if exists p_purchi_read    on public.purchase_items;  create policy p_purchi_read    on public.purchase_items  for select to authenticated using (public.is_admin());
drop policy if exists p_orders_read    on public.orders;          create policy p_orders_read    on public.orders          for select to authenticated using (public.is_admin());
drop policy if exists p_orderi_read    on public.order_items;     create policy p_orderi_read    on public.order_items     for select to authenticated using (public.is_admin());
drop policy if exists p_expenses_read  on public.expenses;        create policy p_expenses_read  on public.expenses        for select to authenticated using (public.is_admin());
drop policy if exists p_changes_read   on public.change_requests; create policy p_changes_read   on public.change_requests for select to authenticated using (public.is_owner() or requested_by = auth.uid());
drop policy if exists p_combos_read    on public.combos;          create policy p_combos_read    on public.combos          for select to authenticated using (public.is_admin());
drop policy if exists p_comboi_read    on public.combo_items;     create policy p_comboi_read    on public.combo_items     for select to authenticated using (public.is_admin());
drop policy if exists p_audit_read     on public.audit_log;       create policy p_audit_read     on public.audit_log       for select to authenticated using (public.is_owner());

-- ---------- 9. Permisos ------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.public_products, public.public_combos, public.delivery_zones, public.settings to anon, authenticated;
grant select on public.profiles, public.products, public.stock_movements, public.suppliers,
                public.purchases, public.purchase_items, public.orders, public.order_items,
                public.expenses, public.change_requests, public.audit_log, public.combos, public.combo_items to authenticated;

grant execute on function public.is_admin(), public.is_owner()                    to anon, authenticated;
grant execute on function public.effective_price(public.products)           to anon, authenticated;  -- la usan las vistas públicas
grant execute on function public.place_order(text, text, text, uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.submit_change(text, text, uuid, jsonb, text)     to authenticated;
grant execute on function public.review_change(uuid, boolean, text)               to authenticated;
grant execute on function public.set_order_status(uuid, text)                     to authenticated;
grant execute on function public.set_notify_config(text, text)                      to authenticated;
grant execute on function public.get_notify_status()                                to authenticated;
grant execute on function public.send_test_notification()                           to authenticated;
grant execute on function public.save_push_subscription(text, text, text)           to authenticated;
grant execute on function public.remove_push_subscription(text)                     to authenticated;
grant execute on function public.report_summary(date, date)                       to authenticated;

-- ---------- 10. Pedidos en tiempo real para el panel -----------------------

do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when others then null;
end $$;

-- ---------- 11. Fotos de productos (Storage) --------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 2097152, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/webp','image/jpeg','image/png'];

drop policy if exists productos_admin_insert on storage.objects;
create policy productos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'productos' and public.is_admin());
drop policy if exists productos_admin_update on storage.objects;
create policy productos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'productos' and public.is_admin())
  with check (bucket_id = 'productos' and public.is_admin());
drop policy if exists productos_admin_delete on storage.objects;
create policy productos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'productos' and public.is_owner());
