# Phase 2C — Real Supabase ACL hardening of the Torneos baseline + recertification

**Conclusión binaria: A) REAL SUPABASE BASELINE HARDENED + RECERTIFIED** (calculada por
`phase2c/summarize.py` desde la evidencia; ver `phase2c/results.json`). **STOP.**

Alcance único: corregir **sólo** el modelo de ACL/grants del baseline para que sea seguro
sobre una instalación Supabase **real**. Sin cambios de negocio, sin tocar Core contracts,
sin SSO, sin staging, sin Production, sin Phase 3B, sin Mercado Pago. Todo local, con
componentes Supabase reales; ningún ref remoto, ningún `.env` de producto, ningún deploy.

- **Branch:** `claude/supabase-acl-hardening-c23094`, fast-forward sobre **`317c2b19`** (Phase 3A HEAD).
- **Baseline SHA-256:** `7ec33549…` (Phase 2B) → **`97634b658c91b620c60bdceb53c9638a601fa7aba01ae3a999e6857e37d08692`** (Phase 2C).

## 1. Causa exacta de P3A-F1

La imagen `supabase/postgres` trae, en su base `postgres`, **default ACLs por schema** para
el rol instalador (`supabase_admin`) en `public`:

```
supabase_admin|public|f → {postgres=X,anon=X,authenticated=X,service_role=X}   (funciones)
supabase_admin|public|S → {…,anon=rwU,authenticated=rwU,service_role=rwU}       (secuencias)
supabase_admin|public|r → {…,anon=arwdDxtm,…}                                    (tablas)
```

Los default ACLs **por schema se suman** a los globales; no los reemplazan. El prólogo
certificado en Phase 2B revocaba:

- funciones **de forma global** (`ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS …`, sin `IN SCHEMA public`) → **no anula** la entrada por schema;
- tablas **por schema** (`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES …`) → sí correcta;
- **secuencias: no las revocaba**.

Resultado sobre la imagen real: cada función y cada secuencia creada por el instalador
**heredaba** el grant a `anon/authenticated/service_role`. El `REVOKE … FROM PUBLIC` por
función (que sí emite el dump) no toca un grant **explícito** a `anon`. En `template0` no
hay default ACLs, por eso Phase 2B daba un falso verde. Medido sobre la imagen real con el
candidato Phase 2B (`phase2c/evidence/real-image-acl-before-real.json`): **358/359 funciones
públicas y 304/304 SECURITY DEFINER** ejecutables por `anon`, **7/7 secuencias** con
privilegio, y toda función/secuencia futura del mismo instalador nacía con privilegio API.

## 2. Diff mínimo

Un solo cambio de fuente, en el prólogo del generador `backend/torneos/tools/build.py`
(dos líneas nuevas, la forma **por schema** que ya usaba para tablas):

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
```

Se regeneró el baseline con `python3 backend/torneos/tools/build.py` (determinista): el
único cambio en el SQL emitido es ese bloque de comentario + dos `ALTER DEFAULT PRIVILEGES`
en el prólogo. **Cero cambios** en tablas, funciones, políticas, triggers, seeds o grants
explícitos: cada privilegio efectivo de rol API es ahora un `GRANT` **explícito**, no un
default heredado. `FOR ROLE postgres` no es necesario: las migraciones del baseline corren
como `supabase_admin` (el owner de las 359 funciones y las 104 tablas es `supabase_admin`,
verificado en la instalación real).

## 3. Archivos cambiados

- `backend/torneos/tools/build.py` — dos líneas en el prólogo del generador.
- `backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql` — regenerado.
- Recert Phase 2B (regenerados por `phase2b/run.py`): `evidence/install.json` (nuevo SHA),
  `evidence/tests.json`, `phase2a/tests.txt`, `phase2b/season-scope-sweep.{json,txt}`.
- **Nuevo** `backend/torneos/phase2c/`: `acl-inventory.sql`, `real_image_acl.py`, `summarize.py`,
  `REPORT.md`, `results.json`, `changed-files.txt`, `evidence/`.
- Lab: `integration/torneos-core-contracts/acl.test.mjs` (nueva suite ACL sobre el stack real),
  `package.json` (script `test:acl`), `test.mjs` (P3A-F1→cerrado, disposición P3A-R1, hash),
  `evidence/` refrescada.
- `scripts/edge-functions/torneos-core-contract.test.mjs` — fix de robustez del harness
  (cache-buster monotónico; **no** cambia el contrato ni su comportamiento).
- **Sin cambios:** `contracts/`, `phase2a/*.py`, `supabase/functions/*` (Core), `config.toml`,
  migración Core, SSO (`integration/torneos-sso/`).

## 4. HEAD / branch

Branch `claude/supabase-acl-hardening-c23094` sobre `317c2b19`. Sin push ni PR.

## 5. Grants antes / después (imagen Supabase real, instalador `supabase_admin`)

Default ACL del **instalador** en `public` tras instalar:

| objeto | antes (Phase 2B) | después (Phase 2C) |
|---|---|---|
| funciones | `anon=X,authenticated=X,service_role=X` heredado | sin entrada para roles API |
| secuencias | `anon=rwU,…` heredado | sin entrada para roles API |
| tablas | ya revocado por schema | sin entrada para roles API |

El default ACL del rol **plataforma** `postgres` (que no es un rol API y no instala el
baseline) queda intacto — es de la imagen, no del baseline.

## 6. Conteo efectivo por rol (EXECUTE, imagen real)

| rol | funciones públicas antes → después | SECURITY DEFINER (público) antes → después | secuencias con privilegio antes → después |
|---|---|---|---|
| `anon` | 358 → **12** | 304 → **12** | 7 → **0** |
| `authenticated` | 358 → **180** | 304 → **179** | 7 → **4** |
| `service_role` | 358 → **328** | 304 → **284** | 7 → **4** |
| `postgres` (plataforma) | 359 → 359 | 304 → 304 | 7 → 7 |

Los 12 de `anon` son exactamente los certificados como anon-ejecutables (3 `PUBLIC_READ` +
9 `IDENTITY_GATED_READ`); los 180 de `authenticated`, exactamente los del `GRANT` explícito.
**Ninguna función queda `PUBLIC`-ejecutable**; **0 privilegio de secuencia para `anon`**;
**0 grants de escritura no-SELECT para `anon`**. Una migración futura del mismo instalador
nace sin privilegio API (probe `false,false,false` para función/secuencia/tabla).
**El fix sólo quita privilegios: 0 privilegios ganados por ningún rol API**
(`real-image-acl-diff.json` → `privilege_gained_by_api_role_after_fix: []`;
554 cambios en funciones + 21 en secuencias, todos removals).

Equivalencia **stack real == template0**: 0 diferencias de privilegio de rol API sobre
**479 objetos** comparados (funciones, secuencias, relaciones). El baseline corregido se
comporta igual con o sin los default ACLs de la imagen: los grants ahora son explícitos.

## 7. 305/305 SECURITY DEFINER recertificadas

`acl.test.mjs` recontrasta cada función DEFINER contra el ledger semántico Phase 2B
(`evidence/security-definer-review.json`) **sobre el stack real**: grantees, owner
(`supabase_admin`), `search_path=""` y la regla anon por categoría. **305/305 mantienen su
disposición** (`evidence/acl-security-definer-recert.json`):
`SERVICE_ONLY 106, CLIENT_RPC_GUARDED 144, CLIENT_PREDICATE 16, INTERNAL 9,
IDENTITY_GATED_READ 9, CORE_CONTRACT_BOUND 4, PUBLIC_READ 3, CLIENT_RPC_DELEGATED 2,
TRIGGER 10, ADAPTER_ONLY 1, CATALOG_READ 1`. Las 106 `SERVICE_ONLY` y las 9 `INTERNAL`
son inalcanzables por bearers anon/authenticated, verificado además vía Data API directa
(42501 *antes* del cuerpo). TRIGGER/ADAPTER no son alcanzables por anon/authenticated
(un grant a `service_role`, server-only, sí es admisible y está en el ledger).

## 8. Tests completos

| Suite | Resultado | Entorno |
|---|---|---|
| `phase2c/real_image_acl.py` (before/after/template0) | before-real 358→ · after-real 12 · **479 objetos real==template0, 0 mismatch, 0 privilegio ganado** | imagen Supabase real (contenedores efímeros, `network=none`) |
| `acl.test.mjs` (`npm run test:acl`) | **16/16** checks | stack real (PostgREST Data API + roles anon/authenticated/service_role) |
| `phase2b/run.py` (recert completa) | **A) CLEAN TORNEOS BASELINE PASS**, 0 failed | template0 |
| ↳ baseline checks (`tools/test.py`) | 79/79 | template0 |
| ↳ contratos Phase 2A | 63/63 | template0 |
| ↳ temp-relation / season-read / core-wiring | 11/11 · 18/18 · 68/68 | template0 |
| ↳ season-scope sweep | LEAK 0 · ORG_LEAK 0 · SCOPED 101 · INCONCLUSIVE 33 | template0 |
| ↳ inventory ACL / owner / search_path | 366/366 | template0 |
| ↳ equivalence + seed equivalence | sin diferencias sin motivo | template0 |
| Core unit (`torneos-core-contract.test.mjs`) | **15/15** | node |
| Edge suite completa (`scripts/edge-functions/*`) | **76/76** | node |
| `guard_migration_source.test.mjs` + `migrations:guard` | 3/3 + OK | node |

## 9. E2E Phase 3A repetido (contra el baseline corregido)

`npm --prefix integration/torneos-core-contracts test` sobre el lab reconstruido desde
volúmenes vacíos con el baseline Phase 2C → **40/40, 0 FINDING** (`evidence/e2e-results.json`,
`evidence/e2e-tests.txt`). Cadena real intacta, sin regresiones:

Core real (GoTrue sesión real) → `torneos-core-contract` (edge-runtime) →
`torneos_contract_execute` (PostgREST `service_role`) → contrato firmado → adaptador
(`SET LOCAL ROLE torneos_core_adapter`, `authorize_core_contract`, atestación INSERT-only)
→ 4 RPC históricas vía PostgREST con el bearer del usuario → **baseline corregido** → RLS/scope.
El check que en Phase 3A era `FINDING P3A-F1` es ahora `P3A-F1 closed` (PASS).

## 10. Disposición de P3A-R1

**A) comportamiento intencional y seguro, con test.**
`create_tournament_team_entry` responde el replay idempotente **antes** de consumir la
atestación fresca de `team_snapshot`, así que un veredicto positivo queda sin consumir ≤ 10 s.
Está **ligado** a identidad, sesión Core, contrato y al hash exacto (org/torneo/categoría/
equipo). Nueva evidencia sobre el stack real (`test.mjs :: 'P3A-R1 disposition (A)'`):

- otra identidad con autoridad local sobre el mismo objetivo → `TORNEOS_CORE_ATTESTATION_REQUIRED` (la atestación viva no le sirve);
- misma identidad, otra sesión Core → denegada;
- misma identidad y sesión, otro objetivo (otro hash) → denegada;
- un duplicado exacto → **409 `TORNEOS_TEAM_ALREADY_REGISTERED`**, con rollback: nada consumido, nada creado;
- expira dentro del **TTL certificado de 10 s**; tras expirar, la misma llamada vuelve a exigir atestación.

No requiere fix antes de staging. (El índice único parcial `tournament_team_entries_linked_active_unique`
sobre `(tournament_id, category_id, arma2_team_id)` bloquea la doble importación del mismo equipo.)

## 11. Las 33 INCONCLUSIVE

Se mantienen como **residual-risk ledger** (`phase3a/inconclusive-ledger.json`); **no** se
declaran probadas. Phase 2C **no habilita** ninguna feature que las alcance
(`phase2c_reachable: false`). Cada una conserva la regla de temporada del generador y la
denegación observada del admin en la temporada no asignada. Regla para staging: **sólo**
bloquean si una feature que vayamos a habilitar (media pipeline, compras/entitlements,
estados avanzados de partido) hace alcanzable a alguna; en ese caso necesitan fixtures/
cobertura específicos antes de habilitar esa feature.

## 12. Conclusión

**A) REAL SUPABASE BASELINE HARDENED + RECERTIFIED. STOP.**
No staging. No Production. No Phase 3B. No deploy.

Reproducción: `backend/torneos/README.md`, `backend/torneos/phase2c/`, y
`integration/torneos-core-contracts/README.md` (`npm run up`, `npm test`, `npm run test:acl`).
