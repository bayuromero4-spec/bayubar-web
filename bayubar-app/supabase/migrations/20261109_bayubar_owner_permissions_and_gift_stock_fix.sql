-- BAYU BAR · permisos de módulos operativos y corrección de stock de regalos
-- Aplicada en Supabase producción el 2026-11-09.
begin;

do $$
declare t text;
begin
  foreach t in array array[
    'customers','loyalty_settings','loyalty_transactions','loyalty_rewards',
    'loyalty_redemptions','marketing_campaigns','marketing_campaign_events',
    'cash_sessions','cash_movements','delivery_assignments','store_locations',
    'bayu_promotion_redemptions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format('drop policy if exists %I on public.%I', 'bayu_promo_redemptions_admin', t);
    if t = 'bayu_promotion_redemptions' then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_owner())', t || '_owner_all', t);
    else
      execute format('create policy %I on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t || '_owner_all', t);
    end if;
  end loop;
end $$;

create or replace function public.redeem_loyalty_reward(p_phone text, p_reward uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare c public.customers%rowtype; r public.loyalty_rewards%rowtype; code text;
begin
  if not public.is_owner() then raise exception 'Solo el dueño puede canjear recompensas.'; end if;
  select * into c from public.customers
    where phone = regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g') for update;
  if not found then raise exception 'Cliente no encontrado.'; end if;
  select * into r from public.loyalty_rewards where id = p_reward and active for update;
  if not found or (r.max_redemptions is not null and r.redemptions_count >= r.max_redemptions) then
    raise exception 'Recompensa no disponible.';
  end if;
  if c.points_balance < r.points_cost then raise exception 'Puntos insuficientes.'; end if;
  code := 'BAYU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  update public.customers set points_balance = points_balance - r.points_cost, updated_at = now() where id = c.id;
  insert into public.loyalty_transactions(customer_id, points, kind, note)
    values(c.id, -r.points_cost, 'redeemed', 'Canje: ' || r.title || ' · ' || code);
  insert into public.loyalty_redemptions(customer_id, reward_id, points_spent, redemption_code)
    values(c.id, r.id, r.points_cost, code);
  update public.loyalty_rewards set redemptions_count = redemptions_count + 1 where id = r.id;
  return jsonb_build_object('code', code, 'reward', r.title, 'points_spent', r.points_cost);
end $$;
revoke all on function public.redeem_loyalty_reward(text, uuid) from public, anon;
grant execute on function public.redeem_loyalty_reward(text, uuid) to authenticated;

-- Stock del regalo: place_order ya descontó la compra; aquí se comprueba solo la cantidad de regalo.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'place_order'
    and pg_get_function_identity_arguments(p.oid) like '%p_ticket_code%';
  if v_def is null then raise exception 'No se encontró place_order con soporte para tickets.'; end if;
  if position('if v_gift.stock<coalesce(v_required,0)+v_promo.gift_qty then' in v_def) > 0 then
    execute replace(v_def,
      'if v_gift.stock<coalesce(v_required,0)+v_promo.gift_qty then',
      'if v_gift.stock<v_promo.gift_qty then');
  elsif position('if v_gift.stock<v_promo.gift_qty then' in v_def) = 0 then
    raise exception 'No se encontró la condición de stock esperada; se cancela la corrección.';
  end if;
end $$;

revoke all on function public.award_loyalty_points() from public, anon, authenticated;
commit;
