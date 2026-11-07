// BAYU BAR · Configuración
// Conexión al proyecto Supabase existente de BAYU BAR.
// La clave publishable es pública por diseño. Nunca uses service_role ni sb_secret aquí.
window.BAYU_CONFIG = {
  SUPABASE_URL: 'https://ffgubmxnnnjnapruiozz.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_JWmlQOYm_o0p1bVHhTpN4A_VJj0DKBY',
  // Solo se usa si la base de datos aún no responde:
  WHATSAPP: '51960577902',
  // Clave pública para avisos push. Déjala vacía si no usas push.
  VAPID_PUBLIC_KEY: ''
};
