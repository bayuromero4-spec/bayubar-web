// BAYU BAR · envía la notificación push a los celulares de los administradores.
// La base de datos llama a esta función cuando entra un pedido nuevo.
// Secretos necesarios (Supabase → Edge Functions → Secrets):
//   NOTIFY_SECRET      clave inventada por ti (la misma que pones en Ajustes del panel)
//   VAPID_PUBLIC_KEY   clave pública (la misma que va en js/config.js)
//   VAPID_PRIVATE_KEY  clave privada (solo aquí, nunca en la página)
//   VAPID_SUBJECT      mailto:tu-correo@gmail.com
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (req.headers.get("x-notify-secret") !== Deno.env.get("NOTIFY_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  let payload: { title?: string; body?: string; url?: string };
  try { payload = await req.json(); } catch { return new Response("bad request", { status: 400 }); }

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: subs, error } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth");
  if (error) return new Response(error.message, { status: 500 });

  const msg = JSON.stringify({
    title: String(payload.title ?? "BAYU BAR").slice(0, 120),
    body: String(payload.body ?? "").slice(0, 300),
    url: String(payload.url ?? "admin.html#pedidos"),
  });
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, msg);
      sent++;
    } catch (e) {
      // 404/410: el celular ya no recibe avisos; se limpia la suscripción.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }));
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
