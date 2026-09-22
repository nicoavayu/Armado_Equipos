# Phase 2D — Staging RPC exposure gate

**Conclusión binaria: A) STAGING RPC EXPOSURE GATE PASS** (calculada por `phase2d/summarize.py`
desde la evidencia; ver `phase2d/results.json`, 27/27 condiciones). **STOP.** No staging, no
Production, no deploy, no Phase siguiente, no Mercado Pago.

Alcance único: cerrar el residual risk de las 33 funciones SECURITY DEFINER que quedaron
INCONCLUSIVE (Phase 2B) / NOT_EXERCISED (Phase 3A). La P0 que staging v1 necesita
(`review_tournament_team_entry`) queda **funcionalmente certificada**; las otras 32 quedan
**técnicamente inaccesibles** para el cliente de staging v1 (DB ACL + allowlist del gateway), más
el único camino indirecto que las alcanzaba. Sin auditoría general nueva; sin tocar Core/SSO.

## 1. Worktree / branch / HEAD

- Worktree `.claude/worktrees/arma2-phase-2d-rpc-exposure-a542ad`, branch
  `claude/arma2-phase-2d-rpc-exposure-a542ad`, rebasada a **`992dd282`** exacto (Phase 2C HEAD;
  `git status` limpio al inicio). El worktree de Phase 2C (`arma2-connection-architecture-8a5d41`)
  no se tocó.
- Base verificada: baseline `97634b658c91b620c60bdceb53c9638a601fa7aba01ae3a999e6857e37d08692`,
  Phase 2C `A) HARDENED + RECERTIFIED`, P3A-F1 CLOSED, E2E 40/40.
- Baseline Phase 2D: **`f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f`**
  (único cambio: el cuerpo del P0, §4). Gate: `00000000000001_staging_v1_rpc_exposure.sql`
  `3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62`.

## 2. ACL before / after de las 33 (+ padre), medida sobre la imagen Supabase real

`phase2d/exposure_acl.py` instala (a) el baseline de **`992dd282`** y (b) el baseline Phase 2D +
gate en contenedores efímeros nuevos de `supabase/postgres:17.6.1.143` (`network=none`, base
`postgres` con los default ACLs de la imagen), inventaría con `phase2c/acl-inventory.sql` y
compara también contra `template0`. Nada reutilizado de conteos previos.

| rol | funciones públicas 992dd282 → 2D | DEFINER 992dd282 → 2D |
|---|---|---|
| `anon` | 12 → **12** | 12 → 12 |
| `authenticated` | 180 → **147** | 179 → **146** |
| `service_role` | 328 → 328 | 284 → 284 |
| `postgres` (plataforma) | 359 → 359 | 304 → 304 |

- Cambios before→after: **exactamente 33 funciones**, todas en `authenticated`, todas removals;
  `privilege_gained_by_api_role = []`; secuencias y relaciones sin cambio.
- Real == template0: **479 objetos, 0 mismatch**.
- Por función (`evidence/exposure-acl-33.json`, 34 filas): en 992dd282 las 33 tenían
  `authenticated=true`, `anon=false`. Después: sólo `review_tournament_team_entry` conserva
  `authenticated`; las 32 + `auto_schedule_tournament_matches` → `anon=false, authenticated=false,
  service_role=true, adapter=false, writer=false`, ausentes del OpenAPI de PostgREST para anon y
  para un bearer. Exposición por gateway: 403 para las 33 (§9).

## 3. Solución elegida — defense in depth

**A) DB (frontera final):** migración nueva `backend/torneos/supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql`,
generada por `phase2d/build_gate.py` desde `phase3a/inconclusive-ledger.json` + el grafo de
llamadas del baseline (manifiesto `phase2d/staging-v1-rpc-gate.json`). `REVOKE EXECUTE … FROM anon,
authenticated` sobre las **32 OFF + 1 padre** (33 sentencias); `service_role` conserva EXECUTE;
idempotente; precondición fail-closed (la función existe) y postcondición (anon/authenticated sin
EXECUTE, service_role con EXECUTE). El baseline NO embebe la decisión de despliegue: reactivar una
función exige su certificación + una migración `GRANT` posterior + entrada en la allowlist.
Sin roles ni arquitectura nueva.

**B) Gateway:** allowlist explícita `phase2d/staging-v1-rpc-allowlist.json` (43 RPC por feature)
montada read-only en el gateway del lab y aplicada a `/torneos/rest/v1/rpc/<name>` (POST y GET)
después de verificar el bearer y antes del chequeo de sesión/identidad: `403 {error:'rpc not
enabled'}`. Fail-closed si el archivo falta o está vacío. Las lecturas de tablas por el proxy
genérico no cambian (RLS).

**P0:** edit anclado R3-2D en el generador (`phase2d/season-scope-edits.json`, cargado por
`phase2b/season_scope.py`): la capability de `review_tournament_team_entry` es un `case … end`
que el patrón R2 de Phase 2B no matcheaba → la función **no tenía regla de temporada** (un admin
asentado sólo en la temporada 1 podía aprobar/rechazar una inscripción de la temporada 2 de la
misma organización). Ahora exige `has_tournament_season_access(org, season de la entry)`.

## 4. Diff exacto (fuente)

`backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql` (regenerado, único hunk):

```diff
-  if private.current_identity_id() is null or not public.has_tournament_organization_capability(
+  -- Phase 2D: the capability argument is a CASE expression, which the Phase 2B R2 pattern did not
+  -- match; organization authority over this entry's season requires the actor's season assignment.
+  if private.current_identity_id() is null or not (public.has_tournament_organization_capability(
     p_organization_id,
     case when p_decision = 'approved' then 'team_entries.approve'
          when p_decision = 'rejected' then 'team_entries.reject'
          else 'team_entries.review' end
-  ) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
+  ) and public.has_tournament_season_access(p_organization_id, (select e.season_id from public.tournament_team_entries e where e.id = p_team_entry_id and e.organization_id = p_organization_id))) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
```

`backend/torneos/phase2b/season_scope.py` (carga los edits de Phase 2D con etiqueta `R3-2D`):

```diff
-    edits = json.loads((BASE / 'phase2b/season-scope-edits.json').read_text())
-    if name in edits:
-        …
-        rules.add('R3')
+    for phase, tag in (('phase2b', 'R3'), ('phase2d', 'R3-2D')):
+        edits = json.loads((BASE / phase / 'season-scope-edits.json').read_text())
+        if name in edits:
+            …
+            rules.add(tag)
```

`backend/torneos/tools/build.py` (etiqueta "Phase 2D" en `intentional-function-differences.json`
cuando todas las reglas son `-2D`).

`integration/torneos-core-contracts/gateway.mjs`:

```diff
+const allowlistDoc = JSON.parse(await readFile('staging-v1-rpc-allowlist.json', 'utf8'));
+const RPC_ALLOWLIST = new Set(Object.values(allowlistDoc.features ?? {}).flat().filter(n => /^[a-z0-9_]+$/.test(n)));
+if (RPC_ALLOWLIST.size === 0) throw new Error('staging v1 RPC allowlist is empty');
 …
       const p = await verifyToken(token, await readConfig());
+      const rpc = rest[2];
+      if (rpc && !RPC_ALLOWLIST.has(rpc)) return json(res, 403, { error: 'rpc not enabled' });
       await activeSession(p.core_user_id, p.session_id);
```

`integration/torneos-core-contracts/compose.yaml`: un volumen read-only
`../../backend/torneos/phase2d/staging-v1-rpc-allowlist.json:/lab/staging-v1-rpc-allowlist.json:ro`.
`lab.mjs`: `installTorneos` aplica en orden las migraciones posteriores al baseline y las registra
en `install.json`. Nueva migración `00000000000001_staging_v1_rpc_exposure.sql` (33 `REVOKE`).

## 5. Staging v1 RPC allowlist (43)

Derivada de las features mínimas aprobadas; todo lo demás OFF (media, compras/entitlements,
partidos/fixture/draw/standings, comunicaciones, documentos, branding, página pública, social).

| feature | RPC |
|---|---|
| organizations/workspaces (11) | create_tournament_organization, update_tournament_organization, is_tournament_organization_slug_available, is_tournament_organization_member, has_tournament_organization_capability, has_tournament_capability, tournament_role_capabilities, get_my_tournament_memberships, get_tournament_workspace_context, set_tournament_workspace_preference, set_active_tournament_context |
| collaborators (5) | assign_tournament_season_member, remove_tournament_season_member_assignment, list_tournament_season_member_assignments, has_tournament_season_access, has_tournament_season_capability |
| seasons (2) | create_tournament_season, update_tournament_season |
| tournaments (7) | create_tournament_with_defaults, update_tournament_configuration, change_tournament_status, save_tournament_category, get_tournament_competition_context, get_tournament_creation_eligibility, has_organization_consumed_free_tournament |
| team registration / basic roster (14) | create_tournament_team_entry, update_tournament_team_entry, submit_tournament_team_entry, withdraw_tournament_team_entry, archive_tournament_team_entry, get_team_registration_context, get_tournament_teams_context, can_read_tournament_team_entry, is_tournament_team_manager, add_tournament_roster_player, update_tournament_roster_player, remove_tournament_roster_player, create_tournament_provisional_player, search_tournament_players |
| invitations (2) | invite_tournament_team_manager, accept_tournament_team_invitation |
| Core team import (1) | search_tournament_arma2_teams |
| team entry review (1) | review_tournament_team_entry (certificada acá) |

Verificado por la suite: allowlist ∩ gate = ∅; ninguna OFF; cada entrada existe y es ejecutable
por `authenticated`; ninguna es SERVICE_ONLY/INTERNAL; ninguna salvo el P0 era INCONCLUSIVE en
Phase 2B. El gateway no tiene camino anónimo de RPC (bearer obligatorio), así que las 12 lecturas
anon del baseline no forman parte de la allowlist y siguen gobernadas sólo por el ACL.

## 6. `review_tournament_team_entry` — certificación (stack real)

Fixture **real** construido por las RPC allowlisted a través del gateway con una sesión Core real
(GoTrue + `/exchange`): organización activa → 2 temporadas → 2 torneos `create_tournament_with_defaults`
(football_5) → categoría activa → `change_tournament_status('registration')` (checklist ready) →
`create_tournament_team_entry` manual → `update_tournament_team_entry` (in_progress) → 5
`create_tournament_provisional_player` + `add_tournament_roster_player` (dorsales 1–5 únicos,
posiciones ARQ/DEF/MED/DEL/DEF, 1 arquero) → `invite_tournament_team_manager` → manager activo
(sembrado: la aceptación es el contrato verified-email certificado en Phase 3A) →
`submit_tournament_team_entry` (validación `valid:true`, counts 5/1/5/8). Roster settings
`5,8,1,unique_shirt_numbers=true,require_individual_player_approval=false`. Colaboradores: admin
asentado en A, admin asentado en B, admin sin asiento (`assign_tournament_season_member`).

| actor | approved | changes_requested | rejected |
|---|---|---|---|
| owner (gateway, sesión Core real) | **PASS** | PASS | PASS |
| admin asentado en la temporada de la entry | **PASS** (A sobre A; B sobre B) | — | — |
| admin sin asiento | DENY `TORNEOS_RESOURCE_FORBIDDEN` | — | — |
| admin asentado en otra temporada | DENY | DENY | DENY |
| admin A sobre entry de temporada B | DENY | — | — |
| owner de otro workspace (con el org de la entry / con el suyo) | DENY / DENY | — | — |
| owner con org ajeno | DENY | — | — |
| anon (PostgREST directo / gateway) | 42501 antes del cuerpo / 401 | — | — |

- Payload inválido: decisión desconocida, motivo <3 / >1200, `issues` no-array → `22023
  TORNEOS_INVALID_REVIEW`; entry inexistente / ya revisada → `TORNEOS_RESOURCE_FORBIDDEN`.
- Roster inválido (arquero removido tras el submit): approve → `23514 TORNEOS_ROSTER_INCOMPLETE`
  con detalle `minimum_goalkeepers, minimum_players`; `changes_requested` sí procede.
- **No partial writes:** tras cada DENY / 22023 / 23514, snapshot idéntico de entry, rosters,
  jugadores, `tournament_team_reviews` y `tournament_audit_log`.
- **Audit correcto:** `team_entry.<decision>` / `team_entry` / `resource_id=team_entry_id` /
  `tournament_id` / `actor_user_id` = revisor / `metadata {rosterId, issueCount}`; fila en
  `tournament_team_reviews` con decision, motivo, issues, `created_by`, roster y org. Approve:
  roster `approved`, jugadores `pending → eligible`, `approved_at`; changes_requested: entry y
  roster `changes_requested`, sin timestamps de aprobación, issues persistidas, roster editable;
  rejected: `rejected_at`, roster sigue `submitted`.

Estado en el ledger: **NOT_EXERCISED → CERTIFIED**.

## 7. Wrappers `approve_tournament_team_entry` / `reject_tournament_team_entry`

SERVICE_ONLY en el baseline (grantees `service_role`): PostgREST directo → 42501 antes del
cuerpo para anon y para un bearer válido; gateway → 403 (no allowlisted). Como `service_role`
con la identidad del owner en `request.jwt.claims` delegan en `review` con decisión fija:
`approved` / `rejected` con audit y review row a nombre del owner; con un admin sin asiento o
asentado en otra temporada → `TORNEOS_RESOURCE_FORBIDDEN` (heredan la regla de temporada); sin
identidad → `TORNEOS_AUTH_REQUIRED`. No entran en la allowlist.

## 8. PostgREST DENY para las 32 (+ padre)

`evidence/exposure-postgrest-sweep.json`: 66 llamadas directas a `torneos-rest` desde dentro de
la red (posición atacante, sin gateway), con los parámetros declarados en null: **33 anon →
401/42501 `permission denied for function`; 33 authenticated (bearer válido) → 403/42501**, todas
`DENIED_BEFORE_BODY`; GET también denegado. Catálogo: `has_function_privilege` false para anon y
authenticated en las 33.

## 9. Gateway DENY para las 32 (+ padre)

`evidence/exposure-gateway-sweep.json`: sesión Core real + bearer del bridge válido → **33 × POST
403 `rpc not enabled` y 33 × GET 403**; control con la misma sesión sobre una RPC allowlisted →
200; bearer inválido → 401 (nunca llega al veredicto de allowlist); tabla vía proxy → 200 (RLS,
sin cambio). Logout Core → 401 en una RPC allowlisted y 403 en una OFF (la allowlist no depende
del estado de sesión).

## 10. Parent-path checks

Cierre transitivo del grafo de llamadas del baseline sobre las RPC ejecutables por cliente en
992dd282: **un solo padre**, `auto_schedule_tournament_matches` (SCOPED en Phase 2B) →
`schedule_tournament_match` (OFF). Un DEFINER padre corre como owner, así que revocar sólo a la
hija no cerraba ese camino → el padre entra en el gate (DB REVOKE + fuera de la allowlist):
PostgREST directo 42501, gateway 403. `bulk_schedule_tournament_matches` (el otro caller) nunca fue
ejecutable por cliente. Triggers y políticas no referencian ninguna de las 32.

## 11. Regresión completa

| suite | resultado |
|---|---|
| `phase2d/exposure_acl.py` (imagen real before/after/template0) | 8/8 checks; 33 cambios, 0 ganados; 479 objetos, 0 mismatch |
| `npm run test:exposure` (nueva, stack real) | **18/18** (re-ejecutable) |
| `npm run test:acl` (Phase 2C, stack real) | **16/16** |
| `npm test` (Phase 3A E2E, stack real) | **40/40, 0 FINDING**; P3A-F1 sigue CLOSED (anon 12/359) |
| `phase2b/run.py` (recert template0) | **A) CLEAN TORNEOS BASELINE PASS**: 79/79, contratos 63/63, wiring 68/68, inventario 366/366, equivalence sin motivos (119 diferencias intencionales = 118 + P0) |
| 305/305 SECURITY DEFINER | disposición mantenida (33 marcadas `staging_v1_gated`, categorías Phase 2B intactas) |
| season / workspace isolation | sweep LEAK 0, ORG_LEAK 0, SCOPED 101, INCONCLUSIVE 33; P0 DENY cross-season/cross-workspace |
| Core contracts / SSO / logout / revocación | E2E verified email, directory, team snapshot, logout → 401 en exchange/RPC/contrato |
| no privilege escalation / no secrets | ACL suite + exposure suite (sin JWT ni secretos en artefactos y evidencia) |
| Core unit `torneos-core-contract.test.mjs` | **15/15** |
| Edge suite `npm run test:edge-functions` | **76/76** ×3 (fix de harness: la firma "alterada" usaba `'0'` fijo y quedaba intacta 1/16 de las corridas; ahora se voltea el último dígito a uno distinto; no cambia el contrato) |
| `npm run migrations:guard` | OK + 8/8 |
| features staging v1 | 14 RPC allowlisted ejercitadas con 200 a través del gateway por el propio fixture |

## 12. Residual-risk ledger

`phase2d/residual-ledger.json` (generado): `review_tournament_team_entry` **CERTIFIED**; las 32
**NOT_EXERCISED — SERVER-SIDE DISABLED FOR STAGING V1** (no se declaran probadas; vuelven a exigir
fixture/test antes de un `GRANT` + allowlist); `auto_schedule_tournament_matches` **GATED (parent
path)**. Notas: `update_draft_fixture` tampoco tiene regla de temporada (misma clase que el P0:
capability en `case … end`) y debe recibirla junto con su fixture antes de habilitar la edición de
fixture; `schedule_tournament_match` sólo se reactiva junto con su padre.

## 13. Conclusión

**A) STAGING RPC EXPOSURE GATE PASS. STOP.** No Phase siguiente. No staging. No Production.

Reproducción: `python3 backend/torneos/tools/build.py` (requiere el contenedor `history`),
`python3 backend/torneos/phase2d/build_gate.py`, `python3 backend/torneos/phase2b/run.py`,
`python3 backend/torneos/phase2d/exposure_acl.py`, luego en `integration/torneos-core-contracts`:
`npm run up` (volúmenes de base de datos vacíos), `npm run test:exposure`, `npm run test:acl`,
`npm test`; `python3 backend/torneos/phase2d/summarize.py`.
