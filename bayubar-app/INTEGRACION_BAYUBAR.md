# BAYU BAR · Integración de módulos

## Estado de esta entrega
- La tienda mantiene la interfaz, catálogo, productos, combos, promociones y PWA de la rama principal.
- El checkout incorpora el campo de código promocional `fTicket`, que ya está conectado en `js/store.js` con el RPC `place_order`.
- Se conservan los módulos administrativos existentes en `js/admin.js`: productos, inventario, compras, pedidos, gastos/reportes, aprobaciones, tickets, clientes, fidelización, campañas, caja y asignación de repartos.
- Se conserva la configuración Supabase publicable de `js/config.js`; no se debe publicar ninguna clave `service_role` ni secretos.
- La migración `20261109_bayubar_owner_permissions_and_gift_stock_fix.sql` fue aplicada en el proyecto Supabase de BAYU BAR el 2026-11-09. Limita los módulos de clientes, puntos, campañas, caja y delivery al rol owner; corrige el control de stock al regalar un producto que también forma parte del pedido y retira el permiso RPC público de la función interna de puntos.
- La migración está versionada en este repositorio para reproducibilidad. No volver a ejecutar migraciones ya registradas en producción.

## Publicación
1. Revisar los cambios de esta rama y fusionarlos a `main` cuando estén aprobados.
2. Cloudflare Pages debe publicar la carpeta `bayubar-app` (Build command vacío; output directory `bayubar-app`).
3. Esperar el despliegue y abrir la URL pública en móvil y escritorio.
4. Entrar al panel en `/admin.html`.

## Pruebas obligatorias antes de recibir pedidos reales
- Iniciar sesión con owner y helper y comprobar que el helper no accede a reportes, clientes, fidelización, campañas, caja, repartos ni canjes.
- Crear un ticket temporal con límite de un uso, mínimo de compra y producto de regalo.
- Probar código válido, inválido, vencido, agotado, mínimo no alcanzado y stock insuficiente.
- Probar el regalo cuando el mismo producto también está en el carrito; el stock debe bajar exactamente por la cantidad comprada más la cantidad regalada.
- Confirmar que puntos se acreditan una sola vez al marcar el pedido como entregado.
- Verificar que el consentimiento de marketing sea opcional y solo incluya clientes que lo aceptaron en las campañas.
- Probar pedido completo con Yape/Plin y efectivo, y mensajes de WhatsApp.

## Seguridad y límites
- La función de puntos se ejecuta por trigger y no se expone como RPC.
- Los módulos operativos sensibles son de owner; helper conserva las operaciones previstas en el panel general.
- WhatsApp se abre manualmente desde el dispositivo; no se simula envío automático.
- No se ha realizado un pedido de producción de prueba ni se ha confirmado un despliegue de Cloudflare en esta entrega.
- No ejecutar `supabase/schema.sql` ni `00_limpiar_tablas_antiguas.sql` en la base de producción.

## Optimización visual y gestión de imágenes (2026-11-10)
- Se creó la rama de respaldo `backup/antes-optimizacion-2026-11-09` desde el commit anterior a estos cambios.
- La tienda ajusta el ancho y la retícula para escritorio, mantiene columnas adaptables en laptop/tablet/celular y presenta las imágenes de producto completas con `object-fit: contain`.
- La ficha de producto usa una composición premium y restaura la posición de scroll al cerrarse.
- En Administración → Ajustes → Gestión visual de BAYU BAR, el dueño puede subir banners de ofertas/combos, BAYU COIN y sección de ofertas. Se optimizan a WebP/JPG y se guardan en el bucket público `productos`.
- Las fotos de productos y combos siguen siendo editables desde sus fichas. Se agregó vista previa inmediata y presentación sin recorte en el panel.
- La función `save_storefront_asset` permite guardar solo las tres claves visuales permitidas y exige sesión de dueño. Los enlaces se exponen a la tienda mediante `settings.is_public=true`.
- La migración `20261109_bayubar_visual_asset_management.sql` fue aplicada en Supabase y versionada en este repositorio.
- Para mejores resultados en fotos de productos, usar PNG/WebP con fondo transparente y botella completa dentro del lienzo. La web no elimina fondos que ya estén incrustados en la fotografía.

- El dueño también puede usar **Restaurar original** para quitar una imagen personalizada de banner y volver al recurso gráfico de BAYU BAR.
- La función de guardado permite URL nula únicamente para restaurar el valor original; la autorización sigue limitada al dueño.
- La migración complementaria `20261110_bayubar_visual_asset_reset.sql` fue aplicada en Supabase y versionada.
