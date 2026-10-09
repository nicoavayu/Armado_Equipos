# Preview real en Netlify Free (2026-10-09)

**URL:** https://deploy-preview-194--silly-licorice-383784.netlify.app (Deploy Preview del PR #194, en borrador y marcado «NO MERGEAR»).

- **Candidato:** `9603ff22`; reconstruida y verificada de nuevo sobre `d81fe468` (bundle con `get_public_match_roster`, 0 secretos). Lo construye Netlify desde GitHub; no hay CLI ni token en esta máquina.
- **Sin cambios de configuración en Netlify.**
- **Por qué existe #194:** el proyecto de prueba sólo construye Deploy Previews de PRs contra su rama de producción (`codex/netlify-hosting-preview`). Por eso #192, que apunta a `main`, nunca tuvo preview. #194 apunta a esa rama. No se mergea: mergearlo publicaría este árbol como producción del sitio de prueba.
- **Costo:** los Deploy Previews no consumen créditos en Netlify Free.
- **Sin DNS:** `app.arma2.com.ar` sigue en Vercel.

## Qué se verificó

| Área | Resultado |
| --- | --- |
| Protección de acceso | Sin sesión de Netlify, todas las rutas responden 401: se mantiene la protección de equipo existente. Con la sesión de Netlify del dueño, el sitio abre |
| Rutas | `/torneos`, `/torneos/explorar`, `/login` y `/votar-equipos` son servidas por la app. En desktop, `/`, las rutas desconocidas, `/partido/<id>/invitacion` y archivos inexistentes muestran la página «Llevá Arma2 en el celular», porque Core es sólo mobile |
| Cabeceras | CSP en las páginas estáticas, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, HSTS con preload |
| Enlaces de app | `/.well-known/apple-app-site-association` y `assetlinks.json` responden |
| Login | `/torneos` sin sesión redirige a `/login?returnTo=/torneos`, que muestra «Ingresar con Google» y «Continuar con email», sin errores de consola. **No se inició sesión:** ver «Configuración» |
| Configuración | `DEPLOY_ENV=preview` y `TORNEOS_PRODUCTION_ENABLED=false`. Modo de cobro sin definir: no aparece el botón de pago. El sitio sólo tiene `REACT_APP_SUPABASE_URL` y `REACT_APP_SUPABASE_ANON_KEY`, y el bundle apunta al **Core de Production** (`rcyuuo…`, clave anon pública) |
| Secretos en el frontend | Se revisaron los 95 archivos JS (6,8 MB): 0 `service_role`, 0 claves secretas de Supabase, 0 tokens de Mercado Pago (productivos o de test), 0 claves privadas y 0 secretos de cliente OAuth |
| Páginas públicas | Explorar responde «El catálogo no está disponible en este entorno», porque la preview no tiene gateway de Torneos. Votar con un código inexistente responde «No encontramos ese partido» |

## Qué no se puede probar en esta preview, por falta de backend remoto de prueba

- **Iniciar sesión** y todo lo que depende de una cuenta. La preview apunta al Core de Production: iniciar sesión crearía sesiones y escrituras reales, así que no se hizo.
- **Torneos:** inscripción, aprobación, fixture, avisos y reprogramación. No hay gateway de Torneos configurado.
- **Galería** (carga, revisión, publicación) y **Premium**.
- **Votación por nombre de punta a punta** sobre un partido real.

Todo eso está verificado en el ensayo general (`ENSAYO-GENERAL.md`), con la misma web, sobre una copia descartable.

**Para la publicación real:** antes de usar Netlify como producción hay que definir las variables del contexto de producción: `REACT_APP_TORNEOS_*`, el gateway de Torneos y el contexto `production` del `netlify.toml`, que hoy fuerza `preview` en todos los contextos.
