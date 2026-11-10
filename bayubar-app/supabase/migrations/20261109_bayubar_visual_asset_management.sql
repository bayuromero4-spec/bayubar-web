-- BAYU BAR · gestión segura de imágenes de portada de la tienda
create or replace function public.save_storefront_asset(p_key text, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_owner() then
    raise exception 'Solo el dueño puede cambiar las imágenes de la tienda.';
  end if;
  if p_key not in ('visual_combo_banner','visual_points_banner','visual_offers_banner') then
    raise exception 'Destino de imagen no válido.';
  end if;
  if p_url is null or length(p_url) > 2048 or p_url !~ '^https://[A-Za-z0-9.-]+/' then
    raise exception 'La dirección de la imagen no es válida.';
  end if;
  insert into public.settings(key,value,is_public,updated_at)
  values (p_key,to_jsonb(p_url),true,now())
  on conflict (key) do update
    set value=excluded.value,is_public=true,updated_at=now();
  return jsonb_build_object('ok',true,'key',p_key);
end;
$$;
revoke all on function public.save_storefront_asset(text,text) from public, anon;
grant execute on function public.save_storefront_asset(text,text) to authenticated;
