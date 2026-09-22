# Phase 1.5 — A) REAL CORE → ISOLATED TORNEOS INTEGRATION PASS

Certificación local final: 2026-09-13. STOP. Phase 2 no iniciada.

## 1–3. Repositorio, worktree y base

- App autenticada inequívoca: `https://github.com/nicoavayu/Armado_Equipos.git`.
- Checkout descubierto: `/Users/nicoavayu/Downloads/arma2/arma2`, branch
  `release/1.1.13-build-32`, HEAD `0a25998f921eb553efe4874bbab0635faa5dd836`.
  Sus cambios locales se conservaron.
- Base elegida: referencias locales `main` y `origin/main`, ambas en
  `e61f089d873d00e8a2a62b9d41ecf26b6c820c53`. No se afirma haber actualizado el remoto.
- Branch nueva: `codex/torneos-real-core-sso-phase15`.
- Worktree exclusivo: `/Users/nicoavayu/Downloads/arma2/arma2-torneos-real-core-sso-phase15`.
- `/Users/nicoavayu/Downloads/Arma2Web` es la landing pública y no fue modificada.
- POC fuente: `/Users/nicoavayu/Downloads/Arma2Web-sso-poc`, commit certificado
  `b2f39e5790635ca416fc3f5a22859f9751208d7d`; se conservó intacto.

## 4. Archivos cambiados

Código existente: `src/App.js` selecciona la pantalla local dentro de la ruta
protegida `/torneos/*`; `src/lib/supabaseClient.js` exporta el alias `supabaseCore`.

Código nuevo: `src/features/torneos/isolated/{config.js,createTorneosClient.js,IsolatedTorneosPage.jsx}`
y `src/__tests__/torneosIsolatedSso.test.js`.

Laboratorio nuevo en `integration/torneos-sso/`: Compose, gateway, firma JWT,
bootstrap local, SQL mínimo, fixture Core, build aislado, clientes de test,
pruebas backend/browser, lockfile, README, este informe y evidencia.
`evidence/manifest.sha256` identifica los archivos entregados. Ningún archivo
bajo `supabase/`, migraciones, cron ni scripts del backend actual fue cambiado.

## 5–6. Dos clientes y flujo de sesión real

Auth actual: singleton `src/lib/supabaseClient.js`, reexportado por `src/supabase.js`
y `src/services/api/supabase.js`. Usa `REACT_APP_SUPABASE_URL` y
`REACT_APP_SUPABASE_ANON_KEY`, persistencia y refresh automático existentes.
`AuthProvider` hidrata `auth.getSession`, escucha `onAuthStateChange` y carga el
perfil `usuarios` por el mismo UUID de `auth.users`; `getProfile` consulta además
jugadores, premios y partidos manuales.

Router: `BrowserRouter` → `AuthProvider`/`AppAuthWrapper` → `/torneos/*`.
El login real ofrece OAuth y magic link; `AuthCallback` procesa la sesión.
`authLogoutService.signOutWithPushDeactivation` conserva limpieza push y ejecuta
el `signOut` del singleton. Ninguno de esos archivos se modificó.

La nueva pantalla recibe ese singleton como `supabaseCore`; crea únicamente
`supabaseTorneos` con `accessToken()`. La sesión Core existente autoriza un POST
silencioso a `/exchange`; el servidor valida GoTrue, usuario activo y sesión
vigente, hace UPSERT de la identity shadow y emite RS256 por 120 segundos.
El cliente consulta `sso_probe` a través del gateway privado, usando ese JWT.
PostgREST verifica la firma/claims y PostgreSQL aplica RLS al bearer del usuario.

Sólo se guardan en memoria caché Torneos y exchange concurrente. Se invalida
ante SIGNED_OUT, SIGNED_IN, TOKEN_REFRESHED y USER_UPDATED, o errores de Torneos.
El token se renueva cuando quedan 20 segundos. Exchanges tardíos no sobreviven
al cambio de generación/sesión. Desmontar Torneos sólo retira su suscripción;
no detiene el refresh ni cierra la sesión Core.

El gate requiere conjuntamente opt-in SSO, deploy `test`, local edit `false`,
Core URL exacta `http://127.0.0.1:58410` y el mismo origen del browser. No se
modifican flags Production. El path `/torneos` se conserva; no se crea un subdominio
ni se configura o despliega `app.arma2.com.ar`.

## 7–12. Pruebas y evidencia

| Grupo | Resultado final | Evidencia |
|---|---|---|
| Backend real, JWT y PostgreSQL RLS | 32/32 PASS | `evidence/backend-tests.txt`, `backend-results.json` |
| App completa en Chrome headless | 13/13 PASS | `evidence/app-tests.txt`, `app-results.json`, `real-app-torneos.png` |
| Adaptador y regresiones auth/routing | 41/41 PASS, 6 suites | `evidence/app-regression-tests.txt` |
| Build CRA real | PASS | `evidence/build.txt` |
| Whitespace/diff | PASS | `git diff --check` |

Los contadores Node incluyen una prueba padre por grupo: son 31 escenarios
backend y 12 escenarios browser, además de las 41 pruebas Jest. Cero FAIL y
cero skipped en las ejecuciones finales. `initial-backend-results.json` conserva la primera corrida fallida heredada del POC.
`iteration-notes.json` registra fallos
intermedios y sus correcciones; no se presentan como ejecuciones exitosas.

**Sesión real / segundo login = 0.** El fixture crea cuentas reales en GoTrue
local y entrega su sesión al `AuthCallback` existente del build de la app,
sin mocks de provider ni identidad de local edit. La app hidrata su perfil,
navega a `/torneos` y muestra la fila propia. Desde esa sesión hay cero requests
de password/OTP/authorize/signup adicionales y cero Torneos Auth. No se afirma
haber ejecutado Google/Apple ni entregado email externo: se prueba la sesión
existente y su callback, dentro del alcance no productivo.

**Core unaffected.** Bearer Core idéntico antes y después de Torneos y navegación
por `/terms` → `/privacy` → `/torneos`. Durante la caída real de PostgREST Torneos,
la sesión persiste y GoTrue `/user` y Core REST `/usuarios` siguen devolviendo
el mismo usuario/perfil. Las regresiones existentes de AppAuthWrapper, callback,
providers y aislamiento de rutas también pasan. Esto no certifica todos los
flujos de partidos, pagos, dispositivos o el backend completo de Core.

**RLS.** SELECT propio e INSERT/UPDATE propio pasan. SELECT por identidad ajena
retorna `[]`; INSERT ajeno es 403; PATCH/DELETE ajenos no modifican filas;
reasignación de ownership es 403. También se verifica PostgREST directamente
dentro de la red privada. Torneos sólo tiene dos tablas públicas y shadow sólo
almacena UUID local, UUID Core y fecha. No replica perfiles ni passwords.

**Logout/revocación/expiración.** El botón llama al servicio de logout real,
vuelve a login, borra la sesión Core y bloquea exchange y replay del JWT Torneos
aún vigente. Revocación SQL de sesión y usuario baneado bloquean de inmediato.
`auth.sessions.not_after` vencido bloquea; token Core ausente/expirado también se
prueba en adaptador. El refresh real del SDK Core se dispara al hidratar una
sesión marcada próxima a vencer, realiza el grant real y reautoriza Torneos.
La renovación Torneos avanza sólo el reloj browser; se espera su respuesta real.

**Caídas.** Se detiene y restaura sólo PostgREST del laboratorio; la prueba espera
su readiness antes del reintento. La caída de GoTrue bloquea Torneos. El fallo de
transporte de exchange se inyecta con Playwright, deja Torneos cerrado y mantiene
Core. Errores de red/dependencia reconocidos retornan 503, denegación 401.

**Secretos y Production.** Se escanean assets del build, configuración pública,
logs de servicios y consola contra claves/passwords y tokens usados. Ningún
service role, private key ni JWT de sesión aparece en el bundle/logs. Tokens
Torneos ausentes de localStorage/sessionStorage; cero cookies. Core conserva su
persistencia habitual. JWT forged, tampered, unsigned, wrong audience/issuer,
claims faltantes y elevación de rol son rechazados.

El build usa sólo URL API loopback y anon local, sin URL hosted Supabase.
Los links estáticos heredados del producto pueden mencionar dominios externos;
no son destinos de backend configurados. CSP y Playwright bloquean egress externo;
la ejecución final registra cero requests externos. No se leyó configuración
Production ni se usaron herramientas de administración remota, Vercel, flags,
ledger 236, cron o migraciones 37–48.

## 13–14. Reutilización y diferencias del POC

Reutilizados: contrato RS256/JWKS, `token.mjs`, RLS de `torneos.sql`, lector mínimo
de sesiones, writer shadow, red privada Compose y pruebas de ataque/rotación.

Adaptados: puerto/proyecto separados, Core URL raíz para su cliente real, servicio
Core PostgREST con cuatro tablas de fixture, gateway que sirve el build real y
preserva Accept para `.single()`, errores operativos, adaptador con propiedad de
Core externa y eventos de refresh, pantalla en router auténtico, tests reales.
Se eliminó el frontend sintético de laboratorio. No se actualizó la dependencia
Supabase de la app ni se ejecutaron migraciones Arma2.

Documentación consultada: [changelog Supabase](https://supabase.com/changelog),
[inicialización del cliente](https://supabase.com/docs/reference/javascript/initializing),
[eventos Auth](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

## 15–17. Límites, riesgos y próximo paso

Esta certificación corresponde al código real de la app con usuarios GoTrue
locales y fixture de perfil mínimo. No es certificación del backend completo,
de usuarios Production, del QA preexistente ni del dominio desplegado.
Los seis servicios Compose de esta fase permanecen locales; el QA previo no
se modificó. README incluye el comando para detenerlos sin borrar volúmenes.

Pendientes antes de cualquier backend definitivo: garantía de gateway sin bypass
en hosting real, custodia/rotación de claves, HTTPS fuera de loopback, límites
de requests, costos/latencia de consulta online a Core, compatibilidad futura
con `auth.sessions`, prueba mobile/cross-tab y recorridos completos de Core.
El bearer puede reutilizarse mientras siga vigente y autorizado; solicitudes ya
autorizadas pueden terminar durante logout. La limpieza privada `_removeSession`
existente sólo borra la sesión local y no equivale a revocación server-side;
la garantía certificada usa el logout normal y revocación real de Core.

Recomendación: aceptar Phase 1.5 dentro de estos límites y revisar la frontera de
revocación/hosting antes de autorizar Phase 2. No publicar una Data API directa
que permita eludir la validación online del gateway.

**A) REAL CORE → ISOLATED TORNEOS INTEGRATION PASS. STOP.**
No baseline final, ninguna de las 48 migraciones, ningún proyecto Supabase Torneos
Production, ningún deploy y ningún inicio de Phase 2.
