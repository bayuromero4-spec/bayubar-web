/* BAYU BAR · navegación móvil de administración */
(function(){
 'use strict';
 const app=document.getElementById('appView');
 if(!app)return;
 const icons={
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  chart:'<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  box:'<path d="m12 3 9 5-9 5-9-5z"/><path d="M3 8v9l9 5 9-5V8M12 13v9"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
 };
 const nav=document.createElement('nav');nav.className='bb-bottom-nav';nav.setAttribute('aria-label','Navegación principal');
 nav.innerHTML=[
  ['resumen','Inicio','home'],['reportes','Balance','chart'],['ventas','Ventas','plus'],['inventario','Inventario','box'],['more','Más','more']
 ].map(([id,label,icon])=>'<button type="button" class="bb-nav-item '+(id==='ventas'?'bb-main-action':'')+'" data-bb-go="'+id+'">'+(id==='ventas'?'<span class="bb-nav-icon">':'')+'<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[icon]+'</svg>'+(id==='ventas'?'</span>':'')+'<span>'+label+'</span></button>').join('');
 nav.hidden = true;
 document.body.appendChild(nav);
 const backdrop=document.createElement('div');backdrop.className='bb-more-backdrop';backdrop.hidden=true;
 backdrop.innerHTML='<section class="bb-more-sheet" role="dialog" aria-modal="true" aria-label="Más módulos"><div class="bb-more-head"><h3>Todos los módulos</h3><button type="button" class="btn ghost sm" data-bb-close>Cerrar</button></div><div class="bb-more-grid"></div><p class="bb-feature-note">Los módulos actuales se mantienen disponibles. Las cuentas por cobrar y por pagar requieren implementar un registro de crédito y abonos antes de mostrar saldos como si fueran deudas reales.</p></section>';
 document.body.appendChild(backdrop);
 const routes=[
  ['pedidos','Pedidos'],['productos','Productos'],['promos','Combos y promociones'],['compras','Compras a proveedores'],['gastos','Gastos'],['clientes','Clientes y BAYUCOIN'],['marketing','Marketing'],['caja','Caja'],['delivery','Repartos'],['aprobaciones','Aprobaciones'],['ajustes','Ajustes']
 ];
 backdrop.querySelector('.bb-more-grid').innerHTML=routes.map(([id,label])=>'<button class="bb-more-link" type="button" data-bb-go="'+id+'">'+label+'</button>').join('');
 function active(){
  const h=(location.hash||'#resumen').slice(1);
  nav.querySelectorAll('[data-bb-go]').forEach(b=>b.setAttribute('aria-current',b.dataset.bbGo===h?'page':'false'));
 }
 function go(id){backdrop.hidden=true;location.hash=id;if(location.hash==='#'+id)active();}
 nav.addEventListener('click',e=>{const b=e.target.closest('[data-bb-go]');if(!b)return;if(b.dataset.bbGo==='more'){backdrop.hidden=false;return;}go(b.dataset.bbGo);});
 backdrop.addEventListener('click',e=>{if(e.target===backdrop||e.target.closest('[data-bb-close]'))backdrop.hidden=true;const b=e.target.closest('[data-bb-go]');if(b)go(b.dataset.bbGo);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')backdrop.hidden=true;});
 window.addEventListener('hashchange',active);
 const oldTabs=document.getElementById('tabs');
 if(oldTabs){oldTabs.setAttribute('aria-hidden','true');}
 nav.hidden = app.hidden;
 const obs=new MutationObserver(()=>{nav.hidden=app.hidden;if(!app.hidden)active();});
 obs.observe(app,{attributes:true,attributeFilter:['hidden']});
 active();
})();