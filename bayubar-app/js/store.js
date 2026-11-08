// BAYU BAR · tienda (clientes)
(function () {
  'use strict';
  const { esc, money, norm, store: ls, toast, errMsg, cfg } = BB;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ------------------------------------------------------------ datos de ejemplo (modo demostración)
  const DEMO_PRODUCTS = [
    { id: 'd1', name: 'Cerveza lager', category: 'Cervezas', size: '620 ml', price: 9, stock: 40 },
    { id: 'd2', name: 'Six-pack lager', category: 'Cervezas', size: '6 × 355 ml', price: 24, stock: 12 },
    { id: 'd3', name: 'Ron añejo', category: 'Ron y whisky', size: '750 ml', price: 49, promo_price: 42, stock: 8 },
    { id: 'd4', name: 'Whisky 12 años', category: 'Ron y whisky', size: '750 ml', price: 119, stock: 2 },
    { id: 'd5', name: 'Vino tinto reserva', category: 'Vinos', size: '750 ml', price: 35, stock: 10 },
    { id: 'd6', name: 'Espumante brut', category: 'Vinos', size: '750 ml', price: 45, stock: 0 },
    { id: 'd7', name: 'Pisco quebranta', category: 'Pisco y vodka', size: '500 ml', price: 38, stock: 14 },
    { id: 'd8', name: 'Hielo', category: 'Extras', size: 'Bolsa 2 kg', price: 6, stock: 30 }
  ];
  const DEMO_ZONES = [{ id: 'z1', name: 'Centro de San Miguel', fee: 3 }, { id: 'z2', name: 'Alrededores', fee: 6 }];
  const DEMO_COMBOS = [
    { id: 'k1', name: 'Noche de amigos', description: 'Para compartir en casa.', price: 55, ends_on: null, items: [{ product_id: 'd2', name: 'Six-pack lager', size: '6 × 355 ml', qty: 2 }, { product_id: 'd8', name: 'Hielo', size: 'Bolsa 2 kg', qty: 1 }] },
    { id: 'k2', name: 'Para el trago', description: null, price: 80, ends_on: null, items: [{ product_id: 'd3', name: 'Ron añejo', size: '750 ml', qty: 1 }, { product_id: 'd8', name: 'Hielo', size: 'Bolsa 2 kg', qty: 1 }, { product_id: 'd4', name: 'Whisky 12 años', size: '750 ml', qty: 1 }] }
  ];

  // ------------------------------------------------------------ estado
  const S = {
    demo: !BB.configured,
    products: [], combos: [], zones: [], promotions: [],
    settings: { whatsapp: cfg.WHATSAPP || '51960577902', free_delivery_enabled: false, free_delivery_min: 0 },
    cart: ls.get('bb_cart_v3', {}),     // clave = id de producto, o "c:<id>" para combos
    cat: 'Todo', query: '', loadedAt: 0, submitting: false, order: null
  };
  const sb = S.demo ? null : BB.db({ auth: { persistSession: false, autoRefreshToken: false } });

  const byId = (id) => S.products.find((p) => p.id === id);
  const comboById = (id) => S.combos.find((c) => c.id === id);
  const isCombo = (k) => String(k).startsWith('c:');
  const hasPromo = (p) => p.promo_price !== null && p.promo_price !== undefined;
  const unitPrice = (p) => (hasPromo(p) ? Number(p.promo_price) : Number(p.price));
  // En producción el catálogo expone disponibilidad, no el inventario exacto.
  // El límite real de unidades se valida en Supabase al confirmar el pedido.
  // En demo se conserva el stock de ejemplo.
  const maxQty = (p) => S.demo
    ? Math.max(0, Math.min(99, Number(p.stock) || 0))
    : (p.available === true ? 99 : 0);
  const maxQtyCombo = (c) => S.demo
    ? Math.max(0, Math.min(99, Number(c.available_units) || 0))
    : (Number(c.available_units) > 0 ? 99 : 0);
  const lookup = (key) => (isCombo(key) ? { combo: true, item: comboById(key.slice(2)) } : { combo: false, item: byId(key) });
  const maxFor = (key) => { const x = lookup(key); return !x.item ? 0 : x.combo ? maxQtyCombo(x.item) : maxQty(x.item); };
  const saveCart = () => ls.set('bb_cart_v3', S.cart);
  const cartItems = () => Object.keys(S.cart).map((key) => {
    const x = lookup(key); const q = S.cart[key];
    return x.item && q > 0 ? { key, combo: x.combo, item: x.item, q, price: x.combo ? Number(x.item.price) : unitPrice(x.item) } : null;
  }).filter(Boolean);
  const cartCount = () => cartItems().reduce((t, x) => t + x.q, 0);
  const cartSub = () => cartItems().reduce((t, x) => t + x.q * x.price, 0);
  const waNumber = () => String(S.settings.whatsapp || cfg.WHATSAPP || '').replace(/\D/g, '');
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  const fmtShort = (d) => { if (!d) return ''; const [y, m, day] = String(d).slice(0, 10).split('-'); return `${day}/${m}`; };

  function feeFor(sub, zone) {
    if (!zone) return null;
    const free = S.settings.free_delivery_enabled === true && sub >= Number(S.settings.free_delivery_min || 0);
    return free ? 0 : Number(zone.fee) || 0;
  }

  // ------------------------------------------------------------ imágenes
  const PALETTE = ['#c98a1a', '#a04a1c', '#8a1a3e', '#4c8a6b', '#9fb4c9', '#d8d1a0', '#b8741f', '#2f7fb5', '#7a4a8f'];
  function hue(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
  function bottleShape(c, cat) {
    if (/vino|espum/.test(cat)) return `<path d="M35 8h10v38c0 10 13 16 13 40v70c0 6-4 10-10 10H32c-6 0-10-4-10-10V86c0-24 13-30 13-40Z" fill="${c}"/><rect x="34" y="4" width="12" height="16" rx="2" fill="#1b2236"/><rect x="27" y="104" width="26" height="38" rx="2" fill="#f4ecd9"/><rect x="31" y="112" width="18" height="3" rx="1.5" fill="${c}"/>`;
    if (/cerveza|six|lager/.test(cat)) return `<rect x="17" y="34" width="46" height="112" rx="9" fill="${c}"/><rect x="19" y="28" width="42" height="9" rx="3" fill="#cfd6e4"/><rect x="19" y="143" width="42" height="7" rx="3" fill="#cfd6e4"/><rect x="17" y="66" width="46" height="44" fill="#f4ecd9" opacity=".9"/><rect x="24" y="80" width="32" height="4" rx="2" fill="${c}"/>`;
    if (/extra|hielo|vasos/.test(cat)) return `<path d="M16 56l6-8 6 8 6-8 6 8 6-8 6 8 6-8 6 8v90c0 6-4 10-10 10H26c-6 0-10-4-10-10Z" fill="${c}" opacity=".9"/><path d="M40 84v40M24 104h32" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>`;
    return `<rect x="31" y="3" width="18" height="12" rx="2" fill="#1b2236"/><path d="M33 14h14v22c0 8 15 14 15 34v84c0 6-4 10-10 10H28c-6 0-10-4-10-10V70c0-20 15-26 15-34Z" fill="${c}"/><rect x="24" y="92" width="32" height="46" rx="2" fill="#f4ecd9"/><rect x="29" y="100" width="22" height="3" rx="1.5" fill="${c}"/>`;
  }
  function placeholder(p) {
    return `<svg viewBox="0 0 80 170" aria-hidden="true">${bottleShape(hue(p.name), norm(p.category))}<rect x="23" y="60" width="5" height="90" rx="2.5" fill="#fff" opacity=".16"/></svg>`;
  }
  function comboPlaceholder(c) {
    const its = (c.items || []).slice(0, 3);
    const pos = its.length === 1 ? [[0, 0, 1]] : its.length === 2 ? [[-34, 6, .9], [34, 6, .9]] : [[-52, 14, .8], [0, 0, 1], [52, 14, .8]];
    return `<svg viewBox="-70 0 220 170" aria-hidden="true">${its.map((it, i) => `<g transform="translate(${40 + pos[i][0]} ${pos[i][1]}) scale(${pos[i][2]}) translate(-40 0)">${bottleShape(hue(it.name), norm(it.name + ' ' + (it.size || '')))}</g>`).join('')}</svg>`;
  }
  function art(item, combo) {
    const u = safeUrl(item.image_url);
    if (u) return `<img class="ph" src="${esc(u)}" alt="${esc(item.name)}" loading="lazy" decoding="async" width="480" height="440" data-img>`;
    return combo ? comboPlaceholder(item) : placeholder(item);
  }

  // ------------------------------------------------------------ carga de datos
  async function load() {
    if (S.demo) {
      S.products = DEMO_PRODUCTS.map((p) => ({ ...p }));
      S.zones = DEMO_ZONES;
      S.combos = DEMO_COMBOS.map((c) => {
        const ps = c.items.map((i) => ({ i, p: byId2(S.products, i.product_id) }));
        return { ...c, regular_price: ps.reduce((t, x) => t + x.i.qty * (x.p ? unitPrice(x.p) : 0), 0), available_units: Math.min(...ps.map((x) => (x.p ? Math.floor(x.p.stock / x.i.qty) : 0))) };
      });
      S.settings.free_delivery_enabled = true; S.promotions = [];
      $('#demoBanner').hidden = false;
    } else {
      const [pr, co, zo, se, pm] = await Promise.all([
        sb.from('public_products').select('id,name,category,size,description,price,promo_price,promo_until,image_url,available').order('category').order('name'),
        sb.from('public_combos').select('id,name,description,price,image_url,ends_on,items,regular_price,available_units').order('name'),
        sb.from('delivery_zones').select('id,name,fee').eq('active', true).order('fee').order('name'),
        sb.from('settings').select('key,value'),
        sb.from('public_bayu_promotion').select('*').limit(1)
      ]);
      if (pr.error) throw pr.error;
      if (zo.error) throw zo.error;
      if (se.error) throw se.error;
      S.promotions = pm.error ? [] : (pm.data || []);
      S.products = pr.data || [];
      S.combos = co.error ? [] : (co.data || []);   // si la sección de combos falla, el catálogo sigue funcionando
      S.zones = zo.data || [];
      (se.data || []).forEach((r) => { S.settings[r.key] = r.value; });
    }
    S.loadedAt = Date.now();
    // La cantidad en el carrito nunca puede superar lo disponible.
    Object.keys(S.cart).forEach((key) => {
      const max = maxFor(key);
      if (max < 1) delete S.cart[key]; else S.cart[key] = Math.min(S.cart[key], max);
    });
    saveCart();
  }
  function byId2(list, id) { return list.find((p) => p.id === id); }

  // ------------------------------------------------------------ render: catálogo
  function categories() {
    const set = [];
    S.products.forEach((p) => { if (!set.includes(p.category)) set.push(p.category); });
    return (S.products.some(hasPromo) ? ['Ofertas'] : []).concat(set);
  }
  function filtered() {
    const q = norm(S.query.trim());
    return S.products.filter((p) => (S.cat === 'Todo' || (S.cat === 'Ofertas' ? hasPromo(p) : p.category === S.cat)) && (!q || norm([p.name, p.size, p.category, p.description, p.brand].filter(Boolean).join(' ')).includes(q)));
  }
  function renderChips() {
    const cats = ['Todo', ...categories()];
    if (!cats.includes(S.cat)) S.cat = 'Todo';
    $('#chips').innerHTML = cats.map((c) => {
      const n = c === 'Todo' ? S.products.length : c === 'Ofertas' ? S.products.filter(hasPromo).length : S.products.filter((p) => p.category === c).length;
      return `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === S.cat}">${esc(c)} <small>${n}</small></button>`;
    }).join('');
  }

  function categoryImage(category) {
    const c = norm(category);
    if (/cerveza/.test(c)) return 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=720&q=85';
    if (/whisky|whiskey|ron/.test(c)) return 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=720&q=85';
    if (/pisco|vodka/.test(c)) return 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?auto=format&fit=crop&w=720&q=85';
    if (/vino|espum/.test(c)) return 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=720&q=85';
    if (/coctel|cocktail/.test(c)) return 'https://images.unsplash.com/photo-1513558161293-cdaf765edfd4?auto=format&fit=crop&w=720&q=85';
    if (/licor|extra/.test(c)) return 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=720&q=85';
    return 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=720&q=85';
  }

  function renderHomeCategories() {
    const grid = $('#homeCategoryGrid');
    if (!grid) return;
    const cats = Array.from(new Set(S.products.map((p) => p.category).filter(Boolean)));
    grid.innerHTML = cats.slice(0, 7).map((category) => {
      const count = S.products.filter((p) => p.category === category).length;
      const image = categoryImage(category);
      return '<button class="home-category-card" type="button" data-home-cat="' + esc(category) + '" style="--cat-image:url(&quot;' + esc(image) + '&quot;)">' +
        '<span class="home-category-copy"><strong>' + esc(category) + '</strong><small>' + count + ' productos</small></span><span class="home-category-arrow" aria-hidden="true">↗</span></button>';
    }).join('');
  }

  function renderOffers() {
    const section = $('#dailyOffers');
    const grid = $('#offersGrid');
    if (!section || !grid) return;
    const offers = S.products.filter((p) => hasPromo(p) && maxQty(p) > 0).slice(0, 4);
    section.hidden = offers.length === 0;
    grid.innerHTML = offers.map(cardHtml).join('');
    bindImgFallback(grid);
    const modalGrid = $('#modalOffersGrid');
    const modalSection = $('#modalOffersSection');
    if (modalGrid && modalSection) {
      modalGrid.innerHTML = offers.map(cardHtml).join('');
      modalSection.hidden = offers.length === 0;
      bindImgFallback(modalGrid);
    }
    updatePromosEmpty();
  }

  function actionsHtml(key, name, max, q) {
    if (max < 1) return `<button class="add" type="button" disabled>Agotado</button>`;
    if (q > 0) return `<div class="stepper"><button type="button" data-dec="${esc(key)}" aria-label="Quitar uno de ${esc(name)}">−</button><b class="num">${q}</b><button type="button" data-inc="${esc(key)}" aria-label="Agregar uno más de ${esc(name)}" ${q >= max ? 'disabled' : ''}>+</button></div>`;
    return `<button class="add" type="button" data-inc="${esc(key)}" aria-label="Añadir ${esc(name)}">Añadir <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>`;
  }
  function cardHtml(p, i) {
    const q = S.cart[p.id] || 0; const max = maxQty(p); const promo = hasPromo(p);
    const tag = max < 1
      ? '<span class="tag none">Agotado</span>'
      : promo
        ? `<span class="tag deal">Oferta${p.promo_until ? ' · hasta ' + esc(fmtShort(p.promo_until)) : ''}</span>`
        : (S.demo && max <= 3)
          ? `<span class="tag low">Quedan ${max}</span>`
          : '';
    const price = promo ? `<span class="price num">${money(p.promo_price)}</span><s class="old num">${money(p.price)}</s>` : `<span class="price num">${money(p.price)}</span>`;
    return `<article class="card ${q ? 'in' : ''} ${max < 1 ? 'out' : ''}" data-card="${esc(p.id)}" style="--i:${Math.min(i, 12)}">
      <div class="art">${tag}${q ? `<span class="qty num">${q}</span>` : ''}${art(p, false)}</div>
      <div class="card-body"><div><h3>${esc(p.name)}</h3><p>${esc([p.size, p.category].filter(Boolean).join(' · '))}</p></div>
      <div class="card-foot"><span class="prices">${price}</span><span class="act">${actionsHtml(p.id, p.name, max, q)}</span></div></div></article>`;
  }
  function comboHtml(c, i) {
    const key = 'c:' + c.id; const q = S.cart[key] || 0; const max = maxQtyCombo(c);
    const save = Number(c.regular_price) - Number(c.price);
    const tag = max < 1
      ? '<span class="tag none">Agotado</span>'
      : save > 0.004
        ? `<span class="tag deal">Ahorras ${money(save)}</span>`
        : (S.demo && max <= 3)
          ? `<span class="tag low">Quedan ${max}</span>`
          : '';
    const list = (c.items || []).map((it) => `<li>${it.qty} × ${esc(it.name)}${it.size ? ' <span>' + esc(it.size) + '</span>' : ''}</li>`).join('');
    const price = save > 0.004 ? `<span class="price num">${money(c.price)}</span><s class="old num">${money(c.regular_price)}</s>` : `<span class="price num">${money(c.price)}</span>`;
    return `<article class="card combo ${q ? 'in' : ''} ${max < 1 ? 'out' : ''}" data-card="${esc(key)}" style="--i:${Math.min(i, 12)}">
      <div class="art">${tag}${q ? `<span class="qty num">${q}</span>` : ''}${art(c, true)}</div>
      <div class="card-body"><div><h3>${esc(c.name)}</h3>${c.description ? `<p>${esc(c.description)}</p>` : ''}<ul class="combo-list">${list}</ul>${c.ends_on ? `<p class="until">Vigente hasta el ${esc(fmtShort(c.ends_on))}</p>` : ''}</div>
      <div class="card-foot"><span class="prices">${price}</span><span class="act">${actionsHtml(key, c.name, max, q)}</span></div></div></article>`;
  }
  function activeGiftPromo() {
    const p = (S.promotions || []).find((x) => x && x.ticket_code);
    return p || null;
  }
  function giftUnlocked() {
    const p = activeGiftPromo();
    return !!p && cartSub() >= Number(p.min_subtotal || 0);
  }
  function renderPromoTicket() {
    const promo = activeGiftPromo();
    let trigger = $('#giftFloatButton');
    let dialog = $('#giftPromoDialog');
    if (!promo) {
      if (trigger) trigger.remove();
      if (dialog) dialog.remove();
      return;
    }
    if (!trigger) {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.id = 'giftFloatButton';
      trigger.className = 'gift-float-button';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', 'giftPromoDialog');
      trigger.innerHTML = '<img src="./assets/gift-bayu.svg" alt=""><span><b>Tu regalo</b><small>Por tu compra</small></span><i aria-hidden="true">✦</i>';
      document.body.appendChild(trigger);
      trigger.addEventListener('click', () => {
        const current = $('#giftPromoDialog');
        if (current && !current.open) current.showModal();
      });
    }
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'giftPromoDialog';
      dialog.className = 'gift-promo-dialog';
      dialog.setAttribute('aria-labelledby', 'giftPromoTitle');
      dialog.innerHTML = '<div class="gift-modal-shell"><button class="gift-modal-close" type="button" aria-label="Cerrar promoción">×</button><div class="gift-modal-content"></div></div>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
      $('.gift-modal-close', dialog).addEventListener('click', () => dialog.close());
    }
    const missing = Math.max(0, Number(promo.min_subtotal) - cartSub());
    const unlocked = missing <= 0;
    const threshold = Math.max(1, Number(promo.min_subtotal) || 1);
    const progress = Math.min(100, Math.max(0, (cartSub() / threshold) * 100));
    const giftImage = safeUrl(promo.gift_image) || './assets/gift-bayu.svg';
    const qty = Math.max(1, Number(promo.gift_qty) || 1);
    const status = unlocked ? '¡Tu regalo está desbloqueado!' : cartSub() > 0 ? 'Agrega ' + money(missing) + ' más para conseguirlo.' : 'Agrega productos al carrito y desbloquea tu regalo.';
    $('.gift-modal-content', dialog).innerHTML = `
      <div class="gift-modal-topline"><span class="gift-modal-kicker">DETALLE ESPECIAL BAYU</span><span class="gift-modal-pill">REGALO</span></div>
      <div class="gift-modal-hero">
        <div class="gift-modal-copy"><p class="overline">PROMOCIÓN ESPECIAL</p>
          <h2 id="giftPromoTitle">${esc(promo.title || 'Tu compra viene con regalo')}</h2>
          <p class="gift-modal-description">${esc(promo.description || 'Llévate un detalle especial por tu compra.')}</p></div>
        <div class="gift-modal-image"><img src="${esc(giftImage)}" alt="${esc(promo.gift_name || 'Regalo BAYU')}" loading="lazy"></div>
      </div>
      <div class="gift-modal-product"><span class="gift-product-icon"><img src="./assets/gift-bayu.svg" alt=""></span>
        <span><small>RECIBIRÁS</small><b>${esc(promo.gift_name || 'Regalo sorpresa')}</b></span><strong>× ${qty}</strong></div>
      <div class="gift-modal-progress"><div class="gift-progress-heading"><b>${status}</b><span>${progress.toFixed(0)}%</span></div>
        <div class="gift-progress-track"><span style="width:${progress.toFixed(1)}%"></span></div>
        <div class="gift-progress-values"><span>Tu compra: ${money(cartSub())}</span><span>Meta: ${money(threshold)}</span></div></div>
      <p class="gift-modal-terms">El regalo se agregará automáticamente al pedido al alcanzar el monto mínimo. Sujeto a disponibilidad de stock y condiciones de la promoción.</p>
      <button class="btn gift-modal-cta" type="button">${unlocked ? '¡Seguir con mi pedido!' : 'Ver productos y completar mi compra'} <span aria-hidden="true">→</span></button>`;
    $('.gift-modal-cta', dialog).addEventListener('click', () => {
      dialog.close();
      $('#catalogo').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function updatePromosEmpty() {
    const empty = $('#modalPromosEmpty');
    if (empty) empty.hidden = S.combos.length > 0 || S.products.some((p) => hasPromo(p) && maxQty(p) > 0);
  }
  function renderCombos() {
    const sec = $('#combos'); const has = S.combos.length > 0;
    if (sec) sec.hidden = !has;
    const feature = $('#comboFeature');
    if (feature) feature.hidden = !has && !S.products.some((p) => hasPromo(p) && maxQty(p) > 0);
    $('#navCombos').hidden = !has && !S.products.some((p) => hasPromo(p) && maxQty(p) > 0);
    const markup = has ? S.combos.map(comboHtml).join('') : '';
    const mainGrid = $('#comboGrid');
    if (mainGrid) mainGrid.innerHTML = markup;
    bindImgFallback(mainGrid);
    const modalGrid = $('#modalComboGrid');
    const modalSection = $('#modalCombosSection');
    if (modalGrid && modalSection) {
      modalGrid.innerHTML = markup;
      modalSection.hidden = !has;
      bindImgFallback(modalGrid);
    }
    updatePromosEmpty();
  }
  function renderGrid() {
    const grid = $('#grid'); const msg = $('#gridMsg');
    const list = filtered();
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = list.map(cardHtml).join('');
    $('#resultCount').textContent = S.products.length ? `${list.length} ${list.length === 1 ? 'producto' : 'productos'}` : '';
    if (!S.products.length) {
      msg.innerHTML = `<div class="msg"><h3 class="dis">Pronto cargaremos el catálogo</h3><p>Estamos preparando la selección. Escríbenos por WhatsApp y te ayudamos con tu pedido.</p><a class="btn" href="${waLink('Hola BAYU BAR, quiero hacer un pedido.')}" target="_blank" rel="noopener">Escribir por WhatsApp</a></div>`;
    } else if (!list.length) {
      msg.innerHTML = `<div class="msg"><h3 class="dis">No encontramos esa bebida</h3><p>Quizá la tengamos disponible. Escríbenos y la buscamos por ti.</p><a class="btn" href="${waLink('Hola BAYU BAR, estoy buscando: ' + S.query.trim())}" target="_blank" rel="noopener">Preguntar por WhatsApp</a></div>`;
    } else msg.innerHTML = '';
    bindImgFallback(grid);
  }
  function bindImgFallback(root) {
    $$('img[data-img]', root).forEach((img) => {
      img.addEventListener('error', () => {
        const card = img.closest('[data-card]'); const k = card && card.dataset.card; const x = k && lookup(k);
        if (x && x.item) img.replaceWith(Object.assign(document.createElement('span'), { innerHTML: x.combo ? comboPlaceholder(x.item) : placeholder(x.item) }).firstChild);
      }, { once: true });
    });
  }
  // Actualiza solo los controles de una tarjeta (evita recargar fotos y repetir animaciones).
  function refreshCard(key) {
    const x = lookup(key);
    const cards = $$('[data-card="' + CSS.escape(key) + '"]');
    if (!x.item || !cards.length) return;
    const q = S.cart[key] || 0;
    cards.forEach((card) => {
      card.classList.toggle('in', q > 0);
      $('.act', card).innerHTML = actionsHtml(key, x.item.name, maxFor(key), q);
      const a = $('.art', card); let badge = $('.qty', a);
      if (q > 0) { if (!badge) { badge = document.createElement('span'); badge.className = 'qty num'; a.prepend(badge); } badge.textContent = q; }
      else if (badge) badge.remove();
    });
  }

  // ------------------------------------------------------------ carrito
  function setQty(key, q) {
    const x = lookup(key); if (!x.item) return;
    const max = maxFor(key);
    if (q > max) { toast(max < 1 ? 'Esto está agotado.' : `Solo quedan ${max} de ${x.item.name}.`); q = max; }
    if (q <= 0) delete S.cart[key]; else S.cart[key] = q;
    saveCart();
    refreshCard(key);
    renderBar(true);
    if ($('#cartDlg').open && stepNow() === 'cart') renderCart();
    if ($('#cartDlg').open && stepNow() === 'checkout') renderSummary();
    renderPromoTicket();
  }
  function renderBar(bump) {
    const n = cartCount(); const sub = cartSub();
    renderPromoTicket();
    $('#cartCount').textContent = n;
    $('#dockCount').textContent = n; $('#dockTotal').textContent = money(sub);
    $('#dockBtn').setAttribute('aria-label', n ? `Ver mi pedido, ${n} productos, ${money(sub)}` : 'Abrir mi pedido vacío');
    const cartDialogOpen = $('#cartDlg').open;
    // El CTA de pedido aparece solo cuando hay productos en el carrito.
    $('#dock').hidden = n === 0 || cartDialogOpen;
    const giftButton = $('#giftFloatButton');
    if (giftButton) {
      // El acceso al regalo aparece únicamente cuando el CTA de pedido está oculto.
      giftButton.hidden = n > 0 || cartDialogOpen;
      giftButton.setAttribute('aria-hidden', giftButton.hidden ? 'true' : 'false');
    }
    if (bump) { [$('#cartCount'), $('#dockCount')].forEach((el) => { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }); }
  }
  function renderCart() {
    const items = cartItems();
    const p = activeGiftPromo();
    const unlocked = giftUnlocked();
    const normalLines = items.length ? items.map(({ key, item, q, price, combo }) => `<div class="line"><div><b>${esc(item.name)}</b><small>${combo ? 'Combo' : esc(item.size || '')} · ${money(price * q)}</small></div>
      <div class="stepper"><button type="button" data-dec="${esc(key)}" aria-label="Quitar uno de ${esc(item.name)}">−</button><b class="num">${q}</b><button type="button" data-inc="${esc(key)}" aria-label="Agregar uno más de ${esc(item.name)}" ${q >= maxFor(key) ? 'disabled' : ''}>+</button></div></div>`).join('')
      : '<p class="empty">Aún no agregaste nada. Toca <b>Añadir</b> en cualquier bebida o combo para empezar.</p>';
    const giftLine = p ? `<div class="line gift-line"><div><b>🎁 Regalo BAYU · ${esc(p.gift_name)}</b><small>${unlocked ? 'Incluido gratis en este pedido' : `Te faltan ${money(Math.max(0,Number(p.min_subtotal)-cartSub()))} para desbloquearlo`}</small></div><b class="num">${unlocked ? 'GRATIS' : 'PENDIENTE'}</b></div>` : '';
    $('#cartLines').innerHTML = normalLines + giftLine;
    $('#cartSub').textContent = money(cartSub());
    $('#toCheckout').disabled = !items.length;
    $('#cartDeliveryNote').textContent = S.settings.free_delivery_enabled === true
      ? (Number(S.settings.free_delivery_min) > 0 ? `Delivery gratis en pedidos desde ${money(S.settings.free_delivery_min)}.` : 'Delivery gratis por reapertura.')
      : 'El costo de delivery se calcula según tu zona.';
  }
  function zoneSel() { return S.zones.find((z) => z.id === $('#fZone').value) || null; }
  function renderSummary() {
    const sub = cartSub(); const zone = zoneSel(); const fee = feeFor(sub, zone);
    $('#sumSub').textContent = money(sub);
    $('#sumFee').textContent = fee === null ? 'Elige tu zona' : fee === 0 ? 'Gratis' : money(fee);
    $('#sumTotal').textContent = money(sub + (fee || 0));
  }

  // ------------------------------------------------------------ diálogo
  const dlg = $('#cartDlg');
  const stepNow = () => (['cart', 'checkout', 'done'].find((s) => !$(`[data-step="${s}"]`).hidden)) || 'cart';
  function step(name) {
    ['cart', 'checkout', 'done'].forEach((s) => { $(`[data-step="${s}"]`).hidden = s !== name; });
    $('#dlgTitle').textContent = name === 'checkout' ? 'Tus datos' : name === 'done' ? 'Listo' : 'Mi pedido';
    $('#dlgOver').textContent = name === 'checkout' ? 'Entrega y pago' : name === 'done' ? 'Confirmación' : 'Tu selección';
  }
  function openCart() {
    if (S.order) { step('done'); } else { step('cart'); renderCart(); }
    if (!dlg.open) dlg.showModal();
    $('#dock').hidden = true;
  }
  function closeCart() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', () => { renderBar(false); if (stepNow() === 'done') { S.order = null; } });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeCart(); });

  function waLink(text) { return `https://wa.me/${waNumber()}?text=${encodeURIComponent(text)}`; }
  function orderText(items, num, name, zone, address, payment, fee, total) {
    const lines = items.map(({ item, q, price, combo }) => `- ${q} x ${combo ? 'Combo ' : ''}${item.name}${!combo && item.size ? ' ' + item.size : ''} (${money(price * q)})`);
    return [`Hola BAYU BAR, ${num ? 'hice el pedido ' + num : 'quiero hacer este pedido'}:`, ...lines,
      `Delivery: ${fee === 0 ? 'Gratis' : money(fee)}`, `Total: ${money(total)}`,
      `Nombre: ${name}`, `Zona: ${zone.name}`, `Dirección: ${address}`, `Pago: ${payment}`].join('\n');
  }

  function showFormError(msg) { const b = $('#formError'); b.textContent = msg; b.hidden = !msg; if (msg) b.scrollIntoView({ block: 'nearest' }); }

  async function submitOrder(ev) {
    ev.preventDefault();
    if (S.submitting) return;
    showFormError('');
    const name = $('#fName').value.trim(); const phone = $('#fPhone').value.trim(); const address = $('#fAddress').value.trim();
    const payment = (document.querySelector('input[name="payment"]:checked') || {}).value;
    const note = $('#fNote').value.trim(); const zone = zoneSel();
    const promo = activeGiftPromo();
    const ticketCode = giftUnlocked() && promo ? String(promo.ticket_code).trim().toUpperCase() : ($('#fTicket')?.value || '').trim().toUpperCase();
    if (name.length < 2) return showFormError('Escribe tu nombre completo.');
    if (!/^\+?[0-9\s-]{7,16}$/.test(phone)) return showFormError('Escribe un número de celular válido.');
    if (!zone) return showFormError('Elige tu zona de entrega.');
    if (address.length < 5) return showFormError('Escribe tu dirección de entrega (calle, número y referencia).');
    if (!$('#fAge').checked) return showFormError('Confirma que eres mayor de 18 años para continuar.');
    const items = cartItems();
    if (!items.length) return showFormError('Tu pedido está vacío.');

    const sub = cartSub(); const fee = feeFor(sub, zone); const total = sub + fee;
    const btn = $('#submitOrder');
    S.submitting = true; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Enviando…';
    try {
      let num = null; let finalTotal = total; let finalFee = fee;
      if (!S.demo) {
        const { data, error } = await sb.rpc('place_order', {
          p_name: name, p_phone: phone, p_address: address, p_zone: zone.id, p_payment: payment,
          p_note: note || null, p_ticket_code: ticketCode || null, p_age_confirmed: $('#fAge').checked, p_marketing_consent: $('#fMarketing')?.checked === true,
          p_items: items.map((x) => (x.combo ? { combo_id: x.item.id, qty: x.q } : { product_id: x.item.id, qty: x.q }))
        });
        if (error) throw error;
        num = data.number; finalTotal = Number(data.total); finalFee = Number(data.delivery_fee);
        if (data.promotion_code) S.appliedPromotion = { code: data.promotion_code, gift: data.gift_name, qty: data.gift_qty };
      }
      const text = orderText(items, num, name, zone, address + (note ? ` (${note})` : ''), payment, finalFee, finalTotal) + (S.appliedPromotion ? `\nTicket aplicado: ${S.appliedPromotion.code}\nRegalo: ${S.appliedPromotion.qty} × ${S.appliedPromotion.gift}` : '');
      S.order = { num, total: finalTotal, text };
      S.appliedPromotion = null; if ($('#fTicket')) $('#fTicket').value = '';
      S.cart = {}; saveCart();
      ls.set('bb_customer', { name, phone, address, zone: zone.id });
      $('#doneNumber').textContent = num || '(modo demostración)';
      $('#doneTotal').textContent = money(finalTotal);
      $('#doneWa').href = waLink(text);
      step('done');
      renderBar(false);
      load().then(() => { renderChips(); renderGrid(); renderCombos(); renderHomeCategories(); renderOffers(); }).catch(() => {});   // refresca el stock
    } catch (e) {
      showFormError(errMsg(e));
      load().then(() => { renderChips(); renderGrid(); renderCombos(); renderSummary(); }).catch(() => {});
    } finally {
      S.submitting = false; btn.disabled = false; btn.textContent = 'Confirmar pedido';
    }
  }

  // ------------------------------------------------------------ textos dinámicos
  function renderSettings() {
    const free = S.settings.free_delivery_enabled === true;
    const min = Number(S.settings.free_delivery_min || 0);
    const num = waNumber();
    const hello = waLink('Hola BAYU BAR, quiero hacer un pedido.');
    $('#waHero').href = hello; $('#waContact').href = hello;
    const loyalty = $('#loyaltyWhatsApp');
    if (loyalty) loyalty.href = waLink('Hola BAYU BAR, quiero consultar mi saldo de puntos y las recompensas disponibles. Mi nombre y celular son: ');
    if (loyalty) loyalty.href = waLink('Hola BAYU BAR, quiero consultar mi saldo de puntos y las recompensas disponibles. Mi nombre y celular son: ');
    $('#proofFree').hidden = !free;
    $('#benefitDelivery').textContent = free ? (min > 0 ? `Gratis desde ${money(min)}` : 'Gratis por reapertura') : 'Cobertura en San Miguel';
    const items = ['BAYU BAR', 'DRINKS · DELIVERY', ...(free ? ['DELIVERY GRATIS'] : []), 'SAN MIGUEL DE PALLAQUES', 'ATENCIÓN +18'];
    const one = '<span>' + items.map((t) => `<i>${esc(t)}</i><i>✦</i>`).join('') + '</span>';
    $('#ticker').innerHTML = one.repeat(4);
    if (free) {
      $('#promoOver').textContent = 'Promoción de reapertura';
      $('#promoTitle').innerHTML = 'El delivery va<br><span class="it">por nuestra cuenta.</span>';
      $('#promoText').textContent = min > 0 ? `Delivery gratis en pedidos desde ${money(min)}. Elige tus bebidas, confirma tu dirección y coordinamos la entrega.` : 'Elige tus bebidas, confirma tu dirección y coordinamos la entrega por WhatsApp.';
    }
    return num;
  }
  function renderZones() {
    const saved = ls.get('bb_customer', {});
    $('#fZone').innerHTML = '<option value="">Elige tu zona…</option>' + S.zones.map((z) => `<option value="${esc(z.id)}">${esc(z.name)}${S.settings.free_delivery_enabled === true && cartSub() >= Number(S.settings.free_delivery_min || 0) ? '' : ' · ' + money(z.fee)}</option>`).join('');
    if (saved.zone && S.zones.some((z) => z.id === saved.zone)) $('#fZone').value = saved.zone;
    if ($('#fTicket')) $('#fTicket').value = '';
  }

  // ------------------------------------------------------------ ficha rápida de producto
  const productDlg = document.createElement('dialog');
  productDlg.className = 'product-dialog';
  productDlg.id = 'productDlg';
  productDlg.innerHTML = '<div class="product-modal-shell"><button class="product-modal-close" type="button" aria-label="Cerrar">×</button><div class="product-modal-content"></div></div>';
  document.body.appendChild(productDlg);
  function openProduct(product) {
    if (!product) return;
    const promo = hasPromo(product);
    const price = promo ? money(product.promo_price) : money(product.price);
    const max = maxQty(product);
    const q = S.cart[product.id] || 0;
    const description = String(product.description || '').trim() || 'Una opción de BAYU BAR para disfrutar y compartir. Consulta disponibilidad y detalles por WhatsApp.';
    $('.product-modal-content', productDlg).innerHTML = `
      <div class="product-modal-image">${art(product, false)}</div>
      <div class="product-modal-info">
        <span class="product-modal-category">${esc(product.category || 'BAYU BAR')}</span>
        <h2>${esc(product.name)}</h2>
        ${product.size ? `<p class="product-modal-size">${esc(product.size)}</p>` : ''}
        <p class="product-modal-description">${esc(description)}</p>
        <div class="product-modal-bottom"><div><strong>${price}</strong>${promo ? `<s>${money(product.price)}</s>` : ''}</div><span class="product-modal-stock ${max < 1 ? 'is-out' : ''}">${max < 1 ? 'Agotado' : 'Disponible'}</span></div>
        <div class="product-modal-action">${actionsHtml(product.id, product.name, max, q)}</div>
      </div>`;
    if (!productDlg.open) productDlg.showModal();
  }
  productDlg.addEventListener('click', (e) => { if (e.target === productDlg || e.target.closest('.product-modal-close')) productDlg.close(); });
  productDlg.addEventListener('close', () => { $('.product-modal-content', productDlg).innerHTML = ''; });

  // ------------------------------------------------------------ eventos
  document.addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]'); const dec = e.target.closest('[data-dec]'); const cat = e.target.closest('[data-cat]');
    const homeCat = e.target.closest('[data-home-cat]');
    const productCard = e.target.closest('#grid [data-card], #offersGrid [data-card]');
    if (inc && !inc.disabled) { const k = inc.dataset.inc; setQty(k, (S.cart[k] || 0) + 1); if (productDlg.open) { const p = S.products.find((x) => String(x.id) === String(k)); if (p) openProduct(p); } }
    else if (dec) { const k = dec.dataset.dec; setQty(k, (S.cart[k] || 0) - 1); if (productDlg.open) { const p = S.products.find((x) => String(x.id) === String(k)); if (p) openProduct(p); } }
    else if (cat) { S.cat = cat.dataset.cat; renderChips(); renderGrid(); }
    else if (homeCat) { S.cat = homeCat.dataset.homeCat; renderChips(); renderGrid(); $('#catalogo').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (productCard) { const p = S.products.find((x) => String(x.id) === String(productCard.dataset.card)); if (p) openProduct(p); }
  });
  $('#search').addEventListener('input', BB.debounce((e) => { S.query = e.target.value; renderGrid(); }, 120));
  const combosDialog = $('#combosPromoDialog');
  $('#comboFeature')?.addEventListener('click', () => { if (combosDialog && !combosDialog.open) combosDialog.showModal(); });
  $('#combosModalClose')?.addEventListener('click', () => combosDialog?.close());
  combosDialog?.addEventListener('click', (event) => { if (event.target === combosDialog) combosDialog.close(); });

  const pointsDialog = $('#pointsPromoDialog');
  $('#pointsFeature')?.addEventListener('click', () => { if (pointsDialog && !pointsDialog.open) pointsDialog.showModal(); });
  $('#pointsModalClose')?.addEventListener('click', () => pointsDialog?.close());
  pointsDialog?.addEventListener('click', (event) => { if (event.target === pointsDialog) pointsDialog.close(); });

  $('#cartOpen').addEventListener('click', openCart);
  $('#dockBtn').addEventListener('click', openCart);
  $('#dlgClose').addEventListener('click', closeCart);
  $('#doneClose').addEventListener('click', () => { S.order = null; closeCart(); });
  $('#toCheckout').addEventListener('click', () => {
    if (!cartItems().length) return;
    const saved = ls.get('bb_customer', {});
    if (!$('#fName').value) $('#fName').value = saved.name || '';
    if (!$('#fPhone').value) $('#fPhone').value = saved.phone || '';
    if (!$('#fAddress').value) $('#fAddress').value = saved.address || '';
    renderZones(); renderSummary(); showFormError(''); step('checkout');
  });
  $('#backToCart').addEventListener('click', () => { step('cart'); renderCart(); });
  $('#fZone').addEventListener('change', renderSummary);
  $('#fTicket')?.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); });
  $('#mobileCartOpen')?.addEventListener('click', openCart);
  $('#orderForm').addEventListener('submit', submitOrder);
  $('#orderForm').addEventListener('input', () => showFormError(''));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - S.loadedAt > 60000 && !dlg.open) load().then(() => { renderChips(); renderGrid(); renderCombos(); renderBar(false); }).catch(() => {});
  });

  // ------------------------------------------------------------ arranque
  function skeletons() { $('#grid').innerHTML = '<div class="skeleton"></div>'.repeat(8); }
  async function boot() {
    skeletons(); renderSettings(); renderBar(false);
    try {
      await load();
      renderSettings(); renderPromoTicket(); renderCombos(); renderChips(); renderGrid(); renderHomeCategories(); renderOffers(); renderBar(false);
    } catch (e) {
      $('#grid').innerHTML = ''; $('#grid').setAttribute('aria-busy', 'false');
      $('#gridMsg').innerHTML = `<div class="msg"><h3 class="dis">No pudimos cargar el catálogo</h3><p>${esc(errMsg(e))}</p><button class="btn" id="retry" type="button">Reintentar</button></div>`;
      $('#retry').addEventListener('click', boot);
    }
  }
  boot();
})();
