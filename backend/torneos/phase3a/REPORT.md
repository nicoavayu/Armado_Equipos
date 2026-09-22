# Phase 3A — Real Core contract implementation, non-production end-to-end

> **Addendum (Phase 2C, 2026-09-14):** P3A-F1 (§16) is **CLOSED**. The baseline generator
> now also revokes the Supabase image's schema-scoped default ACLs for functions and
> sequences, recertified on a real Supabase stack and on template0. P3A-R1 is classified
> **A) intentional and safe (with a test)**. Baseline SHA-256 moved `7ec33549…` → `97634b65…`.
> See `backend/torneos/phase2c/REPORT.md`. This section is kept as the original Phase 3A record.

**Conclusión binaria: A) REAL CORE CONTRACTS + TORNEOS E2E PASS** (calculada por
`phase3a/summarize.py` desde la evidencia; ver `results.json`). **STOP.**

No se creó ningún proyecto Supabase Production Torneos, no hubo deploy, no se tocó
Mercado Pago ni Phase 3B, y no hubo contacto con Production ni Staging. Todo corrió
en un laboratorio local con componentes Supabase reales.

Con la certificación viaja un **hallazgo del baseline que bloquea cualquier paso a
Production** (P3A-F1, §16): no es una incompatibilidad entre el contrato implementado
y el schema certificado, así que el baseline **no fue modificado** (cambios = 0), como
exige el brief; queda documentado para decisión.

## 1–3. Repo Core, branch, HEAD

- **Repo Core real:** `nicoavayu/Armado_Equipos` (este checkout). El backend de Core es
  Supabase: `supabase/migrations/*.sql` (schema, 41 migraciones canónicas en HEAD) y
  `supabase/functions/*` (Edge Functions Deno). Los endpoints Core viven ahí; la
  autenticación es GoTrue (`auth.users`, `auth.sessions`), reutilizada tal cual por el
  SSO certificado de Phase 1.5.
- **Branch/worktree:** `claude/torneos-phase3a-core-contracts-ac1d84` en
  `.claude/worktrees/phase-3-fresh-backup-d83091`, fast-forward sobre **`b5c5d4af`**
  (Phase 2B; mismos 41 archivos de migración Core que `main`/`e61f089d`).
- **NON-PRODUCTION confirmado:** el Core "real" de esta fase es el schema Core real en
  HEAD (las 41 migraciones + la nueva) instalado como `postgres` sobre
  `supabase/postgres:17.6.1.143`, con GoTrue `v2.194.0`, PostgREST `v14.15` y
  `edge-runtime:v1.74.2` reales, en Compose local (`integration/torneos-core-contracts/`).
  No es un proyecto hospedado: `.env` del producto no se lee, ningún ref remoto aparece.

## 4–6. Endpoints implementados, schemas, auth/autorización

**Migración Core** `supabase/migrations/20260914120000_torneos_core_contract_v1.sql`
(SHA-256 `2967ae6f…`), registrada en `scripts/guard_migration_source.mjs`:

- `app_private.torneos_contract_nonces` (replay de servicio, 61 s) y
  `app_private.torneos_contract_rate_events` (30/60 s por actor): owner-only, RLS,
  sin grants a roles API.
- Helpers `app_private.torneos_contract_{email,url,visible_player,importable_team}`:
  EXECUTE revocado a PUBLIC/anon/authenticated/service_role.
- **Entry point único** `public.torneos_contract_execute(p_operation, p_nonce, p_request)`
  SECURITY DEFINER, `search_path=''`, EXECUTE **sólo `service_role`**. Consume el nonce,
  verifica la sesión Core y evalúa la operación **en una transacción**; devuelve
  `{status, body}` como dato para que una denegación también consuma el nonce.

**Edge Function** `supabase/functions/torneos-core-contract/index.ts` +
`_shared/torneosCoreContract.ts` (lógica pura, WebCrypto), `verify_jwt = false` en
`config.toml` (service-to-service, como `push-sender`). Rutas:

| POST | Request (`phase2a/schemas.json`) | 200 |
|---|---|---|
| `/v1/verified-email` | `verifiedEmailRequest` | `{verified, matches, checked_at}` |
| `/v1/directory` | `directoryRequest` (kind players/teams, query 2..100, limit 1..12, cursor) | `{items[], next_cursor}` |
| `/v1/team-snapshot` | `teamSnapshotRequest` | `{core_team_id, name, crest_url, players[], source_revision, captured_at}` |

Los schemas de request/response son **byte a byte los certificados en Phase 2A**
(`schemas.json`, sin cambios): la Edge Function aplica schemas cerrados y el cliente
Node del gateway los valida con el mismo subconjunto de keywords que
`phase2a/schema_validation.py`. Internamente, al SQL viaja `after` (posición keyset
autenticada) en lugar del cursor firmado.

Autenticación/autorización de cada endpoint:

1. **Service auth** (todos): `X-Time` (±30 s), `X-Nonce` (32 hex, un solo uso, durable
   en SQL), `X-Signature` = HMAC-SHA256(`TORNEOS_CONTRACT_SERVICE_SECRET`,
   `path\ntime\nnonce\nbody`), verificación en tiempo constante. Body ≤ 16 KiB, sólo POST.
   Secret ausente → 503 cerrado, sin tocar la base.
2. **Autoridad de sesión Core** (todos): `auth.sessions` existe, pertenece al
   `core_user_id`, no venció (`not_after`), y la cuenta no está borrada, baneada ni es
   anónima. Logout real borra la sesión → 403. Torneos pre-autoriza localmente
   (`private.authorize_core_contract`) **antes** de llamar.
3. `verified-email`: email actual + `email_confirmed_at` de `auth.users`, normalización
   Phase 2A (ASCII, un `@`, sin espacios, 3..254, lowercase). Sólo verdicto y hora.
4. `directory`: rate limit 30/60 s por actor bajo advisory lock; players = cuentas vivas
   con `usuarios.acepta_invitaciones = true` y nombre 2..100; teams = equipos activos
   sobre los que el llamante tiene autoridad Core (`team_user_is_admin_or_owner`).
   Match con el normalizador propio de Core; cursores HMAC (clave derivada), 60 s,
   ligados a usuario/sesión/kind/query plegada/limit.
5. `team-snapshot`: 404 idéntico para equipo inexistente, inactivo o sin autoridad;
   candidatos = miembros que resuelven a cuenta viva y descubrible; `source_revision`
   = epoch de `teams.updated_at`; >80 → 409 (inalcanzable en Core real, §14).

## 7. Archivos cambiados

`phase3a/changed-files.txt`. Core: migración, Edge Function, helper compartido,
`config.toml`, inventario de funciones (`scripts/edge-functions/contracts.test.mjs`),
guard de migraciones (+test). Tests Core: `scripts/edge-functions/torneos-core-contract.test.mjs`.
Lab E2E: `integration/torneos-core-contracts/` (compose, `lab.mjs`, `core-init.sql`,
`core-api.mjs`, `edge-main/index.ts`, `gateway.mjs`, `adapter.mjs`, `core-client.mjs`,
`test.mjs`, README, evidencia). Documentación: `backend/torneos/phase3a/`.
**`backend/torneos/supabase/`, `contracts/`, `tools/`, `phase2a/`, `phase2b/`: sin cambios.**
`integration/torneos-sso/`: sin cambios (`token.mjs` se monta verbatim).

## 8. Tests Core

`node --test scripts/edge-functions/torneos-core-contract.test.mjs` → **15/15**
(`evidence/core-unit-tests.txt`): rutas y prefijo del gateway, secret ≥ 32 bytes,
ventana/formato/firma, schemas cerrados (uuid canónico, email, kind, limit, cursor),
cursores ligados/firmados/expirados, pipeline con ejecutor SQL falso (verdictos
pass-through, `has_more`→`next_cursor`, `after` en la 2ª página, rechazos de transporte
sin tocar SQL, 503 saneado sin loguear el request), cableado Deno (rpc exacto,
secret ausente → 503 sin rpc). `node --test scripts/edge-functions/*.test.mjs` → 76/76;
`npm run migrations:guard` OK.

## 9–12. End-to-end real y evidencia

`npm --prefix integration/torneos-core-contracts test` sobre un lab reconstruido desde
volúmenes vacíos → **40/40 (39 PASS + 1 FINDING)**, `evidence/e2e-results.json`,
`evidence/e2e-tests.txt`. Cadena real en cada check:

Core real (GoTrue sesión real) → `torneos-core-contract` (edge-runtime) →
`torneos_contract_execute` (PostgREST `service_role`) → contrato firmado → adaptador
real (`SET LOCAL ROLE torneos_core_adapter`, `authorize_core_contract`, atestación
INSERT-only) → RPC histórica vía PostgREST con el bearer del usuario → baseline
certificado → RLS/scope.

| Grupo | Checks | Evidencia clave |
|---|---|---|
| Verified email | 8 | verified PASS (manager ligado a la identidad local); wrong email DENY (`matches=false` real); email cambiado por la admin API de GoTrue invalida la invitación vieja y la nueva pasa; no verificado DENY; **baneado** DENY en gateway y en Core; **logout real** → exchange, RPC y contrato Core deniegan y la invitación sigue `pending`; outage → 503, sin atestación |
| Directory | 11 | búsqueda autorizada con forma histórica y `userId` = identidad shadow; usable por `add_tournament_roster_player`; bridge upsert reutiliza la identidad; borrado de cuenta (admin API) desaparece; outsider/otro workspace/temporada no asignada/query inválida → 403 **sin llamada a Core** (contador de nonces); paginación keyset con cursor ligado a sesión/query y manipulación rechazada; acentos/case; proyección de privacidad (sin email/teléfono, avatar no-HTTPS retenido); sesión/usuario cruzados → 403; **30/60 s → 429** en Core y rate limit local antes de Core; equipos sólo importables; outage → 503 mientras lecturas y RPC no-Core siguen |
| Team import | 6 | snapshot congelado (nombre desde Core, candidatos visibles, sin roster); no importador → `CORE_DENIED`; denegaciones locales sin Core; retry idempotente con reautorización Core fresca; renombre + roster cambiado no reescriben; otra competencia captura versión nueva; equipo inactivo/borrado → 404; **tope de roster real de Core** (§14); outage → sin entry |
| Binding/replay | 2 | un solo uso; ligado a identidad, sesión Core, hash exacto, torneo; TTL vencido; respuesta/equipo distintos rechazados con hash igual |
| Security | 5 | atestaciones inforjables por anon/authenticated/service_role; adaptador append-only sin RPC; bearer Torneos con session/core_user_id/sub/exp/iss/aud/kid incorrectos → 401 (y PostgREST directo rechaza aud); HMAC forjado/skew/nonce replay/path/método/tamaño; **sin secretos** en logs de 6 servicios, `/config`, respuestas ni Torneos; service key sólo en `core-functions`; sin FDW/dblink/tablas Core |
| Scope | 3 | cross-season DENY del admin en las 3 RPC dependientes; cross-workspace DENY; season scope PASS con import real del admin |

Logout/revocación (11): "verified email: real logout…" + "disabled (banned)…".
Replay/binding (12): "binding: …" ×2 + "security: Core service authentication …".
No secrets (13): "security: no secrets …" + escaneo de `evidence/` contra todos los
secretos del lab (limpio).

## 14. Diferencias respecto de los mocks Phase 2A

| Tema | Mock 2A | Core real (3A) |
|---|---|---|
| Transporte | `ThreadingHTTPServer` loopback | Edge Function Deno detrás del origen Core (`/functions/v1/torneos-core-contract/v1/…`); misma firma HMAC |
| Nonce / rate limit | en memoria | tablas `app_private.*`, atómicos, sobreviven reinicios |
| Sesión | dict sintético | `auth.sessions`/`auth.users` reales; logout borra; ban = `banned_until`; `is_anonymous` excluido |
| Email verificado | flag `email_verified` | `email_confirmed_at is not null` + email actual |
| Descubribilidad de jugador | flag `discoverable` | `usuarios.acepta_invitaciones` (toggle propio del usuario) + cuenta viva + nombre 2..100 (inválidos excluidos, nunca truncados) |
| Equipos "ocultos pero importables por id" | estado del mock | **no existe en Core**: descubrible ≡ importable ≡ `is_active` + owner/admin/captain; lo demás es 404 |
| Posiciones | strings libres | `usuarios.posiciones` (CHECK Core ≤ 2 de ARQ/DEF/MED/DEL), recortadas al contrato |
| URLs | fixture | sólo referencias `https://` ≤ 2048; el resto viaja como `null` |
| `source_revision` | contador | epoch de `teams.updated_at` (int32 hasta 2038; cambios de miembros no lo mueven: la autoridad es `players`+`captured_at` del snapshot) |
| Candidatos | lista de ids | `team_members` → `user_id` o `jugadores.usuario_id`; invitados sin cuenta no cruzan (sin `core_user_id`) |
| Tope 80 jugadores | probado | **inalcanzable**: `teams_max_roster_size_check ≤ 40` y el trigger de Core rechaza ("Plantilla completa"); el 409 queda como defensa |
| Matching | NFKD casefold | `public.normalize_tournament_person_name` de Core; el cursor sí liga la query con NFKD casefold |
| Errores | excepciones | SQL devuelve `{status, body}` para consumir el nonce también al denegar |

Mocks conservados como tests unitarios: `phase2a/test_contracts.py` (63) y el resto
de Phase 2B no se tocan; sólo la suite E2E usa Core real.

## 15. Cambios en el baseline: 0

`00000000000000_torneos_baseline_v1.sql` = `7ec33549…` (idéntico a `evidence/install.json`
de Phase 2B); `lab.mjs` lo verifica antes de instalar. Generador, contratos y
evidencia Phase 2B intactos. Ninguna incompatibilidad contrato↔schema apareció.

## 16. Riesgos pendientes (bloqueantes antes de Production)

**P3A-F1 — anon/authenticated con EXECUTE sobre las funciones públicas del baseline en
una base Supabase real.** Phase 2B certificó "sin EXECUTE de anon" sobre `template0`
(sin default ACLs). La imagen Supabase trae default ACLs **por schema** para el rol
instalador en `public` (funciones → `anon, authenticated, service_role`). El baseline
revoca el default de funciones en forma **global** (`ALTER DEFAULT PRIVILEGES REVOKE
EXECUTE ON FUNCTIONS …`, sin `IN SCHEMA public`), que no anula la entrada por schema; el
`REVOKE … FROM PUBLIC` por función tampoco toca el grant explícito a `anon`. Las tablas
no sufren esto porque su línea sí es `IN SCHEMA public`. Observado: **358/359 funciones
públicas y 304/304 SECURITY DEFINER** ejecutables por `anon`; barrido con argumentos
nulos (`evidence/finding-p3a-f1-anon-sweep.json`): 41/106 SERVICE_ONLY con guard en el
cuerpo, **43/106 SERVICE_ONLY y 5/9 INTERNAL ejecutan sin guard**, 26 con otros errores.
Inalcanzable a través del gateway certificado (exige bearer), **alcanzable por una Data
API PostgREST publicada** (probado dentro de la red: 200 como `anon` en
`tournament_media_pipeline_readiness`). La disposición Phase 2B "SERVICE_ONLY inalcanzable
desde bearers anon/authenticated" no vale en infraestructura Supabase real.
Fix mínimo propuesto (generador, una línea, **no aplicado**): la forma por schema que ya
usa para tablas, `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS
FROM PUBLIC, anon, authenticated, service_role;` (y `FOR ROLE postgres` si las
migraciones corren como `postgres`), seguido de recertificar Phase 2B también sobre una
base Supabase real y no sólo `template0`.

- **P3A-R1** — `create_tournament_team_entry` responde el replay idempotente antes de
  `consume_core_attestation`: la atestación positiva fresca del retry queda viva ≤ 10 s,
  ligada a identidad/sesión/contrato/hash exacto; cualquier llamada con esos inputs cae
  primero en la misma rama de replay/ya registrado. Observado y asertado en la suite.
- **P3A-R2** — 33 INCONCLUSIVE (§17).
- **P3A-R3** — custodia/rotación del secret de servicio, TLS/mTLS fuera de loopback,
  despliegue hospedado de la Edge Function, límites de latencia/costo de consulta online
  a Core, y el retiro de `core-api` (Kong sustituto del lab) no forman parte de esta fase.
- Decisión de producto pendiente: `acepta_invitaciones` como definición de
  descubribilidad para Torneos.
- Observación colateral de Core (fuera de alcance): `rpc_accept_team_invitation` inserta
  `jugadores` sin `partido_id`, que es NOT NULL en HEAD; el fixture del lab usó `partidos`.

## 17. Las 33 INCONCLUSIVE

`phase3a/inconclusive-ledger.json`: 33 funciones, **NOT_EXERCISED / residual risk**
(12 estados avanzados de competencia, 8 media/assets, 4 comercial/entitlements,
9 otras). Ninguna es alcanzable por los contratos Core de esta fase; conservan la regla
de temporada del generador y la denegación observada del admin, sin control positivo.
No se las declara probadas. Antes de Production necesitan fixtures/cobertura específica
si la funcionalidad que las alcanza queda habilitada.

## 18. Conclusión

**A) REAL CORE CONTRACTS + TORNEOS E2E PASS. STOP.** No crear Supabase Production
Torneos, no Phase 3B, no deploy. El hallazgo P3A-F1 debe resolverse (y recertificarse)
antes de cualquier proyecto Production; queda a decisión.

Reproducción: `integration/torneos-core-contracts/README.md`.
