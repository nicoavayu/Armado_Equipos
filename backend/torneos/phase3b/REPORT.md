# Phase 3B — Remote Core ↔ Torneos separation certification (non-production)

**Conclusión (calculada por `phase3b/summarize.py` desde la evidencia, `results.json`, tri-estado):
`HYBRID_BLOCKED`**, únicamente por **R3 + R4 + R5 + B04 pendientes**. Las 15 condiciones LOCALES
pasan (§4, D1 aceptada §4.2.1); de las 20 condiciones HÍBRIDAS pasan 12: R1 (2/2, §1), **R2-LOCAL
(8/8, §7.2: stack Torneos aislado local certificado en dos runs desde cero)** y 2 de R3 (tests offline
20/20 y rollback ensayado offline, §8; las otras 4 de R3 son remotas y siguen en STOP). Las 10 condiciones
REMOTE-TO-REMOTE (proyecto Torneos remoto, bootstrap remoto, gateway hospedado, certify remoto, B03)
quedan **`REMOTE_TO_REMOTE_PENDING_PRELAUNCH`: diferidas al gate final pre-launch, explícitamente NO
bloqueantes** (`results.json → remote_to_remote.blocking = false`). Drift PostgreSQL 17.6.1.147:
informativo, `INFORMATIVE_NO_DRIFT` (§7.3). **NO Production. NO Core staging tocado. NO Mercado
Pago. NO fixtures/billing/media/Social/cron.**

Base: worktree `plan-r2-local-f7ace5`, branch `claude/plan-r2-local-f7ace5`, fast-forward a
**`2058da03`** (Phase 2D) + copia byte-idéntica (manifiesto SHA-256 de 68 archivos, modos, `git status`
y `git diff HEAD` idénticos) del estado sin commit del worktree `arma2-torneos-phase-3b-remote-9a453f`,
que queda intacto como respaldo. Baseline `f857bd09…`, gate `3df4b96e…`, **contrato de verificación
compartido v2** (SQL renderizado `0d6ef458…`, expect `2c0772c2…`; `contracts/README.md`), imagen
`postgres:17.6.1.143` id `80d7b27c…` (verificados por hash en `summarize.py`, en el lab local y en el
runner remoto de bootstrap). **Nada commiteado, nada pusheado.**

## 0. Plan previo y decisiones

Los siete documentos del plan (`~/Downloads/ARMA2-TORNEOS-PHASE3B-PLAN-20260914/`, fuera del
repo) cerraban en B) BLOCKED con B01–B06. Estado ahora: **B01 cerrado** (2C `992dd282` + 2D
`2058da03`); B02 (gateway lab-only) **cerrado localmente** por el port a Edge Function (§4);
B03 (trust JWKS en PostgREST hospedado) **abierto, experimento preparado** (§4.3); B04 (frontend
dual-client) **no iniciado** (§8); B05 cerrado por Phase 2D (32 OFF + padre, DB + gateway);
B06 (manifiesto remoto) **cubierto por los runners y este informe** hasta que la evidencia remota
exista.

Decisiones de Nico (2026-09-15): ejecución interactiva; **Core non-prod = Staging
`hhyvmhgpapyuzjgxfnqv`** (desviación documentada: el clon monolítico contiene tablas Torneos
que el cliente Torneos NO usará; sólo se usan GoTrue + el contrato Core); **Torneos non-prod =
proyecto Supabase NUEVO** (lo crea Nico con el runner); **gateway = Edge Function en el proyecto
Torneos**, port Deno del gateway certificado sin cambiar semántica, **Core sólo por HTTPS, sin
DB-to-DB**, sin VM automática; STOP + documentar si una incompatibilidad real obliga a cambiar
contrato o arquitectura.

**CAMBIO DE DECISIÓN (Nico, 2026-09-15, tarde) — arquitectura HÍBRIDA non-production.** No se crea
un tercer proyecto Supabase pago por ahora ni se usa una segunda cuenta para evadir límites Free. El
objetivo de Phase 3B pasa a certificar **Core staging REMOTO (`hhyvmhgpapyuzjgxfnqv`) ↔ Torneos
staging AISLADO LOCAL (Docker, `arma2-torneos-isolated-local`)** con el frontend dual-backend, manteniendo
exactamente la arquitectura aprobada (Core = autoridad de identidad; zero DB-to-DB; zero FK física;
shadow identity local; contrato Core por HTTPS; gateway Edge/Deno RS256; TTL/revocación/sesión
actuales; sin cache; sin Core `service_role` en Torneos; D1 aceptada; allowlist 2D; 32 OFF; P0
certificado; `update_draft_fixture` OFF y gated). **R2 remoto queda POSTERGADO, no cancelado**: crear
el proyecto Torneos remoto y certificar remote-to-remote es el **gate final pre-launch**, que no
bloquea el desarrollo ni la certificación funcional/arquitectónica. Aprobaciones del plan R2-local
(2026-09-15): Paso 0 (ff + copia, sin commit); extracción del SQL/expect compartido con test de
identidad; drift 17.6.1.147 informativo. Y, durante la ejecución, **VERIFICATION CONTRACT V2** (§7.2.1).

## 1. Infraestructura non-prod identificada — **R1 ejecutado** (`evidence/remote-inventory-20260915T154002Z.json`, sha256 `502c2c69f5d5e45649b92ffdea3b78618f6b21472ef0f8a53c30292cc5d62286`, `read_only: true`)

| Componente | Control plane (R1, 2026-09-15T15:40Z) | Uso en Phase 3B |
|---|---|---|
| Organización | `gwqrborhnqjdzzmpxulh` ("nicoavayu's Org"), única visible al PAT; 3 proyectos | — |
| Production Core | `rcyuuoaqfwcembdajcss` ("nicoavayu's Project", `sa-east-1`, ACTIVE_HEALTHY, PG 17.4) — clasificado `PRODUCTION (denylisted)`, `production_present: true`, **no inventariado** (0 requests a su ref) | **DENYLIST / NO TOCAR** |
| Core non-prod | `hhyvmhgpapyuzjgxfnqv` ("arma2-torneos-staging", `us-east-1`, ACTIVE_HEALTHY, PG 17.6.1.147, 9 migraciones canónicas `20260727090000`…`20260810215224`, 11 Edge Functions, 7 usuarios / 9 sesiones `auth`, 137 tablas `public` (86 `tournament*`), 520 funciones (anon EXECUTE 19), 8 cron activos, buckets media). Objetos del contrato Core **ausentes** (`torneos_contract_execute`, `app_private.*` = false); objetos del baseline Torneos ausentes salvo las tablas `tournament_*` del monolito | **Core staging monolítico exclusivamente**: GoTrue real + contrato Core (R4a lo despliega). Aunque el nombre diga "torneos", sus tablas Torneos históricas **no** las usa el nuevo cliente |
| `giaeztyghmhzcngskjmw` | "Arma2", `us-west-2`, **INACTIVE** (inventario `deadline_exceeded`: proyecto pausado) | **no es target** |
| Torneos non-prod | **no existe** un backend separado para la arquitectura nueva | R2 lo crea (§7–15) |
| Gateway remoto | no existe | R4b despliega `torneos-gateway` en el proyecto Torneos |
| Frontend non-prod | Vercel Production + previews por PR; sin origen staging dedicado | pendiente (B04) |

Production quedó distinguida inequívocamente por el control plane (no por documentación) y fuera
del conjunto de targets: condiciones `remote_inventory_written_by_operator` y
`production_classified_and_not_targeted` = PASS. Hallazgo colateral de R1: `inventory.sh` fue
endurecido en la misma corrida (valida que cada ítem sea JSON antes de emitirlo; el proyecto
pausado devolvía `deadline_exceeded`).

## 2–3. Core remoto y Torneos remoto usados

Core remoto = `hhyvmhgpapyuzjgxfnqv` (§1), todavía **sin modificar** (R4a no ejecutado: sin
contrato Core, sin secret). Torneos remoto: **no existe todavía**; R2 preparado con gate humano
(§7–15). Pendiente de R2–R4 (`phase3b/evidence/project-create-*.json`, `bootstrap-*.json`,
`core-contract-*.json`, `gateway-deploy-*.json`). Hasta entonces: **ninguno usado**.

## 4. Port del gateway a Edge Function (B02) — certificado localmente ≡ gateway Node

`backend/torneos/supabase/functions/torneos-gateway/` (árbol de funciones del proyecto
**Torneos**, separado de `supabase/functions` de Core): `index.ts` (handler), `token.ts`
(= `integration/torneos-sso/token.mjs`, misma librería jose 6.2.12, mismas constantes
iss/aud/TTL que exige `private.current_identity_id()`), `core-client.ts` (= `core-client.mjs`:
HMAC WebCrypto, schemas cerrados, 2 s/16 KiB/256 KiB, freshness 3 s), `adapter.ts`
(= `adapter.mjs`), `db.ts` (`npm:postgres`, único acceso a DB: la del proyecto Torneos, siempre
`BEGIN; SET LOCAL ROLE torneos_identity_writer|torneos_core_adapter`), `config.ts` (fail-closed:
cualquier valor ausente/malformado deshabilita el gateway; Production rechazada en toda URL;
`https` obligatorio salvo hosts internos del lab). `verify_jwt=false`
(`backend/torneos/supabase/config.toml`). Copias de `staging-v1-rpc-allowlist.json`,
`schemas.json`, `session.schema.json` byte-idénticas a las canónicas (test).

Secuencia preservada por request: bearer → `verifyToken` (RS256, kid confiable, claims) →
allowlist (403 `rpc not enabled`) → sesión Core online → `identityExists` → adapter (4 RPC
Core-dependientes: `authorize_core_contract` → Core firmado → atestación INSERT-only) → proxy a
PostgREST con el bearer del usuario. Errores: 503 sólo por dependencia caída; el resto `401
access denied`; nunca se loguea request/bearer/SQL.

### 4.1 Lo único que cambia: validación de sesión Core **sólo por HTTPS**

El gateway Node leía `auth.sessions` de Core por SQL (`poc_session_reader`). Por decisión de
Nico (sin DB-to-DB), el port obtiene el mismo veredicto del **contrato Core**: nueva operación
`session` (**v1.1**, `supabase/migrations/20260915120000_torneos_core_contract_v1_1_session.sql`,
`create or replace` del entry point con la rama `session` que devuelve exactamente el veredicto de
autoridad de sesión ya certificado — existe, pertenece al `core_user_id`, no venció `not_after`,
cuenta viva/no baneada/no anónima — y nada más; misma disciplina nonce/HMAC/replay; ruta
`/v1/session` en `_shared/torneosCoreContract.ts`; `phase3b/contracts/session.schema.json`).
La migración Phase 3A (`2967ae6f…`) queda byte-idéntica; guard 43 migraciones; unit 77/77.
Costo: **una llamada HTTPS firmada a Core por cada request al gateway** (exchange y RPC).

### 4.2 Certificación local (lab Phase 3A + servicio `torneos-functions` = edge-runtime v1.74.2)

| Suite | Node (`:58420`) | Edge (`:58421/torneos-gateway`) |
|---|---|---|
| E2E Phase 3A (40 checks) | **41/41** | **41/41** (`evidence/e2e-results-edge.json`) |
| Exposure Phase 2D (18 checks) | **19/19** | **19/19** (`exposure-*-edge.json`) |
| ACL Phase 2C (stack) | **17/17** | — (independiente del gateway) |
| 32 OFF + padre, POST y GET | 33 × 403 `rpc not enabled` | **33 × 403, filas idénticas** |
| Matriz P0 `review_tournament_team_entry` (21 filas) | PASS | **PASS, idéntica** |
| Diferencial `equivalence.test.mjs` (mismos requests a ambos) | — | **123 pares, 120 idénticos, 3 instancias de la única diferencia D1** (§4.2.1) |
| Contraparte D1 `d1.test.mjs` (`evidence/d1-session-authority.json`) | — | **6/6**: GoTrue solo no revoca ban/timebox/soft-delete; `core-db` caída → Node rechaza TODO; `core-functions` caída → clase D1 completa; 1 veredicto por request Edge, 0 caché, 0 por contrato en Node |
| Unit offline `phase3b/gateway-port.test.mjs` | — | **5/5**: tokens cross-verificados en ambos sentidos, `validate()` paridad, config fail-closed (18 valores malos), copias en sync, sin secretos |

Cobertura del diferencial: health/jwks/unknown/method, exchange (misma identidad `sub`, mismas
claims, token de un gateway aceptado por el otro), RPC allowlisted, 33 OFF, lecturas RLS,
bad json/array/body-too-large, 9 bearers forjados (session/core_user_id/sub/exp/ttl/iss/aud/
role/kid), logout, sesión revocada por SQL, ban, `not_after` vencido, GoTrue caído, contrato
Core caído, sin secretos en logs ni evidencia.

#### 4.2.1 D1 — revisión (2026-09-15): **ACEPTADO por Nico como KNOWN AVAILABILITY TRADE-OFF, NOT SECURITY REGRESSION** (`evidence/d1-decision.json`)

**Qué difiere.** Con el **endpoint del contrato Core caído** (lab: `core-functions` detenido;
`core-db` y GoTrue arriba), el gateway Edge rechaza **toda request que pasa por sesión** —
`/exchange` y todo `/torneos/rest/v1/*` después del bearer y del allowlist — con `503
CORE_UNAVAILABLE` (0 escrituras parciales), mientras el Node sigue sirviendo el tráfico
Core-independiente (RPC allowlisted 200, lecturas RLS 200, RPC Core-dependiente denegada
localmente 403, exchange 200). Tres instancias en el diferencial, una causa raíz.

**Por qué NO es una regresión de fail-closed, sino un cambio de identidad del transporte
(evidencia `integration/torneos-core-contracts/evidence/d1-session-authority.json`, suite
`d1.test.mjs`, 6/6):**

1. **Ninguno de los dos gateways sirve una request con sesión sin un veredicto online de
   Core** (E2): con el transporte de sesión del Node caído (`core-db`), el Node rechaza
   también exchange, RPC, lecturas y RPC Core-dependientes (`401 access denied`; Edge `503
   CORE_UNAVAILABLE`); sólo sobreviven los rechazos pre-sesión (allowlist 403, bearer inválido
   401), idénticos en ambos. El Node "seguía sirviendo" durante la caída del contrato **sólo
   porque su veredicto viaja DB-to-DB** (`auth.sessions` con `poc_session_reader`), exactamente
   lo que Phase 3B prohíbe al Edge. En el Edge el contrato **es** el transporte del veredicto.
2. **No hay caché ni reutilización** (E4): 7 requests Edge con sesión = 7 veredictos `session`
   consumidos en Core (5 RPC + 1 lectura + 1 exchange); 6 requests Node = 0 veredictos por
   contrato. Ventana de revocación: 0 en ambos.
3. **GoTrue no es la autoridad de sesión** (E1, v2.194.0): `/auth/v1/user` responde **200** con
   `not_after` vencido, con `banned_until` futuro y con `deleted_at` seteado (sólo el logout
   —fila de sesión borrada— da 403). Ban, timebox y soft-delete los aplica **únicamente el
   veredicto SQL** (Node: lectura de `auth.sessions`; Edge: op `session` v1.1), y ambos
   gateways los rechazan 401 en la request siguiente. Cualquier diseño que validara con GoTrue
   "y la evidencia ya disponible" perdería esas tres clases de revocación en silencio.
4. Hallazgo colateral sobre el gateway de referencia: con `core-db` caída el Node responde
   **401** y no 503, porque el driver `pg` devuelve `ENOTFOUND` (container detenido) y la lista
   del gateway certificado sólo mapea `ECONNREFUSED`/`57P01`/`ETIMEDOUT` a 503. Rechazo
   preservado; sólo el código. **No se modifica el gateway certificado** (es la referencia).

**Alternativas evaluadas para preservar el comportamiento Node en el Edge — todas cambian el
modelo de seguridad o introducen un riesgo nuevo (criterio STOP de la instrucción):**

| # | Alternativa | Qué rompe |
|---|---|---|
| A | Servir requests Core-independientes con el bearer RS256 (120 s) sin veredicto online mientras el contrato esté caído | **Ventana de revocación ≤ 120 s** durante la caída: logout/ban/timebox/soft-delete degradados (prohibido explícitamente); caché insegura por definición |
| B | Veredicto vía GoTrue `/user` enviando el bearer Core en cada RPC | GoTrue no aplica ban/`not_after`/`deleted_at` (E1) → **pierde 3 clases de revocación**; cambia el contrato del cliente (el gateway certificado no acepta ese bearer en RPC); el access token Core viajaría en cada request Torneos |
| C | Gateway Torneos llama `torneos_contract_execute` por PostgREST de Core con `service_role` de Core | **Expansión de trust boundary**: el proyecto Torneos pasaría a tener la llave que salta todo RLS del monolito Core |
| D | Nueva función SQL en Core expuesta a `anon` por PostgREST con verificación HMAC en SQL (secreto en Vault/tabla) | **Nueva superficie pública en Core** que golpea la DB sin autenticación previa (hoy la firma se verifica en Deno antes de tocar la DB); secreto duplicado (env + DB); comparación de HMAC en SQL no constant-time (el contrato prohíbe explícitamente comparar hex a mano); cambia la certificación ACL de Core (`anon EXECUTE`) |
| E | DB-to-DB (lectura de `auth.sessions` desde el Edge) | Prohibido por la decisión de arquitectura de Phase 3B |
| F | Separar la op `session` en una Edge Function propia de Core (`torneos-core-session`) | **No elimina D1** (mismo runtime Edge de Core: en el lab y en hospedado una caída del runtime tira ambas); sólo aísla fallos de deploy/bug del contrato. Más superficie (función, URL, binding de secreto). Mitigación opcional, no equivalencia |

**Veredicto técnico:** el objetivo "las operaciones que no requieren Core continúan si la sesión
puede validarse de forma segura con la evidencia ya disponible y sin DB-to-DB" **no tiene
solución** bajo las cinco restricciones simultáneas (HTTPS-only, sin DB-to-DB, revocación online
por request, sin ventana no documentada, sin ampliar trust boundary): la única "evidencia
disponible" en una RPC es el bearer Torneos, y ese bearer no puede acreditar el estado *actual*
de la sesión en Core.

**Decisión de Nico (2026-09-15): D1 ACEPTADO.** La evidencia demuestra que ambos gateways
requieren un veredicto ONLINE de Core; el Node lo obtenía DB-to-DB desde `auth.sessions`, el
Edge lo obtiene por HTTPS mediante el contrato Core; preservar el comportamiento Node ante caída
de `core-functions` exigiría violar una restricción ya decidida (DB-to-DB, caché/ventana de
revocación, service_role compartido o nueva superficie de autoridad). Para Phase 3B:
**D1 = KNOWN AVAILABILITY TRADE-OFF, NOT SECURITY REGRESSION.** Alternativas A–F **rechazadas,
no diferidas** (no se implementan).

**Semántica remota aprobada** (la que el Edge gateway ya implementa; `summarize.py` exige que
`d1-decision.json` la enumere íntegra y que los valores de evidencia sobre los que se decidió
sigan siendo los actuales — si `npm run test:d1` los cambia, la decisión queda STALE y la fase
vuelve a BLOCKED):

- toda request Torneos autenticada requiere un veredicto Core **actual**;
- contrato Core no disponible → **`503 CORE_UNAVAILABLE`**;
- nunca se sirve con sesión stale;
- revocación / ban / soft-delete siguen siendo inmediatos (request siguiente);
- sin caché de veredictos;
- sin DB-to-DB Torneos↔Core;
- sin service_role de Core en Torneos.

**Dependencia de disponibilidad conocida (documentada, no mitigada en 3B):** la disponibilidad
del runtime de Edge Functions de Core (`torneos-core-contract`) está en la ruta crítica por
request de toda request Torneos con sesión — además de GoTrue y la DB de Core, que ya estaban
en la ruta crítica del gateway Node. Una caída del contrato = Torneos autenticado fuera de
servicio (503, 0 escrituras parciales) hasta que vuelva; el tráfico pre-sesión (health, jwks,
rechazos de allowlist/bearer) no se ve afectado.

Vocabulario: el Edge responde `503 CORE_UNAVAILABLE` (código sanitizado ya certificado del
adapter) donde el Node, en la caída análoga de su propio transporte, responde `access denied`
(503 por diseño, 401 observado por el gap del punto 4). No se cambia: es el mismo evento
—autoridad de sesión inalcanzable— y ninguna de las dos formas filtra más que "dependencia
caída".

### 4.3 B03 — trust del RS256 del bridge en PostgREST hospedado (abierto)

En el lab PostgREST confía en el JWKS del bridge (`PGRST_JWT_SECRET=@jwks.json`). En hospedado
eso no es configurable. R4 registra el JWKS público como **third-party auth (`custom_jwks`)**
del proyecto Torneos y R5 mide si un RPC allowlisted con bearer RS256 devuelve 200. Si no →
**STOP y documentar** (HS256 con el JWT secret del proyecto en manos del gateway sería un cambio
de arquitectura que decide Nico). `pgrst.db_pre_request=private.check_token` se fija en el
bootstrap (`ALTER ROLE authenticator SET …` + `NOTIFY pgrst`).

## 5. Matriz env efectiva (sin valores secretos) — Edge gateway

| Variable (Edge secret del proyecto Torneos) | Valor / fuente | Secreto |
|---|---|---|
| `TORNEOS_GATEWAY_PUBLIC_URL` | `https://<torneos_ref>.supabase.co/functions/v1/torneos-gateway` | no |
| `TORNEOS_ALLOWED_ORIGIN` | origen del frontend staging (placeholder hasta B04) | no |
| `CORE_AUTH_URL` / `CORE_JWT_ISSUER` | `https://hhyvmhgpapyuzjgxfnqv.supabase.co/auth/v1` | no |
| `CORE_ANON_KEY` | anon público de Core (apikey de Kong) | no (público) |
| `CORE_CONTRACT_URL` | `https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract` | no |
| `TORNEOS_CONTRACT_SERVICE_SECRET` | hex 32 bytes, generado en el shell de Nico; también en Core | **sí** |
| `TORNEOS_REST_URL` | `https://<torneos_ref>.supabase.co/rest/v1` | no |
| `TORNEOS_ANON_KEY` | anon público de Torneos (apikey de Kong; `/config`) | no (público) |
| `TORNEOS_DB_IDENTITY_WRITER_URL` / `TORNEOS_DB_CORE_ADAPTER_URL` | `postgres://torneos_edge_*.<ref>:…@aws-N-<region>.pooler.supabase.com:6543/postgres` | **sí** |
| `TORNEOS_DB_SSL_CA` | CA Supabase (base64; `verify-full`) | no |
| `TORNEOS_BRIDGE_KEYS` | key ring RS256 (`p3b-k1` activa/confiable, `p3b-k2` standby), base64 JSON | **sí** (privadas) |
| Constantes no configurables | iss `urn:arma2:local:identity-bridge`, aud `arma2-torneos-local`, TTL 120 (baseline) | — |

Core (Staging) recibe **sólo** `TORNEOS_CONTRACT_SERVICE_SECRET`. Frontend: sin cambios todavía
(B04); ninguna `REACT_APP_*` nueva consumida.

## 6. Secrets placement

Custodia en Keychain de macOS (helper `phase3b/remote/keychain.py`, contrato certificado del
harness A1: `add` por pty, sin `-U`, sin delete): `arma2-torneos-nonprod-db/{postgres,
torneos_edge_identity_writer, torneos_edge_core_adapter}`, `arma2-torneos-nonprod-core/
contract-secret`, `arma2-torneos-nonprod-bridge/keys`. En runtime: sólo Edge secrets del proyecto
correspondiente. **Nunca** service_role de Core en Torneos (test), nunca clave privada ni service
role en el navegador, nunca login a DB de Core desde Torneos (test: `db.ts` no menciona
`auth.*`/`core-db`/`poc_session_reader`). Los runners rechazan cualquier evidencia que contenga
un secreto conocido antes de promoverla.

## 7–15. Bootstrap, SSO remoto, dual-backend, 43/32, review remoto, contratos Core remotos, logout, outage, E2E UI

**Pendientes de ejecución por el operador** (orden R1→R5; cada runner refuerza el anterior con
evidencia propia):

| # | Runner (`backend/torneos/phase3b/remote/`) | Escribe | Cubre |
|---|---|---|---|
| R1 ✅ | `inventory.sh` | `remote-inventory-20260915T154002Z.json` | Fase 1: **ejecutado** (§1); Production clasificada y excluida |
| R2 remoto ⏭ **DIFERIDO** (gate final pre-launch) | `create-torneos-project.sh [--plan-only] <org_slug> [region] [name]` | `r2-preflight-*.json` (siempre) → `project-create-*.json` (sólo tras la frase) | Fase 2a remota: proyecto Torneos non-prod `arma2-torneos-isolated-staging` (§7.1). **Sustituido en la arquitectura híbrida por R2-LOCAL ✅ (§7.2)** |
| **R2 LOCAL ✅** | `integration/torneos-isolated-local/lab.mjs up` / `certify` / `reset` / `drift` + `phase3b/local/certify-torneos-local.mjs` | `local-torneos-bootstrap-*.json`, `local-torneos-certify-*.json`, `local-torneos-drift-*.json`, `local-torneos-tests.txt` | Fase 2 híbrida: stack Torneos aislado local (§7.2), **certificado 17/17 × 2 runs desde cero** |
| R3 remoto Torneos (**diferido con R2 remoto**) | `bootstrap-torneos.sh <ref>` | `bootstrap-*.json` | Fase 2b remota: baseline 2D + gate, atómico por psql/Session Pooler `verify-full`; roles del gateway; `pgrst.db_pre_request`; verificación con el **contrato compartido v2** (`contracts/torneos-bootstrap-verify.sql` + `-expect.json`, pins `0d6ef458…`/`2c0772c2…` comprobados antes de leer el PAT): 359/304/12/147/328/0/33/0/0/33 |
| **R3 híbrido (siguiente)** = R4a | `deploy-core-contract.sh [--preflight-only\|--dry-run]` · rollback `rollback-core-contract.sh` · D1 positivo `test-d1-positive.sh` | `r3-preflight-*.json` → `core-contract-*.json` (sólo tras la frase `APPLY R3 <ref>`); `r3-failed-*.json` si el harness firmado no pasa; `r3-offline-rehearsal-*.json` ✅ | Fase 3: v1+v1.1 en **Core staging remoto** con **ledger estrategia A** (fila CLI `(version,name,statements)` en la MISMA transacción), secret idempotente (Keychain × Core), deploy `torneos-core-contract`, **harness firmado 9/9 exacto + probe ACL** (§8; un 503/404 nunca es DEPLOYED). **STOP: NO ejecutado** (decisión 2026-09-15) |
| **R4 híbrido (siguiente)** | `lab.mjs` con perfil `gateway` (por definir) | `local-torneos-gateway-*.json` | Edge gateway `torneos-functions` en `127.0.0.1:58431` contra Torneos local + contrato Core remoto por HTTPS |
| **R5 híbrido (siguiente)** | por definir | `local-torneos-e2e-*.json` | E2E real Core staging remoto ↔ Torneos local; fixture P0 híbrido |
| R4b | `deploy-torneos-gateway.sh <ref> <core_anon> <torneos_anon> [origin]` | `gateway-deploy-*.json` | Fase 4: key ring, 13 secrets, deploy `torneos-gateway`, third-party auth (B03), probes |
| R5 | `certify-remote.sh <ref> <core_anon> <torneos_anon> password\|admin <email>` | `remote-certify-*.json` | Fases 4/6: login Core real → exchange → RPC allowlisted (B03) → 33 OFF (403) → PostgREST directo (anon DENY; bearer bridge en gated DENY) → forjado → logout → 401/403 |

Todavía **no escritos**: el fixture remoto de `review_tournament_team_entry` (matriz P0 contra el
proyecto remoto; localmente idéntica en ambos gateways) y el E2E remoto de los contratos Core con
fixtures sintéticos (Fase 7). El outage remoto se certifica por D1 local (aceptado en §4.2.1,
contraparte `d1.test.mjs`) y no se provoca en remoto.

### 7.1 R2 remoto preparado — `arma2-torneos-isolated-staging` (NO ejecutado; **DIFERIDO al gate final pre-launch** por la decisión híbrida, §0)

Target: **nombre `arma2-torneos-isolated-staging`**, org **`gwqrborhnqjdzzmpxulh`**, región
**`us-east-1`** (la del Core staging), NON-PRODUCTION. El runner fue reescrito el 2026-09-15 para
cumplir el gate previo a cualquier creación:

1. **Contrato de la API** (OpenAPI de `api.supabase.com` leída el 2026-09-15, sha256
   `c781ed91fb5c5fa825d0f648036785c3d35c9b8f7d8e31afd2553c1d528d6b7a`): `POST /v1/projects`
   exige `organization_slug` (`organization_id` deprecado) y `region_selection:
   {type: "specific", code}` (`region` deprecado); `desired_instance_size` **se omite** = "the
   smallest possible size". `mgmt-write.mjs` arma exactamente ese body (test). El nombre
   `arma2-torneos-isolated-staging` **no pasaba** el patrón anterior (exigía `staging` pegado al
   prefijo): ahora la marca non-prod es una etiqueta completa en cualquier posición, las
   etiquetas `prod|production|live|main` se rechazan y un nombre **ya existente en la org se
   rechaza** (el Core staging se llama literalmente `arma2-torneos-staging`; la lista de nombres
   del preflight es obligatoria para la op, `existing_names_required__ABORT`).
2. **Preflight read-only** (`mgmt.mjs`, sólo GET): resuelve la org por slug, lee su **plan**
   (`GET /v1/organizations/{slug}`, nueva op `org`, proyección id/slug/name/plan/canales), lista
   los proyectos, exige `production_present` (si el PAT no ve Production, STOP: la denylist no
   se puede confirmar), cuenta activos y detecta el nombre duplicado.
3. **Costo/plan esperado** (supabase.com/pricing y docs compute-and-disk, 2026-09-15; el
   preflight imprime la rama que corresponda al plan real, que R1 no expone):
   - plan **free**: USD 0, pero **límite de 2 proyectos activos** y hoy hay 2
     (`rcyuuoaqfwcembdajcss`, `hhyvmhgpapyuzjgxfnqv`; `giaeztyghmhzcngskjmw` está INACTIVE) →
     la creación sería rechazada por la plataforma; subir de plan es decisión de billing fuera
     del runner (`creatable_under_plan: false`, STOP antes de pedir autorización);
   - plan **pro/team**: **un Micro más ≈ USD 10/mes** (USD 0,01344/h, facturado por hora
     mientras exista; fuera del spend cap; el crédito de compute de USD 10 del plan ya lo consume
     un proyecto existente); 8 GB disco / 3000 IOPS incluidos; sin add-ons; Nano no se puede
     lanzar en plan pago → el tamaño mínimo es Micro; borrar el proyecto detiene el cargo.
4. **Permiso mínimo del PAT**: los PAT (`sbp_…`) **no son scopeables** — llevan todos los
   privilegios de la cuenta. El mínimo que puede crear un proyecto es un PAT de una cuenta con
   rol **Administrator** (u Owner) en la org (Developer/Read-only no crean proyectos). Ese PAT
   también alcanza a Production por construcción: la única protección es la denylist del tooling
   → generarlo con expiración corta para R2 y revocarlo después.
5. **STOP humano**: `--plan-only` imprime todo lo anterior, escribe `r2-preflight-<UTC>.json`
   (`created: false`; prefijo distinto de `project-create-*`, que `summarize.py` usa para la
   condición) y termina sin crear. Sin `--plan-only` el runner **igual se detiene** y sólo
   continúa si el operador teclea exactamente `CREATE arma2-torneos-isolated-staging` en
   `/dev/tty`; es la única escritura del script (test estático: orden preflight → plan-only
   stop → frase → `mgmt_write create-project`, una sola vez). Evidencia jamás se sobreescribe
   (`EVIDENCE_EXISTS` en `lib.sh`).

Simulación offline (transporte canned con los datos de R1, sin red, `mgmt_write` prohibido):
plan `pro` → plan impreso y `PHASE3B_R2_PLAN_ONLY_STOP`; plan `free` → `creatable_under_plan:
false` y `PHASE3B_R2_NOT_CREATABLE_UNDER_PLAN` antes de la frase; nombre `arma2-torneos-staging`
→ rechazado por duplicado; región ≠ `us-east-1` → rechazada; sin `/dev/tty` para la frase → abort
sin escritura. Harness offline `inventory.test.mjs`: **19/19** (7 tests nuevos R2).

**No ejecutar hasta el OK explícito de Nico. Sin bootstrap (R3), sin tocar Core staging (R4a),
sin deploy (R4b) hasta entonces.**


### 7.2 R2 LOCAL — stack Torneos aislado `arma2-torneos-isolated-local` ✅ (2026-09-15, dos runs desde cero)

**Qué es**: `integration/torneos-isolated-local/` (`compose.yaml` + `lab.mjs` **sin dependencias npm**:
RS256 con `node:crypto` en `jwt.mjs`; sin Supabase CLI; socket Docker fijo; `--project-name` explícito;
label `arma2.phase=3b-local-torneos`) y `backend/torneos/phase3b/local/` (`certify-torneos-local.mjs`,
`drift-torneos-local.mjs`, `api_view.py` = puente al `api_view` de `phase2c/real_image_acl.py`,
`local.test.mjs`). Servicios: `torneos-db` (`postgres:17.6.1.143`, **id `80d7b27c…` verificado antes de
`up`, nunca pull**, red `isolated` `internal: true`, sin puerto publicado) y `torneos-rest`
(`postgrest:v14.15`, `127.0.0.1:58430`, red `isolated` + `loopback-ingress` sin masquerade, JWKS del
bridge, `PGRST_JWT_AUD=arma2-torneos-local`, `JWT_CACHE_MAX_LIFETIME=0`, **sin `PGRST_DB_PRE_REQUEST`
env**: el hook viene de `ALTER ROLE authenticator SET pgrst.db_pre_request`, la forma hospedada del
runner remoto). `torneos-functions` (Edge gateway, `127.0.0.1:58431`, red `egress` sólo para él) está
detrás del perfil `gateway` y **no arranca en R2** (R4). **No hay servicio Core en el compose por
construcción**: nada que alcanzar DB-to-DB. No reutiliza `arma2-core-contracts-phase3a`
(`58420/58421`), `arma2-sso-phase15` (`58410`) ni `arma2-torneos-qa-seed` (`57321–57327`).

**`up`** (fail-closed, en orden): integridad hash-pinned (baseline, gate, SQL renderizado v2, expect,
imagen por id) → preflight de aislamiento sobre el compose **renderizado** (literales prohibidos:
Production, Core staging, `supabase.co`, `api.supabase.com`, `core-*`, `/supabase/migrations`, otros
proyectos; `ports` sólo `127.0.0.1`; `isolated.internal`; masquerade off; bind-mounts dentro del
worktree; proyecto inexistente; `58430/58431` libres) → `.runtime/` 0600 gitignored (secretos **de
lab**) → `up --wait torneos-db` sobre volumen nuevo → precondición (`public` vacío, 0 roles
`torneos*`, `torneos_identity` ausente, pgcrypto) → baseline (su transacción) → gate (su transacción)
→ post-instalación **idéntica al runner remoto** (`torneos_edge_identity_writer` /
`torneos_edge_core_adapter` LOGIN NOINHERIT miembros de los NOLOGIN; `pgrst.db_pre_request`;
`notify pgrst`) + sólo-transporte-local `ALTER ROLE authenticator PASSWORD` → `torneos-rest` → verificación
con el contrato compartido (16/16 o STOP; error de consulta = evidencia + STOP, stack en pie para
inspección, nunca reparación a mano; error de instalación = volumen destruido).

**`certify` (17 chequeos, A–E)** — run 1 `local-torneos-certify-20260915T202648Z.json` (`193c3e59b3289f73…`, bootstrap `local-torneos-bootstrap-20260915T202636Z.json` `ef7aa405431c6c08…`),
run 2 tras `reset` (`down -v` → `up` → `certify`) `local-torneos-certify-20260915T202816Z.json` (`29c7c373107fff87…`, bootstrap `local-torneos-bootstrap-20260915T202810Z.json`
`5c80d64085a7c04c…`): **17/17 y 17/17**.

| # | Criterio | Resultado (run 1 = run 2) |
|---|---|---|
| 1 | Hashes baseline/gate/SQL/expect/imagen | `f857bd09…` / `3df4b96e…` / `0d6ef458…` (renderizado) / `2c0772c2…` / `sha256:80d7b27c…` — iguales a los certificados |
| 2 | Preflight de aislamiento | **0 hallazgos** (servicios renderizados: `torneos-db`, `torneos-rest`) |
| 3 | Instalación baseline + gate | ambas COMMIT como `supabase_admin`; `installer/table_owners/function_owners = supabase_admin` |
| 4 | **A. Catálogo** (mismo SQL + mismo expect que el runner remoto) | **16/16**: 359 funciones públicas / 304 SECURITY DEFINER / anon EXECUTE **12** / authenticated **147** / service_role **328** / secuencias anon **0** / gated presentes **33**, anon **0**, authenticated **0**, service_role **33** / P0 authenticated `true` / RLS forzado en `torneos_identity` / 0 foreign servers / miembros `["torneos_edge_identity_writer"]` `["torneos_edge_core_adapter"]` / `pgrst.db_pre_request=private.check_token`. `cron_jobs = -1`, `storage_buckets = -1` (ausentes en la imagen). `catalog_hash` **`617d205bb09d1d4e…`** |
| 5 | **B. Equivalencia** (`acl-inventory.sql` vivo vs 2D after-real, `api_view` 2C) | **479 objetos / 0 mismatches** (366 funciones, 7 secuencias, 106 relaciones); `api_view` **`c212beccfa46208a…` = vista certificada 2D**; SECURITY DEFINER total 305 (público 304); PUBLIC EXECUTE 0; anon write en relaciones 0 |
| 6 | **C. Data API real** (`127.0.0.1:58430`) | OpenAPI anon 200 sin ninguna gated; **33 gated × anon y × authenticated (bearer RS256 válido) = 66/66 `42501 permission denied for function` antes del cuerpo (POST y GET)**; **P0 `review_tournament_team_entry(uuid,uuid,text,text,jsonb)` authenticated → 403 `42501 TORNEOS_RESOURCE_FORBIDDEN` = el cuerpo se ejecutó** (anon → `permission denied for function`); identidad sembrada por el camino real del gateway (`torneos_edge_identity_writer` TCP/scram `torneos-db:5432`; INSERT **rechazado sin `SET ROLE`** = NOINHERIT, aceptado tras `SET ROLE torneos_identity_writer`); bearer válido lee **sólo su fila** (RLS `own_identity`); **11 bearers forjados → 401** en `/torneos_identity` y en `/rpc/P0` (kid no confiable `PGRST301`, expirado `PGRST303`, aud errónea `PGRST303`, `alg none` `PGRST301`; iss errónea / TTL 3600 / `nbf≠iat` / identidad desconocida / `core_user_id` distinto / sin `session_id` / claim `role=service_role` → **`PT401` de `private.check_token`**); `torneos_identity` anon `42501 permission denied for table`, INSERT authenticated `42501`; allowlist **43 ⊆ EXECUTE authenticated, ∩ gate = ∅**, gated con `service_role` y sin cliente; fila sintética borrada → **`identity_rows: 0`** |
| 7 | **D. Aislamiento** | containers = {`torneos-db`, `torneos-rest`} con ids de imagen certificados, redes ⊆ `arma2-torneos-isolated-local_*`, `torneos-db` sin puertos y sólo `isolated` (`Internal: true`), `torneos-rest` sólo `127.0.0.1:58430`, mounts = volumen del proyecto + `.runtime/public` del worktree; desde `torneos-db`: `core-db/core-auth/core-api/core-rest`, `arma2-core-contracts-phase3a-core-db-1`, `arma2-sso-phase15-core-db-1`, `supabase_db_arma2-torneos-qa-seed` **irresolubles** (exit 2; `torneos-rest` resuelve → el DNS interno funciona), **0 rutas por defecto**, `connect` a TEST-NET `192.0.2.1:443`/`198.51.100.1:53` → "Network unreachable" **rc=1 inmediato (ningún paquete sale)**; extensiones = {`pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`}, `dblink/postgres_fdw/pg_net/http` **no instaladas**, 0 foreign servers/tables, **303 FK todas dentro de public/private, 0 hacia otro schema**, **0 funciones que referencien `auth.*`**, sin `public.usuarios`, sin `torneos_contract_execute`, sin `app_private` |
| 8 | Reset (run 2 desde cero) | bootstraps distintos (`202636Z` ≠ `202810Z`, `fresh_volume: true`), **`catalog_hash` idéntico `617d205b…` (bootstrap y certify, ambos runs), `api_view` idéntico `c212becc…`**, documento de verificación, sweep 66, forjados e `isolation.database` idénticos |
| 9 | Offline | `local.test.mjs` **7/7** (`evidence/local-torneos-tests.txt`), `inventory.test.mjs` **20/20** (incluye identidad del runner remoto con el contrato v2), `migrations:guard` OK (8/8), conjunto local **15/15** intacto |
| 10 | Remoto | **0 requests**: guard runtime en `fetch` (rechaza cualquier host ≠ `127.0.0.1:58430`) → **160 requests por run, hosts = [`127.0.0.1:58430`]**; estructural: el runner no importa `phase3b/remote/*` ni conoce otro hostname (afirmado en `local.test.mjs`). Core staging y Production **no tocados** |

Evidencia histórica **conservada** (nunca sobreescrita ni borrada): `local-torneos-bootstrap-20260915T171938Z.json`
(instalación completa, verificación v1 con error de parse), `local-torneos-certify-20260915T171954Z.json`
(14/17: A por v1, más dos defectos de mis chequeos —args `{}` en el sondeo RPC de forjados → 404
`PGRST202` desde la caché de PostgREST antes de la DB; regex "Network **is** unreachable"—) y
`local-torneos-certify-20260915T172211Z.json` (16/17: sólo A). Ningún run fallido tocó el baseline, el
gate ni una ACL.

#### 7.2.1 VERIFICATION CONTRACT V2 (decisión de Nico, 2026-09-15)

El SQL de verificación v1 (`7b8881ea…`, byte-idéntico al que `bootstrap-torneos.sh` llevaba inline y
**nunca ejecutado hasta R2-local**) tenía un defecto latente de parse/resolución: `'cron_jobs', (… case
when to_regclass('cron.job') is null then -1 else (select count(*) from cron.job) end)` y
`'storage_buckets', (select count(*) from storage.buckets)` referencian relaciones **opcionales** que
PostgreSQL resuelve al parsear aunque el `CASE` no las ejecute → `ERROR: relation "cron.job" does not
exist` en la imagen certificada (y en el `torneos-db` del lab 3A, misma imagen) y en cualquier proyecto
hospedado nuevo sin `pg_cron` → **R3 remoto habría instalado todo y abortado en la verificación**. v2
cambia **únicamente esas dos expresiones** a evaluación perezosa (`query_to_xml` dentro del `ELSE`):
relación ausente → `-1` (intención del autor de v1), presente → el mismo `count(*)`. Las 16 expectativas
son idénticas (ninguno de los dos campos es expectativa); el expect (`2c0772c2…`) no cambió. **NO es un
cambio de producto, de baseline, de gate ni de ACL/RLS.** Nuevo hash renderizado **`0d6ef458d0d46375…`**
pinneado en el runner remoto (`CERTIFIED_VERIFY_SQL`, comprobado **antes** de leer el PAT), en el lab
(`CERTIFIED.verify_sql_rendered`), en `local.test.mjs`/`inventory.test.mjs` y en `summarize.py`. El
runner remoto mantiene idéntica semántica salvo este fix: su diff contra el texto pre-refactor es la
extracción (constantes + pins + `while read … expect`) y el diff v1→v2 del SQL renderizado son esas dos
líneas (`contracts/README.md`).

### 7.3 Drift informativo — `postgres:17.6.1.147` (versión de Core staging) — NON-BLOCKING

`local-torneos-drift-17.6.1.147-20260915T202959Z.json` (`1c1e0034045da1b1…`): container fresco `--network none` de `17.6.1.147` (id `ac581882…`, presente
localmente, sin pull), baseline + gate instalados, post-instalación como los runners, contrato v2 y
`acl-inventory.sql`; container eliminado. Resultado **`INFORMATIVE_NO_DRIFT`**: 479 objetos / **0
mismatches** contra 2D after-real (`api_view` = `c212becc…`), **16/16** expectativas, y el `catalog_hash`
es exactamente **`617d205b…`** (el mismo de la imagen certificada: ni `server_version 17.6` ni las versiones
de extensiones difieren); `default ACL` de la imagen en `public` = los mismos hosted-style para
`postgres` (S/f/r a anon/authenticated/service_role) que motivaron el fix 2C. **El PASS oficial de R2 se
mide sólo sobre `17.6.1.143` (`80d7b27c…`)**; este run no lo afecta (`results.json →
drift_informative.blocking = false`). No hubo diferencia material de ACL/RLS/semántica → no hay STOP.

## 8. R3 pre-apply — decisiones del 2026-09-15 aplicadas al tooling (worktree `plan-r2-local-f7ace5`, SIN COMMIT) — **STOP, 0 requests remotos, 0 writes**

Decisiones de Nico: A) ejecutar desde `plan-r2-local-f7ace5` (no replicar; `9a453f` intacto de respaldo);
B) corregir ANTES del apply los tres gaps del pre-flight; C) test positivo D1 autorizado bajo condiciones;
D) resolver el blocker del ledger; E) rollback reproducible preparado y testeado offline. Todo
implementado y ensayado offline; **R3 remoto NO ejecutado**; Production `rcyuuoaqfwcembdajcss` denylisted
en cada módulo (`assertNoProduction` en host/path/body/token; refs pinneados a `hhyvmhgpapyuzjgxfnqv`).

### 8.1 Módulos (todos en `phase3b/remote/`, más `phase3b/contracts/core-contract-rollback.sql`)

| Archivo | Rol |
|---|---|
| `core-contract.mjs` | **Datos del contrato R3** (puro, offline): migraciones pinneadas, filas del ledger fieles al CLI, SQL de apply renderizado y pinneado, forma hospedada del ledger, probes read-only (shape, filas, ACL, privilegios del writer), expectativas del harness firmado, carga del rollback pinneado |
| `cli_parser.mjs` + `testdata/` | Port validado del separador del Supabase CLI (`parser.SplitAndTrim`), byte-idéntico al harness `migration-history-repair` (sha `1ab11b26…`), validado contra los 18 fixtures del propio CLI |
| `mgmt.mjs` (+ops read-only) | `core-ledger`, `core-contract-acl`, `secret-names`, `function`, `core-qa-users`, `core-session-exists` — GET o POST `read_only:true`; misma guarda de SQL |
| `mgmt-write.mjs` (`apply-core-contract` reescrito) | Target sólo Core staging; gate de forma del ledger; **tabla de decisión objetos × ledger**; escribe únicamente los documentos de apply pinneados o el INSERT del ledger solo; sigue sin poder emitir DELETE (métodos ≠ GET/POST rechazados) |
| `mgmt-rollback.mjs` | ÚNICO módulo que emite DELETE: exactamente 3 formas de request (SQL pinneado, `DELETE …/functions/torneos-core-contract`, `DELETE …/secrets ["TORNEOS_CONTRACT_SERVICE_SECRET"]`) |
| `probe-core-contract.mjs` | Harness firmado reproducible (9 respuestas exactas) con clasificación `SECRET_NOT_CONFIGURED` / `FUNCTION_NOT_FOUND` / `SECRET_MISMATCH` / `FAIL` y reintentos para la propagación |
| `d1-positive.mjs` + `test-d1-positive.sh` | Test positivo D1 (§8.3) |
| `deploy-core-contract.sh` | Runner R3 reescrito (§8.5) |
| `rollback-core-contract.sh` | Runner de rollback (§8.6) |
| `offline-rehearsal.mjs` | Ensayo offline apply→ledger→ACL→idempotencia→rollback sobre un CLON descartable del Core del lab 3A (§8.7) |
| `core-contract.test.mjs` | 20 tests offline (transporte/fetch inyectados; contratos estáticos de los runners; estrictez de `summarize_r3.py`) |
| `summarize_r3.py` | Evaluación ESTRICTA de R3 para `summarize.py`, con el manifiesto pedido a `core-contract.mjs` (una sola fuente de verdad) |

### 8.2 Gaps B cerrados

1. **Secret idempotente** — máquina de estados Keychain × Core, evaluada read-only en el preflight y
   ejecutada en el paso 3: `ABSENT/absent` → generar 32 bytes hex → Keychain add → `set-secrets` →
   relectura de nombres; `PRESENT/absent` → `set-secrets` con el valor del Keychain (**reconciliación**);
   `PRESENT/PRESENT` → sin write; el harness firmado decide y un `SECRET_MISMATCH` se reconcilia desde el
   Keychain y se vuelve a probar; `ABSENT/PRESENT` → **STOP** (nunca rotación silenciosa). El valor sólo
   vive en una variable del shell (`keychain_read` → `printf` builtin → stdin de node), nunca argv, nunca
   env persistente, `unset` en trap; `promote_evidence` rechaza cualquier evidencia que lo contenga.
2. **Summarize estricto** — `DEPLOYED` exige: `mode == apply`, `core_ref` pinneado, las 2 versiones con
   `installed_after` y fila de ledger `ours` (digest, count, bytes, `created_by/idempotency_key/rollback`
   NULL), función `ACTIVE` + `verify_jwt=false` + `ezbr_sha256`, manifest de deploy == bytes del árbol,
   harness `SIGNED_HARNESS_PASS` con las 9 filas exactas (status + body) y probe ACL sin fallos. Un 503,
   un 404, un dry-run o la evidencia vieja (`unsigned_probe_status`) evalúan **False** (test).
3. **Harness firmado + ACL** — 9 requests: sin firma → `401 SERVICE_AUTH_REQUIRED`; clave aleatoria →
   401; `X-Time` −120 s → 401; firmado `/v1/session` sesión inexistente → `403 FORBIDDEN` (prueba v1.1:
   con v1 solo daría 404); **replay** mismo nonce → `401 REPLAY`; `/v1/verified-email` → 403 (ruta v1);
   esquema malformado → `400 INVALID_REQUEST`; `/v1/nope` → `404 NOT_FOUND`; `GET` → 404. Cabeceras
   `content-type/cache-control: no-store/x-content-type-options` verificadas. Probe ACL:
   `has_function_privilege` para `anon`/`authenticated`/`service_role` en las 5 funciones (sólo
   `service_role` EXECUTE en `public.torneos_contract_execute`; ninguna en las 4 de `app_private`),
   `has_table_privilege` (S/I/U/D) en las 2 tablas (ninguna), RLS activa, índices exactos, `SECURITY
   DEFINER` + `search_path=''`, rama `session` presente, 0 objetos `torneos_contract_*` extra.

### 8.3 C — test positivo D1 (preparado, se corre DESPUÉS de R3)

`test-d1-positive.sh [--list-only]`: probe read-only `core-qa-users` (emails **enmascarados**, patrón de
label `qa|test|synthetic|phase3b|e2e`, confirmado, con password, vivo, no baneado, no anónimo) → **sin
candidato claramente dedicado → `D1_POSITIVE_NO_DEDICATED_QA_USER` STOP, nunca se crea un usuario** →
Nico tipea el email (tiene que ser candidato), password y anon key de Core staging en tty (sin eco; el
anon key se valida por claims `ref == Core staging`, `role == anon`) → `d1-positive.mjs`: GoTrue
`token?grant_type=password` → contrato `/v1/session` → `200 {active:true, checked_at}` → `logout?scope=local`
(sólo esa sesión) → 204 → `/v1/session` → `403 FORBIDDEN` → probe read-only `core-session-exists`: la fila
de `auth.sessions` desapareció y el conteo del usuario vuelve al previo. Evidencia `d1-positive-*.json`
sin email, sin password, sin token, ids truncados. No toca profile/team/datos de negocio (los únicos
writes son los nonces del contrato, que vencen a los 61 s).

### 8.4 D — ledger: **estrategia A**, y por qué es compatible

**Qué se sabe del ledger de Core staging (R1, read-only, 2026-09-15):** 9 filas `(version, name)`:
`20260727090000_arma2_canonical_baseline` … `20260810215224_tournament_public_pages`. **Las columnas NO
fueron observadas en R1** (el probe seleccionó `version, name`). **Hallazgo colateral:** ese ledger ya
no describe el esquema — Core staging tiene 520 funciones `public` y 86 tablas `tournament*`, mientras
el árbol tiene 43 migraciones canónicas (la 7ª local, `20260806120000`, no está en el ledger remoto y
las 32 posteriores a `20260810215224` tampoco): el esquema avanzó por `/database/query` sin ledger desde
que el CLI quedó prohibido. Consecuencia: `supabase db push` contra Core staging **ya es imposible hoy**
(el CLI exige que el ledger remoto sea prefijo ordenado de los archivos locales y falla en el índice 6).
Esto NO lo corrige R3 ni está en su alcance; sólo se deja constancia.

**Forma hospedada esperada** (observada en Production el 2026-08-07, audit `02_ledger.json`): 6 columnas
`version text NOT NULL` (PK), `statements text[]`, `name text`, `created_by text`, `idempotency_key text`
(UNIQUE, `NULLS DISTINCT`), `rollback text[]`; sin defaults; owner `postgres`; sin RLS. Es la tabla del
CLI (`version` + `name` + `statements`) más las 3 columnas que agrega la plataforma. **El preflight de R3
la observa read-only en Core staging (`LEDGER_SHAPE_SQL`) y cualquier diferencia es STOP
(`LEDGER_SHAPE_UNEXPECTED`)**; el op de apply la vuelve a verificar antes del primer write.

**Cómo se registra cada versión — exactamente lo que escribe `supabase db push`:**
`INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ($1, $2, $3)` con
`version`/`name` del nombre del archivo y `statements = parser.SplitAndTrim(<archivo>)` (CLI v2.84.2,
`pkg/migration/file.go` + `pkg/parser`; el CLI lo manda en el mismo batch que las sentencias). Aquí el
INSERT va **dentro de la misma transacción** que la migración: para v1 (que es su propio
`begin…commit`) el `commit;` final del archivo se sustituye por `<INSERT>; commit;` (los bytes del archivo
hasta ahí se conservan verbatim); v1.1 (sin control de transacción) se envuelve en `begin; … <INSERT>;
commit;`. `statements` se emite con dollar-quoting `$r3stmt$…$r3stmt$` (verbatim, sin escapes). INSERT
plano, **nunca `ON CONFLICT`**: una fila preexistente aborta toda la transacción.

| Versión | archivo sha256 | `statements` | md5(`array_to_string(statements, chr(30))`) | bytes | apply SQL sha256 (pin) |
|---|---|---|---|---|---|
| `20260914120000` `torneos_core_contract_v1` | `2967ae6f…672c` | 22 | `09ad7d261523fa1c2bb6e203a1624467` | 16688 | `3d3e2845…8485` (33935 B) |
| `20260915120000` `torneos_core_contract_v1_1_session` | `5256413…e422` | 3 | `b424cc66022e7ab721e8070d0b05cdc7` | 12088 | `859fa7a3…b78c` (24408 B) |

**Validación viva del separador:** el preflight lee los digests de las 9 filas que el CLI escribió de
verdad en Core staging y los compara con los que `cli_parser.mjs` calcula de los 9 archivos locales
(`compareLedgerRows`); exige `mismatched == 0` y `matched ≥ 1`, si no STOP. Offline: el ensayo inserta
esas 9 filas con el mismo INSERT dollar-quoted y las relee con `md5/octet_length` del lado de PostgreSQL →
**9/9 idénticas** (round-trip byte a byte).

**Idempotencia (tabla de decisión, por versión, evaluada read-only antes de escribir):**

| objetos instalados | fila de ledger | decisión |
|---|---|---|
| no | ausente | `apply` (documento pinneado, 1 transacción) |
| sí | `ours` (digest == pin) | `skip` (0 writes) |
| sí | ausente | `reconcile-ledger` (sólo `begin; INSERT; commit;`) |
| sí | `foreign` (digest ≠ pin) | **STOP** `ledger_row_not_ours` |
| no | `ours`/`foreign` | **STOP** `ledger_row_without_objects` |

**Efecto sobre futuros deploys:** cualquier herramienta que lea el ledger (CLI `migration list`/`repair`,
o el executor propio con probe-first) ve las dos versiones como aplicadas y no las reaplica; el
generador del árbol (`migrations:guard`) sigue exigiendo exactamente los 43 archivos. El CLI `db push`
sigue siendo inaplicable por la divergencia preexistente (arriba), no por R3.

**Privilegios del writer (`postgres`, el rol con el que `/database/query` escribe):** el preflight verifica
`has_database_privilege(CREATE)` (hallazgo del ensayo: `create schema if not exists app_private`
comprueba el privilegio aunque el schema exista), CREATE en `public`/`app_private`, INSERT/DELETE en el
ledger → `WRITER_PRIVILEGES_INSUFFICIENT` STOP.

### 8.5 Plan de apply DEFINITIVO (`deploy-core-contract.sh`, lo corre Nico; NO ejecutado)

0. **Pins antes del PAT**: bytes de las 2 migraciones, filas del ledger (count/md5/bytes), SQL de apply
   renderizado (`3d3e2845…` / `859fa7a3…`), rollback SQL (`08edcd0e…`), `cli_parser.mjs` (`1ab11b26…`).
   Estado del Keychain. `read_pat` (tty, sin eco).
1. **PREFLIGHT read-only**: proyecto (`arma2-torneos-staging`, `ACTIVE_HEALTHY`) → `core-ledger` (forma
   == hospedada; writer `postgres` con privilegios; 9 filas CLI reproducidas; estado objetos × ledger por
   versión y decisión) → `secret-names` (plan del secret; `ABSENT/PRESENT` STOP) → `function` →
   `core-contract-acl`. Evidencia `r3-preflight-<UTC>.json`. **`--preflight-only` para acá (0 writes)**;
   `--dry-run` agrega el manifest del deploy (3 archivos: `supabaseApiKeys.ts 5d6cc3ae…`,
   `torneosCoreContract.ts 83d12902…`, `index.ts 41e012f0…`) y las decisiones sin escribir.
2. **HUMAN AUTHORIZATION**: la frase exacta `APPLY R3 hhyvmhgpapyuzjgxfnqv` en `/dev/tty`.
3. `apply-core-contract`: v1 y v1.1 según la tabla de decisión, cada una en 1 transacción con su fila de
   ledger; verificación probe + ledger tras cada una.
4. Secret según la máquina de estados (§8.2.1).
5. Deploy `torneos-core-contract` (multipart CLI-shaped, `verify_jwt=false`) → relectura: `ACTIVE`,
   `verify_jwt=false`, `ezbr_sha256`.
6. Harness firmado (secret del Keychain por stdin; hasta 8 reintentos × 10 s por propagación) →
   `SIGNED_HARNESS_PASS` obligatorio; `SECRET_MISMATCH` en estado `PRESENT/PRESENT` → reconciliar y repetir;
   cualquier otro veredicto → `r3-failed-<UTC>.json` y STOP (rollback disponible).
7. Probe ACL → `aclFailures == []` obligatorio.
8. Evidencia `core-contract-<UTC>.json` (pins, migraciones con decisiones, filas del ledger releídas,
   secret {keychain, remote, action}, deploy, función, harness, ACL, custodia) → `PHASE3B_CORE_CONTRACT_DEPLOYED`.
   Luego `python3 summarize.py` (condiciones estrictas) y, si Nico lo ordena, `test-d1-positive.sh`.

### 8.6 Plan de rollback DEFINITIVO (`rollback-core-contract.sh`; preparado y ensayado offline; NO ejecutado)

Revierte **sólo R3**, en este orden, cada paso con chequeo de estado (re-ejecutable): (1) `DELETE
/v1/projects/hhyvmhgpapyuzjgxfnqv/functions/torneos-core-contract` (skip si ausente); (2) el SQL pinneado
`contracts/core-contract-rollback.sql` (`08edcd0e…`, 1 transacción con guardas previas/posteriores):
`drop function if exists` × 5 (`public.torneos_contract_execute(text,text,jsonb)` + las 4 de
`app_private`), `drop table if exists` × 2 (sus índices `_expiry/_actor/_pkey` caen con ellas), `delete`
de las 2 filas del ledger **sólo si su digest es el de R3** (una fila ajena aborta todo); **sin CASCADE;
NO `drop schema app_private`** (es compartido y se verifica que siga); post-guarda: 0 relaciones y 0
funciones `torneos_contract_*`, 0 filas del ledger; (3) `DELETE …/secrets ["TORNEOS_CONTRACT_SERVICE_SECRET"]`
(skip si ausente; **el Keychain se conserva**). Preflight read-only + plan + `rollback-preflight-<UTC>.json`;
`--preflight-only`/`--dry-run`; frase `ROLLBACK R3 hhyvmhgpapyuzjgxfnqv`; post-verificación read-only
(función 404, secret ausente, `rollbackResidue == []`, 0 filas) → `core-contract-rollback-<UTC>.json`.
No toca tablas Core, `tournament_*`, cron, storage, auth users (los módulos lo rechazan por construcción y
los tests lo afirman sobre el SQL).

### 8.7 Ensayo offline (`offline-rehearsal.mjs`) — **PASS ×2, 0 requests remotos**

Sobre un CLON descartable (`pg_dump | pg_restore`, `pg_cron` excluido, owner `postgres` como en la
plataforma) del Core del lab 3A (`arma2-core-contracts-phase3a-core-db-1`, `supabase/postgres` 17.6, 625
funciones `public`, 187 `auth.users`, contrato ya instalado por el lab): tabla del ledger con la forma
hospedada (diff `[]`) → privilegios del writer → 9 filas CLI round-trip 9/9 → `rollback_initial` (limpia el
contrato del lab: residuo `[]`) → `apply` v1, v1.1 (documentos pinneados) → `ledger` (2 filas == pins) →
`acl` (0 fallos) → `rerun_idempotent` (un segundo apply aborta entero en `relation
"torneos_contract_nonces" already exists`, el ledger no cambia; borrada la fila v1.1, el INSERT solo la
restituye) → `rollback` → `residue []` → `catalog_unchanged` (**1482 entradas de catálogo fuera del
contrato idénticas antes/después, hash `c245933e…` en los dos runs**) → re-ejecución del rollback =
no-op (las 9 filas CLI intactas). Clon borrado siempre; el lab queda intacto. Evidencias
`r3-offline-rehearsal-20260915T224045Z.json` y `…T224119Z.json`.

### 8.8 STOP

Todo lo anterior es **local**. Próximo paso recomendado, si Nico lo autoriza: `deploy-core-contract.sh
--preflight-only` (read-only, PAT en tty, **0 writes**) para observar en Core staging la forma real del
ledger, los privilegios de `postgres` y las 9 filas CLI antes de decidir el apply. **R3 remoto NO se
ejecuta hasta el OK explícito.** Production sigue prohibida.

### 8.9 2026-09-17 — `--preflight-only` ejecutado ×3 sobre Core staging (read-only, **0 writes**): STOP real, re-pin de las filas legacy del ledger, **PASS 7/2/0/0**

Lo corrió Nico (PAT tipeado en tty; el agente sólo leyó la salida). Sólo `GET project`, `core-ledger`,
`secret-names`, `function`, `core-contract-acl`; el primer `mgmt_write` del runner está DESPUÉS del
`exit 0` de `--preflight-only`.

1. **1º y 2º run → STOP `CLI_ROWS_NOT_REPRODUCED`** (el primero sin evidencia en disco; por eso el
   runner ahora persiste `r3-preflight-failed-*.json` en TODOS los STOP del preflight). Evidencia del 2º:
   `r3-preflight-failed-20260917T161922Z.json` sha256
   `35baf9208a7eb037d25e075bcc3b7bed734a78800598d182f1cbd8fe7012f326`. Hallazgo: de las 9 filas del ledger
   de Core staging, **2 son legacy single-blob** (`statements = ARRAY[<archivo entero>]`:
   `20260803090000_tournament_social_studio` y `20260810160355_tournament_entitlements_foundation`) y
   la segunda es la ÚNICA fila con `created_by` no nulo (la escribió el endpoint de migraciones de la
   Management API el 2026-08-10, no el CLI). El pin viejo inferido `created_by_is_null:true` era falso.
2. **Re-pin desde la observación, no desde inferencia** (patch `evidence/r3-created-by-repin-20260917.patch`
   sha256 `2989ca28f533b4aeae6303dfa4d23e8be22cb1e1b47180e9146fc8ee68090f36`, 6 archivos; provenance
   corroborada en la respuesta cruda `ledger_raw.rows[7]` + `totals.rows_created_by_set=1`, en la
   transcripción del `read_terminal` de las 16:20:58Z y en el log Codex del 2026-08-10):
   `core-contract.mjs` pinnea `created_by_is_null:false` SÓLO en `20260810160355`; cada flag legacy es
   booleano explícito por fila (`LEDGER_NULL_FLAGS`) y un flag no observado (ausente o no booleano)
   **nunca** iguala un pin. `core-contract.test.mjs` 20/20 (filas observadas reproducen el veredicto; el pin
   viejo da `diff ['created_by_is_null']` → 7/1/1/0; cada flag flipeado en cada fila legacy es un diff).
   `offline-rehearsal.mjs` siembra `created_by` sintético en la fila pinneada y suma la fase
   `cli_rows_discrepancy_blocks` (clear/set → 7/1/1/0 + restore); `summarize_r3.py` la exige. `summarize.py`:
   `r3_preflight` apunta a `r3-preflight-[0-9]*` (el glob viejo elegía el `-failed-` por orden lexicográfico).
3. **Ensayo offline re-ejecutado**: `r3-offline-rehearsal-20260917T161625Z.json` (14/14, antes del re-pin)
   sha256 `acce7daaf50efec536acc3bcead2f2e2c215c6bd343a9fdc6d69cab6dba2c084` y
   `r3-offline-rehearsal-20260917T163527Z.json` (**15/15**, con la fase nueva) sha256
   `7402c866035c3bd9e743901110b73d45365f39deb8479a34b90988d985802d9f`; 0 requests remotos, clon dropeado,
   catálogo `c245933e…` idéntico a los dos runs del 2026-09-15.
4. **3º run → `PHASE3B_R3_PREFLIGHT_ONLY_STOP (0 writes)`**: `r3-preflight-20260917T163745Z.json` sha256
   `4ab49a7b9a0c69ef216865622571b51cd4fbcbe2784adb8a0f6178166bc4ec22` (0600) + log de terminal
   `r3-preflight-20260917T163745Z-terminal.log` sha256
   `e40319985074374df01b379a284363f17caa40fd982108607561f430a8b336fc` (gitignored por `*.log`, 0 tokens PAT).
   Observado en Core staging: proyecto `arma2-torneos-staging` `ACTIVE_HEALTHY` `NON_PRODUCTION`
   `us-east-1` PG `17.6.1.147`; ledger 9 filas (max `20260810215224`), **forma == hospedada** (6 columnas,
   `shape_diff []`), writer `postgres` con CREATE en database/`public`/`app_private` e INSERT/DELETE en el
   ledger; `standard_conforming_strings=on`; veredicto CLI `{reproduced 7, legacy_matched 2, mismatched 0,
   absent 0, ok true}` con `diff []` y `local_blob_reproduces_pin true` en las dos legacy; objetos × ledger
   `20260914120000` y `20260915120000` = `installed:false, ledger:absent → apply`; secret Keychain `ABSENT` /
   Core `absent` → plan `generate 32 random bytes (hex) → Keychain add → set-secrets on Core → verify by
   signed probe`; función `torneos-core-contract` `present=false`; ACL baseline: 5 funciones + 2 tablas
   ausentes, `app_private` presente (USAGE anon/authenticated/service_role = true),
   `session_branch false`, 0 objetos/relaciones `torneos_contract_*` extra.

**Estado:** R3 sigue en STOP **por autorización, no por hallazgo**. El PASS del preflight es una foto
read-only: la ejecución del apply vuelve a correr el preflight entero (mismo runner, mismos STOP) antes
del primer write; no se reutiliza. Suites offline re-ejecutadas al cerrar este commit: R3 tooling 20/20,
inventory 20/20, local 7/7, gateway-port 5/5, unit Edge 16/16 (TS 4.9.5), `migrations:guard` OK + 8/8;
`summarize.py` → `results.json` byte-idéntico (`HYBRID_BLOCKED`: local 15/15; híbrido 12 PASS / 8 PENDING =
R3 ×3 + D1 positivo + R4 + R5 ×2 + B04).

## 16. Diferencias local → remoto

| Tema | Lab | Remoto (según runners) |
|---|---|---|
| Instalador del baseline | `supabase_admin` (owner) | `postgres.<ref>` por Session Pooler; el prólogo `ALTER DEFAULT PRIVILEGES` aplica al rol actual → el runner verifica los mismos conteos ACL (359/304/12/147/328) y owners |
| Sesión Core | SQL `auth.sessions` (Node) / contrato `session` (Edge) | sólo contrato `session` por HTTPS |
| Trust del bearer Torneos | PostgREST con JWKS del bridge | third-party auth `custom_jwks` (**B03, a medir**) |
| Kong/apikey | sin Kong (`core-api` sustituto) | `apikey` anon público en GoTrue/PostgREST/Functions |
| Pre-request | lab 3A: `PGRST_DB_PRE_REQUEST` env · **R2-local: `ALTER ROLE authenticator SET pgrst.db_pre_request` (forma hospedada)** | `ALTER ROLE authenticator SET pgrst.db_pre_request` |
| Verificación del bootstrap | **contrato compartido v2** (`contracts/`), 16/16 en R2-local | el **mismo** SQL/expect, pinneados antes de leer el PAT |
| Logins del gateway | `torneos_edge_identity_writer` / `torneos_edge_core_adapter` (mismos nombres; passwords en `.runtime/config.json` de lab) | mismos nombres; passwords en Keychain |
| `cron.job` / `storage.buckets` | ausentes (imagen sin `pg_cron`; storage-api no corre) → `-1` | `storage.buckets` existe; `cron.job` sólo con `pg_cron` habilitado → `-1` si no |
| Trust del bearer Torneos (híbrido) | PostgREST con JWKS del bridge (archivo) — **certificado en R2-local** | third-party auth `custom_jwks` (**B03, diferido a remote-to-remote**) |
| TLS | ninguno (red interna) | `verify-full` con CA Supabase (psql y `db.ts`) |
| Ledger de migraciones Core | ensayo offline: tabla hospedada de 6 columnas creada en el clon | **Estrategia A (§8.4)**: el runner inserta la fila CLI `(version, name, statements)` en la MISMA transacción que la migración (`/database/query` no escribe `schema_migrations`); forma del ledger verificada read-only antes del write |
| Edge gateway path | `/torneos-gateway/*` | `/functions/v1/torneos-gateway/*` (ambos soportados por `routePath`) |
| Servicios publicados en el lab | 8 (Phase 3A) | 9: se sumó `torneos-functions` (test de forma actualizado) |

## 17. Blockers pendientes

**Bloquean `HYBRID_REMOTE_LOCAL_CERTIFIED`** (`results.json → blocking_conditions`):

1. **R3 híbrido** — contrato Core v1 + v1.1 en Core staging remoto (`deploy-core-contract.sh`, lo corre
   Nico; sin PAT/tty el agente no puede). Evidencia `core-contract-*.json`. **Tooling corregido y ensayado
   offline el 2026-09-15 (§8); pendiente de la autorización explícita de Nico; el paso recomendado
   antes de autorizar es `--preflight-only` (read-only, 0 writes).** Condiciones estrictas en
   `summarize.py`: `r3_core_contract_migrations_and_ledger_rows_on_core_staging`,
   `r3_core_contract_function_signed_harness_9_exact_answers`,
   `r3_core_contract_acl_anon_authenticated_service_role_certified`,
   `r3_d1_positive_login_session_200_logout_403_session_gone`.
2. **R4 híbrido** — Edge gateway `torneos-functions` (perfil `gateway`, `127.0.0.1:58431`) contra
   Torneos local + contrato Core remoto por HTTPS; `.runtime/torneos-gateway.env` a generar desde el key
   ring `p3b-k1/p3b-k2` ya creado. Evidencia `local-torneos-gateway-*.json` (por definir).
3. **R5 híbrido** — E2E real Core staging remoto ↔ Torneos local + fixture P0 híbrido. Evidencia
   `local-torneos-e2e-*.json` (por definir).
4. **B04 frontend dual-backend**: `src/features/torneos/api/tournamentWorkspaceService.js` (145 RPC) y 7
   servicios más importan el singleton Core; `createTorneosClient` exige `127.0.0.1:58410`;
   `resolveIsolatedSso` exige `deploy=test`. No iniciado.

**No bloquean** (diferidos / cerrados / vigilancia):

5. **`REMOTE_TO_REMOTE_PENDING_PRELAUNCH`** — R2 remoto (`arma2-torneos-isolated-staging`, §7.1, costo
   ≈ USD 10/mes en pro / imposible en free), bootstrap remoto (R3 remoto, ahora con el contrato v2),
   gateway hospedado, certify remoto y **B03** (trust RS256 en PostgREST hospedado: inherentemente
   remote-to-remote). Gate final pre-launch; 10 condiciones pendientes, `blocking = false`.
6. **D1**: cerrado — aceptado (§4.2.1). Dependencia operativa a vigilar en remoto.
7. **`update_draft_fixture`** (y `schedule_tournament_match` con su padre): OFF + DB gated + gateway
   gated; blocker obligatorio antes de habilitar fixtures (ningún flujo staging v1 lo requiere).
8. Fixture remoto de `review_tournament_team_entry` y E2E remoto Fase 7: no escritos (remote-to-remote).
9. Nada commiteado ni pusheado (decisión de Nico). El stack `arma2-torneos-isolated-local` queda
   **levantado** (run 2) en `127.0.0.1:58430` para R4; `node lab.mjs destroy` lo elimina con su volumen.

## 18. Conclusión

**`HYBRID_BLOCKED` — únicamente por R3 + R4 + R5 + B04 pendientes.** Local 15/15 (port Edge ≡ Node,
D1 aceptada). Híbrido 10/15: R1 ejecutado (Core staging = `hhyvmhgpapyuzjgxfnqv`; Production
clasificada y excluida) y **R2-LOCAL certificado**: stack Torneos aislado `arma2-torneos-isolated-local`
sobre la imagen certificada `80d7b27c…`, **17/17 chequeos en dos runs desde cero con hashes idénticos**
(`catalog 617d205b…`, `api_view c212becc…` = 2D), catálogo 16/16 con el contrato compartido v2, **479/0**,
33 gated denegadas a anon y authenticated (66/66), P0 alcanza su cuerpo, 11 forjados → 401, identidad
protegida, allowlist 43 ⊆/∩∅, aislamiento total (sin Core resoluble, sin ruta por defecto, sin
extensiones de red, 0 FK externas, 0 `auth.*`), **0 requests remotos** (160/run a `127.0.0.1:58430`).
**`REMOTE_TO_REMOTE_PENDING_PRELAUNCH` explícitamente diferido y no bloqueante.** Drift 17.6.1.147
informativo: **sin drift**. Hallazgo de esta fase: el SQL de verificación v1 del runner remoto no
parseaba sin `pg_cron` → **contrato v2** (§7.2.1), sin cambio de producto/baseline/gate/ACL. NO Production.
NO Core staging tocado.

R3 pre-apply (2026-09-15, §8): tooling corregido (ledger estrategia A, secret idempotente, harness
firmado + ACL, rollback pinneado) y **ensayado offline ×2 sobre un clon del Core del lab** (apply → ledger
→ ACL → idempotencia → rollback → catálogo idéntico); 20/20 tests offline nuevos + 20/20 previos;
`summarize.py` estricto (6 condiciones R3, 2 ya en verde: tests offline y rollback ensayado). **R3 remoto
NO ejecutado: STOP a la espera del OK.**

Reproducción local: `node integration/torneos-isolated-local/lab.mjs up` → `certify` → `reset` (run 2)
→ `drift 17.6.1.147`; `node --test backend/torneos/phase3b/local/local.test.mjs`;
`npm --prefix integration/torneos-core-contracts run up` (volúmenes vacíos), `npm test`, `npm run test:edge`,
`npm run test:exposure`, `npm run test:exposure:edge`, `npm run test:acl`, `npm run test:equivalence`,
`npm run test:d1`; `node --test backend/torneos/phase3b/gateway-port.test.mjs`;
`node --test backend/torneos/phase3b/remote/inventory.test.mjs`; `node --test backend/torneos/phase3b/remote/core-contract.test.mjs`;
`node backend/torneos/phase3b/remote/offline-rehearsal.mjs` (clon del lab 3A, 0 remoto); `node --test scripts/edge-functions/*.test.mjs`;
`npm run migrations:guard`; `python3 backend/torneos/phase3b/summarize.py`.
