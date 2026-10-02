# ARMA2 TORNEOS — OPERATOR RUNBOOK

Autoridad operativa para continuar Arma2 Torneos. Se actualiza en cada paso de rollout.
**Sin secretos:** este archivo nunca contiene access/refresh tokens, service_role, anon keys, claves privadas ni URLs de DB con credenciales. Los secretos viven en Secret Manager (Cloud Run) y en las env de Vercel/Supabase.

Última actualización: 2026-10-02 (ver [Último estado certificado](#último-estado-certificado)).

---

## 1. Modo de operación

El operador (Claude) avanza solo en todo lo read-only, local y reversible: lectura, diagnóstico, git fetch/status/diff/log, tests, builds locales, lint, guards, CI, smoke tests, benchmarks chicos, lectura de logs/config, documentación, preparación de branches y PRs, verificación post-deploy y este runbook.

### Gates — requieren GO explícito de Nico en el chat

| Gate | Acción |
|---|---|
| A | Mergear un PR |
| B | Deployar o cambiar tráfico en Production |
| C | Modificar variables/envs/secrets de Production |
| D | Escribir o migrar una DB Production |
| E | Rollback Production (salvo caída crítica causada por una acción recién autorizada) |
| F | Activar Billing |
| G | Activar Commerce |
| H | Activar Mercado Pago |
| I | Crear/modificar checkout o pagos reales |
| J | Subir Android a Google Play |
| K | Publicar iOS |
| L | Borrar datos, branches importantes, proyectos, servicios, bases o recursos |
| M | Contratar/subir un plan pago o generar un costo fijo nuevo |

Formato de pedido de gate: `GATE / Estado / Riesgo / Cambio exacto / Rollback / ¿GO?`, pocas líneas.

Ante un resultado inesperado: fail closed, no arreglar en caliente, diagnosticar con todo lo read-only/local, y recién entonces escalar el problema concreto. Entre alternativas técnicas equivalentes se elige la más conservadora (arquitectura, seguridad, costo, rollback).

---

## 2. Arquitectura actual

```
app.arma2.com.ar (Vercel, CRA)  ──Core auth──▶  Supabase Core  rcyuuoaqfwcembdajcss  (Arma2 principal)
        │
        └─ REACT_APP_TORNEOS_GATEWAY_URL ──▶  Cloud Run  torneos-gateway  (southamerica-east1)
                                                 ├─ /exchange: Core session → bridge token (TTL 120 s)
                                                 ├─ RPC allowlist + Core session + identity (G1, en paralelo)
                                                 └─ PostgREST ─▶ Supabase Torneos Prod  onzpwnqxnvlgsevivngf
```

- **Gateway Production:** Cloud Run, Deno 2.9.7 (`denoland/deno:2.9.7`), entrada `torneos-gateway/index.ts`. Fuente en git: `backend/torneos/supabase/functions/torneos-gateway/` + `torneos-payments/{hmac,remote-hosts}.ts` (grafo de 18 archivos).
- **Deno Deploy (gateway viejo, Chicago):** sigue vivo sólo como fallback para builds viejos (Android ≤ 42). No recibe tráfico web.
- **Shadows Cloud Run** (idle, min 0, costo ≈ 0): `tgw-sp-g1` (PLAN READ ON, usado para certificar), `tgw-sp-serial`. Borrarlos = gate L.
- **Staging Torneos:** `hhyvmhgpapyuzjgxfnqv`. Nunca usar el Supabase CLI ni `--linked` (el repo está linkeado a Production).

---

## 3. Production refs

### Cloud Run

| Campo | Valor |
|---|---|
| Proyecto | `arma2-465223` (número 476836389730) |
| Región | `southamerica-east1` |
| Servicio | `torneos-gateway` |
| URL pública (única aceptada por el host guard) | `https://torneos-gateway-476836389730.southamerica-east1.run.app/functions/v1/torneos-gateway` |
| Alias `*-7fnauuvvxa-rj.a.run.app` | responde 403 (host guard), esperado |
| Revisión activa | `torneos-gateway-00003-b78` (PLAN READ ON), 100 % fijado por REVISION (no LATEST: una revisión nueva no recibe tráfico sola). Anteriores: `torneos-gateway-00002-skw` (misma imagen, PLAN READ OFF), `torneos-gateway-00001-7lw` (imagen pre-PLAN READ) |
| Imagen activa | `.../torneos-gateway/gateway@sha256:dc8049d3c285c008219a32b7eff1329c160b374ff8862e9c26bec372f847c191` (tag `main-44b4b4b2`) |
| Escalado | min 0, max 3, concurrencia 80, 1 vCPU / 512Mi, `cpuIdle` (request-based billing), startup CPU boost |
| Timeout | 30 s |
| Service account | `torneos-gateway-prod@arma2-465223.iam.gserviceaccount.com` (sólo `secretAccessor` sobre 4 secretos) |
| Ingress / invoker | all / IAM invoker deshabilitado (público, la autenticación es del gateway) |
| Secretos (Secret Manager, @1) | `torneos-gw-shadow-bridge-keys`, `-contract-secret`, `-db-identity-writer-url`, `-db-core-adapter-url`. Etiquetados `production=torneos-gateway`: **no borrar en una limpieza de shadows** |
| Env no secretas | `CORE_ANON_KEY`, `CORE_AUTH_URL`, `CORE_CONTRACT_URL`, `CORE_JWT_ISSUER`, `TORNEOS_ALLOWED_ORIGIN=https://app.arma2.com.ar`, `TORNEOS_ANON_KEY`, `TORNEOS_DB_SSL_CA`, `TORNEOS_GATEWAY_PUBLIC_URL`, `TORNEOS_PLAN_READ_MODE=on`, `TORNEOS_REST_URL` (14 env en total con los 4 secretos) |
| Env de commerce / billing / MP | **ninguna** |
| Env de PLAN READ | `TORNEOS_PLAN_READ_MODE=on` (desde rev `00003-b78`) |
| Artifact Registry | `southamerica-east1-docker.pkg.dev/arma2-465223/torneos-gateway/gateway` (Prod) y `.../torneos-gw-shadow/gateway` (shadows) |

`gcloud` local corre con Python 3.9 y `gcloud run` crashea (`CommandLoadFailure`). Operar Cloud Run por la REST API v2 (`run.googleapis.com/v2/...`) con `gcloud auth print-access-token`; las copias de imagen y las verificaciones de contenido se hacen con Cloud Build (`gcrane`, `docker run` del digest).

### Vercel

| Campo | Valor |
|---|---|
| Proyecto | `prj_h8ozz0T5Jw1yZHZfqwObwhF2gu2c` (`arma2`), dominio `app.arma2.com.ar` |
| Deploy Production actual | `dpl_3i3jzSDodUVY4RKzwBioZ5szDB9o` (main `44b4b4b2`, bundle `main.45421abc.js`, PLAN READ ON) |
| Rollback frontend | promover `dpl_FYRP4LaoNBvs2gpz3wjyH5hyQvmN` (mismo main, bundle `main.d122a441.js`, PLAN READ OFF). Más atrás: deployment sobre `4a8c5bbe` (GitHub deployment 6785088892) |
| `REACT_APP_TORNEOS_GATEWAY_URL` | URL Cloud Run de arriba (env id `uNG4dxIq8STJFH59`, production-only) |
| `REACT_APP_TORNEOS_PLAN_READ_MODE` | `on` (env id `vC6YHwcitmPuCbNy`, production-only, 2026-10-02) |
| Billing | ausente → OFF (`NOT_CONFIGURED`) |

### Supabase

| Proyecto | Ref | Rol |
|---|---|---|
| Core (Arma2) | `rcyuuoaqfwcembdajcss` | Auth + datos de Arma2. Issuer del bearer Core |
| Torneos Production | `onzpwnqxnvlgsevivngf` | DB de Torneos detrás del gateway |
| Torneos Staging | `hhyvmhgpapyuzjgxfnqv` | Staging |

---

## 4. Migrations Torneos (Production)

Directorio: `backend/torneos/supabase/migrations/`. Production está en **POST_0007**.

| # | Archivo | sha256 (prefijo) |
|---|---|---|
| 0000 | `torneos_baseline_v1.sql` | `f857bd0939054bc1` |
| 0001 | `staging_v1_rpc_exposure.sql` | `3df4b96eecc7321e` |
| 0002 | `mercadopago_checkout_pro_test.sql` | `06378f12b57620e8` |
| 0003 | `mercadopago_provider_ordering.sql` | `d54b3293da53aea1` |
| 0004 | `competition_v1_rpc_exposure.sql` | `36e45eddf5769047` |
| 0005 | `officialization_v1.sql` | `51fe200f2124e786` |
| 0006 | `domain_error_contract.sql` | `767d57e8fb96ca69` |
| 0007 | `season_entitlements_scope.sql` | `ba0450f965f3357679e493efc8ac465eb37c836dafccdf21138ea9244d85a205` |

- 0007 aplicada en Production y certificada (`TORNEOS_SEASON_SCOPE_PROD_DB_CERTIFIED`). Cuerpo `md5(prosrc)` = `bf263acafb185ee0993117d5805bc701` (antes `a533331a…`). **No volver a aplicarla.**
- Rollback de 0007: sha256 `054985997ea06a0c7745f1e700489a9b879cbd40f0320d83d7049780f2758be3`, restaura `a533331a…`. Sólo con PLAN READ y Commerce en OFF. Es gate D.

---

## 5. Flags

| Capa | Variable | Estado Production | Efecto en ON |
|---|---|---|---|
| Gateway | `TORNEOS_PLAN_READ_MODE` | **`on`** (rev `00003-b78`, 2026-10-02) | Agrega sólo `get_effective_tournament_season_entitlements` y `get_effective_tournament_entitlements` a la allowlist. Cualquier valor distinto de `on`/`off`/vacío cierra el boot (`PlanReadConfigError`) |
| Gateway | `TORNEOS_COMMERCE_MODE` y env de MP/pagos | **ausentes (OFF)** | Production rechaza commerce |
| Frontend | `REACT_APP_TORNEOS_PLAN_READ_MODE` | **ausente (OFF)** | Sólo `on` exacto, en composición `hybrid`: `entitlements` + `plan` (overlay `stagingV1PlanReadOverlay`). Billing sigue `false` |
| Frontend | Billing | OFF | — |

Con el flag de frontend OFF no existen "Mi plan", el badge FREE/PREMIUM, "Plan no verificado" ni lecturas de plan.

### Estado comercial

- **Billing:** OFF
- **Commerce:** OFF
- **Mercado Pago LIVE:** OFF
- 14 RPC comerciales → 403 `rpc not enabled`. Rutas `/commerce/v1/season-checkout` y `/internal/v1/season-checkout-preference` → 404.

---

## 6. PLAN READ

- Código en `main` desde PR #169 (merge `44b4b4b2`): `torneos-gateway/plan-read.ts` + gate visual en el frontend.
- Shadow `tgw-sp-g1` (rev `tgw-sp-g1-00004-br5`, imagen `dc8049d3…`, PLAN READ ON) certificado el 2026-10-01: matriz live 32/32 (`TORNEOS_PLAN_READ_SHADOW_API_CERTIFIED`).
  - Org QA + temporada QA → 200; lectura por torneo → 200.
  - Temporada QA + otra org, org QA + temporada ajena, temporada inexistente, org inexistente, torneo cruzado → 403 `TORNEOS_ENTITLEMENTS_FORBIDDEN`.
  - QA → FREE, `assignmentSource=default_free`, `schemaVersion=4`, galería 25, 1 colaborador admin + owner, Social Studio Base 3.
  - Sin bearer / bearer inválido → 401. RPC desconocida y 14 comerciales → 403. Checkout/MP → 404.
- Production `torneos-gateway-00003-b78` (PLAN READ ON) certificado el 2026-10-02 con la misma matriz: 32/32 (`TORNEOS_GATEWAY_PROD_PLAN_READ_ON_CERTIFIED`). 
- Frontend Production con PLAN READ ON (`dpl_3i3jzSDo…`) certificado el 2026-10-02 (`TORNEOS_WEB_PROD_PLAN_READ_UX_CERTIFIED`), ver §8.

---

## 7. Pins / hashes

| Qué | Valor |
|---|---|
| main | `44b4b4b2205887bc5eab1709b47269e1e4c34eb3` |
| Imagen Prod actual (= shadow plan-read, grafo = main) | `sha256:dc8049d3c285c008219a32b7eff1329c160b374ff8862e9c26bec372f847c191` (Cloud Build `74b7cb5e`, tag `torneos-gw-shadow/gateway:plan-read-6726a07d-readable`) |
| Imagen Prod anterior, rev `00001-7lw` (G1 `d2edf66d`, 17 archivos) | `sha256:d163a36bf05fbc8d31d4c9b8c67284cc7c637183bb8727c3b8cc789df2acd09e` |
| Grafo G1 base (manifiesto versionado) | digest `cfe5cd02e5de9703c7b2634ccea196070f3e188f9d859754f299adb0e020ccd2` |
| Grafo gateway main (18 archivos) | digest `80f94685…` (fijado en `backend/torneos/perf-v2/g1-main-integration.test.mjs`) |
| Delta main vs imagen anterior | sólo `index.ts` (wiring de `withPlanRead`, 4 líneas) + `plan-read.ts` nuevo |

---

## 8. Rollout PLAN READ

| Paso | Estado |
|---|---|
| 1. PR #169 | ✅ mergeado (`44b4b4b2`) |
| 2. Vercel Production desde main, PLAN READ OFF | ✅ READY, sin superficie de plan |
| 3. Gateway Production desde main, PLAN READ OFF | ✅ `TORNEOS_GATEWAY_PROD_PLAN_READ_OFF_CERTIFIED` (rev `torneos-gateway-00002-skw`) |
| 4. Gateway `TORNEOS_PLAN_READ_MODE=on` | ✅ rev `torneos-gateway-00003-b78` (misma imagen `dc8049d3…`) |
| 5. Certificar gateway Production (matriz del shadow, 1 `/exchange`) | ✅ `TORNEOS_GATEWAY_PROD_PLAN_READ_ON_CERTIFIED` (32/32) |
| 6. Vercel `REACT_APP_TORNEOS_PLAN_READ_MODE=on` + redeploy | ✅ env `vC6YHwcitmPuCbNy` + `dpl_3i3jzSDodUVY4RKzwBioZ5szDB9o` (main `44b4b4b2`, bundle `main.45421abc.js`) |
| 7. Certificar UX en Production (Mi plan, badge, temporadas, desktop/mobile, sin checkout) | ✅ `TORNEOS_WEB_PROD_PLAN_READ_UX_CERTIFIED` (ver abajo) |
| 8. Android (build nuevo con este frontend) | ⛔ gate J — **próximo gate** |

**Certificación UX web (2026-10-02, sesión real de Nico, org QA `ff425559…`, temporada `8b82d3ab…`):**

- Bundle: `REACT_APP_TORNEOS_PLAN_READ_MODE:"on"`, sin `REACT_APP_TORNEOS_BILLING_MODE`, 0 strings `checkout`/`mercadopago`. Env Vercel sin Billing/Commerce/MP.
- Header: badge `FREE · QA Temporada 2026` (link a `temporada/:id/plan`); pill FREE en el selector. "Mi plan" en el rail desktop y en la barra móvil (ítem 8 de 9, scrolleable); `/mi-plan` redirige a la temporada activa.
- Pantalla Mi plan: `FREE · QA Temporada 2026`, "FREE confirmado para esta temporada y sus torneos", comparación FREE vs PREMIUM, "La compra de Premium todavía no está disponible". 0 controles de compra.
- Red: 1 `get_effective_tournament_season_entitlements` → 200 por carga, rev `00003-b78`. Logs gateway 1 h: 0 5xx, 0 `CORE_UNAVAILABLE`.
- Fail-closed: temporada inexistente → "Sin temporada", badge "Sin temporada", **sin** lectura de plan, nunca FREE. Los estados "Lectura no disponible"/"Error transitorio" no se forzaron en Prod (cubiertos por tests y por los 403 del gateway en la matriz 32/32).
- Viewports (popup same-origin): 1440 sin overflow; 390 y 320 sin scroll horizontal, badge y card completos.
- No verificado: ruta `…/plan/compra/` (el clasificador bloqueó navegarla); con Billing OFF el bundle no la referencia. PREMIUM no se vio en Prod (no hay temporada PREMIUM).

Objetivo final: "Mi plan" en la navegación, badge FREE/PREMIUM, pantalla Mi plan por temporada con plan autoritativo real, errores fail-closed (nunca inventar FREE), Billing OFF y sin compra.

---

## 9. Rollback

| Capa | Cómo |
|---|---|
| Gateway (hoy) | Tráfico 100 % a `torneos-gateway-00002-skw` (misma imagen `dc8049d3…`, PLAN READ OFF). Segundos, sin rebuild. Más atrás: `torneos-gateway-00001-7lw` (imagen `d163a36b…`, pre-PLAN READ) |
| Gateway (genérico) | Tráfico 100 % a la revisión anterior (Run API v2: `PATCH services/torneos-gateway` con `traffic=[{type: REVISION, revision: <anterior>, percent: 100}]`). Sin rebuild |
| Gateway PLAN READ ON → OFF | quitar `TORNEOS_PLAN_READ_MODE` (nueva revisión) o volver tráfico a la revisión OFF |
| Frontend | promover `dpl_FYRP4LaoNBvs2gpz3wjyH5hyQvmN` (PLAN READ OFF, mismo main), o borrar env `vC6YHwcitmPuCbNy` y redeploy |
| Web → Deno | `REACT_APP_TORNEOS_GATEWAY_URL` a la URL Deno + redeploy (último recurso) |
| DB 0007 | script de rollback fijado arriba (gate D) |

---

## 10. Procedimiento: deploy del gateway Cloud Run

1. Verificar que el grafo de la imagen candidata = `main` (sha256 por archivo) y que el Dockerfile no cambió.
2. Baseline unauth de la revisión actual (health, OPTIONS, sin bearer, bearer inválido, rutas commerce).
3. Copiar el digest al repo Prod con Cloud Build `gcrane cp` y verificar el contenido en la imagen (`sha256sum`, versión de Deno, usuario `deno`).
4. Crear la revisión nueva fijando el tráfico en la anterior (0 % a la nueva) con un tag temporal. Cambiar sólo lo autorizado (imagen o env): secretos, SA, escalado y recursos idénticos. Enviar el `etag` leído para no pisar cambios concurrentes.
5. Chequear la candidata por su URL de tag con `x-forwarded-host: torneos-gateway-476836389730.southamerica-east1.run.app` (sin ese header el host guard responde 403, esperado). Suite unauth idéntica a la revisión activa (status + hash de body).
6. Mover 100 % a la revisión nueva (tipo REVISION) y quitar el tag → verificar config (URL, región, min/max, env sin PLAN READ/commerce salvo lo autorizado).
7. Smoke unauth + matriz autenticada con un solo `/exchange` QA desde un documento `/login` de `app.arma2.com.ar` (sin CSP del gate). Logs: 0 5xx, 0 `CORE_UNAVAILABLE`.

---

## Certificación 2026-10-02 — `TORNEOS_GATEWAY_PROD_PLAN_READ_OFF_CERTIFIED`

Deploy autorizado por Nico (gate B) desde `main 44b4b4b2`, PLAN READ ausente.

- **Imagen:** Cloud Build `e6de5674` copió el digest `dc8049d3…` (shadow certificado) a `torneos-gateway/gateway:main-44b4b4b2`; el digest destino es idéntico. Dentro de la imagen: Deno 2.9.7, usuario `deno`, 18 archivos con sha256 = `main 44b4b4b2` (18/18). Dockerfile = el de la imagen anterior.
- **Revisión:** `torneos-gateway-00002-skw`, Ready en 5 s. Candidata (0 %, tag temporal) idéntica a `00001-7lw` en la suite unauth 15/15. Luego 100 % del tráfico; tag eliminado.
- **Config:** misma URL y región; min 0 / max 3, 1 vCPU / 512Mi, concurrencia 80, timeout 30 s, SA, 13 env y 4 secretos @1 idénticos (comparación de template salvo imagen = igual). 0 env de PLAN READ / commerce / billing / MP.
- **Unauth (15/15, sin diffs de status ni de hash de body contra la revisión anterior):** health 200, config 200, JWKS 200 (mismo hash), OPTIONS 204, `/exchange` y RPC sin bearer o con bearer inválido → 401, RPC de plan y comercial sin bearer → 401, `/commerce/v1/season-checkout` y `/internal/v1/season-checkout-preference` → 404, origen ajeno → 403, alias `*.a.run.app` → 403.
- **Autenticado (26/26, un solo `/exchange` QA, 4.0 s):** documento `/login?returnTo=%2Fterms` (sin CSP, 0 requests previas al gateway), sesión QA `44106956…`, identidad preexistente `67671b64…`, TTL 120 s. Guard de fetch: 0 bloqueadas, 0 requests fuera del gateway.
  - Torneos normal: `get_tournament_workspace_context` y `get_tournament_competition_context` (org QA) → 200 con la org y la temporada QA.
  - `get_effective_tournament_season_entitlements` y `get_effective_tournament_entitlements` → 403 `rpc not enabled`.
  - RPC desconocida y las 14 comerciales → 403 `rpc not enabled`. Checkout/MP → 404. Sin bearer / inválido → 401.
- **Logs desde 14:30Z:** 0 5xx, 0 `CORE_UNAVAILABLE`, 0 líneas de error. Latencia server-side en instancia nueva: exchange 1.2 s, contexto 1.16 s (en ráfaga de 22), comparable con `00001-7lw` tras cold start (1.18 s / 1.6–1.8 s). Unauth ~260 ms, igual que antes. Sin regresión.
- **DB:** ninguna operación de DB ni migración en este paso; 0007 no se reaplicó. Billing, Commerce y MP LIVE siguen OFF.

## Certificación 2026-10-02 — `TORNEOS_GATEWAY_PROD_PLAN_READ_ON_CERTIFIED`

GO de Nico (gates B+C) sólo para `TORNEOS_PLAN_READ_MODE=on` en el gateway Production, misma imagen y todo lo demás sin cambios. Vercel, Billing, Commerce y MP no se tocaron.

- **Baseline:** servicio en gen 3, 100 % a `00002-skw`, 13 env, imagen `dc8049d3…`. Unauth 15/15 idéntica (status + hash de body) a la certificación OFF.
- **Revisión:** PATCH con el `etag` leído; template idéntico salvo la env nueva (verificado por diff). Creó `torneos-gateway-00003-b78` con 0 % (tráfico fijado en `00002-skw`) y tag temporal: Ready y healthy (el boot acepta `on`, sin `PlanReadConfigError`). Candidata por URL de tag + `x-forwarded-host`: unauth 15/15 sin diffs.
- **Tráfico:** 100 % a `00003-b78` (REVISION), tag eliminado. Config post-cambio: template = anterior + `TORNEOS_PLAN_READ_MODE=on`; 0 env de commerce/billing/MP; labels, escalado (max 3), ingress e invoker iguales. Unauth 15/15 en la URL Production sin diffs.
- **Autenticado (32/32 + 2/2 de regresión, un solo `/exchange` del probe, 2.9 s, 15:42:59Z):** documento `/login?returnTo=%2Fterms`, sesión QA `44106956…` (renovada por la propia app al cargar), identidad preexistente `67671b64…`, TTL 120 s. Guard de fetch: 0 bloqueadas del probe; 9 GET de la app a Core REST bloqueados por el guard (no salieron).
  - Org QA + temporada QA → 200; lectura por torneo → 200; mismo scope, plan, capabilities y límites.
  - QA → FREE, `default_free`, `schemaVersion=4`, `requiresPremium=false`, galería 25, 1 colaborador admin + owner (no cuenta), Social Studio Base 3, premium/full `false`.
  - N1 (temporada QA + org ajena), N2 (org QA + temporada ajena), temporada inexistente, org inexistente, torneo cruzado → 403 `42501 TORNEOS_ENTITLEMENTS_FORBIDDEN`.
  - Sin bearer / bearer inválido → 401. RPC desconocida y las 14 comerciales → 403 `rpc not enabled`. `/commerce/v1/season-checkout` y `/internal/v1/season-checkout-preference` → 404.
  - Regresión: `get_tournament_workspace_context` y `get_tournament_competition_context` (org QA) → 200.
- **Incidente de harness (sin impacto):** el primer intento falló cerrado con `WRONG_PAGE_STOP` antes de su exchange: la pestaña pasó a `/torneos` (el documento tenía foco; el código no redirige `/terms`) y la app hizo su propio `/exchange` + `get_my_tournament_memberships` + `get_tournament_workspace_context`, los tres 200 contra `00003-b78`. Se reintentó en un documento nuevo con espera de `/terms` y guard `APP_ALREADY_HIT_GATEWAY_STOP`. Exchanges 200 en `00003-b78`: 2 (app 15:39:28Z, probe 15:43:00Z).
- **Logs desde 15:30Z:** 0 5xx, 0 líneas de error, 0 `CORE_UNAVAILABLE`, 0 `PlanReadConfigError`. Latencia server-side: exchange ≤ 1.0 s, lecturas de plan ≤ 0.9 s, contexto ≤ 1.13 s.
- **Frontend:** bundle Production `main.d122a441.js` sin `REACT_APP_TORNEOS_PLAN_READ_MODE` ni referencias a las RPC de plan → sin cambio visible.
- **DB:** ninguna operación. Billing, Commerce y MP LIVE siguen OFF.

## Próximo gate — PLAN READ ON en el frontend Production (Vercel)

- **Cambio exacto:** agregar `REACT_APP_TORNEOS_PLAN_READ_MODE=on` (production-only) al proyecto Vercel `arma2` y redeployar Production desde `main` (mismo commit). Sin env de Billing, Commerce ni MP.
- **Efecto:** aparecen "Mi plan", el badge FREE/PREMIUM y la pantalla por temporada leyendo el plan autoritativo del gateway. Billing sigue `false` → sin compra ni checkout.
- **Certificación:** bundle nuevo con el flag `on` y sin Billing; UX en Production (Mi plan, badge, temporadas, desktop/mobile, sin checkout, errores fail-closed) con la sesión QA; logs del gateway.
- **Rollback:** promover `dpl_FYRP4LaoNBvs2gpz3wjyH5hyQvmN` (bundle `main.d122a441.js`) o quitar la env y redeployar.

## Gotchas operativos

- `integration/torneos-core-contracts/deno-runtime-hardening.test.mjs` reescribe `backend/torneos/mp-b/evidence/mp-b1.1-r3/offline.json`; restaurarlo con `git checkout --` después de correrlo, o el guard de confinamiento G1 falla.
- `backend/torneos/perf-v2/g1-main-integration.test.mjs` exige que todo archivo cambiado desde `4a8c5bbe` esté en su allowlist: un doc nuevo en `docs/torneos/` necesita entrar ahí.
- `plan-read.test.mjs` necesita `node_modules` (`npm ci`).
- El probe autenticado debe esperar `/terms` y abortar si la app ya llamó al gateway: si la pestaña de Chrome recibe foco/clics puede navegar a `/torneos` y la app hace su propio `/exchange`. Si la sesión QA está por vencer, recargar `/login?returnTo=%2Fterms` deja que la app la renueve al iniciar (en una pestaña ya abierta el auto-refresh puede no correr).
- En claude-in-chrome, `javascript_tool` no espera un IIFE async suelto: guardar la promesa en `window` y hacer `await` en una segunda llamada. El filtro de salida bloquea claves con "token"/"bearer"/"auth".

## Último estado certificado

| Estado | Fecha |
|---|---|
| `TORNEOS_WEB_PROD_PLAN_READ_UX_CERTIFIED` | 2026-10-02 |
| `TORNEOS_GATEWAY_PROD_PLAN_READ_ON_CERTIFIED` | 2026-10-02 |
| `TORNEOS_GATEWAY_PROD_PLAN_READ_OFF_CERTIFIED` | 2026-10-02 |
| `TORNEOS_PLAN_MAIN_MERGED_SAFE` | 2026-10-02 |
| `TORNEOS_SEASON_SCOPE_PROD_DB_CERTIFIED` | 2026-10-01 |
| `TORNEOS_PLAN_READ_SHADOW_API_CERTIFIED` | 2026-10-01 |
| `SAO_PAULO_WEB_PRODUCTION_READY` | 2026-09-30 |
