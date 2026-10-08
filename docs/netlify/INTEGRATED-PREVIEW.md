# Netlify Free — preview integrada y lo que falta para reemplazar Vercel

**Estado (2026-10-08):**
- Rama aislada `claude/netlify-integrated-preview`, PR #192 en borrador («NO MERGEAR»).
- Sin contrataciones, merges, DNS ni cambios en Production.
- `app.arma2.com.ar` sigue en Vercel.

Árbol integrado:

| Frente | PR y head |
| --- | --- |
| Base: Torneos + Galería + Premium | #190 `fa0f82cb`, que trae #189 `dba47fce` y #182 `7d435472` (piloto: programación, 0015, avisos 0016) y #178–#181 |
| Core | #187 `abd9e8f2` (con #183 y #186), #184 `dadc7c19`, #185 `64de0d89`, #193 `4a5a9179` (privacidad: 135000–138000 y RUNBOOK-193) |
| Netlify | #191 `9c40146d` |

Conflictos resueltos en la integración:
- guarda de migraciones de Core: las dos listas (66 con #193 `4a5a9179`);
- workflow de CI: se conserva `claude/**`;
- B04 regenerado.

## 1. Cómo se verificó (y qué es laboratorio y qué es real)

| Verificación | Dónde | Tipo |
| --- | --- | --- |
| Rutas, recargas, assets, gate de acceso, funciones, login/callback/logout, Core mobile, Torneos mobile y desktop, Galería, Premium | Build de producción del árbol integrado, servido por un emulador de la cadena de Netlify (`netlify-lab.localhost:3131`) contra el laboratorio `arma2-promo-rehearsal` | **Laboratorio** |
| Semántica de `context.next(request)` (el gate reescribe a `/mobile-only.html` y `/private-web-access.html`) | Código del runtime real de Netlify (`edge.netlify.com/bootstrap/function_chain.ts` y `request.ts`): `contextNext` reemplaza el request (mismo host) y el llamado al origen usa su URL | **Lectura del código de producción de Netlify** |
| Sitio de prueba `silly-licorice-383784.netlify.app` y `deploy-preview-191--…` | curl | **Real.** Todas las rutas responden 401 «Login Redirect»: el proyecto es privado para el equipo hasta publicarlo, y por eso Chrome mostró `ERR_BLOCKED_BY_CLIENT`. Sin una sesión de Netlify no se puede verificar más |
| Comparación con Vercel | GET de solo lectura a `app.arma2.com.ar` | **Real** (Production, sólo lectura) |

## 2. Qué funciona (en el laboratorio, sobre el build de Netlify)

**Gate de acceso web.** Se comporta igual que el `middleware.ts` de Vercel:

| Pedido | Resultado |
| --- | --- |
| `/`, `/home`, `/perfil`, `/index.html` y rutas desconocidas | página «solo mobile», con CSP y `no-store` |
| `/acceso-web` | página de contraseña |
| `/health` | `{"status":"ok"}` |
| `/torneos/*`, `/login`, `/auth/callback` | SPA |
| `/votar-equipos?codigo=` y la invitación con `codigo` + `invite` | SPA |
| Invitación sin `invite` | gate |
| `/?codigo=…` | 308 a `/votar-equipos` |
| POST sin cookie | 403 |

**Funciones.** Contraseña correcta → 303 con `Set-Cookie: __Host-arma2_private_web` (`HttpOnly; Secure; SameSite=Lax; Path=/`). Con la cookie:
- `/` y `/perfil` cargan la app;
- `/acceso-web` → 302 al `returnTo`;
- una cookie alterada vuelve al gate.

Los rechazos y el logout:
- contraseña incorrecta → `/acceso-web?error=1`;
- `Origin` ajeno → 403;
- GET a logout → 405;
- logout del mismo origen → 204 con `Max-Age=0`.

**Assets.** `main.<hash>.js` → 200 `immutable`.

**Sesión de Supabase.**
- El login de laboratorio con callback en el host del preview funciona.
- La sesión sobrevive a cargas directas.
- El logout borra la sesión.
- Después del logout, una ruta de Torneos manda a `/login?returnTo=…`.

**Core (375 px).**
- Inicio, notificaciones (3 sin leer, de partidos y encuestas) y perfil «B04 Captain».
- Sin desbordes.

**Torneos (375 px y desktop).**
- Inicio «Hola, Capi», avisos (5 de inscripciones) y perfil de Torneos «Capi Halcones Cierre».
- Perfiles y avisos separados de Core.
- El selector de espacios funciona en los dos sentidos.

**Galería.**
- El participante ve las 4 fotos firmadas, y el visor carga la foto de 1600 px.
- El participante no entra al Centro Multimedia de la organización.
- El organizador ve «25 / 25» con el texto corregido.

**Premium.** Compra de prueba en el servidor de desarrollo (facturación de prueba) para la temporada «Lab Temporada Netlify» (`6406b14b`, pago `1791428115614001`):
1. Aprobada en el emulador; webhook 200.
2. La URL de vuelta, con **carga directa en el build de Netlify**, carga y Mi plan pasa a PREMIUM.
3. Devuelta (`payment.refund`): Mi plan vuelve a FREE.

## 3. Qué se corrigió en la rama, y por qué

1. **`/.well-known/apple-app-site-association` salía como `application/octet-stream`.** Vercel lo sirve como `application/json`, y iOS lo necesita para los links universales. Ahora `netlify.toml` le da a ese archivo y a `assetlinks.json` el mismo `Content-Type` y la misma caché que `vercel.json`. Un test lo ata a `vercel.json`.
2. **Publicaciones innecesarias.** `ignore = "node scripts/netlify/should-build.mjs"`: un cambio que sólo toca backend, base de datos, docs, Android/iOS, laboratorio o CI no compila ni publica. Ante la duda compila. 8 de los últimos 40 merges a main se habrían salteado.
3. **Los tests de hosting de #191 no corrían en CI.** Ahora `test:netlify:hosting` (31 tests) es parte de `test:ci`.

## 4. Qué falta antes de reemplazar Vercel

1. **Verificación real en Netlify.** Con una sesión de Netlify del equipo, abrir el deploy preview y comprobar la tabla del §2. La alternativa es hacer público el sitio de prueba: el gate de la app sigue protegiendo Core.
2. **Contextos de `netlify.toml`.** Hoy fuerza `REACT_APP_DEPLOY_ENV=preview` y `REACT_APP_TORNEOS_PRODUCTION_ENABLED=false` en **todos** los contextos, y las variables de `netlify.toml` le ganan a las del panel. Un deploy de producción con ese archivo apagaría Torneos y no podría vender Premium. Para el corte:
   - `[context.production.environment]` con los valores de Production;
   - el resto, como en la prueba.
3. **Paridad del build.** Vercel corre `validate:web-access-env`, que falla si faltan los secretos del acceso privado, y el release de Sentry (`REACT_APP_SENTRY_RELEASE` = commit, environment, subida de sourcemaps). En Netlify:
   - usar `$COMMIT_REF`;
   - `SENTRY_AUTH_TOKEN` sólo en el build;
   - los secretos del acceso privado sólo en Functions/Edge (sin prefijo `REACT_APP_`, nunca en el bundle).
4. **Mismo dominio.** El código sólo vende Premium en `app.arma2.com.ar` (`PRODUCTION_BILLING_APP_HOSTS`). Fuera de ahí la pantalla de compra muestra «No disponible en esta versión», y así quedó la vuelta de Mercado Pago en el host del preview. Con el mismo dominio además no cambian:
   - el CORS del gateway (`TORNEOS_ALLOWED_ORIGIN`);
   - las Redirect URLs de Auth;
   - los links universales;
   - las `back_urls` de Mercado Pago.
5. **Auth para probar en `*.netlify.app`** (sin hacer; es un cambio de Production). En Supabase Core → Authentication → URL Configuration → Redirect URLs, agregar:
   - `https://silly-licorice-383784.netlify.app/auth/callback`;
   - `https://deploy-preview-*--silly-licorice-383784.netlify.app/auth/callback`.

   Google y Apple vuelven al callback de Supabase, así que no cambian. Sin esto, el login en el dominio de prueba termina en el Site URL, que es Vercel.
6. **Redirecciones de dominios viejos.** `arma2.vercel.app` y `arma2-nicoavayus-projects.vercel.app` → `app.arma2.com.ar` sólo existen en Vercel. Conviene dejar el proyecto de Vercel como redirector.
7. **Configuración del sitio en Netlify** (la hace el dueño del equipo):
   - rama de producción dedicada a releases (ver §6) o publicación bloqueada;
   - sacar la protección «privado para el equipo» al momento del corte.
8. **Prueba intermitente.** `test:torneos:social:browser` falló 2 de 5 veces sobre el árbol integrado y 0 de 3 sobre #190 solo: un recurso abortado (`ERR_FAILED`) sin URL, en la pasada PREMIUM. En la corrida instrumentada pasó 2 de 2 sin pedidos fallidos. Hay que mirarlo antes de mergear Core sobre Torneos.

## 5. Lo que queda fuera de Netlify

Mudar el frontend no muda el resto.

| Servicio | Dónde corre | Costo |
| --- | --- | --- |
| Core: base, Auth, Storage, funciones | Supabase Free | 0. Cuotas de organización: 500 MB por base, 1 GB de Storage y 5 GB de egress compartidos con Torneos |
| Torneos: base y Storage (fotos y logos con URLs firmadas) | Supabase Free | 0. Las fotos y los logos salen del Storage de Supabase, no de Netlify |
| Gateway de Torneos | Cloud Run `torneos-gateway`, `arma2-465223`, `southamerica-east1` | Dentro del Free Tier: 2 M pedidos, 180.000 vCPU-s, 360.000 GiB-s por mes. Necesita cuenta de facturación (ya existe). El egress gratis es sólo desde Norteamérica: la salida desde São Paulo (JSON chico) puede costar centavos. Artifact Registry 0,5 GB gratis (conviene podar imágenes viejas); Secret Manager 6 versiones activas gratis |
| Servicio de pagos y webhooks de Mercado Pago | Deno Deploy `torneos-payments-production` (cron cada 15 min ≈ 2.900 ejecuciones por mes) | Free de Deno Deploy: 1 M pedidos, 20 GiB de egress, 10 h de CPU por mes. Hay que confirmar con la sesión de Premium que el plan Free actual incluye cron |
| Mercado Pago | Mercado Pago | Comisión por venta, no hosting |
| Errores web | Sentry | Plan gratuito. La subida de sourcemaps necesita un token sólo de build |
| Push | Firebase (apps nativas) | 0 |
| DNS de `arma2.com.ar` | Registrador actual | 0. El corte cambia el CNAME de `app` |
| Vercel | Queda como respaldo y redirector | Hobby es sólo para uso no comercial: con ventas de Premium no corresponde dejar la app ahí |

## 6. Consumo del plan Free de Netlify

Reglas vigentes (docs de Netlify, octubre 2026):

| Concepto | Free |
| --- | --- |
| Créditos | 300 por mes, tope duro, no se pueden comprar más |
| Deploy de producción | 15 créditos |
| Deploy previews y branch deploys | Gratis (0 créditos) |
| Ancho de banda | 20 créditos por GB |
| Pedidos | 2 créditos por cada 10.000 (las Edge Functions cuentan como pedidos) |
| Cómputo | 10 créditos por GB-hora |
| Builds simultáneos | 1 |
| Protección por contraseña de Netlify | No incluida (el gate propio de la app la reemplaza) |

**Al agotarse:**
- **todos** los proyectos de la cuenta quedan pausados con «Site not available» hasta el ciclo siguiente;
- Free no permite comprar créditos;
- la única salida es subir de plan, y eso no está autorizado.

**Estimación:**

| Concepto | Créditos por mes |
| --- | --- |
| Tráfico de los últimos 30 días en Vercel (3,19 GB y 92.000 pedidos) | ≈ 64 + 18 = 82 |
| Primera visita | 225 KB comprimidos (1,2 MB sin comprimir) más los chunks de la ruta; todo el JS y el CSS pesa 1,66 MB comprimidos |
| Ejemplo: 5.000 visitas extra de Torneos de unos 0,6 MB | ≈ 60 |
| Deploys al ritmo actual (18 merges por mes) | 270 |

Sumando los deploys al ritmo actual al tráfico, se pasa de 300: **no se puede publicar cada merge**.

Recomendación:
- rama de producción dedicada a releases, actualizada sólo cuando se publica a propósito (≤ 8 por mes = 120 créditos);
- deploy previews gratis para revisar;
- el `ignore` del §3.

Así el total queda en unos 200–260 créditos, con margen.
