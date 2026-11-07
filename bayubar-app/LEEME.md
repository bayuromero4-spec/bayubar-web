# BAYU BAR · Tienda online + Panel de administración

Dos páginas y una base de datos:

| Archivo | Para quién | Qué hace |
|---|---|---|
| `index.html` | Clientes | Catálogo con fotos, precios y disponibilidad, carrito, dirección, cálculo de delivery por zona, confirmación del pedido y contacto por WhatsApp |
| `admin.html` | Tú y tu ayudante | Productos y precios, entradas/salidas de inventario, compras a proveedores, pedidos y ventas, gastos, ganancias, reportes diarios y mensuales, aprobaciones |
| `supabase/schema.sql` | (una vez) | Crea la base de datos, las reglas de seguridad y toda la lógica |

## Cómo funcionan los dos administradores

- **Tú (dueño):** lo que haces se aplica al instante. Quedan registrados en la bitácora.
- **Tu ayudante:** puede ver pedidos, productos, inventario, compras y gastos, y puede **avanzar pedidos** (confirmar, “salió a entregar”, entregado). Todo lo demás que modifique (crear o editar productos y precios, ajustar stock, registrar compras o gastos, cambiar delivery, **cancelar un pedido**) **queda pendiente** hasta que tú lo apruebes en la pestaña **Aprobaciones**. Si lo rechazas, nada cambia.
- Tu ayudante **no ve** los reportes de ganancias ni la bitácora.
- Esto lo impone la base de datos, no solo la pantalla: aunque alguien manipule el navegador, el ayudante no puede escribir directo en ninguna tabla.

## Instalación (unos 15 minutos)

### 1. Crear el proyecto en Supabase
1. Entra a <https://supabase.com> → **New project** (plan gratuito sirve para empezar). Guarda la contraseña de la base de datos.
2. Espera a que termine de crearse.

### 2. Crear la base de datos
1. En Supabase abre **SQL Editor → New query**.
2. Copia **todo** el contenido de `supabase/schema.sql`, pégalo y pulsa **Run**. Debe terminar en “Success”.

> **Si sale un error como `column "spent_on" does not exist`**: tu proyecto de Supabase ya tenía tablas con los mismos nombres (de una versión anterior). Si ese contenido era de pruebas, ejecuta primero `supabase/00_limpiar_tablas_antiguas.sql` (borra esas tablas y sus datos) y luego repite `schema.sql`. Si tenías datos reales, no lo ejecutes: avísame y los migramos.

### 3. Dar de alta a los dos administradores
1. Abre `supabase/admins.sql`, cambia los dos correos (el tuyo como `owner` y el de tu ayudante como `helper`) y ejecútalo en el SQL Editor.
2. Ve a **Authentication → Users → Add user → Create new user**. Crea dos usuarios con **esos mismos correos**, una contraseña segura para cada uno y marca **Auto Confirm User**.
3. Ve a **Authentication → Sign In / Providers** y **desactiva “Allow new users to sign up”**. Así nadie más puede registrarse.

### 4. Conectar las páginas
1. En Supabase: **Project Settings → API**. Copia **Project URL** y la clave **anon public**.
2. Abre `js/config.js` y pégalas. **Nunca uses la clave `service_role`.**

En esta versión, js/config.js ya está configurado para conectarse al proyecto Supabase existente de BAYU BAR. La clave sb_publishable es pública por diseño. Nunca coloques aquí una clave service_role ni sb_secret. No cambies la configuración salvo que decidas utilizar otro proyecto.

### 5. Publicar
Para publicar con GitHub + Cloudflare Pages:
1. Sube el contenido de esta carpeta al repositorio GitHub (la carpeta raíz debe contener `index.html`).
2. En Cloudflare: Workers & Pages → Create → Pages → Connect to Git.
3. Selecciona el repositorio `bayubar-web`, rama principal y configura **Build command: (vacío)** y **Build output directory: /** (o `.` según la pantalla).
4. Guarda y despliega. Tu tienda quedará en `/` y el panel en `/admin.html`.
No se necesita instalar dependencias ni ejecutar un build.

### 6. Primeros pasos en el panel
1. Entra a `admin.html` con tu correo.
2. **Ajustes → Zonas de delivery:** edita las dos zonas de ejemplo (tarifas de ejemplo: S/ 3.00 y S/ 6.00) y agrega las tuyas.
3. **Ajustes → Delivery:** deja activo el delivery gratis de reapertura o desactívalo.
4. **Productos → Nuevo producto:** carga tus bebidas con foto, precio, costo y stock inicial.
5. Haz un pedido de prueba desde la tienda y confírmalo en **Pedidos**.

## Avisos de pedidos y mensajes al cliente

**Avisarte cuando entra un pedido (aunque no tengas el panel abierto).** Hay dos formas y puedes usar las dos. Se configuran en el panel → **Ajustes → Avisos de pedidos nuevos**.

*Telegram (la más fácil, 5 minutos):*
1. En Telegram busca **@BotFather**, escribe `/newbot` y sigue los pasos. Te da un token.
2. Abre tu bot nuevo y toca **Iniciar** (si no, no puede escribirte).
3. Busca **@userinfobot**, toca Iniciar: te muestra tu ID (solo números).
4. En el panel: Telegram → Configurar → pega token e ID → **Enviar prueba**.

*Notificación del celular (push), una sola vez y algo más técnica:*
1. En una computadora con Node: `npx web-push generate-vapid-keys`. Te da una clave pública y una privada.
2. Supabase → **Edge Functions** → crear función `notify-order` → pega el contenido de `supabase/functions/notify-order/index.ts` y **desactiva "Verify JWT"**.
3. En Edge Functions → **Secrets** agrega: `NOTIFY_SECRET` (una clave inventada, 12+ caracteres), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`mailto:tu-correo@gmail.com`).
4. Pega la clave pública en `js/config.js` (`VAPID_PUBLIC_KEY`) y vuelve a publicar la página.
5. En el panel: **Servidor de avisos del navegador** → Configurar → pega la dirección de la función y el `NOTIFY_SECRET`.
6. En cada celular (el tuyo y el del ayudante): abre el panel → Ajustes → **Activar aquí** y acepta el permiso. En iPhone primero: Safari → Compartir → **Añadir a pantalla de inicio**, y abre el panel desde ese icono.

Si Telegram o el push fallan, el pedido del cliente se registra igual: los avisos nunca lo bloquean. Si la prueba no llega, revisa en Supabase → Database → Extensions que **pg_net** esté activado.

**Mensajes al cliente por WhatsApp.** Al pulsar **Confirmar**, **Salió a entregar** o **Marcar entregado**, el panel muestra el mensaje ya escrito y un botón verde "Abrir WhatsApp con este mensaje": solo tocas Enviar. También hay un botón "Avisar por WhatsApp" en cada pedido por si quieres reenviarlo. Los tres textos se editan en **Ajustes → Mensajes al cliente** (`{nombre}`, `{pedido}` y `{total}` se reemplazan solos). Los envía desde el WhatsApp del celular donde tengas abierta la sesión; WhatsApp no permite que una página los mande sola sin la API oficial de pago.

## Combos y promociones

En el panel, pestaña **Combos y promos**:

- **Combo**: varios productos a un precio fijo (ej. 2 six-packs + hielo por S/ 55). Al venderse se descuenta el stock de cada producto. La tienda muestra cuánto ahorra el cliente y, si pones fecha, "vigente hasta". Si falta stock de algún componente, el combo aparece agotado. La ganancia del combo se calcula con el costo de sus productos.
- **Oferta por producto**: precio rebajado con fecha de fin opcional. En la tienda se ve el precio tachado y la etiqueta "Oferta", más un filtro "Ofertas". Al vencer la fecha vuelve sola al precio normal.
- Si el ayudante crea o cambia un combo u oferta, queda pendiente hasta que tú lo apruebes.
- La base de datos existente ya recibió los ajustes de seguridad y protección del inventario. No ejecutes nuevamente el esquema completo ni el script de limpieza en este proyecto sin una revisión previa. Para nuevas instalaciones, sigue el procedimiento correspondiente.

## Cómo se calculan las cifras

- **Venta:** pedido marcado como *Entregado*, contado el día en que se entregó (hora de Lima).
- **Costo de lo vendido:** el costo del producto **al momento de la venta** (no cambia si luego cambias el costo).
- **Ganancia bruta** = ventas − costo de lo vendido.
- **Ganancia neta** = ganancia bruta − gastos del periodo.
- Las **compras a proveedores** se muestran aparte: son inversión en mercadería (suben el stock y actualizan el costo del producto), no un gasto.
- El delivery cobrado cuenta como venta. Si pagas a un repartidor, regístralo como gasto (“Transporte y delivery”).

## Seguridad: lo que ya está resuelto

- Los clientes solo pueden **ver el catálogo (sin costos)** y **crear pedidos**. No pueden leer pedidos, ni ventas, ni modificar nada.
- El **precio y el stock se validan en el servidor** al crear el pedido; el navegador no puede alterarlos.
- Las fotos solo las pueden subir usuarios administradores (máx. 2 MB, se reducen solas).
- Cada cambio queda en una **bitácora** (quién, cuándo, antes y después).
- La clave `anon` en `config.js` es pública por diseño; la protección está en las reglas de la base de datos.

## Cambiar al ayudante
1. En `supabase/admins.sql` cambia el correo `helper` por el nuevo y ejecútalo.
2. En **Authentication → Users** crea el usuario nuevo.
3. Para quitar el acceso al anterior, ejecuta en el SQL Editor:
   `update public.profiles set active = false where email = 'correo-anterior@gmail.com';`

## Límites a tener en cuenta
- No hay cobro en línea: el pago (Yape/Plin o efectivo) se coordina por WhatsApp al confirmar.
- El delivery se calcula **por zona** con tarifa fija, no por distancia.
- Un pedido entregado no se puede cancelar; para corregir stock usa **Ajustar stock**.
- Las compras no se editan una vez registradas; si te equivocas, corrige con un ajuste de inventario.
- Si el plan gratuito de Supabase se pausa por inactividad, entra al panel de Supabase y pulsa “Restore”.
