# SOCIAL-V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Volver a habilitar el Estudio Social en Production (FREE: Base + 3 placas con firma Arma2; PREMIUM: todo) detrás de flags que hoy quedan OFF, sin Multimedia, sin Billing/Commerce/MP y fail-closed en cada capa.

**Architecture:** Un contrato nuevo, SOCIAL-V1, con las mismas cuatro capas que PLAN READ: migración 0008 (GRANT + fix de NULL en `authorize_tournament_social_export`), módulo opt-in del gateway (`TORNEOS_SOCIAL_MODE=on` agrega exactamente 3 RPC), overlay del feature map híbrido + scope del cliente + 3 alias del adapter, y la elegibilidad del flag web `socialContentGenerator`. Todo el código se mergea apagado; cada encendido en Production es un gate.

**Tech Stack:** PostgreSQL 17 (Supabase), Deno 2.9.7 (gateway Cloud Run), React/CRA + Jest, `node --test`.

**Spec:** [`AUDIT.md`](AUDIT.md) (mismo directorio). Operación: `docs/torneos/OPERATOR-RUNBOOK.md` (rama `claude/arma2-torneos-autonomous-operator-9a372f`).

## Global Constraints

- RPC del contrato, exactas: `get_tournament_social_studio_context`, `get_tournament_social_snapshot`, `authorize_tournament_social_export`. `set_tournament_social_permission` **no** entra.
- Pin de Production previo: cuerpo `authorize_tournament_social_export` md5 `f211d9a26d99448d4069c499c7508c55`; ACL `authenticated=171 anon=12`; post 0008: `172/12`.
- Gateway: env `TORNEOS_SOCIAL_MODE` ∈ {ausente, `""`, `off`, `on`}; cualquier otro valor ⇒ el boot falla (`SocialConfigError`).
- Web: una sola variable, `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=true` (literal), production-only; además exige PLAN READ on y backend productivo certificado.
- Billing/Commerce/MP: ninguna env, RPC ni ruta nueva; las 14 comerciales siguen 403 `rpc not enabled`, checkout 404.
- Sin Multimedia: el adapter híbrido no expone `signMediaReadUrls`, `resolveTeamShieldUrl` ni `resolveTournamentLogoUrl`.
- Copy de usuario en español rioplatense; nunca "familias" en Mi plan.
- No se toca Production en ninguna tarea: la ejecución en Production es la sección "Rollout", gate por gate.

## Review Focus

1. Lectura de plan `loading`/`error`/de otra temporada mientras el Estudio está abierto ⇒ la UI nunca habilita export Premium (T4: test "plan no confiable ⇒ sólo Base 3").
2. `TORNEOS_SOCIAL_MODE=ON`, `"on "`, `1`, `true` ⇒ boot cerrado, no "casi on" (T2: test de valores inválidos).
3. Temporada FREE que intenta exportar sin firma o con tema Premium por API directa ⇒ 403 de la DB aunque el gateway deje pasar (T1: casos A4–A6 + F1 en el lab).
4. Torneo sin fixture publicado / sin partidos ⇒ estado explicativo, no "error transitorio" (T4: copy de `TORNEOS_SOCIAL_SCOPE_UNAVAILABLE`).
5. Flag web `true` con PLAN READ off o backend no certificado ⇒ el Estudio no existe y no sale ni un request social (T3: test de composición).

---

### Task 1: Migración 0008 — GRANT + NULL-guard de la autorización de export

**Files:**
- Create: `backend/torneos/supabase/migrations/00000000000008_social_v1_export_authorization.sql`
- Create: `backend/torneos/social-v1/rollback/00000000000008_social_v1_export_authorization.rollback.sql`
- Create: `backend/torneos/social-v1/contract.json`
- Modify: `backend/torneos/social-v1/lab/run-audit-lab.sh` → copiar a `lab/run-lab.sh` (RED → 0008 → GREEN → re-apply → rollback → RED → 0008)
- Test: `backend/torneos/social-v1/social-v1-migration.test.mjs` (estático) + el lab

**Interfaces:**
- Produces: `contract.json` = `{ "phase": "SOCIAL-V1", "rpcs": [3 nombres], "grant": ["authorize_tournament_social_export(uuid,uuid,text,text,boolean)"], "excluded": { "set_tournament_social_permission": "sin consumidor en la UI" }, "pins": { "authorize_pre_md5": "f211d9a2…", "authorize_post_md5": "<calculado>", "acl_pre": [171,12], "acl_post": [172,12] } }`. T2 y T3 leen `rpcs` de acá en sus guards.

- [ ] **Step 1: Test estático que falla** — `social-v1-migration.test.mjs`: el archivo 0008 existe; contiene exactamente un `GRANT EXECUTE` (a `authenticated`, sobre `authorize_tournament_social_export`), cero `REVOKE`, cero `anon`, ningún otro `CREATE OR REPLACE FUNCTION`; el cuerpo nuevo es el baseline con sólo 3 cambios (`p_theme is null or`, `p_piece is null or`, `coalesce(p_include_arma2_branding, true)` en las dos lecturas); el md5 del cuerpo nuevo = `contract.json.pins.authorize_post_md5`.
- [ ] **Step 2:** `node --test backend/torneos/social-v1/social-v1-migration.test.mjs` ⇒ FAIL (archivo inexistente).
- [ ] **Step 3: Escribir 0008** con el patrón de 0007/0004: `BEGIN`; tabla temporal de ACL; precondición (md5 ∈ {pre, post}, ACL ∈ {cerrada, abierta}, conteos ∈ {171/12, 172/12}, `prosecdef`, `search_path=""`, los otros 2 RPC y los 9 helpers con su md5 de `evidence/catalog-post0007.txt`) ⇒ si no, `TORNEOS_SOCIAL_V1_PRECONDITION_FAILED`; `CREATE OR REPLACE` del cuerpo; `GRANT`; postcondición (172/12 exactos, sin `anon`/`PUBLIC`/`torneos_core_adapter`/`torneos_identity_writer`/`torneos_payment_service`, resto idéntico) ⇒ `TORNEOS_SOCIAL_V1_POSTCONDITION_FAILED`; `COMMIT`. Rollback: inverso, mismas guardas.
- [ ] **Step 4: Lab** — `lab/run-lab.sh`: los casos A0–A12, R1–R8 del audit con estas expectativas post-0008: A0 ⇒ `OK` (ya no "permission denied"); **F1a ⇒ `ERR:TORNEOS_SOCIAL_THEME_UNKNOWN`, F1b ⇒ `ERR:TORNEOS_SOCIAL_PIECE_UNKNOWN`, F1c ⇒ `ERR:TORNEOS_SOCIAL_THEME_UNKNOWN`, F1d ⇒ `OK:"includeArma2Branding": true`**; agregar un caso PREMIUM (fila en `tournament_season_plan_grants` para la temporada A2 + torneo en A2): `mvp`/`heritage`/sin firma ⇒ OK con `includeArma2Branding:false`, Base con firma pedida ⇒ `true`. Re-apply ⇒ no-op (md5 igual); rollback ⇒ catálogo idéntico a `catalog-post0007.txt`; diff de catálogo POST_0007→POST_0008 = sólo la fila de `authorize_…` (md5 + `authenticated`).
- [ ] **Step 5:** `node --test …migration.test.mjs` y `backend/torneos/social-v1/lab/run-lab.sh` ⇒ PASS, `SOCIAL_V1_LAB_PASS`. Evidencia en `evidence/`.
- [ ] **Step 6: Commit** `feat(torneos): SOCIAL-V1 migration 0008 opens export authorization with NULL guards`.

### Task 2: Gateway — `TORNEOS_SOCIAL_MODE` opt-in con 3 RPC exactas

**Files:**
- Create: `backend/torneos/supabase/functions/torneos-gateway/social-v1-rpc-allowlist.json`
- Create: `backend/torneos/supabase/functions/torneos-gateway/social.ts`
- Modify: `backend/torneos/supabase/functions/torneos-gateway/index.ts:46,82` (import + composición)
- Modify: `backend/torneos/perf-v2/g1-main-integration.test.mjs` (strip de la composición social como `withoutPlanComposition`; nuevos archivos en el allowlist; manifiesto de 20 archivos)
- Test: `backend/torneos/social-v1/social-v1-gateway.test.mjs` (modelo: `backend/torneos/plan-read/plan-read.test.mjs`)

**Interfaces:**
- Consumes: `contract.json.rpcs` (T1).
- Produces: `export const SOCIAL_RPCS: readonly string[]`, `export class SocialConfigError extends Error`, `export function withSocial(base: ReadonlySet<string>, env: Record<string, string | undefined>): ReadonlySet<string>`.

- [ ] **Step 1: Tests que fallan**: (a) `withSocial(base, {})`, `{TORNEOS_SOCIAL_MODE:''}`, `'off'` ⇒ mismo set; `'on'` ⇒ base + exactamente `SOCIAL_RPCS`; `'ON'`, `'on '`, `'true'`, `'1'` ⇒ `SocialConfigError`. (b) JSON = `contract.json.rpcs`, disjunto de staging/competition/officialization/públicas/`PLAN_READ_RPCS`/commerce. (c) Gateway real (sandbox de plan-read) con `on`: las 3 llegan a REST; `set_tournament_social_permission` y las 14 comerciales ⇒ 403 `rpc not enabled` sin REST; checkout ⇒ 404; ruta pública con las 3 ⇒ 403; sin bearer ⇒ 401 sin dependencias. (d) Con modo ausente: las 3 ⇒ 403 `rpc not enabled`.
- [ ] **Step 2:** `node --test backend/torneos/social-v1/social-v1-gateway.test.mjs` ⇒ FAIL (`social.ts` no existe).
- [ ] **Step 3: Implementar** `social.ts` (calco de `plan-read.ts`, lee el JSON y valida `phase === "SOCIAL-V1"`) y en `index.ts` `const rpcAllowlist = withSocial(withPlanRead(effectiveRpcAllowlist(baseAllowlist, commerce), env), env)`.
- [ ] **Step 4:** tests de T2 + `npm run test:torneos:g1` + `node --test backend/torneos/plan-read/plan-read.test.mjs` ⇒ PASS.
- [ ] **Step 5: Commit** `feat(torneos): gateway SOCIAL-V1 opt-in (TORNEOS_SOCIAL_MODE) with three exact RPCs`.

### Task 3: Frontend — elegibilidad, overlay, scope y alias (todo OFF por defecto)

**Files:**
- Modify: `src/features/torneos/config/featureFlags.js` (`PRODUCTION_ELIGIBLE_FLAGS` + `'socialContentGenerator'`; actualizar el comentario)
- Modify: `src/features/torneos/foundation/config.js` (+ `resolveTorneosSocialStudio`)
- Create: `src/features/torneos/foundation/socialV1Scope.js`
- Modify: `src/features/torneos/foundation/torneosClient.js` (`createTorneosClient({ …, social = false })`)
- Modify: `src/features/torneos/stagingV1/stagingV1WorkspaceService.js` (3 alias + `SOCIAL_METHODS` + strip)
- Modify: `src/features/torneos/stagingV1/stagingV1Features.js` (`stagingV1SocialOverlay`, `stagingV1FeaturesFor(mode, { planRead, social })`)
- Modify: `src/features/torneos/stagingV1/StagingV1TorneosApp.jsx`, `src/features/torneos/TorneosFeatureGate.jsx` (prop `social`)
- Test: `src/__tests__/torneosFeatureFlags.test.js`, `src/__tests__/torneosStagingV1Composition.test.jsx`, `scripts/torneos-frontend/social-adapter.test.mjs` (nuevo, en `test:torneos:frontend-foundation`)

**Interfaces:**
- Consumes: `social-v1-rpc-allowlist.json` (T2) para el guard de igualdad del scope.
- Produces: `resolveTorneosSocialStudio(env = process.env, { backendMode, planRead }) => boolean` (= `backendMode.mode === 'hybrid' && planRead === true && resolveTorneosFeatureFlags(env).socialContentGenerator === true`); `isSocialV1Operation(name) => boolean`; `SOCIAL_METHODS = ['loadSocialStudioContext','loadSocialSnapshot','authorizeSocialExport']`; `stagingV1SocialOverlay = { social_studio: true }`.

- [ ] **Step 1: Tests que fallan**: flags — Production certificado + `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=true` ⇒ `socialContentGenerator === true` (hoy `false`, línea 405); `'TRUE'`/`'1'` ⇒ `false`. Composición — `social` sólo si híbrido ∧ PLAN READ ∧ flag; con cualquiera en falso: `features.social_studio === false`, el servicio no tiene ninguno de `SOCIAL_METHODS`, sin nav "Estudio Social", y 0 llamadas sociales al transport. Adapter — cada alias manda el mismo RPC y `p_*` que el legacy (`api/tournamentWorkspaceService.js:1940-1980`); `setSocialPermission`, `signMediaReadUrls`, `resolveTeamShieldUrl`, `resolveTournamentLogoUrl` ausentes; cliente con `social:false` ⇒ `TORNEOS_OUTSIDE_STAGING_V1`; scope = JSON del gateway.
- [ ] **Step 2:** `CI=true npx react-scripts test --watchAll=false torneosFeatureFlags torneosStagingV1Composition` + `node --test scripts/torneos-frontend/social-adapter.test.mjs` ⇒ FAIL.
- [ ] **Step 3: Implementar** con los nombres de Interfaces; el overlay se aplica después del de PLAN READ (`billing test` sigue mandando sobre ambos).
- [ ] **Step 4:** mismos comandos + `npm run test:torneos:frontend-foundation` ⇒ PASS.
- [ ] **Step 5: Commit** `feat(torneos): SOCIAL-V1 frontend composition behind the production-eligible social flag`.

### Task 4: UX del Estudio en la composición híbrida

**Files:**
- Modify: `src/features/torneos/api/tournamentWorkspaceErrors.js` (copy de `TORNEOS_SOCIAL_FORBIDDEN`, `TORNEOS_SOCIAL_EXPORT_FORBIDDEN`, `TORNEOS_SOCIAL_SCOPE_UNAVAILABLE`, `TORNEOS_SOCIAL_THEME_UNKNOWN`, `TORNEOS_SOCIAL_PIECE_UNKNOWN`)
- Modify: `src/features/torneos/components/SocialStudioPage.jsx` (`runExport`: mostrar `error.message` traducido para `TORNEOS_SOCIAL_*`/`TORNEOS_BRANDING_PREMIUM_REQUIRED` en vez del genérico)
- Modify: `src/features/torneos/domain/planComparison.js`, `src/features/torneos/components/PlanExperiencePage.jsx` (con `features.social_studio`: Estudio Social sale de `PLAN_COMING_SOON` y entra a la tabla como "Estudio Social" — FREE: "Estilo Base: Resultados, Tabla de posiciones y Próxima fecha, con firma Arma2"; PREMIUM: "Todas las placas, 5 estilos, firma opcional")
- Test: `src/__tests__/torneosSocialStudioV1Matrix.test.jsx` (nuevo), `src/__tests__/torneosPlanExperience.test.jsx`

**Interfaces:**
- Consumes: `SOCIAL_METHODS` y el servicio de T3; `PLAN_COMPARISON`/`PLAN_COMING_SOON` actuales.
- Produces: `planComparisonFor(features) => { comparison, comingSoon }` (reemplaza el uso directo de las constantes en `PlanExperiencePage`).

- [ ] **Step 1: Tests que fallan**: matriz — para las 11 piezas × {base, heritage, street, scoreboard, editorial} × {portrait, story}, `prepareSocialRender` con snapshot de fixture, `signMediaReadUrls`/`resolveShieldUrl` `undefined`, sin logo ni foto ⇒ resuelve (curadas con selección hecha) y ninguna llamada de red de medios; plan no confiable (`loading`, `error`, otra temporada) ⇒ `catalogAccess.exportable` sólo para las 3 Base; FREE ⇒ `authorizeSocialExport` recibe `includeArma2Branding: true`; `TORNEOS_SOCIAL_PREMIUM_REQUIRED` del servidor ⇒ aviso "Esta familia de piezas requiere Premium en la temporada." y 0 descargas; `SCOPE_UNAVAILABLE` ⇒ copy de fixture no publicado. Mi plan — con `social_studio` on, 4 filas y "Estudio Social" fuera de Próximamente; off ⇒ igual que hoy (3 filas).
- [ ] **Step 2:** `CI=true npx react-scripts test --watchAll=false torneosSocialStudioV1Matrix torneosPlanExperience` ⇒ FAIL.
- [ ] **Step 3: Implementar** copy + `planComparisonFor` + propagación del mensaje en `runExport`.
- [ ] **Step 4:** `npm run test:ci` ⇒ PASS (todas las suites); `scripts/qa/plan-ux/browser-check.cjs` ⇒ verde.
- [ ] **Step 5: Commit** `feat(torneos): Social Studio UX for the hybrid composition (errors, Mi plan, no-photo matrix)`.

### Task 5: Certificación y operación

**Files:**
- Create: `backend/torneos/social-v1/probe/social-matrix.mjs` (probe autenticado para el documento `/login`, mismo harness que la matriz PLAN READ 32/32)
- Modify: `docs/torneos/OPERATOR-RUNBOOK.md` (rama del runbook): §5 flags, §8 rollout SOCIAL-V1, §9 rollback, procedimiento `cloudrun-readonly`
- Test: `backend/torneos/social-v1/probe/social-matrix.test.mjs` (contra el gateway sandbox de T2)

**Interfaces:**
- Consumes: gateway de T2; `cloudrun-readonly.mjs` (ya en el repo).
- Produces: matriz con expectativas fijas: contexto org QA ⇒ 200 con `capabilities` y `freeBaseFamilies`; snapshot `standings` ⇒ 200 o `SCOPE_UNAVAILABLE` según datos QA; authorize FREE Base `round_results` con firma ⇒ 200 `authorized:true includeArma2Branding:true`; `mvp` ⇒ 403 `TORNEOS_SOCIAL_PREMIUM_REQUIRED`; `heritage` ⇒ 403; Base sin firma ⇒ 403 `TORNEOS_BRANDING_PREMIUM_REQUIRED`; theme `null` ⇒ 400 `TORNEOS_SOCIAL_THEME_UNKNOWN`; org ajena ⇒ 403; `set_tournament_social_permission` ⇒ 403 `rpc not enabled`; 14 comerciales ⇒ 403; checkout ⇒ 404; sin bearer ⇒ 401. Un solo `/exchange`.

- [ ] **Step 1–4:** test del probe contra el sandbox (FAIL → implementar → PASS), runbook actualizado.
- [ ] **Step 5: Commit** `test(torneos): SOCIAL-V1 certification probe and runbook`.

---

## Rollout en Production (cada paso es un gate; formato `GATE / Estado / Riesgo / Cambio exacto / Rollback / ¿GO?`)

| # | Gate | Cambio exacto | Certificación | Rollback |
|---|---|---|---|---|
| 0 | A | Merge del PR de T1–T5 (todo OFF). Vercel redeploya `main` sin env nueva ⇒ sin cambio visible | bundle sin `SOCIAL_GENERATOR` con valor; Estudio inexistente | revert del merge |
| 1 | D | Aplicar 0008 en `onzpwnqxnvlgsevivngf` (precondición: G1 read-only = POST_0007 171/12, md5 `f211d9a2…`) | post 172/12, md5 nuevo, catálogo = lab | `rollback/…0008….rollback.sql` (gate D) |
| 2 | B | Imagen nueva del gateway (grafo 20 archivos = `main`) con `TORNEOS_SOCIAL_MODE` **ausente**, revisión nueva a 0 % + tag ⇒ 100 % | unauth 15/15 sin diffs; auth: las 3 ⇒ 403 `rpc not enabled`; `cloudrun-readonly --expect-env TORNEOS_SOCIAL_MODE=<absent>` | tráfico a `00003-b78` |
| 3 | B+C | Revisión nueva = anterior + `TORNEOS_SOCIAL_MODE=on` | matriz T5 + regresión PLAN READ 32/32; 0 5xx | tráfico a la revisión del paso 2 |
| 4 | C | Vercel `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=true` (production-only) + redeploy de `main` | UX con sesión QA: nav "Estudio Social", FREE exporta PNG Base de las 3 placas con firma, resto con candado y sin checkout, 0 requests de medios/commerce, 390/320 sin overflow | promover el deploy anterior o borrar la env |

Fuera de alcance: Android (gate J, el build no debe llevar la env hasta revisarlo), asignar PREMIUM a una temporada (gate D), Multimedia, logos/escudos, permisos sociales para colaboradores.
