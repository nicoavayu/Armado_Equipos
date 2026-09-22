# ARMA2 TORNEOS — B04 Frontend Integration — informe

**Fecha:** 2026-09-21 · **Worktree:** `arma2-b04-dual-backend-foundation` · **Branch:** `codex/torneos-b04-dual-backend-foundation` @ `2058da03` (Phase 2D) · **SIN COMMIT / SIN PUSH / SIN PR / 0 Production / 0 deploy.**
**Backend:** R4 `R4_HYBRID_GATEWAY_CERTIFIED` (run 20260921T035504Z) y R5 `R5_HYBRID_E2E_CERTIFIED` (run 20260921T144426Z) **no tocados**: `git diff 2058da03 -- backend/torneos migrations supabase/migrations` = vacío; allowlist Phase 2D 43/43 intacta (test 2).

## Veredicto

**B04_FRONTEND_INTEGRATION_PASS — contra el lab híbrido local de este worktree** (Core real local + Torneos baseline 2D certificado + gateway twin certificado en 3A/2D). El recorrido completo `login → /torneos → workspace → temporada → torneo → colaboradores → registro de equipo (importación Core) → roster → invitación → review` funcionó desde la UI con **todo** el tráfico Torneos por el gateway (§7). **No es** una certificación contra el gateway Deno + Core staging: eso es el siguiente paso (§10).

## 1. Reconciliación (contra el árbol real)

160 sitios `.rpc(` = 159 literales + 1 dinámico (3 alternativas) = 162 filas = 160 nombres → **34 migrables / 126 blocked / 9 allowlisted sin caller / allowlist 43**. Exacto a lo esperado. El inventario legacy congelado (`legacy-audit.json`, base 2058da03) es byte-idéntico en los 160 sitios después de B04 (test 7).

## 2. Contrato de transporte (leído del gateway certificado, `torneos-gateway/index.ts`, y del journey R5)

`POST {gw}/exchange` (bearer Core, sin body) → `{access_token, token_type:'Bearer', expires_in:120}`; sin refresh (renovar = nuevo exchange). `POST {gw}/torneos/rest/v1/rpc/<name>` y `GET {gw}/torneos/rest/v1/<table>` con el bearer bridge → passthrough PostgREST. 401 `access denied` (bearer inválido / sesión Core inactiva) · 403 `rpc not enabled` (fuera de allowlist, antes de la sesión) · 403 `origin rejected` · 503 `access denied` (Core Auth o Torneos REST caídos) · 503 `CORE_UNAVAILABLE` (contrato Core) · adapter `{error:'TORNEOS_*'|'CORE_DENIED'}` 400/403/404/429, 503 `TORNEOS_UNAVAILABLE`. Un solo `TORNEOS_ALLOWED_ORIGIN`. Las **rutas de tabla están certificadas en R5** (`tournament_organization_members` con RLS) → collaborators no necesita RPC nueva.

## 3. Transporte implementado (`src/features/torneos/foundation/`)

| Módulo | Qué hace |
| --- | --- |
| `torneosTransport.js` | Único módulo que habla con el gateway. Exchange con dedupe/coalescing por Core token, cache **sólo en memoria** (nunca storage, nunca decodificado), renovación silenciosa antes del TTL (margen 20 s) y ante `TOKEN_REFRESHED`/`SIGNED_IN`/`SIGNED_OUT`/`USER_UPDATED` (clear + generación: una respuesta tardía de otra sesión se descarta). 401 en RPC → un re-exchange y un reintento, nunca más; 403 → sin reintento; 503 → `CORE_UNAVAILABLE`/`TORNEOS_UNAVAILABLE` y cache descartada; passthrough PostgREST `{message,code,details,hint}` intacto. `credentials:'omit'`, `cache:'no-store'`, `redirect:'error'`, timeout 10 s. `dispose()` desuscribe. |
| `torneosClient.js` | Boundary de scope: fuera de las 43 → `TORNEOS_OUTSIDE_STAGING_V1` antes de red; sin transporte → `TORNEOS_TRANSPORT_NOT_CONNECTED`; tabla fuera de `stagingV1Tables` → rechazada. Normaliza `undefined → null` en args (PostgREST resuelve por firma exacta; ver §9 hallazgo H1). |
| `config.js` | `REACT_APP_TORNEOS_GATEWAY_URL` = único destino (https; http sólo loopback), rechaza credenciales/query/fragment, el origen Core (`TORNEOS_CORE_TARGET_COLLISION`) y el ref Production (`TORNEOS_CONFIG_PRODUCTION_TARGET`). `resolveTorneosBackendMode`: `hybrid` (gateway) · `legacy-local` (sin gateway y `DATA_ENV=local`) · `disabled` (todo lo demás → staging/preview sin gateway **nunca** sirve Torneos desde Core). `REACT_APP_TORNEOS_API_URL` retirada. Misma regla en `scripts/validate-build-env.mjs` (prebuild), paridad testeada. |
| `errors.js`, `stagingV1Scope.js` (sin cambios, deepEqual 2D), `stagingV1Tables.js`, `stagingV1Service.js` | — |

`src/features/torneos/stagingV1/`: `coreSessionBridge.js` (único contacto con el singleton Core: `auth.getSession` + `auth.onAuthStateChange`, nada más — test 8 lo asserta por AST), `stagingV1WorkspaceService.js` (adapter, §4), `stagingV1Features.js` (feature map estático), `StagingV1TorneosApp.jsx` (composición: transporte creado y dispuesto en el efecto de montaje — StrictMode-safe —, `TorneosFeaturesProvider` + `TorneosWorkspaceProvider service={adapter}` + `TorneosShell`; **nunca** `TorneosApp`). `TorneosFeatureGate.jsx` elige la composición por modo. Ningún `createClient` nuevo, ningún GoTrue Torneos, ningún `service_role` (test T1 + scan del bundle: 0 `service_role`, 0 ref Production).

## 4. Callers migrados — 34/34

`stagingV1WorkspaceService.js` expone **exactamente** los aliases legacy de las 34 RPC migrables (31 con caller UI + `withdrawTeamEntry`, `archiveTeamEntry`, `loadTournamentCreationEligibility` sin caller) + `listMembers` (tabla certificada) + `createIdempotencyKey`, y **nada más**. `adapter.test.mjs` ejecuta el servicio legacy real contra un stub Core grabador y el adapter contra un transporte grabador, alias por alias: mismo nombre RPC y mismo payload `p_*` en los 34; cobertura = las 34 y ninguna otra. `loadCompetitionContext` devuelve la RPC cruda con `logoPath: null` / `organizationBranding: null` (el legacy componía `get_tournament_branding_context`, bloqueada). `changeTournamentStatus` rechaza antes de red cualquier `p_status` fuera de `draft|registration|archived`. Los 4 contratos Core (`accept_tournament_team_invitation`, `search_tournament_players`, `search_tournament_arma2_teams`, `create_tournament_team_entry` con `p_arma2_team_id`) siguen server-side por el gateway; el frontend no lee Core.

Errores: `TorneosBoundaryError` → `TournamentWorkspaceError` con el copy existente (`ERROR_MESSAGES`, extraído a `api/tournamentWorkspaceErrors.js`, puro; el legacy lo re-exporta sin cambio) + `BOUNDARY_MESSAGES` para `CORE_UNAVAILABLE`, `TORNEOS_UNAVAILABLE`, `TORNEOS_FORBIDDEN`, `TORNEOS_RATE_LIMITED`, `CORE_DENIED`, `TORNEOS_OUTSIDE_STAGING_V1`; sesión inválida/expirada/exchange denegado → `TORNEOS_AUTH_REQUIRED` («Tu sesión venció…»).

## 5. Blocked callers controlados — 126/126

Mecanismo doble: (a) el adapter **no tiene** los aliases bloqueados → los providers/páginas ya duck-typeaban (`typeof service.loadFixtureContext === 'function'`, entitlements fail-closed FREE «Plan no verificado» sin red); (b) `TorneosFeaturesContext` + `stagingV1Features` (8 ON = keys 2D, 18 OFF; guard T13) gatea en `TorneosShell` **51** elementos de ruta con `gate('<feature>', …)` → `FeatureUnavailablePage` (sin montar el componente, sin request), filtra la sidebar (queda Inicio/Torneos/Equipos/Configuración) y el índice `torneo/:id` va a `equipos` en vez de `fixture`. Rutas OFF: fixture/**, programacion, sedes, partidos/**, competencia/**, plan/** (temporada y torneo), comunicaciones, comunicados, mis-partidos/**, multimedia, estudio-social, `/torneos/torneo/:id/**` (hub), `equipos/:id/identidad-visual`. Verificado en Jest (T7, 14 rutas) y en navegador (§7): en una ruta OFF el único request Torneos es el `get_tournament_workspace_context` del shell. La composición legacy no provee el contexto → ve todo ON → **byte-equivalente en comportamiento** (76 suites / 1166 tests legacy verdes sin tocar).

## 6. Bypasses F8 eliminados (gateados por feature map; en legacy siguen montando)

| Bypass | Fix |
| --- | --- |
| `TournamentWizardPage`: `TournamentPublicPageSettings` / `TeamVisualPolicySettings` con default singleton Core; `BrandingAssetField` | Montaje condicionado a `public_pages` / `team_visual_policy` / `branding_assets`. Navegación post-create a plan sólo si `plan`. |
| `TeamRegistrationPage`: `loadRosterPortraits` y `loadTeamPhotoState` (imports directos, mount) | Efectos no corren (`portraitsEnabled`/`teamPhotosEnabled`), estado `ready` vacío; sin tab «Identidad visual», sin `BrandingAssetField`/`TeamPhotoPanel`/`TeamPhotoBanner`/`PlayerPortraitActions`; `canEditBranding` respeta el flag. |
| `OrganizationSettingsPage`: `BrandingAssetField` | Gateado. `OrganizationSettingsNav`: link Plan gateado. |
| `OrganizationMembersPage`: `Promise.all` con `loadSeasonEntitlements` (bloqueada) | `loadSeasonEntitlementsIfServed` → `null` si el servicio no la sirve; límite `—`, assign/remove funcionan. |
| `TorneosCompetitionContext` + branding | Resuelto en el adapter (RPC cruda). |
| `TeamsPage`: `TeamWithdrawalDialog`, link identidad visual · `TorneosDashboard`: `CompetitionLifecycleActions`, paneles fixture/programación, módulos partidos/tabla/disciplina/comunicaciones, next-step hacia fixture · `TorneosLanding`: «Mis partidos»/«Comunicados» · `MyTournamentsPage`: link al hub · `CompetitionOverviewPage`/`SeasonFormPage`: intent premium → plan | Gateados. |

Test `torneosStagingV1Composition.test.jsx` monta la composición híbrida con el singleton Core reemplazado por un Proxy que **registra y rechaza** cualquier acceso: 21 tests, 0 accesos.

## 7. Browser QA — lab híbrido local (Docker, este worktree)

**Stack:** `integration/torneos-core-contracts` como proyecto compose aparte `arma2-b04-hybrid-lab` (volúmenes propios; `lab.mjs` acepta `PHASE3A_LAB_PROJECT`, único cambio). Core = 42 migraciones Core reales + GoTrue v2.194 real + PostgREST + `torneos-core-contract` real en edge-runtime; Torneos = baseline `f857bd09…` (sha verificado contra `evidence/install.json`) + gate 2D `00000000000001`; gateway = `gateway.mjs` (Node, twin del port Deno certificado; mismas rutas, status y bodies). `compose.b04.yaml` publica el Kong-substitute en `127.0.0.1:58424` para el browser. **Puente dev-only** `scripts/torneos-frontend/lab-bridge.mjs` (58422 → Core con CORS; 58423 → gateway reescribiendo `Host`/`Origin` al origen que el lab permite): el gateway sigue rechazando `Origin: http://localhost:3000` (403 verificado). App: `scripts/torneos-frontend/start-hybrid-lab-app.mjs --start` (fail-closed, anon key del lab desde `.runtime`, `DATA_ENV=local`, `REACT_APP_TORNEOS_GATEWAY_URL=http://127.0.0.1:58423`). Fixtures: `lab-fixtures.mjs users | core-team | login <email>` (usuarios `b04-owner/captain/ana/beto@lab.test`, equipo Core «Lab Import FC» con 2 miembros; el magic link lo genera la admin API del lab — no hay mailer — y lo consume el `/auth/callback` **propio de la app**).

**Recorrido (owner → capitán → capitán/admin), todo por `127.0.0.1:58423`:**
1. `/login/email` → `POST /auth/v1/otp` 200 (GoTrue real) → callback de la app → sesión Core (`GET /auth/v1/user` 200).
2. `/torneos` → `POST /exchange` 200 → `get_tournament_workspace_context`, `get_my_tournament_memberships` 200 → landing.
3. Crear organización «Liga B04 Lab» → `is_tournament_organization_slug_available`, `create_tournament_organization`, `get_tournament_competition_context` 200. Sidebar: Inicio/Torneos/Equipos/Configuración.
4. Temporada «Apertura 2026» → `create_tournament_season` 200; activar → `update_tournament_season` 200.
5. Wizard «Copa B04 Lab» → `create_tournament_with_defaults`, `update_tournament_configuration` ×3, `save_tournament_category` («Primera»), `change_tournament_status`→`registration` 200. **0** requests a `public_page`/`visual_policy`/`branding`.
6. `/miembros` → `GET tournament_organization_members` (tabla, RLS) 200, `list_tournament_season_member_assignments` 200, **0** entitlements; asignar admin → `assign_tournament_season_member` 200 («Asignado»). (Membresía admin sembrada por SQL como en R5: v1 no tiene RPC de membresía.)
7. `torneo/:id` → redirige a `equipos` (no a fixture). «Agregar equipo» → Equipo existente → `search_tournament_arma2_teams` 200 (contrato `directory_teams`) → «Lab Import FC» → `create_tournament_team_entry` (con `p_arma2_team_id`, `team_snapshot`) + `invite_tournament_team_manager` 200 → enlace de invitación.
8. Inscripción → `get_team_registration_context` 200; **0** portraits/photo/storage; sin tab Identidad visual. Plantel: `search_tournament_players` 200 (`directory_players`) → Ana → `add_tournament_roster_player` 200; 4 provisionales (`create_tournament_provisional_player` + add) → 5/5; arquero → `update_tournament_roster_player` 200. `submit` como owner con manager pendiente → 403 `TORNEOS_RESOURCE_FORBIDDEN` **con copy correcto** (regla del backend; R5 también presenta tras aceptar).
9. Logout desde la app → `POST /auth/v1/logout?scope=global` 204 → el Core token viejo ya no intercambia (`/exchange` → 401 verificado).
10. Login capitán → deep link `/torneos/invitacion/equipo/<token>` → `accept_tournament_team_invitation` 200 (contrato `verified_email`) → «En preparación» → Plantel → `submit_tournament_team_entry` 200 → «Presentado».
11. Revisión (admin con asiento en la temporada) → `review_tournament_team_entry` (`approved`) 200 → **«Aprobado»**, historial con motivo.
12. Sesión Core revocada server-side → siguiente carga: `/exchange` 401 → «Tu sesión venció», sin reintento en bucle, sin fallback. Renovación silenciosa: a los ~120 s de inactividad la siguiente acción hizo `/exchange` nuevo antes de la RPC, transparente.

**Invariantes observadas:** ningún `/rest/v1/rpc/*` ni `tournament_*` contra Core (58422 sólo tablas del shell Core: `usuarios`, `jugadores`, `notifications_ext`, `player_awards`, `partidos_manuales`); ningún host `supabase.co` ni `functions/v1`; `localStorage` sólo con la sesión Core del singleton (`sb-127-auth-token`) y el hint no autoritativo `arma2:torneos:last-workspace:v2` — **ningún bearer bridge** (`identity-bridge`/`arma2-torneos-local` ausentes); rutas OFF → página «No disponible en esta versión» con 0 requests bloqueados.

## 8. Tests

| Suite | Resultado |
| --- | --- |
| `npm run test:torneos:frontend-foundation` (node): `foundation.test.mjs` 17 (F1 cerrado: fixtures `legacy-audit.json` + `b04-audit.json`, sin SHA; T1 sin segundo login; T13 feature map; paridad prebuild), `transport.test.mjs` 13 (T8–T12, T14 con `fixtures/gateway-contract.json`), `adapter.test.mjs` 8 (T2, T3, equivalencia alias por alias) | **38/38** |
| Jest `torneosStagingV1Composition.test.jsx` (T4/T7) 21 + `torneosStagingV1Gate.test.jsx` 4 (modo híbrido cableado entero con fetch scripteado: exchange → RPC con bearer bridge; refresh Core → re-exchange; `disabled` sin red; `legacy-local`) | **25/25** |
| Jest Torneos completo (legacy + B04) | **78 suites / 1191 tests** |
| `quality-gate-contract` 10/10 · ESLint `src/` 0/0 · `npm run build` (config híbrida placeholder) OK, bundle: 0 `service_role`, 0 ref Production (`sb_secret_` ×1 es un literal de `@supabase/functions-js`) | ✔ |
| `npm run test:ci` | **rojo por deuda heredada/entorno, no B04**: B04 38/38 ✔; `test:staging:guard` 236/239: `static-guard` (F2: JWT anon del lab 1.5 en `integration/torneos-sso/evidence/app-console.json`, commit `2cd3512e`) + `tournament-media-procedure.test.mjs` (`pg` ausente en el `node_modules` symlinkeado, F4) + `psql-connection-live.test.mjs` (`embedded-postgres` ausente, F4). |

## 9. Hallazgos

- **H1 (frontend, latente en legacy):** `TeamRegistrationPage.addPlayer`/`createProvisional` no envían `shirtNumber` → `p_shirt_number` viajaba `undefined` → JSON lo omite → PostgREST `PGRST202` (la firma del baseline no tiene defaults). Reproducido en el lab (404) y corregido en `torneosClient` (`undefined → null` en todos los args; test). El servicio legacy tiene la misma omisión y **no lo toqué** (fuera de scope; la composición legacy no cambia).
- **H2 (producto, esperado):** `submit_tournament_team_entry` por el owner con la invitación pendiente → `TORNEOS_RESOURCE_FORBIDDEN`. Igual que R5 (presenta el capitán o el owner tras la aceptación). UI muestra el copy correcto.
- **H3 (dev):** con `React.StrictMode` el transporte creado en `useMemo` quedaba dispuesto por el cleanup simulado → `CORE_AUTH_REQUIRED` falso. Corregido (transporte nace y muere en el efecto de montaje).
- **H4 (lab):** `gateway.mjs` no responde OPTIONS ni CORS y sólo acepta su propio `Origin` (diseño 1.5); el puente dev-only lo resuelve sin tocar el gateway. En remoto no aplica: `TORNEOS_ALLOWED_ORIGIN` = origen de la app y el port Deno ya responde CORS/OPTIONS.

## 10. Blockers restantes y siguiente paso — Torneos remote staging

Ninguno arquitectónico. Lo que falta es exclusivamente **activación remota** y su certificación:

1. **Gateway hospedado**: desplegar `torneos-gateway` (Deno, R4/R5) en el proyecto Torneos non-prod con `TORNEOS_ALLOWED_ORIGIN` = origen exacto del frontend staging (Vercel preview/staging), `CORE_AUTH_URL`/`CORE_JWT_ISSUER` = Core staging `hhyvmhgpapyuzjgxfnqv`, `CORE_CONTRACT_URL` = contrato Core desplegado en R3/R4, ring/JWKS de R2, logins `identity_writer`/`core_adapter` — con el operator/custody de `plan-r2-local-f7ace5`, no a mano. Torneos backend remoto = decisión R2-remoto (hoy R2 es local Docker): el frontend no depende de dónde viva mientras el gateway lo alcance.
2. **Frontend staging**: build con `REACT_APP_SUPABASE_URL` = Core staging, `REACT_APP_TORNEOS_GATEWAY_URL=https://<torneos-ref>.supabase.co/functions/v1/torneos-gateway`, `REACT_APP_DEPLOY_ENV=staging`, `REACT_APP_TORNEOS_DATA_ENV=staging`, `REACT_APP_TORNEOS_STAGING_PROJECT_REF=hhyvmhgpapyuzjgxfnqv`, flags `TORNEOS/WORKSPACES/WORKSPACE_SWITCHER/DEEP_LINKS=true`, resto `false`, `REACT_APP_PRODUCTION_PROJECT_REF` seteado (el prebuild y `config.js` rechazan cualquier gateway con ese ref). Sin gateway el modo es `disabled` (no hay camino monolito).
3. **QA remota** = repetir §7 con usuarios Core staging reales (login por magic link real), verificando en el browser: CORS/preflight del port Deno, TTL 120 s vs margen 20 s (R5 midió 401 a los 128 s), `content-range` expuesto para la tabla de miembros, logout multi-pestaña, y `Origin` real (sin puente). Los blockers R4-1…R4-7 del prep quedan cerrados por R4/R5 salvo los valores de despliegue.
4. **Deuda heredada a decidir con Astra** (no B04): F2 allowlist del evidence 1.5 en `static-guard` (o redactar el JWT anon), F4 `pg`/`embedded-postgres` en el `node_modules` propio del worktree, y H1 en el servicio legacy.

## Anexo — reproducir

```
npm run test:torneos:frontend-foundation
CI=true npx react-scripts test --watchAll=false --runInBand --testPathPattern='torneosStagingV1'
cd integration/torneos-core-contracts && npm ci --ignore-scripts && PHASE3A_LAB_PROJECT=arma2-b04-hybrid-lab node lab.mjs up
docker compose -p arma2-b04-hybrid-lab --env-file .runtime/compose.env -f compose.yaml -f compose.b04.yaml up -d core-api
node scripts/torneos-frontend/lab-fixtures.mjs users && node scripts/torneos-frontend/lab-fixtures.mjs core-team
node scripts/torneos-frontend/start-hybrid-lab-app.mjs --start      # app en http://localhost:3000
node scripts/torneos-frontend/lab-fixtures.mjs login b04-owner@lab.test   # abrir la URL impresa en el browser
node scripts/torneos-frontend/report.mjs                            # regenerar b04-audit.json + TORNEOS-CALL-MAP.md tras cambiar accesos backend
```
