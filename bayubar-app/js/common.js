// BAYU BAR · utilidades compartidas
(function () {
  'use strict';
  const cfg = window.BAYU_CONFIG || {};
  const configured = !!cfg.SUPABASE_URL && !/TU-PROYECTO/i.test(cfg.SUPABASE_URL) && !!cfg.SUPABASE_ANON_KEY && !/TU-ANON/i.test(cfg.SUPABASE_ANON_KEY);

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const TZ = 'America/Lima';
  const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('es-PE', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const fmtDate = (d) => {
    if (!d) return '';
    const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('es-PE', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  };
  const todayLima = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

  let client = null;
  function db(options) {
    if (client) return client;
    if (!configured || !window.supabase) return null;
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, options || {});
    return client;
  }

  function toast(msg, kind) {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, kind === 'err' ? 6000 : 3200);
  }

  // Mensaje legible a partir de un error de Supabase / red.
  function errMsg(e) {
    const m = (e && (e.message || e.error_description || e.details)) || '';
    if (!m) return 'Ocurrió un error. Inténtalo de nuevo.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No hay conexión con el servidor. Revisa tu internet e inténtalo otra vez.';
    if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/permission denied|row-level security/i.test(m)) return 'No tienes permiso para esta acción.';
    if (/JWT expired/i.test(m)) return 'Tu sesión venció. Vuelve a iniciar sesión.';
    if (/products_promo_check/.test(m)) return 'El precio de oferta debe ser menor al precio normal.';
    if (/violates check constraint/i.test(m)) return 'Revisa los datos: algún valor no es válido (por ejemplo un nombre muy corto o un número negativo).';
    if (/duplicate key value/i.test(m)) return 'Ya existe un registro con ese nombre.';
    return m;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* almacenamiento bloqueado */ } }
  };

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  window.BB = { cfg, configured, esc, money, fmtDateTime, fmtDate, todayLima, addDays, db, toast, errMsg, store, debounce, norm, TZ };
})();
