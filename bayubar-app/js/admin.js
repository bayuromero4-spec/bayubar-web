// BAYU BAR · panel de administración (dueño + ayudante)
// Todo cambio se envía con submit_change: el dueño lo aplica al instante,
// el ayudante lo deja pendiente hasta que el dueño lo apruebe.
(function () {
  'use strict';
  const { esc, money, fmtDateTime, fmtDate, todayLima, addDays, toast, errMsg, norm } = BB;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const sb = BB.db({ auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const A = { profile: null, d: {}, view: 'resumen', f: { orders: 'activos', prodQ: '', prodF: 'todos', moveKind: 'todos', expMonth: todayLima().slice(0, 7), rep: null }, channel: null, sound: null };
  const isOwner = () => !!A.profile && A.profile.role === 'owner';

  const STATUS = { nuevo: 'Nuevo', confirmado: 'Confirmado', en_camino: 'En camino', entregado: 'Entregado', cancelado: 'Cancelado', pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };
  const ENTITY = { product: 'Producto', stock_adjust: 'Ajuste de stock', purchase: 'Compra', expense: 'Gasto', zone: 'Zona de delivery', setting: 'Configuración', order_cancel: 'Cancelar pedido', combo: 'Combo' };
  const ACTION = { insert: 'Crear', update: 'Editar', delete: 'Eliminar' };
  const KIND = { compra: 'Compra', venta: 'Venta', ajuste: 'Ajuste', merma: 'Merma', devolucion: 'Devolución' };
  const FIELD = { name: 'Nombre', category: 'Categoría', size: 'Presentación', description: 'Descripción', price: 'Precio', cost: 'Costo', min_stock: 'Stock mínimo', image_url: 'Foto', active: 'Activo', initial_stock: 'Stock inicial', fee: 'Tarifa', spent_on: 'Fecha', amount: 'Monto', supplier: 'Proveedor', purchased_on: 'Fecha', note: 'Nota', qty: 'Cantidad', kind: 'Tipo', key: 'Ajuste', value: 'Valor', promo_price: 'Precio de oferta', promo_until: 'Oferta hasta', ends_on: 'Vigente hasta' };
  const SETTING_LABEL = { msg_confirmado: 'Mensaje: pedido confirmado', msg_en_camino: 'Mensaje: pedido en camino', msg_entregado: 'Mensaje: pedido entregado', free_delivery_enabled: 'Delivery gratis', free_delivery_min: 'Monto mínimo para delivery gratis', whatsapp: 'WhatsApp del negocio', store_name: 'Nombre del negocio' };
  const MONEY_FIELDS = ['price', 'cost', 'fee', 'amount', 'free_delivery_min', 'promo_price'];

  const pill = (s) => `<span class="status st-${esc(s)}">${esc(STATUS[s] || s)}</span>`;
  const num = (v) => Number(v) || 0;
  const peruPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 9 ? '51' + d : d; };
  const fmtVal = (k, v) => v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : MONEY_FIELDS.includes(k) && !isNaN(Number(v)) ? money(v) : k === 'image_url' ? 'Foto nueva' : String(v);
  const MSG_DEFAULT = {
    confirmado: 'Hola {nombre}, tu pedido {pedido} ha sido confirmado. Ya lo estamos preparando. Gracias por elegir BAYU BAR.',
    en_camino: 'Hola {nombre}, tu pedido {pedido} está en camino hacia tu dirección. ¡Gracias por esperar!',
    entregado: 'Hola {nombre}, tu pedido {pedido} fue entregado. Gracias por tu preferencia, ¡te esperamos pronto! BAYU BAR'
  };
  const MSG_LABEL = { confirmado: 'Pedido confirmado', en_camino: 'Pedido en camino', entregado: 'Pedido entregado' };
  function statusMessage(o, status) {
    const tpl = (A.d.settings && A.d.settings['msg_' + status]) || MSG_DEFAULT[status];
    const first = String(o.customer_name || '').trim().split(/\s+/)[0] || 'cliente';
    return String(tpl).replace(/\{nombre\}/g, first).replace(/\{pedido\}/g, o.number).replace(/\{total\}/g, money(o.total));
  }
  const waUrl = (phone, text) => `https://wa.me/${peruPhone(phone)}?text=${encodeURIComponent(text)}`;
  // Muestra el mensaje listo para enviar. El toque en "Abrir WhatsApp" lo hace la persona,
  // así el navegador nunca bloquea la ventana.
  function notifyCustomer(o, status) {
    const text = statusMessage(o, status);
    openForm({
      title: 'Avisar al cliente', ok: 'Listo',
      body: `<p style="color:var(--muted);margin-bottom:10px">${esc(MSG_LABEL[status])} · ${esc(o.customer_name)} (${esc(o.phone)})</p>
        <p style="padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.03);white-space:pre-wrap">${esc(text)}</p>
        <p style="margin-top:14px"><a class="btn ok" href="${esc(waUrl(o.phone, text))}" target="_blank" rel="noopener">Abrir WhatsApp con este mensaje</a></p>
        <p class="hint" style="margin-top:8px">Se abre el chat con el mensaje escrito; solo tocas Enviar.</p>`,
      submit: async () => {}
    });
  }
  const prodName = (id) => { const p = (A.d.products || []).find((x) => x.id === id); return p ? p.name : 'Producto'; };
  const nameOf = (uid) => { const p = (A.d.profiles || []).find((x) => x.id === uid); return p ? (p.full_name || p.email) : 'Usuario'; };

  // =================================================================== acceso
  function showSetup() { $('#loginView').hidden = false; $('#appView').hidden = true; $('#setupNotice').hidden = false; $('#loginForm').hidden = true; }
  function showLogin(msg) {
    $('#appView').hidden = true; $('#loginView').hidden = false; $('#loginForm').hidden = false; $('#setupNotice').hidden = true;
    const b = $('#loginError'); b.textContent = msg || ''; b.hidden = !msg;
    $('#lPass').value = '';
  }
  async function enter(user) {
    try {
      const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (error) throw error;
      if (!data || !data.active) { await sb.auth.signOut(); showLogin('Tu cuenta no tiene acceso al panel. Pide al dueño que te dé de alta.'); return; }
      A.profile = data;
      $('#loginView').hidden = true; $('#appView').hidden = false;
      $('#roleLabel').textContent = isOwner() ? 'DUEÑO' : 'AYUDANTE';
      $('#whoEmail').textContent = data.email;
      await loadCore();
      renderTabs(); route(); subscribe();
    } catch (e) { await sb.auth.signOut(); showLogin(errMsg(e)); }
  }
  $('#loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('#lEmail').value.trim(); const pass = $('#lPass').value;
    if (!email || !pass) { showLogin('Escribe tu correo y tu contraseña.'); return; }
    const btn = $('#loginBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Entrando…';
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    btn.disabled = false; btn.textContent = 'Entrar';
    if (error) { showLogin(errMsg(error)); return; }
    $('#loginError').hidden = true;
    await enter(data.user);
  });
  $('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); });
  $('#pwdBtn').addEventListener('click', () => openForm({
    title: 'Cambiar contraseña', ok: 'Cambiar',
    body: `<label class="field">Nueva contraseña<input id="np1" type="password" autocomplete="new-password" minlength="8" required></label>
           <label class="field">Repite la contraseña<input id="np2" type="password" autocomplete="new-password" minlength="8" required></label>
           <p class="note" style="font-size:12px;color:var(--faint)">Mínimo 8 caracteres.</p>`,
    submit: async () => {
      const a = $('#np1').value; const b = $('#np2').value;
      if (a.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      if (a !== b) throw new Error('Las contraseñas no coinciden.');
      const { error } = await sb.auth.updateUser({ password: a }); if (error) throw error;
      toast('Contraseña actualizada.', 'ok');
    }
  }));

  // =================================================================== datos
  async function q(promise) { const { data, error } = await promise; if (error) throw error; return data || []; }
  async function loadCore() {
    const [products, orders, requests, zones, settings, profiles, combos, promotions] = await Promise.all([
      q(sb.from('products').select('*').order('name')),
      q(sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(300)),
      q(sb.from('change_requests').select('*').order('requested_at', { ascending: false }).limit(200)),
      q(sb.from('delivery_zones').select('*').order('name')),
      q(sb.from('settings').select('key,value')),
      q(sb.from('profiles').select('id,email,full_name,role,active')),
      q(sb.from('combos').select('*, combo_items(product_id, qty)').order('name')),
      q(sb.from('bayu_promotions').select('*').order('created_at', { ascending: false }))
    ]);
    A.d.promotions = promotions; A.d.combos = combos; A.d.products = products; A.d.orders = orders; A.d.requests = requests; A.d.zones = zones; A.d.profiles = profiles;
    A.d.settings = {}; settings.forEach((r) => { A.d.settings[r.key] = r.value; });
  }
  const pendingCount = () => (A.d.requests || []).filter((r) => r.status === 'pendiente').length;
  const newOrders = () => (A.d.orders || []).filter((o) => o.status === 'nuevo').length;

  async function submit(entity, action, target, payload, summary) {
    const { data, error } = await sb.rpc('submit_change', { p_entity: entity, p_action: action, p_target: target || null, p_payload: payload || {}, p_summary: summary || null });
    if (error) throw error;
    toast(data.status === 'aprobado' ? 'Guardado.' : 'Enviado al dueño para su aprobación.', 'ok');
    await loadCore(); renderTabs();
    return data;
  }

  // =================================================================== tiempo real
  function beep() {
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      A.sound = A.sound || new C(); const o = A.sound.createOscillator(); const g = A.sound.createGain();
      o.connect(g); g.connect(A.sound.destination); o.frequency.value = 880; g.gain.value = 0.06; o.start(); o.stop(A.sound.currentTime + 0.18);
    } catch (_) { /* el navegador bloqueó el audio */ }
  }
  function subscribe() {
    if (A.channel) return;
    A.channel = sb.channel('orders-live').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (p) => {
      toast(`Nuevo pedido ${p.new && p.new.number ? p.new.number : ''}`, 'ok'); beep();
      try { await loadCore(); renderTabs(); if (['pedidos', 'resumen', 'inventario'].includes(A.view)) show(A.view, true); } catch (_) { /* se reintenta al navegar */ }
    }).subscribe();
  }
  sb && sb.auth.onAuthStateChange((ev) => {
    if (ev === 'SIGNED_OUT' && A.profile) {
      A.profile = null; A.d = {}; if (A.channel) { sb.removeChannel(A.channel); A.channel = null; }
      showLogin();
    }
  });

  // =================================================================== navegación
  const VIEWS = [
    ['resumen', 'Resumen'], ['pedidos', 'Pedidos'], ['productos', 'Productos'], ['promos', 'Combos y promos'], ['inventario', 'Inventario'],
    ['compras', 'Compras'], ['gastos', 'Gastos'], ['clientes', 'Clientes y puntos'], ['marketing', 'Marketing'], ['caja', 'Caja'], ['delivery', 'Repartos'], ['sedes', 'Sedes', true], ['reportes', 'Reportes', true], ['aprobaciones', 'Aprobaciones'], ['ajustes', 'Ajustes']
  ];
  function renderTabs() {
    $('#tabs').innerHTML = VIEWS.filter((v) => !v[2] || isOwner()).map(([id, label]) => {
      const n = id === 'pedidos' ? newOrders() : id === 'aprobaciones' && isOwner() ? pendingCount() : 0;
      const text = id === 'aprobaciones' && !isOwner() ? 'Mis solicitudes' : label;
      return `<button class="tab" type="button" data-go="${id}" ${A.view === id ? 'aria-current="page"' : ''}>${esc(text)}${n ? `<span class="pip">${n}</span>` : ''}</button>`;
    }).join('');
  }
  function route() {
    let v = (location.hash || '').replace('#', '') || 'resumen';
    if (!VIEWS.some((x) => x[0] === v) || (v === 'reportes' && !isOwner())) v = 'resumen';
    show(v);
  }
  window.addEventListener('hashchange', () => { if (A.profile) route(); });
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) { location.hash = b.dataset.go; if (A.view === b.dataset.go) show(b.dataset.go, true); } });

  let showToken = 0;
  async function show(view, keepScroll) {
    A.view = view; renderTabs();
    const token = ++showToken; const y = window.scrollY;
    const box = $('#view');
    if (!keepScroll) box.innerHTML = '<p class="empty-state"><span class="spinner"></span></p>';
    try {
      const html = await VIEW[view]();
      if (token !== showToken) return;
      box.innerHTML = (isOwner() ? '' : '<div class="banner">Tus cambios no se aplican al instante: se envían al dueño y él los aprueba o rechaza.</div>') + html;
      if (VIEW_AFTER[view]) VIEW_AFTER[view]();
      if (keepScroll) window.scrollTo(0, y); else { window.scrollTo(0, 0); }
    } catch (e) {
      if (token !== showToken) return;
      box.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div><p style="margin-top:14px"><button class="btn" data-act="reload" type="button">Reintentar</button></p>`;
    }
  }
  const reload = () => show(A.view, true);

  // =================================================================== diálogo genérico
  const modal = $('#modal');
  let modalSubmit = null;
  function openForm({ title, body, ok, submit: fn, wide }) {
    $('#modalTitle').textContent = title; $('#modalBody').innerHTML = body;
    $('#modalOk').textContent = ok || 'Guardar'; $('#modalOk').disabled = false;
    $('#modalError').hidden = true; modalSubmit = fn; modal.style.width = wide ? 'min(680px,calc(100vw - 24px))' : '';
    modal.showModal();
    const first = $('#modalBody input:not([type=hidden]),#modalBody select,#modalBody textarea'); if (first) first.focus();
  }
  $('#modalForm').addEventListener('submit', async (ev) => {
    ev.preventDefault(); if (!modalSubmit) return;
    const btn = $('#modalOk'); const label = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; $('#modalError').hidden = true;
    try { await modalSubmit(); modal.close(); await reload(); }
    catch (e) { const b = $('#modalError'); b.textContent = errMsg(e); b.hidden = false; b.scrollIntoView({ block: 'nearest' }); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
  $('#modalBody').addEventListener('input', () => { $('#modalError').hidden = true; });
  $('#modalCancel').addEventListener('click', () => modal.close());
  $('#modalX').addEventListener('click', () => modal.close());
  function confirmBox({ title, text, ok, danger, field }) {
    return new Promise((resolve) => {
      openForm({
        title, ok: ok || 'Confirmar',
        body: `<p style="color:var(--muted)">${esc(text)}</p>${field ? `<label class="field">${esc(field)}<input id="cfField" type="text" maxlength="150"></label>` : ''}`,
        submit: async () => { resolve({ ok: true, text: field ? $('#cfField').value.trim() : '' }); }
      });
      if (danger) $('#modalOk').classList.add('danger'); else $('#modalOk').classList.remove('danger');
      modal.addEventListener('close', () => resolve({ ok: false }), { once: true });
    });
  }

  // =================================================================== RESUMEN
  const VIEW = {}; const VIEW_AFTER = {};
  VIEW.resumen = async function () {
    const P = A.d.products; const low = P.filter((p) => p.active && p.stock > 0 && p.stock <= p.min_stock); const out = P.filter((p) => p.active && p.stock === 0);
    const active = A.d.orders.filter((o) => ['nuevo', 'confirmado', 'en_camino'].includes(o.status));
    let money1 = '';
    if (isOwner()) {
      const t = todayLima(); const r = await sb.rpc('report_summary', { p_from: t, p_to: t }); if (r.error) throw r.error;
      const x = r.data; const net = num(x.sales) - num(x.cogs) - num(x.expenses);
      money1 = `<div class="kpis">
        <div class="kpi"><span>Ventas de hoy</span><b class="num">${money(x.sales)}</b><small>${x.orders} pedido(s) entregado(s)</small></div>
        <div class="kpi ${net >= 0 ? 'good' : 'bad'}"><span>Ganancia neta de hoy</span><b class="num">${money(net)}</b><small>Ventas − costo − gastos</small></div>
        <div class="kpi"><span>Gastos de hoy</span><b class="num">${money(x.expenses)}</b></div>
        <div class="kpi"><span>Por cobrar (en curso)</span><b class="num">${money(x.pending_sales)}</b><small>Pedidos aún no entregados</small></div></div>`;
    }
    const pend = pendingCount();
    return `<div class="vhead"><div><h2 class="dis">Resumen</h2><p class="sub">Hoy, ${fmtDate(todayLima())}</p></div></div>
      ${money1}
      <div class="kpis">
        <div class="kpi ${newOrders() ? 'warn' : ''}"><span>Pedidos nuevos</span><b class="num">${newOrders()}</b><small>Esperan confirmación</small></div>
        <div class="kpi"><span>Pedidos en curso</span><b class="num">${active.length}</b><small>Nuevos, confirmados o en camino</small></div>
        <div class="kpi ${low.length ? 'warn' : ''}"><span>Stock bajo</span><b class="num">${low.length}</b></div>
        <div class="kpi ${out.length ? 'bad' : ''}"><span>Agotados</span><b class="num">${out.length}</b></div>
        <div class="kpi ${pend ? 'warn' : ''}"><span>${isOwner() ? 'Cambios por aprobar' : 'Mis solicitudes pendientes'}</span><b class="num">${isOwner() ? pend : (A.d.requests.filter((r) => r.status === 'pendiente' && r.requested_by === A.profile.id).length)}</b></div>
      </div>
      <div class="cols">
        <section class="panel"><h3>Pedidos que necesitan atención</h3>${active.length ? `<div class="list">${active.slice(0, 6).map((o) => `<div class="item"><div class="main"><b>${esc(o.number)} · ${esc(o.customer_name)}</b><small>${esc(fmtDateTime(o.created_at))} · ${esc(o.zone_name || '')}</small></div>${pill(o.status)}<b class="num">${money(o.total)}</b></div>`).join('')}</div><p style="margin-top:12px"><button class="btn ghost sm" data-go="pedidos" type="button">Ver todos los pedidos</button></p>` : '<p class="empty-state">No hay pedidos en curso.</p>'}</section>
        <section class="panel"><h3>Productos por reponer</h3>${(low.length + out.length) ? `<div class="list">${[...out, ...low].slice(0, 8).map((p) => `<div class="item"><div class="main"><b>${esc(p.name)}</b><small>${esc(p.size || '')} · mínimo ${p.min_stock}</small></div><b class="${p.stock === 0 ? 'zero' : 'low'} num">${p.stock === 0 ? 'Agotado' : p.stock + ' u.'}</b></div>`).join('')}</div><p style="margin-top:12px"><button class="btn ghost sm" data-go="compras" type="button">Registrar una compra</button></p>` : '<p class="empty-state">Todo el inventario está sobre su mínimo.</p>'}</section>
      </div>`;
  };

  // =================================================================== PEDIDOS
  VIEW.pedidos = async function () {
    const O = A.d.orders; const f = A.f.orders;
    const groups = { activos: ['nuevo', 'confirmado', 'en_camino'], entregados: ['entregado'], cancelados: ['cancelado'] };
    const list = f === 'todos' ? O : O.filter((o) => groups[f].includes(o.status));
    const chip = (k, label) => `<button class="chip" type="button" data-orderf="${k}" aria-pressed="${f === k}">${label} (${k === 'todos' ? O.length : O.filter((o) => groups[k].includes(o.status)).length})</button>`;
    const NEXT = { nuevo: ['confirmado', 'Confirmar'], confirmado: ['en_camino', 'Salió a entregar'], en_camino: ['entregado', 'Marcar entregado'] };
    return `<div class="vhead"><div><h2 class="dis">Pedidos</h2><p class="sub">Los pedidos nuevos aparecen solos y suena un aviso.</p></div></div>
      <div class="chips">${chip('activos', 'En curso')}${chip('entregados', 'Entregados')}${chip('cancelados', 'Cancelados')}${chip('todos', 'Todos')}</div>
      ${list.length ? list.map((o) => {
        const nx = NEXT[o.status]; const items = (o.order_items || []);
        return `<article class="order ${o.status === 'nuevo' ? 'new' : ''}">
          <div class="order-top"><b>${esc(o.number)}</b>${pill(o.status)}<span style="color:var(--muted);font-size:14px">${esc(fmtDateTime(o.created_at))}</span></div>
          <div class="order-meta"><span>Cliente: <b>${esc(o.customer_name)}</b></span><span>Celular: <b><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></b></span><span>Zona: <b>${esc(o.zone_name || '—')}</b></span><span>Pago: <b>${esc(o.payment)}</b></span><span style="grid-column:1/-1">Dirección: <b>${esc(o.address)}</b></span>${o.note ? `<span style="grid-column:1/-1">Indicaciones: <b>${esc(o.note)}</b></span>` : ''}</div>
          <ul class="order-items">${items.map((i) => `<li><span>${i.qty} × ${esc(i.product_name)}${i.is_gift ? ' · REGALO' : ''}</span><span class="num">${i.is_gift ? 'GRATIS' : money(i.qty * i.unit_price)}</span></li>`).join('')}
            <li style="color:var(--muted)"><span>Delivery</span><span class="num">${num(o.delivery_fee) === 0 ? 'Gratis' : money(o.delivery_fee)}</span></li></ul>
          <div class="order-foot"><b class="num" style="font-size:20px">Total ${money(o.total)}</b>
            <div class="btns">
              <a class="btn ghost sm" href="https://wa.me/${esc(peruPhone(o.phone))}?text=${encodeURIComponent('Hola ' + o.customer_name + ', te escribimos de BAYU BAR por tu pedido ' + o.number + '.')}" target="_blank" rel="noopener">WhatsApp</a>
              ${nx ? `<button class="btn sm ok" type="button" data-act="orderstatus" data-id="${esc(o.id)}" data-to="${nx[0]}">${nx[1]}</button>` : ''}
              ${['confirmado', 'en_camino', 'entregado'].includes(o.status) ? `<button class="btn sm ghost" type="button" data-act="notifycust" data-id="${esc(o.id)}">Avisar por WhatsApp</button>` : ''}
              ${['nuevo', 'confirmado', 'en_camino'].includes(o.status) ? `<button class="btn sm danger" type="button" data-act="ordercancel" data-id="${esc(o.id)}">Cancelar</button>` : ''}
            </div></div></article>`;
      }).join('') : '<p class="empty-state">No hay pedidos en esta lista.</p>'}`;
  };

  // =================================================================== PRODUCTOS
  const promoOn = (p) => p.promo_price !== null && p.promo_price !== undefined && (!p.promo_until || p.promo_until >= todayLima());
  VIEW.productos = async function () {
    const P = A.d.products; const qn = norm(A.f.prodQ); const flt = A.f.prodF;
    const list = P.filter((p) => (!qn || norm(p.name + ' ' + p.category).includes(qn)) && (flt === 'todos' ? p.active : flt === 'bajo' ? p.active && p.stock <= p.min_stock : !p.active));
    const chip = (k, l) => `<button class="chip" type="button" data-prodf="${k}" aria-pressed="${flt === k}">${l}</button>`;
    return `<div class="vhead"><div><h2 class="dis">Productos</h2><p class="sub">${P.filter((p) => p.active).length} activos · ${P.filter((p) => !p.active).length} archivados</p></div>
        <div class="tools"><label class="field"><span class="sr-only">Buscar</span><input id="prodSearch" type="search" placeholder="Buscar producto…" value="${esc(A.f.prodQ)}"></label><button class="btn" type="button" data-act="prodnew">+ Nuevo producto</button></div></div>
      <div class="chips">${chip('todos', 'Activos')}${chip('bajo', 'Stock bajo')}${chip('archivados', 'Archivados')}</div>
      <section class="panel">${list.length ? list.map((p) => {
        const margin = num(p.price) > 0 ? Math.round(((num(p.price) - num(p.cost)) / num(p.price)) * 100) : 0;
        return `<div class="prod">${p.image_url && /^https?:/.test(p.image_url) ? `<img class="thumb" src="${esc(p.image_url)}" alt="" loading="lazy" width="56" height="56">` : '<span class="thumb">Sin foto</span>'}
          <div class="main"><b>${esc(p.name)}</b><small>${esc([p.size, p.category].filter(Boolean).join(' · '))}${p.active ? '' : ' · Archivado'}${promoOn(p) ? ' · En oferta ' + money(p.promo_price) : ''}</small></div>
          <div class="nums"><div><span>Precio</span><b class="num">${money(p.price)}</b></div><div><span>Costo</span><b class="num">${money(p.cost)}</b></div><div><span>Margen</span><b class="num">${margin}%</b></div><div><span>Stock</span><b class="num ${p.stock === 0 ? 'zero' : p.stock <= p.min_stock ? 'low' : ''}">${p.stock}</b></div></div>
          <div class="btns"><button class="btn ghost sm" type="button" data-act="prodedit" data-id="${esc(p.id)}">Editar</button><button class="btn ghost sm" type="button" data-act="stockadj" data-id="${esc(p.id)}">Ajustar stock</button>
          <button class="btn ghost sm" type="button" data-act="prodtoggle" data-id="${esc(p.id)}">${p.active ? 'Archivar' : 'Reactivar'}</button></div></div>`;
      }).join('') : '<p class="empty-state">No hay productos en esta lista. Crea el primero con “Nuevo producto”.</p>'}</section>`;
  };
  VIEW_AFTER.productos = function () {
    const s = $('#prodSearch');
    s.addEventListener('input', BB.debounce(() => { A.f.prodQ = s.value; show('productos', true).then(() => { const n = $('#prodSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 200));
  };

  // reducir y subir foto
  async function shrinkImage(file, maxSize = 900) {
    if (!/^image\//.test(file.type)) throw new Error('El archivo debe ser una imagen.');
    const bmp = await createImageBitmap(file).catch(() => { throw new Error('No se pudo leer la imagen. Prueba con JPG o PNG.'); });
    const max = maxSize; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error('No se pudo procesar la imagen.');
    return blob;
  }
  async function uploadImage(file, maxSize = 900) {
    const blob = await shrinkImage(file, maxSize);
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('productos').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
    if (error) throw error;
    return sb.storage.from('productos').getPublicUrl(path).data.publicUrl;
  }

  function productForm(p) {
    const cats = Array.from(new Set(['Cervezas', 'Ron y whisky', 'Vinos', 'Pisco y vodka', 'Gaseosas', 'Extras', ...A.d.products.map((x) => x.category)]));
    const isNew = !p; let imageUrl = p ? (p.image_url || '') : '';
    openForm({
      title: isNew ? 'Nuevo producto' : 'Editar producto', ok: isNew ? 'Crear producto' : 'Guardar cambios', wide: true,
      body: `<label class="field">Nombre<input id="pName" type="text" maxlength="120" required value="${esc(p ? p.name : '')}" placeholder="Ej. Ron añejo"></label>
        <div class="grid2"><label class="field">Categoría<input id="pCat" list="catList" maxlength="40" value="${esc(p ? p.category : '')}" placeholder="Ej. Ron y whisky"></label>
        <label class="field">Presentación<input id="pSize" type="text" maxlength="40" value="${esc(p ? p.size || '' : '')}" placeholder="Ej. 750 ml"></label></div>
        <datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="grid2"><label class="field">Precio de venta (S/)<input id="pPrice" type="number" inputmode="decimal" min="0" step="0.01" required value="${p ? num(p.price) : ''}"></label>
        <label class="field">Costo (S/)<input id="pCost" type="number" inputmode="decimal" min="0" step="0.01" value="${p ? num(p.cost) : ''}"><span class="hint">Lo que te cuesta a ti. Se usa para calcular la ganancia.</span></label></div>
        <div class="grid2">${isNew ? `<label class="field">Stock inicial<input id="pStock" type="number" inputmode="numeric" min="0" step="1" value="0"></label>` : ''}
        <label class="field">Avisar cuando queden<input id="pMin" type="number" inputmode="numeric" min="0" step="1" value="${p ? p.min_stock : 3}"></label></div>
        <label class="field">Descripción (opcional)<textarea id="pDesc" maxlength="300">${esc(p ? p.description || '' : '')}</textarea></label>
        <div class="field">Foto
          <div class="imgbox"><span class="thumb" id="pThumb">${imageUrl ? `<img src="${esc(imageUrl)}" alt="" width="84" height="84" style="width:100%;height:100%;object-fit:cover">` : 'Sin foto'}</span>
          <div><input id="pFile" type="file" accept="image/*"><span class="hint" id="pFileHint">Se reduce automáticamente para que la tienda cargue rápido.</span></div></div></div>
        ${isNew ? '' : ''}`,
      submit: async () => {
        const fileEl = $('#pFile');
        if (fileEl.files[0]) { $('#pFileHint').textContent = 'Subiendo foto…'; imageUrl = await uploadImage(fileEl.files[0]); }
        const name = $('#pName').value.trim(); const price = Number($('#pPrice').value); const cost = $('#pCost').value === '' ? 0 : Number($('#pCost').value);
        const min = $('#pMin').value === '' ? 3 : Number($('#pMin').value);
        if (name.length < 2) throw new Error('Escribe el nombre del producto.');
        if (!isFinite(price) || price < 0 || $('#pPrice').value === '') throw new Error('Escribe un precio válido.');
        if (!isFinite(cost) || cost < 0) throw new Error('El costo no es válido.');
        if (!Number.isInteger(min) || min < 0) throw new Error('El stock mínimo debe ser un número entero.');
        const next = { name, category: $('#pCat').value.trim() || 'General', size: $('#pSize').value.trim(), description: $('#pDesc').value.trim(), price, cost, min_stock: min, image_url: imageUrl };
        if (isNew) {
          const st = Number($('#pStock').value || 0);
          if (!Number.isInteger(st) || st < 0) throw new Error('El stock inicial debe ser un número entero.');
          await submit('product', 'insert', null, { ...next, initial_stock: st, active: true }, `Producto nuevo: ${name} · ${money(price)} · stock inicial ${st}`);
        } else {
          const diff = {}; const parts = [];
          Object.keys(next).forEach((k) => { const before = p[k] ?? ''; const now = next[k] ?? ''; if (String(before) !== String(now)) { diff[k] = next[k]; parts.push(`${FIELD[k]}: ${fmtVal(k, before)} → ${fmtVal(k, now)}`); } });
          if (!parts.length) throw new Error('No hay cambios para guardar.');
          await submit('product', 'update', p.id, diff, `Editar "${p.name}": ${parts.join('; ')}`);
        }
      }
    });
  }

  function stockForm(p) {
    openForm({
      title: `Ajustar stock · ${p.name}`, ok: 'Registrar ajuste',
      body: `<p style="color:var(--muted)">Stock actual: <b class="num" style="color:var(--text)">${p.stock}</b></p>
        <label class="field">Tipo<select id="sKind"><option value="ajuste">Corrección de inventario (conteo)</option><option value="merma">Merma (rotura, vencimiento, pérdida)</option></select></label>
        <label class="field">Cantidad<input id="sQty" type="number" inputmode="numeric" step="1" required placeholder="Ej. 5 para sumar, -2 para restar"><span class="hint" id="sHint"></span></label>
        <label class="field">Motivo<input id="sNote" type="text" maxlength="150" placeholder="Ej. conteo del sábado"></label>`,
      submit: async () => {
        const kind = $('#sKind').value; let qty = Number($('#sQty').value);
        if (!Number.isInteger(qty) || qty === 0) throw new Error('Escribe una cantidad entera distinta de 0.');
        if (kind === 'merma') qty = -Math.abs(qty);
        if (p.stock + qty < 0) throw new Error(`El stock no puede quedar negativo (stock actual: ${p.stock}).`);
        const note = $('#sNote').value.trim();
        await submit('stock_adjust', 'insert', null, { product_id: p.id, qty, kind, note }, `${KIND[kind]} en "${p.name}": ${qty > 0 ? '+' : ''}${qty} (stock ${p.stock} → ${p.stock + qty})${note ? ' · ' + note : ''}`);
      }
    });
    $('#sKind').addEventListener('change', () => { $('#sHint').textContent = $('#sKind').value === 'merma' ? 'Escribe cuántas unidades se perdieron; se restan solas.' : ''; });
  }

  // =================================================================== INVENTARIO
  VIEW.inventario = async function () {
    const P = A.d.products.filter((p) => p.active);
    const mv = await q(sb.from('stock_movements').select('*, products(name)').order('id', { ascending: false }).limit(200));
    const kf = A.f.moveKind; const rows = kf === 'todos' ? mv : mv.filter((m) => m.kind === kf);
    const value = P.reduce((t, p) => t + p.stock * num(p.cost), 0); const units = P.reduce((t, p) => t + p.stock, 0);
    const chip = (k, l) => `<button class="chip" type="button" data-movef="${k}" aria-pressed="${kf === k}">${l}</button>`;
    return `<div class="vhead"><div><h2 class="dis">Inventario</h2><p class="sub">Entradas y salidas de mercadería. El stock se mueve solo con ventas, compras y ajustes.</p></div><button class="btn" type="button" data-act="stockpick">Ajustar stock</button></div>
      <div class="kpis"><div class="kpi"><span>Unidades en stock</span><b class="num">${units}</b></div>${isOwner() ? `<div class="kpi"><span>Valor del inventario (a costo)</span><b class="num">${money(value)}</b></div>` : ''}
        <div class="kpi ${P.filter((p) => p.stock <= p.min_stock).length ? 'warn' : ''}"><span>Por reponer</span><b class="num">${P.filter((p) => p.stock <= p.min_stock).length}</b></div></div>
      <section class="panel"><h3>Stock actual</h3><div class="tscroll"><table class="t"><thead><tr><th>Producto</th><th class="r">Stock</th><th class="r">Mínimo</th><th>Estado</th></tr></thead><tbody>${P.map((p) => `<tr><td>${esc(p.name)} <span style="color:var(--faint)">${esc(p.size || '')}</span></td><td class="r num">${p.stock}</td><td class="r num">${p.min_stock}</td><td>${p.stock === 0 ? '<span class="zero">Agotado</span>' : p.stock <= p.min_stock ? '<span class="low">Reponer</span>' : 'Normal'}</td></tr>`).join('') || '<tr><td colspan="4" style="white-space:normal;color:var(--muted)">Aún no hay productos.</td></tr>'}</tbody></table></div></section>
      <section class="panel"><h3>Movimientos recientes</h3><div class="chips">${chip('todos', 'Todos')}${Object.keys(KIND).map((k) => chip(k, KIND[k] + 's')).join('')}</div>
        <div class="tscroll"><table class="t"><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th class="r">Entrada</th><th class="r">Salida</th><th>Detalle</th></tr></thead><tbody>${rows.map((m) => `<tr><td>${esc(fmtDateTime(m.created_at))}</td><td>${esc(m.products ? m.products.name : '')}</td><td>${esc(KIND[m.kind] || m.kind)}</td><td class="r num">${m.qty > 0 ? '+' + m.qty : ''}</td><td class="r num">${m.qty < 0 ? m.qty : ''}</td><td style="white-space:normal">${esc([m.ref, m.note].filter(Boolean).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="6" style="white-space:normal;color:var(--muted)">Sin movimientos.</td></tr>'}</tbody></table></div></section>`;
  };

  // =================================================================== COMPRAS
  VIEW.compras = async function () {
    const [purchases, sup] = await Promise.all([
      q(sb.from('purchases').select('*, suppliers(name), purchase_items(qty,unit_cost,products(name))').order('purchased_on', { ascending: false }).order('created_at', { ascending: false }).limit(100)),
      q(sb.from('suppliers').select('name').order('name'))
    ]);
    A.d.suppliers = sup;
    const total = purchases.reduce((t, p) => t + num(p.total), 0);
    return `<div class="vhead"><div><h2 class="dis">Compras a proveedores</h2><p class="sub">Cada compra suma stock y actualiza el costo del producto.</p></div><button class="btn" type="button" data-act="purchasenew">+ Registrar compra</button></div>
      <div class="kpis"><div class="kpi"><span>Compras registradas (últimas ${purchases.length})</span><b class="num">${money(total)}</b></div></div>
      ${purchases.length ? purchases.map((p) => `<article class="panel"><div class="item" style="padding-top:0"><div class="main"><b>${esc(p.suppliers ? p.suppliers.name : 'Sin proveedor')}</b><small>${esc(fmtDate(p.purchased_on))}${p.note ? ' · ' + esc(p.note) : ''}</small></div><b class="num" style="font-size:20px">${money(p.total)}</b></div>
        <ul class="order-items">${(p.purchase_items || []).map((i) => `<li><span>${i.qty} × ${esc(i.products ? i.products.name : 'Producto')}</span><span class="num">${money(i.qty * i.unit_cost)} <span style="color:var(--faint)">(${money(i.unit_cost)} c/u)</span></span></li>`).join('')}</ul></article>`).join('') : '<p class="empty-state">Todavía no registraste compras.</p>'}`;
  };
  function purchaseForm() {
    const prods = A.d.products.filter((p) => p.active);
    if (!prods.length) { toast('Primero crea al menos un producto.', 'err'); return; }
    const rowHtml = () => `<div class="rowline"><label class="field">Producto<select class="rP">${prods.map((p) => `<option value="${esc(p.id)}" data-cost="${num(p.cost)}">${esc(p.name)} ${esc(p.size || '')}</option>`).join('')}</select></label>
      <label class="field">Cantidad<input class="rQ" type="number" inputmode="numeric" min="1" step="1" value="1"></label>
      <label class="field">Costo c/u (S/)<input class="rC" type="number" inputmode="decimal" min="0" step="0.01" value="${num(prods[0].cost)}"></label>
      <button class="xbtn rX" type="button" aria-label="Quitar producto">×</button></div>`;
    openForm({
      title: 'Registrar compra', ok: 'Registrar compra', wide: true,
      body: `<div class="grid2"><label class="field">Proveedor<input id="cSup" list="supList" type="text" maxlength="80" placeholder="Nombre del proveedor"></label><label class="field">Fecha<input id="cDate" type="date" value="${todayLima()}" max="${todayLima()}"></label></div>
        <datalist id="supList">${(A.d.suppliers || []).map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>
        <div id="cRows">${rowHtml()}</div>
        <button class="btn ghost sm" id="cAdd" type="button" style="align-self:flex-start">+ Agregar otro producto</button>
        <label class="field">Nota (opcional)<input id="cNote" type="text" maxlength="150" placeholder="Ej. factura 001-234"></label>
        <div class="row" style="display:flex;justify-content:space-between;font-size:18px"><span>Total</span><b class="num" id="cTotal">S/ 0.00</b></div>`,
      submit: async () => {
        const items = $$('#cRows .rowline').map((r) => ({ product_id: $('.rP', r).value, qty: Number($('.rQ', r).value), unit_cost: Number($('.rC', r).value) }));
        if (!items.length) throw new Error('Agrega al menos un producto.');
        for (const i of items) {
          if (!Number.isInteger(i.qty) || i.qty < 1) throw new Error('Cada producto necesita una cantidad entera mayor a 0.');
          if (!isFinite(i.unit_cost) || i.unit_cost < 0) throw new Error('Revisa los costos unitarios.');
        }
        const sup = $('#cSup').value.trim(); const total = items.reduce((t, i) => t + i.qty * i.unit_cost, 0);
        await submit('purchase', 'insert', null, { supplier: sup, purchased_on: $('#cDate').value, note: $('#cNote').value.trim(), items },
          `Compra${sup ? ' a ' + sup : ''}: ${items.map((i) => `${i.qty} × ${prodName(i.product_id)}`).join(', ')} · total ${money(total)}`);
      }
    });
    const recalc = () => { $('#cTotal').textContent = money($$('#cRows .rowline').reduce((t, r) => t + num($('.rQ', r).value) * num($('.rC', r).value), 0)); };
    $('#cRows').addEventListener('input', recalc);
    $('#cRows').addEventListener('change', (e) => { if (e.target.classList.contains('rP')) { const r = e.target.closest('.rowline'); $('.rC', r).value = e.target.selectedOptions[0].dataset.cost; recalc(); } });
    $('#cRows').addEventListener('click', (e) => { if (e.target.closest('.rX') && $$('#cRows .rowline').length > 1) { e.target.closest('.rowline').remove(); recalc(); } });
    $('#cAdd').addEventListener('click', () => { $('#cRows').insertAdjacentHTML('beforeend', rowHtml()); recalc(); });
    recalc();
  }

  // =================================================================== GASTOS
  const EXP_CATS = ['Alquiler', 'Servicios (luz, agua, internet)', 'Sueldos', 'Transporte y delivery', 'Publicidad', 'Mantenimiento', 'Impuestos', 'Otros'];
  VIEW.gastos = async function () {
    const m = A.f.expMonth; const from = m + '-01'; const to = addDays(addMonth(m), -1);
    const rows = await q(sb.from('expenses').select('*').gte('spent_on', from).lte('spent_on', to).order('spent_on', { ascending: false }).order('created_at', { ascending: false }));
    const total = rows.reduce((t, r) => t + num(r.amount), 0);
    const byCat = {}; rows.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + num(r.amount); });
    return `<div class="vhead"><div><h2 class="dis">Gastos</h2><p class="sub">Alquiler, servicios, sueldos y todo lo que sale del negocio.</p></div>
        <div class="tools"><label class="field"><span class="sr-only">Mes</span><input id="expMonth" type="month" value="${esc(m)}"></label><button class="btn" type="button" data-act="expnew">+ Registrar gasto</button></div></div>
      <div class="kpis"><div class="kpi"><span>Total del mes</span><b class="num">${money(total)}</b><small>${rows.length} gasto(s)</small></div>${Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).slice(0, 3).map((c) => `<div class="kpi"><span>${esc(c)}</span><b class="num">${money(byCat[c])}</b></div>`).join('')}</div>
      <section class="panel">${rows.length ? `<div class="list">${rows.map((r) => `<div class="item"><div class="main"><b>${esc(r.description)}</b><small>${esc(fmtDate(r.spent_on))} · ${esc(r.category)}</small></div><b class="num">${money(r.amount)}</b>
        <div class="btns" style="display:flex;gap:8px"><button class="btn ghost sm" type="button" data-act="expedit" data-id="${esc(r.id)}">Editar</button><button class="btn danger sm" type="button" data-act="expdel" data-id="${esc(r.id)}">Eliminar</button></div></div>`).join('')}</div>` : '<p class="empty-state">No hay gastos registrados en este mes.</p>'}</section>`;
  };
  function addMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7) + '-01'; }
  VIEW_AFTER.gastos = function () { $('#expMonth').addEventListener('change', (e) => { if (e.target.value) { A.f.expMonth = e.target.value; show('gastos', true); } }); };
  A.expCache = {};
  async function expenseForm(id) {
    let ex = null;
    if (id) { const r = await q(sb.from('expenses').select('*').eq('id', id)); ex = r[0]; if (!ex) { toast('Ese gasto ya no existe.', 'err'); return; } }
    openForm({
      title: ex ? 'Editar gasto' : 'Registrar gasto', ok: ex ? 'Guardar cambios' : 'Registrar gasto',
      body: `<label class="field">Descripción<input id="eDesc" type="text" maxlength="200" required value="${esc(ex ? ex.description : '')}" placeholder="Ej. Recibo de luz de octubre"></label>
        <div class="grid2"><label class="field">Monto (S/)<input id="eAmt" type="number" inputmode="decimal" min="0.01" step="0.01" required value="${ex ? num(ex.amount) : ''}"></label>
        <label class="field">Fecha<input id="eDate" type="date" value="${ex ? ex.spent_on : todayLima()}" max="${todayLima()}"></label></div>
        <label class="field">Categoría<input id="eCat" list="eCats" type="text" maxlength="40" value="${esc(ex ? ex.category : 'Otros')}"></label><datalist id="eCats">${EXP_CATS.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`,
      submit: async () => {
        const next = { description: $('#eDesc').value.trim(), amount: Number($('#eAmt').value), spent_on: $('#eDate').value, category: $('#eCat').value.trim() || 'Otros' };
        if (next.description.length < 2) throw new Error('Describe el gasto.');
        if (!isFinite(next.amount) || next.amount <= 0) throw new Error('El monto debe ser mayor a 0.');
        if (!next.spent_on) throw new Error('Elige la fecha del gasto.');
        if (!ex) { await submit('expense', 'insert', null, next, `Gasto: ${next.description} · ${money(next.amount)} (${next.category})`); return; }
        const diff = {}; const parts = [];
        Object.keys(next).forEach((k) => { if (String(ex[k]) !== String(next[k])) { diff[k] = next[k]; parts.push(`${FIELD[k] || k}: ${fmtVal(k, ex[k])} → ${fmtVal(k, next[k])}`); } });
        if (!parts.length) throw new Error('No hay cambios para guardar.');
        await submit('expense', 'update', ex.id, diff, `Editar gasto "${ex.description}": ${parts.join('; ')}`);
      }
    });
  }

  // =================================================================== REPORTES
  function presetRange(k) {
    const t = todayLima(); const ym = t.slice(0, 7);
    if (k === 'hoy') return [t, t];
    if (k === 'ayer') { const y = addDays(t, -1); return [y, y]; }
    if (k === '7') return [addDays(t, -6), t];
    if (k === 'mes') return [ym + '-01', t];
    if (k === 'mesant') { const prev = addDays(ym + '-01', -1); return [prev.slice(0, 7) + '-01', prev]; }
    return null;
  }
  A.f.rep = { preset: 'hoy', from: todayLima(), to: todayLima() };
  VIEW.reportes = async function () {
    const R = A.f.rep; const [from, to] = R.preset === 'custom' ? [R.from, R.to] : presetRange(R.preset);
    const r = await sb.rpc('report_summary', { p_from: from, p_to: to }); if (r.error) throw r.error; const x = r.data;
    const gross = num(x.sales) - num(x.cogs); const net = gross - num(x.expenses);
    const chip = (k, l) => `<button class="chip" type="button" data-rep="${k}" aria-pressed="${R.preset === k}">${l}</button>`;
    A.lastReport = x;
    return `<div class="vhead"><div><h2 class="dis">Reportes</h2><p class="sub">Una venta cuenta cuando el pedido se marca como entregado.</p></div><button class="btn ghost" type="button" data-act="csv">Exportar CSV</button></div>
      <div class="chips">${chip('hoy', 'Hoy')}${chip('ayer', 'Ayer')}${chip('7', 'Últimos 7 días')}${chip('mes', 'Este mes')}${chip('mesant', 'Mes anterior')}${chip('custom', 'Personalizado')}</div>
      ${R.preset === 'custom' ? `<div class="tools" style="margin-bottom:16px"><label class="field">Desde<input id="rFrom" type="date" value="${esc(R.from)}"></label><label class="field">Hasta<input id="rTo" type="date" value="${esc(R.to)}"></label><button class="btn sm" id="rApply" type="button">Aplicar</button></div>` : ''}
      <p class="sub" style="margin-bottom:14px">${esc(fmtDate(from))}${from === to ? '' : ' al ' + esc(fmtDate(to))}</p>
      <div class="kpis">
        <div class="kpi"><span>Ventas</span><b class="num">${money(x.sales)}</b><small>${x.orders} pedido(s) · incluye delivery cobrado ${money(x.delivery_income)}</small></div>
        <div class="kpi"><span>Costo de lo vendido</span><b class="num">${money(x.cogs)}</b></div>
        <div class="kpi ${gross >= 0 ? 'good' : 'bad'}"><span>Ganancia bruta</span><b class="num">${money(gross)}</b><small>Ventas − costo</small></div>
        <div class="kpi"><span>Gastos</span><b class="num">${money(x.expenses)}</b></div>
        <div class="kpi ${net >= 0 ? 'good' : 'bad'}"><span>Ganancia neta</span><b class="num">${money(net)}</b><small>Ganancia bruta − gastos</small></div>
        <div class="kpi"><span>Compras a proveedores</span><b class="num">${money(x.purchases)}</b><small>Es inversión en mercadería, no se resta como gasto</small></div></div>
      <section class="panel"><h3>Ventas por día</h3>${chartSvg(x.daily)}<div class="legend"><span><i></i>Ventas del día</span></div></section>
      <div class="cols"><section class="panel"><h3>Productos más vendidos</h3>${x.top_products.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Producto</th><th class="r">Unid.</th><th class="r">Ventas</th><th class="r">Ganancia</th></tr></thead><tbody>${x.top_products.map((p) => `<tr><td>${esc(p.name)}</td><td class="r num">${p.qty}</td><td class="r num">${money(p.revenue)}</td><td class="r num">${money(p.profit)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-state">Sin ventas en este periodo.</p>'}</section>
      <section class="panel"><h3>Por método de pago</h3>${x.by_payment.length ? `<div class="list">${x.by_payment.map((p) => `<div class="item"><div class="main"><b>${esc(p.payment)}</b><small>${p.orders} pedido(s)</small></div><b class="num">${money(p.total)}</b></div>`).join('')}</div>` : '<p class="empty-state">Sin ventas en este periodo.</p>'}</section></div>
      <section class="panel"><h3>Detalle diario</h3><div class="tscroll"><table class="t"><thead><tr><th>Día</th><th class="r">Pedidos</th><th class="r">Ventas</th><th class="r">Costo</th><th class="r">Gastos</th><th class="r">Ganancia neta</th></tr></thead><tbody>${x.daily.map((d) => `<tr><td>${esc(fmtDate(d.day))}</td><td class="r num">${d.orders}</td><td class="r num">${money(d.sales)}</td><td class="r num">${money(d.cogs)}</td><td class="r num">${money(d.expenses)}</td><td class="r num">${money(num(d.sales) - num(d.cogs) - num(d.expenses))}</td></tr>`).join('')}</tbody></table></div></section>`;
  };
  function chartSvg(daily) {
    if (!daily.length) return '<p class="empty-state">Sin datos.</p>';
    const W = 760, H = 220, L = 46, B = 26, T = 10, R = 8;
    const max = Math.max(1, ...daily.map((d) => num(d.sales))); const step = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / step) * step;
    const bw = (W - L - R) / daily.length; const y = (v) => T + (H - T - B) * (1 - v / top);
    const grid = [0, 0.5, 1].map((f) => { const v = top * f; return `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }).join('');
    const every = Math.ceil(daily.length / 10);
    const bars = daily.map((d, i) => { const h = Math.max(0, (H - T - B) * (num(d.sales) / top)); const bwid = Math.max(2, Math.min(40, bw * 0.7)); const cx = L + bw * i + bw / 2;
      return `<rect class="bar" x="${cx - bwid / 2}" y="${H - B - h}" width="${bwid}" height="${h}" rx="3"><title>${esc(fmtDate(d.day))}: ${esc(money(d.sales))}</title></rect>${i % every === 0 ? `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(String(d.day).slice(8, 10))}/${esc(String(d.day).slice(5, 7))}</text>` : ''}`; }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas por día">${grid}${bars}</svg>`;
  }
  function downloadCsv() {
    const x = A.lastReport; if (!x) return;
    const e = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [['Dia', 'Pedidos', 'Ventas', 'Costo', 'Gastos', 'Ganancia neta'], ...x.daily.map((d) => [d.day, d.orders, d.sales, d.cogs, d.expenses, (num(d.sales) - num(d.cogs) - num(d.expenses)).toFixed(2)])];
    const blob = new Blob(['﻿' + rows.map((r) => r.map(e).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bayubar-reporte-${x.from}_${x.to}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }


  // =================================================================== COMBOS Y PROMOS
  VIEW.promos = async function () {
    const C = A.d.combos || []; const P = A.d.products.filter((p) => p.active);
    const offers = A.d.products.filter((p) => p.promo_price !== null && p.promo_price !== undefined);
    const gifts = A.d.promotions || [];
    const today = todayLima();
    const comboCard = (c) => {
      const items = (c.combo_items || []).map((i) => `${i.qty} × ${esc(prodName(i.product_id))}`).join(' · ');
      const regular = (c.combo_items || []).reduce((t, i) => { const pr = A.d.products.find((x) => x.id === i.product_id); return t + i.qty * (pr ? num(pr.price) : 0); }, 0);
      const expired = c.ends_on && c.ends_on < today;
      return `<div class="item"><div class="main"><b>${esc(c.name)}</b><small>${items || 'Sin productos'}</small>
        <small>${money(c.price)}${regular > num(c.price) ? ` · precio normal ${money(regular)} · ahorro ${money(regular - num(c.price))}` : ''}${c.ends_on ? ` · hasta ${esc(fmtDate(c.ends_on))}` : ''}${expired ? ' · VENCIDO' : ''}${c.active ? '' : ' · Desactivado'}</small></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" type="button" data-act="comboedit" data-id="${esc(c.id)}">Editar</button><button class="btn ghost sm" type="button" data-act="combotoggle" data-id="${esc(c.id)}">${c.active ? 'Desactivar' : 'Activar'}</button></div></div>`;
    };
    const offerCard = (p) => `<div class="item"><div class="main"><b>${esc(p.name)}</b><small>${money(p.promo_price)} en vez de ${money(p.price)}${p.promo_until ? ` · hasta ${esc(fmtDate(p.promo_until))}${p.promo_until < today ? ' · VENCIDA' : ''}` : ' · sin fecha de fin'}</small></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" type="button" data-act="offeredit" data-id="${esc(p.id)}">Editar</button><button class="btn ghost sm" type="button" data-act="offerclear" data-id="${esc(p.id)}">Quitar oferta</button></div></div>`;
    return `<div class="vhead"><div><h2 class="dis">Combos y promociones</h2><p class="sub">Un combo vende varios productos a un precio fijo y descuenta el stock de cada uno.</p></div>
        <div class="tools"><button class="btn" type="button" data-act="combonew">+ Nuevo combo</button></div></div>
      <section class="panel"><h3 class="dis" style="font-size:20px;margin-bottom:10px">Combos</h3>
        ${C.length ? `<div class="list">${C.map(comboCard).join('')}</div>` : '<p class="empty-state">Aún no hay combos. Crea el primero con “Nuevo combo”.</p>'}</section>
      <section class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"><h3 class="dis" style="font-size:20px">Ofertas por producto</h3><button class="btn ghost sm" type="button" data-act="offernew" ${P.length ? '' : 'disabled'}>+ Poner en oferta</button></div>
        ${offers.length ? `<div class="list">${offers.map(offerCard).join('')}</div>` : '<p class="empty-state">Ningún producto está en oferta.</p>'}</section>
      <section class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"><div><h3 class="dis" style="font-size:20px">Tickets BAYU · Regalos</h3><p class="sub">El regalo se agrega y descuenta del inventario automáticamente cuando el pedido cumple el mínimo.</p></div><button class="btn" type="button" data-act="giftpromonew" ${isOwner() && P.length ? '' : 'disabled'}>+ Crear ticket</button></div>
        ${gifts.length ? `<div class="list">${gifts.map((g) => { const pr=A.d.products.find(x=>x.id===g.gift_product_id); return `<div class="item"><div class="main"><b>${esc(g.title)} · ${esc(g.ticket_code)}</b><small>Desde ${money(g.min_subtotal)} · Regalo: ${esc(pr?pr.name:'Producto')} × ${g.gift_qty}${g.ends_on?' · hasta '+esc(fmtDate(g.ends_on)):''} · ${g.active?'Activo':'Pausado'} · Usos ${Number(g.uses_count||0)}${g.max_uses ? ' / '+Number(g.max_uses) : ' · ilimitados'}</small><small>${esc(g.description||'')}</small></div><div style="display:flex;gap:8px;flex-wrap:wrap">${isOwner()?`<button class="btn ghost sm" type="button" data-act="giftpromoedit" data-id="${esc(g.id)}">Editar</button><button class="btn ghost sm" type="button" data-act="giftpromotoggle" data-id="${esc(g.id)}">${g.active?'Pausar':'Activar'}</button>`:''}</div></div>`; }).join('')}</div>` : '<p class="empty-state">Todavía no hay tickets ni regalos configurados.</p>'}</section>`;
  };

  function giftPromoForm(g) {
    if (!isOwner()) { toast('Solo el dueño puede crear tickets promocionales.', 'err'); return; }
    const products = A.d.products.filter(p => p.active);
    if (!products.length) { toast('Primero registra un producto para regalar.', 'err'); return; }
    openForm({ title: g ? 'Editar ticket BAYU' : 'Crear ticket BAYU', ok: 'Guardar ticket', wide: true,
      body: `<label class="field">Título visible<input id="gpTitle" maxlength="90" required value="${esc(g?.title||'')}" placeholder="Ej. ¡Tu compra viene con regalo!"></label>
        <label class="field">Mensaje<input id="gpDesc" maxlength="240" value="${esc(g?.description||'')}" placeholder="Ej. Llévate unos snacks por tu compra."></label>
        <div class="grid2"><label class="field">Código del ticket<input id="gpCode" maxlength="24" required value="${esc(g?.ticket_code||'BAYU-REGALO')}" placeholder="BAYU-REGALO"></label>
        <label class="field">Compra mínima (S/)<input id="gpMin" type="number" min="0" step="0.01" required value="${g?num(g.min_subtotal):50}"></label></div>
        <div class="grid2"><label class="field">Producto de regalo<select id="gpProduct">${products.map(p=>`<option value="${esc(p.id)}" ${g?.gift_product_id===p.id?'selected':''}>${esc(p.name)} · stock ${p.stock}</option>`).join('')}</select></label>
        <label class="field">Cantidad de regalo<input id="gpQty" type="number" min="1" max="10" value="${g?.gift_qty||1}" required></label></div>
        <div class="grid2"><label class="field">Usos máximos (opcional)<input id="gpMax" type="number" min="1" step="1" value="${g?.max_uses||''}"><span class="hint">Vacío = usos ilimitados.</span></label><label class="field">Válido desde<input id="gpStart" type="date" value="${esc(g?.starts_on||'')}"></label><label class="field">Válido hasta<input id="gpEnd" type="date" value="${esc(g?.ends_on||'')}"></label></div>
        <label class="field"><span><input id="gpActive" type="checkbox" ${g?.active===false?'':'checked'}> Ticket activo</span><span class="hint">El regalo se entrega automáticamente al cumplir el monto mínimo. El inventario se descuenta en Supabase.</span></label>`,
      submit: async () => {
        const title=$('#gpTitle').value.trim(), code=$('#gpCode').value.trim(), min=$('#gpMin').value, qty=Number($('#gpQty').value), start=$('#gpStart').value, end=$('#gpEnd').value, maxRaw=$('#gpMax').value, maxUses=maxRaw===''?null:Number(maxRaw);
        if(title.length<3) throw new Error('Escribe un título de al menos 3 caracteres.');
        if(!code || !min || Number(min)<0) throw new Error('Completa el código y el monto mínimo.');
        if(!Number.isInteger(qty)||qty<1||qty>10) throw new Error('La cantidad debe estar entre 1 y 10.');
        if(maxUses!==null&&(!Number.isInteger(maxUses)||maxUses<1)) throw new Error('Los usos máximos deben ser un entero mayor que cero.');
        if(start && end && end<start) throw new Error('La fecha final no puede ser anterior a la inicial.');
        const {error}=await sb.rpc('save_bayu_promotion',{p_id:g?.id||null,p_payload:{title,description:$('#gpDesc').value.trim(),ticket_code:code,min_subtotal:Number(min),gift_product_id:$('#gpProduct').value,gift_qty:qty,max_uses:maxUses,starts_on:start||null,ends_on:end||null,active:$('#gpActive').checked}});
        if(error) throw error; toast('Ticket BAYU guardado.','ok');
      }
    });
  }

  function comboForm(c) {
    const isNew = !c; let imageUrl = c ? (c.image_url || '') : '';
    const P = A.d.products.filter((p) => p.active || (c && (c.combo_items || []).some((i) => i.product_id === p.id)));
    if (!P.length) { toast('Primero registra productos.', 'err'); return; }
    const row = (pid, qty) => `<div class="crow" style="display:grid;grid-template-columns:1fr 84px 40px;gap:8px;margin-bottom:8px">
      <select class="cPid" aria-label="Producto">${P.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}${p.size ? ' · ' + esc(p.size) : ''} (${money(p.price)})</option>`).join('')}</select>
      <input class="cQty" type="number" min="1" max="99" step="1" value="${qty}" aria-label="Cantidad">
      <button class="btn ghost sm" type="button" data-crm aria-label="Quitar producto">✕</button></div>`;
    const rows = c && (c.combo_items || []).length ? c.combo_items.map((i) => row(i.product_id, i.qty)) : [row(P[0].id, 1), row(P[Math.min(1, P.length - 1)].id, 1)];
    openForm({
      title: isNew ? 'Nuevo combo' : 'Editar combo', ok: isNew ? 'Crear combo' : 'Guardar cambios', wide: true,
      body: `<label class="field">Nombre del combo<input id="cName" type="text" maxlength="80" required value="${esc(c ? c.name : '')}" placeholder="Ej. Noche de amigos"></label>
        <label class="field">Descripción (opcional)<textarea id="cDesc" maxlength="200">${esc(c ? c.description || '' : '')}</textarea></label>
        <div class="field">Productos del combo<div id="cRows">${rows.join('')}</div><button class="btn ghost sm" type="button" id="cAdd">+ Agregar producto</button><span class="hint" id="cSum"></span></div>
        <div class="grid2"><label class="field">Precio del combo (S/)<input id="cPrice" type="number" inputmode="decimal" min="0.01" step="0.01" required value="${c ? num(c.price) : ''}"></label>
        <label class="field">Vigente hasta (opcional)<input id="cEnds" type="date" value="${esc(c && c.ends_on ? c.ends_on : '')}"><span class="hint">Vacío = sin fecha de fin.</span></label></div>
        <div class="field">Foto (opcional)<div class="imgbox"><span class="thumb">${imageUrl ? `<img src="${esc(imageUrl)}" alt="" width="84" height="84" style="width:100%;height:100%;object-fit:cover">` : 'Sin foto'}</span>
        <div><input id="cFile" type="file" accept="image/*"><span class="hint" id="cFileHint">Si no subes foto se dibujan las botellas.</span></div></div></div>`,
      submit: async () => {
        const fileEl = $('#cFile');
        if (fileEl.files[0]) { $('#cFileHint').textContent = 'Subiendo foto…'; imageUrl = await uploadImage(fileEl.files[0]); }
        const name = $('#cName').value.trim(); const price = Number($('#cPrice').value);
        if (name.length < 2) throw new Error('Escribe el nombre del combo.');
        const items = readRows();
        if (!items.length) throw new Error('Agrega al menos un producto al combo.');
        if (items.some((i) => !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99)) throw new Error('Cada producto necesita una cantidad entre 1 y 99.');
        if (new Set(items.map((i) => i.product_id)).size !== items.length) throw new Error('Un producto está repetido: súmalo en una sola fila.');
        if (!isFinite(price) || price <= 0 || $('#cPrice').value === '') throw new Error('Escribe el precio del combo.');
        const next = { name, description: $('#cDesc').value.trim(), price, ends_on: $('#cEnds').value || null, image_url: imageUrl, items };
        if (isNew) await submit('combo', 'insert', null, { ...next, active: true }, `Combo nuevo: ${name} · ${money(price)} · ${items.length} producto(s)`);
        else {
          const diff = {}; const parts = [];
          ['name', 'description', 'price', 'ends_on', 'image_url'].forEach((k) => { const b = c[k] ?? ''; const n = next[k] ?? ''; if (String(b) !== String(n)) { diff[k] = next[k]; parts.push(`${FIELD[k] || k}: ${fmtVal(k, b)} → ${fmtVal(k, n)}`); } });
          const before = (c.combo_items || []).map((i) => `${i.product_id}:${i.qty}`).sort().join(',');
          if (before !== items.map((i) => `${i.product_id}:${i.qty}`).sort().join(',')) { diff.items = items; parts.push('Productos del combo'); }
          if (!parts.length) throw new Error('No hay cambios para guardar.');
          await submit('combo', 'update', c.id, diff, `Editar combo "${c.name}": ${parts.join('; ')}`);
        }
      }
    });
    function readRows() { return $$('#cRows .crow').map((r) => ({ product_id: $('.cPid', r).value, qty: Number($('.cQty', r).value) })); }
    function sum() {
      const t = readRows().reduce((a, i) => { const pr = A.d.products.find((x) => x.id === i.product_id); return a + (pr && i.qty > 0 ? num(pr.price) * i.qty : 0); }, 0);
      $('#cSum').textContent = `Precio normal de los productos: ${money(t)}. Pon el combo por debajo para que el cliente vea el ahorro.`;
    }
    sum();
    $('#cAdd').addEventListener('click', () => { $('#cRows').insertAdjacentHTML('beforeend', row(P[0].id, 1)); sum(); });
    $('#cRows').addEventListener('click', (e) => { if (e.target.closest('[data-crm]')) { const r = e.target.closest('.crow'); if ($$('#cRows .crow').length > 1) { r.remove(); sum(); } } });
    $('#cRows').addEventListener('input', sum);
  }

  function offerForm(p) {
    const isNew = !p; const list = A.d.products.filter((x) => x.active);
    openForm({
      title: isNew ? 'Poner producto en oferta' : `Oferta de ${p.name}`, ok: 'Guardar oferta',
      body: `${isNew ? `<label class="field">Producto<select id="oPid">${list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.size ? ' · ' + esc(x.size) : ''} (${money(x.price)})</option>`).join('')}</select></label>` : `<p style="color:var(--muted)">Precio normal: <b>${money(p.price)}</b></p>`}
        <div class="grid2"><label class="field">Precio de oferta (S/)<input id="oPrice" type="number" inputmode="decimal" min="0" step="0.01" required value="${p && p.promo_price !== null ? num(p.promo_price) : ''}"></label>
        <label class="field">Oferta hasta (opcional)<input id="oEnds" type="date" value="${esc(p && p.promo_until ? p.promo_until : '')}"><span class="hint">Vacío = hasta que la quites.</span></label></div>`,
      submit: async () => {
        const prod = p || A.d.products.find((x) => x.id === $('#oPid').value);
        const price = Number($('#oPrice').value);
        if ($('#oPrice').value === '' || !isFinite(price) || price < 0) throw new Error('Escribe el precio de oferta.');
        if (price >= num(prod.price)) throw new Error('El precio de oferta debe ser menor al precio normal.');
        const ends = $('#oEnds').value || null;
        if (ends && ends < todayLima()) throw new Error('La fecha de fin ya pasó.');
        await submit('product', 'update', prod.id, { promo_price: price, promo_until: ends }, `Oferta en "${prod.name}": ${money(price)} (antes ${money(prod.price)})${ends ? ' hasta ' + fmtDate(ends) : ''}`);
      }
    });
  }

  // =================================================================== APROBACIONES
  function payloadLines(r) {
    const p = r.payload || {}; const out = [];
    Object.keys(p).forEach((k) => {
      if (k === 'items') { (p.items || []).forEach((i) => out.push([prodName(i.product_id), i.unit_cost !== undefined ? `${i.qty} u. a ${money(i.unit_cost)} c/u` : `${i.qty} u.`])); return; }
      if (k === 'product_id') { out.push(['Producto', prodName(p[k])]); return; }
      if (k === 'key') { out.push(['Ajuste', SETTING_LABEL[p[k]] || p[k]]); return; }
      if (k === 'value') { out.push(['Nuevo valor', typeof p[k] === 'boolean' ? (p[k] ? 'Activado' : 'Desactivado') : String(p[k])]); return; }
      out.push([FIELD[k] || k, fmtVal(k, p[k])]);
    });
    return out;
  }
  VIEW.aprobaciones = async function () {
    const mine = isOwner() ? A.d.requests : A.d.requests.filter((r) => r.requested_by === A.profile.id);
    const pend = mine.filter((r) => r.status === 'pendiente'); const done = mine.filter((r) => r.status !== 'pendiente' && !(r.reviewed_by === r.requested_by)).slice(0, 40);
    const card = (r, actions) => `<article class="req"><div class="req-top"><b>${esc(ENTITY[r.entity] || r.entity)} · ${esc(ACTION[r.action] || r.action)}</b>${pill(r.status)}<span style="color:var(--muted);font-size:13px">${esc(fmtDateTime(r.requested_at))} · ${esc(nameOf(r.requested_by))}</span></div>
      <p>${esc(r.summary || '')}</p>
      ${payloadLines(r).length ? `<details><summary style="cursor:pointer;color:var(--cyan);font-size:14px">Ver detalle</summary><dl class="kv" style="margin-top:8px">${payloadLines(r).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>` : ''}
      ${r.review_note ? `<p style="color:var(--muted);font-size:14px">Nota del dueño: ${esc(r.review_note)}</p>` : ''}
      ${actions ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ok sm" type="button" data-act="approve" data-id="${esc(r.id)}">Aprobar</button><button class="btn danger sm" type="button" data-act="reject" data-id="${esc(r.id)}">Rechazar</button></div>` : ''}</article>`;
    return `<div class="vhead"><div><h2 class="dis">${isOwner() ? 'Aprobaciones' : 'Mis solicitudes'}</h2><p class="sub">${isOwner() ? 'Todo cambio de tu ayudante espera aquí hasta que lo apruebes.' : 'Estado de los cambios que enviaste al dueño.'}</p></div></div>
      <h3 style="margin-bottom:12px">Pendientes (${pend.length})</h3>${pend.length ? pend.map((r) => card(r, isOwner())).join('') : '<p class="empty-state">No hay solicitudes pendientes.</p>'}
      <h3 style="margin:26px 0 12px">Historial</h3>${done.length ? done.map((r) => card(r, false)).join('') : '<p class="empty-state">Aún no hay solicitudes revisadas.</p>'}`;
  };

  // =================================================================== FASE 2 · CLIENTES Y FIDELIZACIÓN
  VIEW.clientes = async function () {
    const [customers,rewards,tx]=await Promise.all([
      q(sb.from('customers').select('*').order('last_order_at',{ascending:false}).limit(250)),
      q(sb.from('loyalty_rewards').select('*').order('points_cost')),
      q(sb.from('loyalty_transactions').select('id,points,kind,note,created_at').order('created_at',{ascending:false}).limit(30))
    ]);
    const points=customers.reduce((n,c)=>n+num(c.points_balance),0);
    return `<div class="vhead"><div><h2 class="dis">Clientes y fidelización</h2><p class="sub">Los puntos se acreditan al marcar un pedido como entregado. Regla inicial: 1 punto por cada S/ 10.</p></div><button class="btn" data-act="rewardnew">+ Nueva recompensa</button></div>
      <div class="kpis"><div class="kpi"><span>Clientes registrados</span><b>${customers.length}</b></div><div class="kpi"><span>Puntos en circulación</span><b>${points}</b></div><div class="kpi"><span>Recompensas activas</span><b>${rewards.filter(r=>r.active).length}</b></div></div>
      <section class="panel"><h3>Recompensas</h3>${rewards.length?`<div class="list">${rewards.map(r=>`<div class="item"><div class="main"><b>${esc(r.title)}</b><small>${esc(r.description||'')} · ${r.points_cost} puntos · Canjes ${r.redemptions_count||0}${r.active?'':' · Pausada'}</small></div><button class="btn ghost sm" data-act="rewardtoggle" data-id="${esc(r.id)}">${r.active?'Pausar':'Activar'}</button></div>`).join('')}</div>`:'<p class="empty-state">Aún no hay recompensas.</p>'}</section>
      <section class="panel"><h3>Base de clientes</h3>${customers.length?`<div class="tscroll"><table class="t"><thead><tr><th>Cliente</th><th>Celular</th><th class="r">Puntos</th><th class="r">Compras</th><th>Última compra</th><th></th></tr></thead><tbody>${customers.map(c=>`<tr><td>${esc(c.full_name)}</td><td>${esc(c.phone)}</td><td class="r num">${num(c.points_balance)}</td><td class="r num">${money(c.lifetime_spend)}</td><td>${c.last_order_at?esc(fmtDateTime(c.last_order_at)):'—'}</td><td><button class="btn ghost sm" data-act="customerredeem" data-id="${esc(c.id)}">Canjear</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty-state">Los clientes aparecerán después de completar y entregar pedidos. No se importaron datos históricos automáticamente.</p>'}</section>
      <section class="panel"><h3>Movimientos recientes de puntos</h3>${tx.length?`<div class="list">${tx.map(t=>`<div class="item"><div class="main"><b>${esc(t.kind)}</b><small>${esc(t.note||'')} · ${esc(fmtDateTime(t.created_at))}</small></div><b class="num">${t.points>0?'+':''}${t.points}</b></div>`).join('')}</div>`:'<p class="empty-state">Sin movimientos todavía.</p>'}</section>`;
  };

  // =================================================================== FASE 3 · MARKETING
  VIEW.marketing = async function () {
    const [campaigns,customers]=await Promise.all([
      q(sb.from('marketing_campaigns').select('*').order('created_at',{ascending:false}).limit(100)),
      q(sb.from('customers').select('id,full_name,phone,marketing_consent,last_order_at').order('full_name').limit(500))
    ]);
    const eligible=customers.filter(c=>c.marketing_consent);
    return `<div class="vhead"><div><h2 class="dis">Marketing BAYU</h2><p class="sub">Campañas con apertura manual de WhatsApp. No se envían mensajes automáticos ni se contacta a quien no dio consentimiento.</p></div><button class="btn" data-act="campaignnew">+ Crear campaña</button></div>
      <div class="kpis"><div class="kpi"><span>Clientes registrados</span><b>${customers.length}</b></div><div class="kpi"><span>Con consentimiento</span><b>${eligible.length}</b></div><div class="kpi"><span>Campañas</span><b>${campaigns.length}</b></div></div>
      <section class="panel"><h3>Campañas</h3>${campaigns.length?`<div class="list">${campaigns.map(c=>`<div class="item"><div class="main"><b>${esc(c.name)}</b><small>Segmento: ${esc(c.segment)} · Estado: ${esc(c.status)} · ${esc(fmtDateTime(c.created_at))}</small><small>${esc(c.message)}</small></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-act="campaignopen" data-id="${esc(c.id)}">Abrir campaña</button><button class="btn ghost sm" data-act="campaigntoggle" data-id="${esc(c.id)}">${c.status==='paused'?'Reactivar':'Pausar'}</button><button class="btn danger sm" data-act="campaigndelete" data-id="${esc(c.id)}">Eliminar</button></div></div>`).join('')}</div>`:'<p class="empty-state">No hay campañas creadas.</p>'}</section>
      <p class="hint">La API oficial de WhatsApp Business no está conectada. Esta fase prepara segmentación y mensajes, pero el envío se confirma manualmente desde WhatsApp.</p>`;
  };

  // =================================================================== FASE 6 · CAJA
  VIEW.caja = async function () {
    const [sessions,movements]=await Promise.all([
      q(sb.from('cash_sessions').select('*').order('opened_at',{ascending:false}).limit(20)),
      q(sb.from('cash_movements').select('*').order('created_at',{ascending:false}).limit(100))
    ]);
    const open=sessions.find(x=>x.status==='open');
    const mv=open?movements.filter(m=>m.session_id===open.id):[];
    const expected=num(open?.opening_amount)+mv.reduce((a,m)=>a+(m.kind==='income'||m.kind==='deposit'?num(m.amount):-num(m.amount)),0);
    return `<div class="vhead"><div><h2 class="dis">Caja</h2><p class="sub">Control de efectivo separado de los gastos generales.</p></div>${open?`<button class="btn danger" data-act="cashclose" data-id="${esc(open.id)}">Cerrar caja</button>`:'<button class="btn" data-act="cashopen">Abrir caja</button>'}</div>
      ${open?`<section class="panel"><h3>Caja abierta</h3><div class="kpis"><div class="kpi"><span>Fondo inicial</span><b>${money(open.opening_amount)}</b></div><div class="kpi"><span>Saldo esperado</span><b>${money(expected)}</b></div><div class="kpi"><span>Movimientos</span><b>${mv.length}</b></div></div><button class="btn ghost sm" data-act="cashmove" data-id="${esc(open.id)}">+ Registrar movimiento</button></section>`:'<section class="panel"><p class="empty-state">No hay una caja abierta.</p></section>'}
      <section class="panel"><h3>Sesiones recientes</h3>${sessions.length?`<div class="list">${sessions.map(x=>`<div class="item"><div class="main"><b>${x.status==='open'?'Abierta':'Cerrada'} · ${esc(fmtDateTime(x.opened_at))}</b><small>Inicial ${money(x.opening_amount)}${x.closed_at?' · Cierre '+money(x.closing_amount||0):''}</small></div></div>`).join('')}</div>`:'<p class="empty-state">Sin sesiones de caja.</p>'}</section>`;
  };

  // =================================================================== FASE 7 · REPARTOS
  VIEW.delivery = async function () {
    const orders=A.d.orders.filter(o=>['nuevo','confirmado','en_camino'].includes(o.status));
    const assignments=await q(sb.from('delivery_assignments').select('*').order('assigned_at',{ascending:false}).limit(100));
    return `<div class="vhead"><div><h2 class="dis">Repartos</h2><p class="sub">Asignación de repartidores y control de entrega.</p></div></div>
      <section class="panel"><h3>Pedidos activos</h3>${orders.length?`<div class="list">${orders.map(o=>{const a=assignments.find(x=>x.order_id===o.id);return `<div class="item"><div class="main"><b>${esc(o.number)} · ${esc(o.customer_name)}</b><small>${esc(o.phone)} · ${esc(o.address)} · ${money(o.total)}</small><small>${a?'Repartidor: '+esc(a.courier_name)+' · '+esc(a.delivery_status):'Sin asignar'}</small></div><button class="btn ghost sm" data-act="deliveryassign" data-id="${esc(o.id)}">${a?'Editar asignación':'Asignar'}</button></div>`}).join('')}</div>`:'<p class="empty-state">No hay pedidos activos.</p>'}</section>`;
  };

  // =================================================================== FASE 10 · SEDES
  VIEW.sedes = async function () {
    const rows=await q(sb.from('store_locations').select('*').order('is_primary',{ascending:false}).order('name'));
    return `<div class="vhead"><div><h2 class="dis">Sedes</h2><p class="sub">Base para expansión. Los pedidos e inventario actuales siguen vinculados a la sede principal.</p></div><button class="btn" data-act="locationnew">+ Nueva sede</button></div><section class="panel">${rows.length?`<div class="list">${rows.map(x=>`<div class="item"><div class="main"><b>${esc(x.name)} ${x.is_primary?'· PRINCIPAL':''}</b><small>${esc(x.code)} · ${esc(x.address||'Sin dirección')} · ${x.active?'Activa':'Inactiva'}</small></div><button class="btn ghost sm" data-act="locationedit" data-id="${esc(x.id)}">Editar</button></div>`).join('')}</div>`:'<p class="empty-state">No hay sedes registradas.</p>'}</section>`;
  };

  // ---- avisos push en este dispositivo
  const VAPID = (BB.cfg && BB.cfg.VAPID_PUBLIC_KEY) || '';
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64 = (k) => { const p = '='.repeat((4 - (k.length % 4)) % 4); const r = atob((k + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  async function pushState() {
    if (!pushSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try { const reg = await navigator.serviceWorker.getRegistration('./sw.js') || await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub ? 'on' : 'off'; } catch (_) { return 'off'; }
  }
  async function enablePush() {
    if (!pushSupported()) throw new Error('Este navegador no permite avisos. En iPhone, primero agrega el panel a la pantalla de inicio.');
    if (!VAPID) throw new Error('Falta la clave VAPID_PUBLIC_KEY en js/config.js (ver LEEME.md, sección Avisos).');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('No se dio permiso para notificaciones. Actívalo en la configuración del navegador.');
    const reg = await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID) });
    const j = sub.toJSON();
    const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }); if (error) throw error;
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (!sub) return;
    await sb.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }); await sub.unsubscribe();
  }

  // =================================================================== AJUSTES
  VIEW.ajustes = async function () {
    const S = A.d.settings; const free = S.free_delivery_enabled === true;
    const visualKeys = [
      ['visual_combo_banner', 'Banner de ofertas y combos', 'Imagen principal del bloque de promociones', './assets/combos-bayu.svg'],
      ['visual_points_banner', 'Banner de BAYU COIN', 'Imagen principal del programa de puntos', './assets/bayu-coin.svg'],
      ['visual_offers_banner', 'Imagen de sección de ofertas', 'Imagen de apoyo para la sección de ofertas del catálogo', '']
    ];
    const visualAssets = isOwner() ? `<section class="panel visual-assets-panel"><div class="visual-panel-heading"><div><h3>Gestión visual de BAYU BAR</h3><p class="sub">Cambia las imágenes de la tienda sin editar código ni volver a publicar.</p></div><span class="status st-aprobado">Solo dueño</span></div>
      <div class="visual-assets-grid">${visualKeys.map(([key,title,desc,fallback])=>{const url=S[key]||fallback;return `<article class="visual-asset-card"><div class="visual-asset-preview ${url?'':'is-empty'}">${url?`<img src="${esc(url)}" alt="${esc(title)}" loading="lazy">`:'<span>Sin imagen personalizada</span>'}</div><div class="visual-asset-copy"><b>${esc(title)}</b><small>${esc(desc)}</small><label class="btn ghost sm visual-upload-label">Subir imagen<input type="file" accept="image/png,image/jpeg,image/webp" data-visual-upload="${key}" hidden></label><small class="hint">PNG, JPG o WebP · Se optimiza automáticamente.</small></div></article>`}).join('')}</div>
      <p class="hint">Las imágenes se guardan en Supabase Storage. Para productos y combos, usa Editar en cada ficha del catálogo.</p></section>` : '';

    const audit = isOwner() ? await q(sb.from('audit_log').select('*').order('id', { ascending: false }).limit(60)) : [];
    const ns = isOwner() ? await sb.rpc('get_notify_status').then((r) => r.data || {}, () => ({})) : {};
    const ps = await pushState();
    return `<div class="vhead"><div><h2 class="dis">Ajustes</h2></div></div>
      ${visualAssets}
      <section class="panel"><h3>Delivery</h3>
        <div class="item"><div class="main"><b>Delivery gratis</b><small>${free ? `Activado${num(S.free_delivery_min) > 0 ? ' para pedidos desde ' + money(S.free_delivery_min) : ' para todos los pedidos'}` : 'Desactivado: se cobra la tarifa de cada zona'}</small></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" type="button" data-act="freetoggle">${free ? 'Desactivar' : 'Activar'}</button><button class="btn ghost sm" type="button" data-act="freemin">Monto mínimo</button></div></div>
        <h3 style="margin:18px 0 6px">Zonas y tarifas</h3>
        <div class="list">${A.d.zones.map((z) => `<div class="item"><div class="main"><b>${esc(z.name)}</b><small>${money(z.fee)}${z.active ? '' : ' · Desactivada'}</small></div><div style="display:flex;gap:8px"><button class="btn ghost sm" type="button" data-act="zoneedit" data-id="${esc(z.id)}">Editar</button><button class="btn ghost sm" type="button" data-act="zonetoggle" data-id="${esc(z.id)}">${z.active ? 'Desactivar' : 'Activar'}</button></div></div>`).join('') || '<p class="empty-state">Sin zonas.</p>'}</div>
        <p style="margin-top:12px"><button class="btn sm" type="button" data-act="zonenew">+ Nueva zona</button></p></section>
      <section class="panel"><h3>Negocio</h3>
        <div class="item"><div class="main"><b>WhatsApp de pedidos</b><small>${esc(S.whatsapp || '')}</small></div><button class="btn ghost sm" type="button" data-act="wa">Cambiar</button></div>
        <div class="item"><div class="main"><b>Nombre del negocio</b><small>${esc(S.store_name || '')}</small></div><button class="btn ghost sm" type="button" data-act="storename">Cambiar</button></div></section>
      <section class="panel"><h3>Avisos de pedidos nuevos</h3>
        <div class="item"><div class="main"><b>Este dispositivo</b><small>${ps === 'on' ? 'Recibirá una notificación en cuanto entre un pedido' : ps === 'denied' ? 'Bloqueado: permite las notificaciones en la configuración del navegador' : ps === 'unsupported' ? 'Este navegador no admite avisos (en iPhone agrega el panel a la pantalla de inicio)' : 'Desactivado'}</small></div>
          ${ps === 'on' ? '<button class="btn ghost sm" type="button" data-act="pushoff">Desactivar</button>' : ps === 'off' ? '<button class="btn sm" type="button" data-act="pushon">Activar aquí</button>' : ''}</div>
        ${isOwner() ? `<div class="item"><div class="main"><b>Telegram</b><small>${ns.telegram ? 'Activo: te llega cada pedido nuevo' : 'No configurado'}</small></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" type="button" data-act="tgcfg">${ns.telegram ? 'Cambiar' : 'Configurar'}</button>${ns.telegram ? '<button class="btn ghost sm" type="button" data-act="tgoff">Apagar</button>' : ''}</div></div>
        <div class="item"><div class="main"><b>Servidor de avisos del navegador</b><small>${ns.push_server ? `Configurado · ${num(ns.devices)} dispositivo(s) activado(s)` : 'No configurado (necesario para las notificaciones push)'}</small></div><button class="btn ghost sm" type="button" data-act="pushcfg">${ns.push_server ? 'Cambiar' : 'Configurar'}</button></div>
        <p style="margin-top:12px"><button class="btn sm" type="button" data-act="notifytest">Enviar prueba</button></p>` : '<p style="color:var(--faint);font-size:13px;margin-top:8px">El dueño configura Telegram y el servidor de avisos.</p>'}</section>
      <section class="panel"><h3>Mensajes al cliente</h3><p style="color:var(--muted);font-size:14px;margin-bottom:6px">Se preparan en WhatsApp cuando cambias el estado de un pedido.</p>
        <div class="list">${['confirmado', 'en_camino', 'entregado'].map((st) => `<div class="item"><div class="main"><b>${esc(MSG_LABEL[st])}</b><small>${esc(S['msg_' + st] || MSG_DEFAULT[st])}</small></div><button class="btn ghost sm" type="button" data-act="msgedit" data-st="${st}">Editar</button></div>`).join('')}</div></section>
      <section class="panel"><h3>Equipo</h3><div class="list">${A.d.profiles.map((p) => `<div class="item"><div class="main"><b>${esc(p.email)}</b><small>${p.role === 'owner' ? 'Dueño: aplica cambios al instante y aprueba los del ayudante' : 'Ayudante: sus cambios esperan tu aprobación'}</small></div><span class="status ${p.active ? 'st-aprobado' : 'st-inactivo'}">${p.active ? 'Activo' : 'Inactivo'}</span></div>`).join('')}</div>
        <p style="color:var(--faint);font-size:13px;margin-top:10px">Para cambiar el correo del ayudante o dar de baja a alguien, sigue los pasos de LEEME.md (sección “Cambiar al ayudante”).</p></section>
      ${isOwner() ? `<section class="panel"><h3>Bitácora (últimos 60 cambios)</h3><div class="tscroll"><table class="t"><thead><tr><th>Fecha</th><th>Quién</th><th>Dónde</th><th>Acción</th></tr></thead><tbody>${audit.map((a) => `<tr><td>${esc(fmtDateTime(a.at))}</td><td>${esc(a.actor_email || '')}</td><td>${esc(a.table_name)}</td><td>${esc(a.action)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  };
  function settingSubmit(key, value, label) { return submit('setting', 'update', null, { key, value }, `${label}: ${typeof value === 'boolean' ? (value ? 'activar' : 'desactivar') : value}`); }
  function zoneForm(z) {
    openForm({
      title: z ? 'Editar zona' : 'Nueva zona', ok: 'Guardar',
      body: `<label class="field">Nombre de la zona<input id="zName" type="text" maxlength="80" required value="${esc(z ? z.name : '')}" placeholder="Ej. Centro de San Miguel"></label><label class="field">Tarifa de delivery (S/)<input id="zFee" type="number" inputmode="decimal" min="0" step="0.01" required value="${z ? num(z.fee) : ''}"></label>`,
      submit: async () => {
        const name = $('#zName').value.trim(); const fee = Number($('#zFee').value);
        if (name.length < 2) throw new Error('Escribe el nombre de la zona.');
        if (!isFinite(fee) || fee < 0 || $('#zFee').value === '') throw new Error('Escribe una tarifa válida.');
        if (!z) { await submit('zone', 'insert', null, { name, fee }, `Zona nueva: ${name} · ${money(fee)}`); return; }
        const diff = {}; const parts = [];
        if (z.name !== name) { diff.name = name; parts.push(`Nombre: ${z.name} → ${name}`); }
        if (num(z.fee) !== fee) { diff.fee = fee; parts.push(`Tarifa: ${money(z.fee)} → ${money(fee)}`); }
        if (!parts.length) throw new Error('No hay cambios para guardar.');
        await submit('zone', 'update', z.id, diff, `Editar zona "${z.name}": ${parts.join('; ')}`);
      }
    });
  }

  function locationForm(loc){
    if(!isOwner()){toast('Solo el dueño puede administrar sedes.','err');return;}
    openForm({title:loc?'Editar sede':'Nueva sede',ok:'Guardar',body:`<label class="field">Código<input id="locCode" maxlength="20" required value="${esc(loc?.code||'')}"></label><label class="field">Nombre<input id="locName" maxlength="100" required value="${esc(loc?.name||'')}"></label><label class="field">Dirección<input id="locAddress" maxlength="200" value="${esc(loc?.address||'')}"></label><label class="field">Teléfono<input id="locPhone" maxlength="20" value="${esc(loc?.phone||'')}"></label><label class="field"><span><input id="locActive" type="checkbox" ${loc?.active===false?'':'checked'}> Activa</span></label>`,submit:async()=>{const payload={code:$('#locCode').value.trim().toUpperCase(),name:$('#locName').value.trim(),address:$('#locAddress').value.trim()||null,phone:$('#locPhone').value.trim()||null,active:$('#locActive').checked};if(payload.code.length<2||payload.name.length<2)throw new Error('Completa código y nombre.');const {error}=loc?await sb.from('store_locations').update(payload).eq('id',loc.id):await sb.from('store_locations').insert(payload);if(error)throw error;await reload();}});
  }

  // =================================================================== acciones (delegación)
  const ACT = {
    reload: () => reload(),
    rewardnew: () => openForm({title:'Nueva recompensa',ok:'Guardar',body:`<label class="field">Nombre<input id="rwTitle" required maxlength="80"></label><label class="field">Descripción<textarea id="rwDesc" maxlength="240"></textarea></label><label class="field">Puntos necesarios<input id="rwCost" type="number" min="1" step="1" required></label>`,submit:async()=>{const title=$('#rwTitle').value.trim(),points_cost=Number($('#rwCost').value);if(title.length<3||!Number.isInteger(points_cost)||points_cost<1)throw new Error('Completa nombre y puntos válidos.');const {error}=await sb.from('loyalty_rewards').insert({title,description:$('#rwDesc').value.trim(),points_cost});if(error)throw error;await reload();}}),
    rewardtoggle: async el=>{const {data,error}=await sb.from('loyalty_rewards').select('*').eq('id',el.dataset.id).single();if(error)throw error;const r=await sb.from('loyalty_rewards').update({active:!data.active}).eq('id',data.id);if(r.error)throw r.error;await reload();},
    customerredeem: async el=>{const c=await sb.from('customers').select('*').eq('id',el.dataset.id).single();if(c.error)throw c.error;const rewards=await q(sb.from('loyalty_rewards').select('*').eq('active',true).order('points_cost'));if(!rewards.length){toast('Primero crea una recompensa.','err');return;}openForm({title:'Canjear puntos · '+c.data.full_name,ok:'Canjear',body:`<p>Saldo: <b>${c.data.points_balance} puntos</b></p><label class="field">Recompensa<select id="rdReward">${rewards.map(r=>`<option value="${esc(r.id)}">${esc(r.title)} · ${r.points_cost} puntos</option>`).join('')}</select></label>`,submit:async()=>{const {data,error}=await sb.rpc('redeem_loyalty_reward',{p_phone:c.data.phone,p_reward:$('#rdReward').value});if(error)throw error;toast('Canje generado: '+data.code,'ok');}});},
    campaignnew:()=>openForm({title:'Nueva campaña',ok:'Guardar borrador',wide:true,body:`<label class="field">Nombre<input id="mcName" maxlength="100" required></label><label class="field">Mensaje<textarea id="mcMessage" maxlength="700" required rows="5"></textarea></label><label class="field">Segmento<select id="mcSegment"><option value="consented">Solo clientes con consentimiento</option><option value="all">Todos los clientes (se filtrará por consentimiento al enviar)</option><option value="frequent">Frecuentes</option><option value="inactive">Inactivos</option><option value="birthday">Cumpleaños</option></select></label>`,submit:async()=>{const name=$('#mcName').value.trim(),message=$('#mcMessage').value.trim();if(name.length<3||message.length<10)throw new Error('Completa el nombre y un mensaje de al menos 10 caracteres.');const {error}=await sb.from('marketing_campaigns').insert({name,message,segment:$('#mcSegment').value,created_by:A.profile.id});if(error)throw error;await reload();}}),
    campaigntoggle:async el=>{const {data,error}=await sb.from('marketing_campaigns').select('*').eq('id',el.dataset.id).single();if(error)throw error;const r=await sb.from('marketing_campaigns').update({status:data.status==='paused'?'ready':'paused'}).eq('id',data.id);if(r.error)throw r.error;await reload();},
    campaigndelete:async el=>{const {data,error}=await sb.from('marketing_campaigns').select('id,name,status').eq('id',el.dataset.id).single();if(error)throw error;openForm({title:'Eliminar campaña',ok:'Sí, eliminar',body:`<p>¿Eliminar definitivamente la campaña <b>${esc(data.name)}</b>?</p><p class="hint">Esta acción no se puede deshacer. No afecta a los clientes ni a sus permisos de consentimiento.</p>`,submit:async()=>{const {error:delError}=await sb.from('marketing_campaigns').delete().eq('id',data.id);if(delError)throw delError;toast('Campaña eliminada.','ok');await reload();}});},
    campaignopen:async el=>{const {data:c,error}=await sb.from('marketing_campaigns').select('*').eq('id',el.dataset.id).single();if(error)throw error;let query=sb.from('customers').select('*').eq('marketing_consent',true);if(c.segment==='frequent')query=query.gte('lifetime_spend',200);if(c.segment==='inactive')query=query.lt('last_order_at',new Date(Date.now()-30*86400000).toISOString());if(c.segment==='birthday')query=query.not('birthday','is',null);const {data:people,error:e}=await query.limit(100);if(e)throw e;if(!people.length){toast('No hay clientes con consentimiento en ese segmento.','err');return;}openForm({title:'Destinatarios · '+c.name,ok:'Cerrar',body:`<p class="hint">${people.length} cliente(s). Abre cada chat manualmente; no se envían mensajes automáticos.</p><div class="list">${people.map(x=>`<div class="item"><div class="main"><b>${esc(x.full_name)}</b><small>${esc(x.phone)}</small></div><a class="btn ghost sm" target="_blank" rel="noopener" href="${esc(waUrl(x.phone,c.message))}">Abrir WhatsApp</a></div>`).join('')}</div>`,submit:async()=>{}});},
    cashopen:()=>openForm({title:'Abrir caja',ok:'Abrir',body:`<label class="field">Fondo inicial (S/)<input id="cashOpening" type="number" min="0" step="0.01" value="0" required></label>`,submit:async()=>{const v=Number($('#cashOpening').value);if(!isFinite(v)||v<0)throw new Error('Monto inválido.');const {error}=await sb.from('cash_sessions').insert({opened_by:A.profile.id,opening_amount:v});if(error)throw error;await reload();}}),
    cashmove:el=>openForm({title:'Movimiento de caja',ok:'Registrar',body:`<label class="field">Tipo<select id="cmKind"><option value="income">Ingreso</option><option value="expense">Egreso</option><option value="withdrawal">Retiro</option><option value="deposit">Depósito</option></select></label><label class="field">Monto (S/)<input id="cmAmount" type="number" min="0.01" step="0.01" required></label><label class="field">Descripción<input id="cmDesc" maxlength="160" required></label>`,submit:async()=>{const amount=Number($('#cmAmount').value),description=$('#cmDesc').value.trim();if(!isFinite(amount)||amount<=0||!description)throw new Error('Completa el monto y la descripción.');const {error}=await sb.from('cash_movements').insert({session_id:el.dataset.id,kind:$('#cmKind').value,amount,description,created_by:A.profile.id});if(error)throw error;await reload();}}),
    cashclose:el=>openForm({title:'Cerrar caja',ok:'Cerrar caja',body:`<label class="field">Efectivo contado al cierre (S/)<input id="cashClosing" type="number" min="0" step="0.01" required></label><label class="field">Nota<input id="cashNote" maxlength="200"></label>`,submit:async()=>{const closing_amount=Number($('#cashClosing').value);if(!isFinite(closing_amount)||closing_amount<0)throw new Error('Monto inválido.');const {error}=await sb.from('cash_sessions').update({status:'closed',closed_by:A.profile.id,closed_at:new Date().toISOString(),closing_amount,note:$('#cashNote').value.trim()}).eq('id',el.dataset.id).eq('status','open');if(error)throw error;await reload();}}),
    deliveryassign:async el=>{const order=A.d.orders.find(o=>o.id===el.dataset.id);const {data:old}=await sb.from('delivery_assignments').select('*').eq('order_id',order.id).maybeSingle();openForm({title:'Asignar repartidor · '+order.number,ok:'Guardar',body:`<label class="field">Nombre<input id="courierName" required maxlength="80" value="${esc(old?.courier_name||'')}"></label><label class="field">Celular<input id="courierPhone" maxlength="16" value="${esc(old?.courier_phone||'')}"></label><label class="field">Estado<select id="courierStatus"><option value="assigned">Asignado</option><option value="picked_up">Recogido</option><option value="on_the_way">En camino</option><option value="delivered">Entregado</option><option value="failed">Incidencia</option></select></label><label class="field">Notas<input id="courierNotes" maxlength="200" value="${esc(old?.notes||'')}"></label>`,submit:async()=>{const payload={order_id:order.id,courier_name:$('#courierName').value.trim(),courier_phone:$('#courierPhone').value.trim()||null,delivery_status:$('#courierStatus').value,assigned_by:A.profile.id,notes:$('#courierNotes').value.trim()||null};if(payload.courier_name.length<2)throw new Error('Escribe el nombre del repartidor.');const {error}=old?await sb.from('delivery_assignments').update(payload).eq('id',old.id):await sb.from('delivery_assignments').insert(payload);if(error)throw error;await reload();}});if(old)$('#courierStatus').value=old.delivery_status;},
    locationnew:()=>locationForm(null),
    locationedit:async el=>{const {data,error}=await sb.from('store_locations').select('*').eq('id',el.dataset.id).single();if(error)throw error;locationForm(data);},
    prodnew: () => productForm(null),
    prodedit: (el) => productForm(A.d.products.find((p) => p.id === el.dataset.id)),
    stockadj: (el) => stockForm(A.d.products.find((p) => p.id === el.dataset.id)),
    stockpick: () => {
      const prods = A.d.products.filter((p) => p.active); if (!prods.length) { toast('Primero crea un producto.', 'err'); return; }
      openForm({ title: 'Ajustar stock', ok: 'Continuar', body: `<label class="field">Producto<select id="spPick">${prods.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} ${esc(p.size || '')} (stock ${p.stock})</option>`).join('')}</select></label>`,
        submit: async () => { const id = $('#spPick').value; setTimeout(() => stockForm(A.d.products.find((p) => p.id === id)), 0); } });
    },
    prodtoggle: async (el) => {
      const p = A.d.products.find((x) => x.id === el.dataset.id); const to = !p.active;
      const c = await confirmBox({ title: to ? 'Reactivar producto' : 'Archivar producto', text: to ? `"${p.name}" volverá a mostrarse en la tienda.` : `"${p.name}" dejará de mostrarse en la tienda. Su historial se conserva.`, ok: to ? 'Reactivar' : 'Archivar' });
      if (!c.ok) return;
      try { await submit('product', 'update', p.id, { active: to }, `${to ? 'Reactivar' : 'Archivar'} producto "${p.name}"`); modal.open && modal.close(); await reload(); } catch (e) { toast(errMsg(e), 'err'); }
    },
    purchasenew: () => purchaseForm(),
    expnew: () => expenseForm(null),
    expedit: (el) => expenseForm(el.dataset.id),
    expdel: async (el) => {
      const c = await confirmBox({ title: 'Eliminar gasto', text: 'Este gasto dejará de contarse en los reportes. ¿Continuar?', ok: 'Eliminar', danger: true });
      if (!c.ok) return;
      try { await submit('expense', 'delete', el.dataset.id, {}, 'Eliminar un gasto'); modal.open && modal.close(); await reload(); } catch (e) { toast(errMsg(e), 'err'); }
    },
    orderstatus: async (el) => {
      el.disabled = true;
      try {
        const { error } = await sb.rpc('set_order_status', { p_id: el.dataset.id, p_status: el.dataset.to }); if (error) throw error;
        toast('Pedido actualizado.', 'ok'); await loadCore(); renderTabs(); await reload();
        const o = A.d.orders.find((x) => x.id === el.dataset.id);
        if (o && MSG_LABEL[el.dataset.to]) notifyCustomer(o, el.dataset.to);
      } catch (e) { toast(errMsg(e), 'err'); el.disabled = false; }
    },
    ordercancel: async (el) => {
      const o = A.d.orders.find((x) => x.id === el.dataset.id);
      const c = await confirmBox({ title: `Cancelar ${o.number}`, text: isOwner() ? 'El pedido se cancela y el stock vuelve al inventario.' : 'Tu solicitud de cancelación se envía al dueño. El pedido sigue activo hasta que la apruebe.', ok: isOwner() ? 'Cancelar pedido' : 'Solicitar cancelación', danger: true, field: 'Motivo (opcional)' });
      if (!c.ok) return;
      try { await submit('order_cancel', 'update', o.id, {}, `Cancelar pedido ${o.number} de ${o.customer_name}${c.text ? ' · ' + c.text : ''}`); modal.open && modal.close(); await reload(); } catch (e) { toast(errMsg(e), 'err'); }
    },
    combonew: () => comboForm(null),
    comboedit: (el) => comboForm((A.d.combos || []).find((c) => c.id === el.dataset.id)),
    combotoggle: async (el) => {
      const c = (A.d.combos || []).find((x) => x.id === el.dataset.id);
      try { await submit('combo', 'update', c.id, { active: !c.active }, `${c.active ? 'Desactivar' : 'Activar'} combo "${c.name}"`); await reload(); } catch (e) { toast(errMsg(e), 'err'); }
    },
    giftpromonew: () => giftPromoForm(null),
    giftpromoedit: (el) => giftPromoForm((A.d.promotions||[]).find(x=>x.id===el.dataset.id)),
    giftpromotoggle: async (el) => { const g=(A.d.promotions||[]).find(x=>x.id===el.dataset.id); try { const {error}=await sb.rpc('save_bayu_promotion',{p_id:g.id,p_payload:{...g,active:!g.active}}); if(error) throw error; toast(g.active?'Ticket pausado.':'Ticket activado.','ok'); await loadCore(); await reload(); } catch(e){toast(errMsg(e),'err');} },
    offernew: () => offerForm(null),
    offeredit: (el) => offerForm(A.d.products.find((p) => p.id === el.dataset.id)),
    offerclear: async (el) => {
      const pr = A.d.products.find((p) => p.id === el.dataset.id);
      try { await submit('product', 'update', pr.id, { promo_price: null, promo_until: null }, `Quitar la oferta de "${pr.name}"`); await reload(); } catch (e) { toast(errMsg(e), 'err'); }
    },
    notifycust: (el) => { const o = A.d.orders.find((x) => x.id === el.dataset.id); if (o && MSG_LABEL[o.status]) notifyCustomer(o, o.status); },
    msgedit: (el) => {
      const st = el.dataset.st; const cur = (A.d.settings['msg_' + st]) || MSG_DEFAULT[st];
      openForm({ title: 'Mensaje: ' + MSG_LABEL[st].toLowerCase(), ok: 'Guardar mensaje', wide: true,
        body: `<label class="field">Texto<textarea id="msgTxt" maxlength="300" rows="4">${esc(cur)}</textarea><span class="hint">Puedes usar {nombre}, {pedido} y {total}; se reemplazan solos.</span></label>`,
        submit: async () => { const v = $('#msgTxt').value.trim(); if (v.length < 10) throw new Error('El mensaje es muy corto.'); await settingSubmit('msg_' + st, v, 'Mensaje de ' + MSG_LABEL[st].toLowerCase()); } });
    },
    tgcfg: () => openForm({ title: 'Avisos por Telegram', ok: 'Guardar', wide: true,
      body: `<ol style="color:var(--muted);padding-left:20px;margin-bottom:14px;line-height:1.6"><li>En Telegram busca <b>@BotFather</b>, escribe <b>/newbot</b> y sigue los pasos. Te da un <b>token</b>.</li><li>Abre tu nuevo bot y toca <b>Iniciar</b> (así puede escribirte).</li><li>Busca <b>@userinfobot</b>, toca Iniciar: te muestra tu <b>ID</b> (solo números).</li></ol>
        <label class="field">Token del bot<input id="tgTok" type="password" autocomplete="off" placeholder="123456789:AA..."><span class="hint">Se guarda en el servidor; nadie lo puede leer desde el navegador.</span></label>
        <label class="field">Tu ID de Telegram<input id="tgChat" type="text" inputmode="numeric" placeholder="123456789"></label>`,
      submit: async () => {
        const t = $('#tgTok').value.trim(); const c = $('#tgChat').value.trim();
        if (!/^[0-9]{6,12}:[A-Za-z0-9_-]{20,}$/.test(t)) throw new Error('El token no parece válido. Cópialo completo desde BotFather.');
        if (!/^-?[0-9]{5,20}$/.test(c)) throw new Error('El ID son solo números.');
        let r = await sb.rpc('set_notify_config', { p_key: 'telegram_token', p_value: t }); if (r.error) throw r.error;
        r = await sb.rpc('set_notify_config', { p_key: 'telegram_chat', p_value: c }); if (r.error) throw r.error;
        toast('Telegram guardado. Envía una prueba.', 'ok');
      } }),
    tgoff: async () => {
      const c = await confirmBox({ title: 'Apagar avisos por Telegram', text: 'Dejarás de recibir los pedidos nuevos por Telegram.', ok: 'Apagar', danger: true });
      if (!c.ok) return;
      try { for (const k of ['telegram_token', 'telegram_chat']) { const r = await sb.rpc('set_notify_config', { p_key: k, p_value: '' }); if (r.error) throw r.error; } modal.open && modal.close(); toast('Telegram apagado.', 'ok'); await reload(); } catch (e) { toast(errMsg(e), 'err'); }
    },
    pushcfg: () => openForm({ title: 'Servidor de avisos del navegador', ok: 'Guardar', wide: true,
      body: `<p style="color:var(--muted);margin-bottom:12px">Esto se hace una sola vez, después de publicar la función <b>notify-order</b> (pasos en LEEME.md, sección Avisos).</p>
        <label class="field">Dirección de la función<input id="pcUrl" type="url" placeholder="https://TU-PROYECTO.supabase.co/functions/v1/notify-order"></label>
        <label class="field">Clave secreta (NOTIFY_SECRET)<input id="pcSec" type="password" autocomplete="off"><span class="hint">La misma que pusiste como secreto en la función.</span></label>`,
      submit: async () => {
        const u = $('#pcUrl').value.trim(); const k = $('#pcSec').value.trim();
        if (!/^https:\/\/.+/.test(u)) throw new Error('La dirección debe empezar con https://');
        if (k.length < 12) throw new Error('La clave debe tener al menos 12 caracteres.');
        let r = await sb.rpc('set_notify_config', { p_key: 'push_url', p_value: u }); if (r.error) throw r.error;
        r = await sb.rpc('set_notify_config', { p_key: 'push_secret', p_value: k }); if (r.error) throw r.error;
        toast('Servidor de avisos guardado.', 'ok');
      } }),
    notifytest: async (el) => {
      el.disabled = true;
      try { const r = await sb.rpc('send_test_notification'); if (r.error) throw r.error; toast('Prueba enviada. Revisa Telegram y tu celular en unos segundos.', 'ok'); } catch (e) { toast(errMsg(e), 'err'); }
      el.disabled = false;
    },
    pushon: async () => { try { await enablePush(); toast('Avisos activados en este dispositivo.', 'ok'); await reload(); } catch (e) { toast(errMsg(e), 'err'); } },
    pushoff: async () => { try { await disablePush(); toast('Avisos desactivados en este dispositivo.', 'ok'); await reload(); } catch (e) { toast(errMsg(e), 'err'); } },
    approve: async (el) => { await review(el.dataset.id, true); },
    reject: async (el) => {
      const c = await confirmBox({ title: 'Rechazar solicitud', text: 'El cambio no se aplicará.', ok: 'Rechazar', danger: true, field: 'Motivo (opcional)' });
      if (c.ok) { modal.open && modal.close(); await review(el.dataset.id, false, c.text); }
    },
    csv: () => downloadCsv(),
    freetoggle: async () => { try { await settingSubmit('free_delivery_enabled', !(A.d.settings.free_delivery_enabled === true), 'Delivery gratis'); await reload(); } catch (e) { toast(errMsg(e), 'err'); } },
    freemin: () => openForm({ title: 'Monto mínimo para delivery gratis', ok: 'Guardar', body: `<label class="field">Monto (S/)<input id="fmin" type="number" inputmode="decimal" min="0" step="0.01" value="${num(A.d.settings.free_delivery_min)}"><span class="hint">0 = delivery gratis en todos los pedidos.</span></label>`,
      submit: async () => { const v = Number($('#fmin').value); if (!isFinite(v) || v < 0) throw new Error('Escribe un monto válido.'); await settingSubmit('free_delivery_min', v, 'Monto mínimo de delivery gratis'); } }),
    wa: () => openForm({ title: 'WhatsApp de pedidos', ok: 'Guardar', body: `<label class="field">Número con código de país<input id="waNum" type="tel" inputmode="numeric" value="${esc(A.d.settings.whatsapp || '')}" placeholder="51960577902"><span class="hint">Solo números, sin + ni espacios.</span></label>`,
      submit: async () => { const v = $('#waNum').value.replace(/\s/g, ''); if (!/^[0-9]{8,15}$/.test(v)) throw new Error('Escribe solo números con código de país (ej. 51960577902).'); await settingSubmit('whatsapp', v, 'WhatsApp del negocio'); } }),
    storename: () => openForm({ title: 'Nombre del negocio', ok: 'Guardar', body: `<label class="field">Nombre<input id="snName" type="text" maxlength="60" value="${esc(A.d.settings.store_name || '')}"></label>`,
      submit: async () => { const v = $('#snName').value.trim(); if (v.length < 2) throw new Error('Escribe un nombre válido.'); await settingSubmit('store_name', v, 'Nombre del negocio'); } }),
    zonenew: () => zoneForm(null),
    zoneedit: (el) => zoneForm(A.d.zones.find((z) => z.id === el.dataset.id)),
    zonetoggle: async (el) => {
      const z = A.d.zones.find((x) => x.id === el.dataset.id);
      try { await submit('zone', 'update', z.id, { active: !z.active }, `${z.active ? 'Desactivar' : 'Activar'} zona "${z.name}"`); await reload(); } catch (e) { toast(errMsg(e), 'err'); }
    }
  };
  async function review(id, approve, note) {
    try {
      const { error } = await sb.rpc('review_change', { p_id: id, p_approve: approve, p_note: note || null }); if (error) throw error;
      toast(approve ? 'Cambio aprobado y aplicado.' : 'Solicitud rechazada.', 'ok'); await loadCore(); renderTabs(); await reload();
    } catch (e) { toast(errMsg(e), 'err'); await loadCore().catch(() => {}); renderTabs(); await reload(); }
  }
  $('#view').addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]'); if (go) { location.hash = go.dataset.go; return; }
    const of = e.target.closest('[data-orderf]'); if (of) { A.f.orders = of.dataset.orderf; return show('pedidos', true); }
    const pf = e.target.closest('[data-prodf]'); if (pf) { A.f.prodF = pf.dataset.prodf; return show('productos', true); }
    const mf = e.target.closest('[data-movef]'); if (mf) { A.f.moveKind = mf.dataset.movef; return show('inventario', true); }
    const rp = e.target.closest('[data-rep]'); if (rp) { A.f.rep.preset = rp.dataset.rep; return show('reportes', true); }
    if (e.target.id === 'rApply') {
      const f = $('#rFrom').value; const t = $('#rTo').value;
      if (!f || !t || t < f) { toast('Revisa las fechas del reporte.', 'err'); return; }
      A.f.rep.from = f; A.f.rep.to = t; return show('reportes', true);
    }
    const b = e.target.closest('[data-act]'); if (b && ACT[b.dataset.act]) ACT[b.dataset.act](b);
  });

  $('#view').addEventListener('change', async (e) => {
    const input = e.target.closest('[data-visual-upload]');
    if (!input || !input.files || !input.files[0]) return;
    if (!isOwner()) { toast('Solo el dueño puede cambiar estas imágenes.', 'err'); input.value = ''; return; }
    const key = input.dataset.visualUpload;
    const labels = { visual_combo_banner: 'Banner de ofertas y combos', visual_points_banner: 'Banner de BAYU COIN', visual_offers_banner: 'Imagen de ofertas' };
    const file = input.files[0]; input.disabled = true;
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Usa una imagen PNG, JPG o WebP.');
      const url = await uploadImage(file, 1600);
      const { error } = await sb.rpc('save_storefront_asset', { p_key: key, p_url: url });
      if (error) throw error;
      toast('Imagen actualizada: ' + labels[key], 'ok');
      await loadCore(); await show('ajustes', true);
    } catch (err) { toast(errMsg(err), 'err'); }
    finally { input.disabled = false; input.value = ''; }
  });

  // =================================================================== arranque
  async function boot() {
    if (!sb) { showSetup(); return; }
    const { data } = await sb.auth.getSession();
    if (data && data.session) await enter(data.session.user); else showLogin();
  }
  boot();
})();
