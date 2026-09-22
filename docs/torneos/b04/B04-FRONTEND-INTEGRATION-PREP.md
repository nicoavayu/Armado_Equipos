# ARMA2 TORNEOS — B04 Frontend Integration Prep (review + plan)

**Fecha:** 2026-09-18 · **Alcance:** review-only, sin cambios en el worktree
**Worktree:** `/Users/nicoavayu/Downloads/arma2/arma2-b04-dual-backend-foundation`
**Branch:** `codex/torneos-b04-dual-backend-foundation` @ HEAD `2058da03` (Phase 2D)
**Estado de la foundation:** **SIN COMMIT** — `package.json` modificado + 17 archivos untracked (`src/lib/coreSupabaseClient.js`, `src/features/torneos/foundation/*` ×4, `scripts/torneos-frontend/*` ×4, `docs/torneos/b04/*` ×7, `config/frontend-dual-backend.env.example`).
**Veredicto:** **B04_FOUNDATION confirmado. NO B04 PASS.** Nada de lo entregado exige cambio antes de R4; los hallazgos son de integración.

Verificado por mí en esta sesión (todo offline, cero contacto remoto):
- `node --test scripts/torneos-frontend/foundation.test.mjs` → **13/13 PASS** (9,5 s).
- ESLint sobre los 5 módulos frontend nuevos → **0 errores / 0 warnings**.
- `scripts/ci/quality-gate-contract.test.mjs` con el nuevo `test:ci` → **10/10 PASS**.
- `git diff 2058da03 -- backend/torneos migrations supabase/migrations` → vacío. `src/lib/supabaseClient.js` byte-idéntico a la base.
- `scripts/torneos-staging/static-guard.test.mjs` → **ROJO, heredado** (ver F2).

---

## 1. Review de la foundation

### 1.1 Checklist

| Requisito | Veredicto | Evidencia |
| --- | --- | --- |
| Singleton Core original intacto | **OK** | `src/lib/supabaseClient.js` sin diff vs base (test 1 lo asserta con `git show`); `coreSupabaseClient.js` es sólo `export { supabase as coreSupabase, supabase as default }` — no llama `createClient`. |
| Auth/login actual intacto | **OK** | Único tracked modificado: `package.json` (2 líneas de `scripts`). `AuthProvider`, `authLogoutService`, `App.js` sin diff. |
| Cero segundo cliente GoTrue | **OK** | `createClient(` en `src` (no-test): sólo `lib/supabaseClient.js:19` (Core) y `isolated/createTorneosClient.js:58` (lab Phase 1.5 preexistente, gate loopback). Ninguno en foundation. Test 3/11 verifican `creations.length === 0`. |
| Cero `persistSession` Torneos | **OK** | Sólo en Core (`true`) y en el lab isolated (`false`). Foundation: ninguno. |
| Cero `service_role` frontend | **OK** | grep `service_role|sb_secret_|SERVICE_ROLE` en `src`+`config` → 0. Guard `frontendLiteralViolations` cubre JWT con `role=service_role`. |
| Cero fallback Torneos → Core | **OK en foundation** | `torneosClient` no importa nada fuera de `foundation/`; `execute()` sólo lanza `TORNEOS_OUTSIDE_STAGING_V1` / `TORNEOS_TRANSPORT_NOT_CONNECTED`. Test 3 pasa `{core:{rpc}}` y `transport` como args y verifica 0 llamadas. **Ojo:** el fallback legacy sigue existiendo en `TorneosApp.jsx` (`service || localReview || undefined → default tournamentWorkspaceService`) — es base, no B04, y condiciona la composición (ver F8). |
| Cero URLs/refs reales hardcodeadas | **OK en lo nuevo** | Guard escanea líneas nuevas/cambiadas (`https?://`, `\b[a-z]{20}\b`, JWT). En **legacy** hay dos preexistentes: `config/featureFlags.js:10` `AUTHORIZED_STAGING_PROJECT_REF = 'hhyvmhgpapyuzjgxfnqv'` y `isolated/config.js` `http://127.0.0.1:58410`. Ambos en la base `2058da03`, fuera del alcance de B04 (F7). |
| Cero llamadas Torneos reales activadas | **OK** | Ningún archivo fuera de `foundation/` importa `foundation/` (grep + test 11). `config.torneos.enabled` es literal `false`; no existe env de activación. |
| Backend/migrations intactos | **OK** | Diff vacío contra base en `backend/torneos`, `migrations`, `supabase/migrations` (test 12 lo asserta). |

### 1.2 Hallazgos

| # | Sev. | Hallazgo | Impacto | Recomendación (no aplicar ahora) |
| --- | --- | --- | --- | --- |
| **F1** | MEDIA (integración) | `foundation.test.mjs` (tests 1, 12, 13) y `report.mjs` pinnean el SHA crudo `2058da03`. `git merge-base --is-ancestor 2058da03 main` → **NO está en main**. | Un squash-merge o rebase de la cadena codex deja `test:ci` rojo en `main` (`Missing baseline file` / `rev-parse` falla). En un clone superficial también. | Al integrar: guardar los blobs auditados como fixture versionada (o anclar a un tag anotado) y comparar contra ese fixture; la comparación "exact audit of base" pasa a ser "exact audit of fixture". |
| **F2** | MEDIA (CI) | `npm run test:ci` está **rojo en toda la cadena codex** antes de B04: `static-guard.test.mjs` detecta `JWT-like credential` en `integration/torneos-sso/evidence/app-console.json` (commit `2cd3512e`, Phase 1.5; token `role=anon`, sin `ref`). Codex sólo corrió 6 suites Jest + los 13 nuevos; lo declara en FRONTEND-TEST-PLAN. | B04-K (regresión completa) no puede ponerse verde sin resolver esto en la cadena. No es defecto de B04. | Decidir con Astra: allowlist del evidence del lab en el static guard, o mover el evidence fuera del árbol escaneado. |
| **F3** | BAJA | `audit.mjs` importa `@babel/parser`; `foundation.test.mjs` importa `@babel/core` + `@babel/plugin-transform-modules-commonjs`. Sólo `@babel/core` es dep top-level; los otros dos llegan hoisted (7.29.7) vía react-scripts. | Un cambio de lockfile puede des-hoistear y romper `test:ci`. | Declararlas como devDependencies al integrar (Codex no tocó lockfile a propósito). |
| **F4** | BAJA (operativa) | `node_modules` del worktree es symlink a `arma2/arma2/node_modules` (checkout principal). Ignorado por git. | La suite depende del árbol de deps del checkout principal, no de un `npm ci` propio. | Nota para reproducibilidad; no bloquea. |
| **F5** | INFO (diseño) | `torneosClient.execute(operation)` descarta `params`; `stagingV1Service` invoca `client.execute(operation, params)`. | Ninguno hoy (stub). | La firma futura debe ser `execute(operation, params, { signal })` — ver §5. |
| **F6** | INFO | `readDualBackendConfig`: `new URL(coreUrl)` en la comparación de origen está fuera de un try → `REACT_APP_SUPABASE_URL` malformada + URL Torneos presente → `TypeError` crudo en vez de `CORE_CONFIG_*`. | Ninguno (no cableado al runtime). | Envolver al cablear. |
| **F7** | INFO (legacy) | Refs hardcodeados preexistentes (ver checklist). | Fuera de B04. | Cuando B04-A adopte aliases, decidir si el ref de staging pasa a env. |
| **F8** | **ALTA para la integración** (no defecto de B04) | Tres **bypasses del `service` inyectado** dentro de flujos *permitidos*: (a) `TournamentWizardPage.jsx:641-653` monta `TournamentPublicPageSettings` y `TeamVisualPolicySettings` **sin prop `service`** → ambos usan `service = tournamentWorkspaceService` por defecto (singleton Core) y disparan en mount `get_tournament_public_page_settings` / `get_tournament_team_visual_policy` (bloqueadas). (b) `TeamRegistrationPage.jsx:37-38,176,202` importa `loadRosterPortraits` y `loadTeamPhotoState` directo (singleton Core; RPC bloqueadas + storage) y los llama en mount. (c) `OrganizationSettingsPage`/`TournamentWizardPage`/`TeamRegistrationPage` montan `BrandingAssetField` → `tournamentBrandingService` (storage upload + `set_tournament_branding_reference`). Además `PlanExperiencePage`/`PurchaseStatusPage` importan funciones del servicio legacy directamente (rutas bloqueables). | Con un adapter Torneos inyectado, estas pantallas seguirían emitiendo tráfico al **Core** para RPC que el gateway bloquea. Es exactamente el "uso accidental del singleton Core desde Torneos" que el test plan quiere detectar. El guard actual de Codex **no** lo detecta porque es deuda inventariada en baseline. | B04-J: gate por feature map a nivel mount (no renderizar), o plumbing de `service` hasta esos componentes. Test nuevo T4 (§8). |
| **F9** | INFO | `report.mjs` recalcula el JSON desde la base; `docs/torneos/b04/legacy-audit.json` (2 900 líneas) es la fuente del test 7/13. | OK, reproducible: verificado con `audit(sourcesAtRevision(base))` deepEqual. | — |

### 1.3 Observaciones sobre los guards (para el test plan)
- Cobertura real: imports relativos, reexports, `require`/`import()` literal, callee por nombre (`.rpc`, `.from`, `.auth.*`, `.storage.*`, `.channel`, `.functions.invoke`, `fetch`, `createClient`, `XMLHttpRequest`, `localStorage`). La resolución del dispatch dinámico es específica del patrón `const { [status]: rpc } = { ... }` de `changeTournamentMatchPlan`.
- No cubre: imports por alias de bundler (no hay), aliases de método extraídos (`const r = client.rpc; r('x')`), `eval`. Aceptable para este repo.
- El guard de crecimiento es **por archivo alcanzable desde `src/features/torneos/`**: agregar un archivo nuevo con backend calls alcanzable desde Torneos falla (`baseline.reachableCallSignatures[file] === undefined`). Quitar una llamada legacy también falla (conservador; hay que regenerar con revisión explícita — Codex lo documenta).

---

## 2. Reconciliación 160 / 162

Ambos conteos son **exactos**; miden cosas distintas y coinciden por casualidad aritmética.

| Métrica | Valor | Derivación (verificada contra `legacy-audit.json` y contra mi grep independiente) |
| --- | --- | --- |
| Call sites sintácticos `.rpc(` bajo `src/features/torneos` (no-test) | **160** | grep: `tournamentWorkspaceService.js` 150 + `tournamentBrandingService.js` 3 + `tournamentTeamPhotoService.js` 3 + `tournamentPlayerPortraitService.js` 2 + `publicTournamentService.js` 2. Idéntico al JSON de Codex (160 `kind:'rpc'`). Cero `.rpc(` de torneos fuera de ese árbol. |
| … de los cuales literales | **159** | 4 de los 5 "no literales" del grep son multilínea (literal en la línea siguiente). |
| … de los cuales dinámicos | **1** | `tournamentWorkspaceService.js:1233` `changeTournamentMatchPlan` → `supabase.rpc(rpc, …)`. |
| Alternativas del dinámico | **3** | `postpone_tournament_match`, `cancel_tournament_match`, `restore_tournament_match_unscheduled`. |
| Filas expandidas | **162** | 159 + 3. |
| RPC names únicos | **160** | 162 − 2 duplicados: `set_tournament_branding_reference` (branding `:71` upload y `:105` remove) y `get_effective_tournament_entitlements` (workspace `:247` y `:1960` media admin). |
| Migrables (allowlist ∩ names) | **34** | 34 nombres = 34 filas = 34 sitios (sin duplicados ni dinámicos entre ellos). |
| Bloqueadas | **126** nombres | = 126 sitios sintácticos = **128 filas** (126 − 1 dinámico + 3 alternativas) − 2 duplicados = 126 nombres. |
| Allowlisted sin caller | **9** | `can_read_tournament_team_entry`, `has_organization_consumed_free_tournament`, `has_tournament_capability`, `has_tournament_organization_capability`, `has_tournament_season_access`, `has_tournament_season_capability`, `is_tournament_organization_member`, `is_tournament_team_manager`, `tournament_role_capabilities`. Son predicados/helpers que la UI recibe embebidos (`organization.capabilities` en `get_tournament_workspace_context`). |
| Allowlist total | **43** | 34 + 9. Snapshot `stagingV1Scope.js` deepEqual al JSON de Phase 2D (test 2). |

Conclusión: la auditoría previa (159/1/3/162/160) y la foundation (160 sitios / 160 nombres) describen el mismo inventario. La frase de Codex "160 sitios RPC; 160 nombres distintos" es correcta pero debería explicitar que el 160 de sitios y el 160 de nombres coinciden porque `+2` (expansión del dinámico) y `−2` (nombres duplicados) se cancelan. No hace falta tocar código.

Dato adicional relevante: de las 34 migrables, **3 no tienen caller UI** (sólo función de servicio): `withdraw_tournament_team_entry`, `archive_tournament_team_entry`, `get_tournament_creation_eligibility` (esta última sólo en `torneosEntitlements.test.js`). De las 126 bloqueadas, **17 tampoco tienen caller UI** (service-only; no requieren gate).

---

## 3. Mapa de migración — las 34 RPC

Convenciones: archivo de servicio `S = src/features/torneos/api/tournamentWorkspaceService.js`; "Core" = necesita datos de Core (siempre **server-side vía contrato atestado**, nunca lectura frontend a Core); "Exchange" = requiere bearer Torneos (las 34: **sí**, el gateway no tiene camino anónimo). Endpoint futuro = `POST {GATEWAY}/torneos/rest/v1/rpc/<name>` en todos los casos (§5). Orden = secuencia recomendada de activación; Riesgo = frontend.

### 3.1 organizations / workspaces (7 + 1 compartida)

| # | RPC | Función (S:línea) | Caller UI | Inputs `p_*` | Output consumido | Core | Orden | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `get_tournament_workspace_context` | `loadTournamentWorkspaceContext` :229 | `context/TorneosWorkspaceContext.refresh` :108 (+ `features/qa/QaTournamentReviewMapPage` :94) | — | `{organizations[{id,name,slug,role,membershipStatus,joinedAt,capabilities[]}], preference{workspaceType,activeOrganizationId,updatedAt}}` | no | **1** | Bajo. Primera llamada del shell; define `status:'ready'`; pasa por `createRecoverableTournamentService` (timeout 12 s). |
| 2 | `set_tournament_workspace_preference` | `setTournamentWorkspacePreference(workspaceType, organizationId)` :437 | `selectOrganization` :163, `selectPersonal` :182 (WorkspaceSwitcher / PersonalWorkspaceSwitcher) | `p_workspace_type` ∈ `personal|tournament_organization`, `p_organization_id` | `{activeOrganizationId}` (fallback al id enviado) | no | 2 | Bajo. Persiste hint en `localStorage` (`arma2:torneos:last-workspace:v2`, no autoritativo). |
| 3 | `get_my_tournament_memberships` | `loadMyTournamentMemberships({limit,offset})` :1547; `loadTournamentExperienceRelations` :1558 pagina hasta 500 | `TorneosLanding` :84-85, `MyTournamentsPage` :132 | `p_limit`, `p_offset` | `{items[], pagination{hasMore,…}}` | no | 2 | Medio. La landing puede encadenar hasta 10 requests (pageSize 50 / max 500) — latencia a través del gateway. Los items enlazan al hub (`/torneos/torneo/:id`, **bloqueado**). |
| 4 | `create_tournament_organization` | `createTournamentOrganization({name,slug,idempotencyKey})` :412 | `TorneosWorkspaceContext.createOrganization` :194 ← `CreateOrganizationPage` | `p_name`, `p_slug`, `p_idempotency_key` | `{organization, membership{role,status,joinedAt,capabilities}, preference}` | no | 3 | Medio. Idempotencia por uuid v4 del cliente; `TORNEOS_CREATION_RATE_LIMITED`, `SLUG_TAKEN`. |
| 5 | `is_tournament_organization_slug_available` | `checkTournamentOrganizationSlugAvailability(slug)` :455 | `CreateOrganizationPage` :51 | `p_slug` | boolean | no | 3 | Bajo. Llamada al tipear → conviene debounce/abort en el adapter. |
| 6 | `update_tournament_organization` | `updateTournamentOrganization({organizationId,name,slug,status})` :471 | `TorneosWorkspaceContext.updateOrganization` :222 ← `OrganizationSettingsPage` :50, :68 | `p_organization_id`, `p_name`, `p_slug`, `p_status` | organization `{id,status,…}` | no | 4 | Medio. `status='archived'` resetea preferencia a personal; `TORNEOS_ARCHIVE_FORBIDDEN`, `ACTIVE_OWNER_REQUIRED`. |
| 7 | `set_active_tournament_context` | `setActiveTournamentContext({organizationId,seasonId,tournamentId})` :766 | `TorneosCompetitionContext.selectContext` :201 ← `CompetitionSelector` | `p_organization_id`, `p_season_id`, `p_tournament_id` | no consumido | no | 5 | Bajo. UI optimista con rollback en error. |
| 8 | `get_tournament_competition_context` (feature `tournaments`) | `loadTournamentCompetitionContext(organizationId)` :501 | `TorneosCompetitionContext.refresh` :129; `OrganizationMembersPage` :76, :97 | `p_organization_id` | `{seasons[], tournaments[{id,seasonId,status,categories[],…}], modalities[], formats[], preference{activeSeasonId,activeTournamentId,updatedAt}}` | no | 4 | **ALTO (composición).** El legacy encadena `loadTournamentBrandingContext` (`get_tournament_branding_context`, **bloqueada**) y decora `logoPath`/`organizationLogoPath`. El adapter v1 debe devolver el payload RPC crudo con `logoPath: null`. |

### 3.2 collaborators (3)

| # | RPC | Función | Caller UI | Inputs | Output | Core | Orden | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 9 | `list_tournament_season_member_assignments` | `listTournamentSeasonMemberAssignments` :326 | `OrganizationMembersPage` :132, :183 | `p_organization_id`, `p_season_id` | `[{membershipId,…}]` | no | 6 | **ALTO (página).** Vive en `Promise.all` con `loadSeasonEntitlements` (**bloqueada**) y la página carga antes `listMembers` (**tabla** `tournament_organization_members`, no RPC). Sin decisión R4 sobre Data API, la pantalla no puede renderizar. |
| 10 | `assign_tournament_season_member` | `assignTournamentSeasonMember` :333 | `OrganizationMembersPage.toggleAssignment` :176 | + `p_membership_id` | no consumido (recarga) | no | 6 | Medio. `TORNEOS_SEASON_COLLABORATOR_LIMIT_REACHED` (límite viene de entitlements, hoy `—`). |
| 11 | `remove_tournament_season_member_assignment` | `removeTournamentSeasonMemberAssignment` :341 | :170 | idem | idem | no | 6 | Bajo. |

### 3.3 seasons (2)

| # | RPC | Función | Caller UI | Inputs | Output | Core | Orden | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12 | `create_tournament_season` | `createTournamentSeason` :533 | `TorneosCompetitionContext.createSeason` :218 ← `SeasonFormPage` | `p_organization_id`, `p_name`, `p_slug`, `p_start_date`, `p_end_date`, `p_idempotency_key` | season `{id,…}` | no | 5 | Bajo. Post-create con `?intent=premium` navega a `seasonPlan` (**bloqueado**). |
| 13 | `update_tournament_season` | `updateTournamentSeason` :557 | :227 ← `SeasonFormPage` | + `p_season_id`, `p_status`, `p_clear_start_date`, `p_clear_end_date` | season | no | 5 | Bajo. `INVALID_SEASON_TRANSITION`, `SEASON_HAS_TOURNAMENTS`. |

### 3.4 tournaments (4 + #8 + 1 sin caller)

| # | RPC | Función | Caller UI | Inputs | Output | Core | Orden | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 14 | `create_tournament_with_defaults` | `createTournamentCompetition` :585 | `TorneosCompetitionContext.createTournament` :232 ← `TournamentWizardPage` | `p_organization_id`, `p_season_id`, `p_name`, `p_slug`, `p_description`, `p_sport_modality`, `p_competition_format`, `p_gender_category`, `p_start_date`, `p_end_date`, `p_idempotency_key` | tournament | no | 7 | Medio. Ejercitada por el fixture 2D (200 vía gateway). |
| 15 | `update_tournament_configuration` | `updateTournamentCompetition` :620 | `updateTournament` :241 ← wizard `patchForStep` :359 | `p_organization_id`, `p_tournament_id`, `p_patch` (jsonb) | tournament | no | 7 | Medio. Allowlist de campos server-side (`TORNEOS_INVALID_PATCH`); límite de body del gateway (lab 16 KB). |
| 16 | `save_tournament_category` | `saveTournamentCategory` :640 | `saveCategory` :246 ← wizard paso 4 | 13 params (`p_category_id` null = crear) | category | no | 7 | Bajo. |
| 17 | `change_tournament_status` | `changeTournamentCompetitionStatus` :677 | `changeTournamentStatus` :251 ← wizard :572 | `p_status` | tournament | no | 7 | **Medio.** `TOURNAMENT_STATUS_TRANSITIONS` sólo permite `draft↔registration` y `→archived`. `active`/finish/reopen son RPC distintas y **bloqueadas** (`start_/finish_/reopen_tournament_competition` en `CompetitionLifecycleActions`). El adapter no debe aceptar `p_status` fuera de ese set. |
| 18 | `get_tournament_creation_eligibility` | `loadTournamentCreationEligibility` :263 | **ninguno** (sólo `src/__tests__/torneosEntitlements.test.js`) | `p_organization_id` | — | no | n/a | No migrar hasta que exista UI. |

### 3.5 team registration / basic roster (12 + 2 sin caller)

| # | RPC | Función | Caller UI | Inputs | Output | Core | Orden | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19 | `get_tournament_teams_context` | `loadTournamentTeamsContext(orgId, tournamentId)` :781 | `TeamsPage` :81, `TorneosDashboard` :133 | `p_organization_id`, `p_tournament_id` | contexto de equipos (teams, categories, summary) | no | 8 | Bajo. |
| 20 | `get_team_registration_context` | `loadTeamRegistrationContext(orgId, teamEntryId)` :800 | `TeamRegistrationPage` :143; **`OrganizationRouteGuard` :48** (acceso relacional capitán/delegado) | `p_organization_id`, `p_team_entry_id` | `{entry{name,shortName,primaryColor,secondaryColor,shieldPath}, roster{players[]}, settings, managers[{isCurrentUser,role}], tournament{name}}` | no | 8 | **Medio.** El guard la usa como **oráculo de autorización** (error → estado `forbidden`). La semántica 401 vs 403 del gateway importa. |
| 21 | `create_tournament_team_entry` | `createTournamentTeamEntry(input)` :814 | `NewTeamEntryPage` :81 | `p_organization_id`, `p_tournament_id`, `p_category_id`, `p_arma2_team_id`, `p_name`, `p_short_name`, `p_primary_color`, `p_secondary_color`, `p_registration_source`, `p_manager_user_id`, `p_manager_email`, `p_manager_display_name`, `p_idempotency_key` | `{entryId}` | **sí si `p_arma2_team_id`** (contrato `team_snapshot`, server-side; manual/provisional no) | 9 (manual) / 11 (import) | Medio. |
| 22 | `update_tournament_team_entry` | `updateTournamentTeamEntry` :832 | `TeamRegistrationPage` :399 | `p_organization_id`, `p_team_entry_id`, `p_patch` | entry | no | 8 | Bajo. `TORNEOS_ENTRY_NOT_EDITABLE`. |
| 23 | `submit_tournament_team_entry` | `submitTournamentTeamEntry` :884 | :567 | `p_organization_id`, `p_team_entry_id` | entry | no | 9 | Medio. `ROSTER_INCOMPLETE`, `MANAGER_REQUIRED`. |
| 24 | `withdraw_tournament_team_entry` | `withdrawTournamentTeamEntry` :901 | **ninguno** | `+p_reason` | — | no | n/a | No migrar. |
| 25 | `archive_tournament_team_entry` | `archiveTournamentTeamEntry` :909 | **ninguno** | `+p_reason` | — | no | n/a | No migrar. |
| 26 | `add_tournament_roster_player` | `addTournamentRosterPlayer` :848 | `TeamRegistrationPage` :264, :280 | `p_organization_id`, `p_team_entry_id`, `p_roster_id`, `p_arma2_user_id`, `p_provisional_player_id`, `p_display_name`, `p_avatar_url`, `p_shirt_number`, `p_primary_position`, `p_secondary_position`, `p_is_goalkeeper` | roster player | no (el `arma2_user_id` viene de `search_tournament_players`) | 8 | Medio. `DUPLICATE_PLAYER`, `DUPLICATE_SHIRT_NUMBER`, `ROSTER_MAXIMUM_REACHED`. `p_avatar_url` es URL Core del directorio — no debe resolverse contra storage Torneos. |
| 27 | `update_tournament_roster_player` | `updateTournamentRosterPlayer` :864 | :289 | `p_roster_player_id` + dorsal/posiciones | roster player | no | 8 | Bajo. |
| 28 | `remove_tournament_roster_player` | `removeTournamentRosterPlayer` :876 | :532 | `p_organization_id`, `p_team_entry_id`, `p_roster_player_id` | — | no | 8 | Bajo. |
| 29 | `create_tournament_provisional_player` | `createTournamentProvisionalPlayer` :840 | :275 | `p_organization_id`, `p_team_entry_id`, `p_display_name` | `{id}` → luego `add_tournament_roster_player` | no | 8 | Bajo. |
| 30 | `search_tournament_players` | `searchTournamentPlayers` :941 | `TeamRegistrationPage` :500 → `PlayerAutocomplete` | `p_organization_id`, `p_tournament_id`, `p_query`, `p_limit` (8), `p_team_entry_id` | `[{arma2UserId?, displayName, avatarUrl?…}]` | **sí** (contrato `directory_players`, server-side) | 10 | **Alto.** Búsqueda al tipear → 429 `TORNEOS_SEARCH_RATE_LIMITED`, `CORE_UNAVAILABLE`; el adapter necesita debounce + `AbortSignal`. |

### 3.6 invitations (2)

| # | RPC | Función | Caller UI | Inputs | Output | Core | Orden | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 31 | `invite_tournament_team_manager` | `inviteTournamentTeamManager` :925 | `NewTeamEntryPage` :95 | `p_organization_id`, `p_team_entry_id`, `p_email`, `p_display_name`, `p_role` (`captain`) | `{token, expiresAt}` → la UI arma `${window.location.origin}/torneos/invitacion/equipo/${token}` | no | 9 | Medio. El origin del link es el de la app (debe ser el de staging). `INVITATION_RATE_LIMITED`. |
| 32 | `accept_tournament_team_invitation` | `acceptTournamentTeamInvitation(token)` :935 | `TeamInvitationPage` :15 (`/torneos/invitacion/equipo/:token`) | `p_token` | `{organizationId, teamEntryId}` → navega a `organizationTeamEntry` | **sí** (contrato `verified_email`, server-side) | 10 | **Alto.** Deep link → login Core → exchange → accept. `INVITATION_INVALID/EXPIRED`. Certificado E2E en lab 3A, pendiente en staging. |

### 3.7 core_team_import (1)

| # | RPC | Función | Caller UI | Inputs | Output | Core | Orden | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 33 | `search_tournament_arma2_teams` | `searchTournamentArma2Teams` :951 | `NewTeamEntryPage` :57 | `p_organization_id`, `p_tournament_id`, `p_query`, `p_limit` (8) | `[{id, name, …}]` → `p_arma2_team_id` en #21 | **sí** (contrato `directory_teams`) | 11 | **Alto.** Mismo perfil que #30. El recorrido completo (búsqueda + snapshot) exige el contrato Core real de staging (Phase 3A fue lab local). |

### 3.8 team_entry_review (1)

| # | RPC | Función | Caller UI | Inputs | Output | Core | Orden | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 34 | `review_tournament_team_entry` | `reviewTournamentTeamEntry` :891 | `TeamRegistrationPage` :595 (tab Revisión, `canReview`) | `p_organization_id`, `p_team_entry_id`, `p_decision`, `p_reason`, `p_issues[]` | entry | no | 12 | Medio. Certificada en 2D (regla de temporada R3-2D). |

### 3.9 Dependencias Core / Torneos por flujo (resumen)

| Flujo | RPC Torneos | Core vía contrato server-side | Core en frontend | No-RPC (tabla / storage / edge) |
| --- | --- | --- | --- | --- |
| organizations/workspaces | 7 | — | sesión Core (bearer para exchange); `GlobalHeader` en shell | `localStorage` hint (no backend); logos vía `BrandingImage` → `storage.getPublicUrl` **compone URL contra `REACT_APP_SUPABASE_URL` (Core)** sin red |
| collaborators | 3 | — | — | **`from('tournament_organization_members')`** (Data API, pendiente R4); entitlements bloqueada |
| seasons | 2 | — | — | link a plan (bloqueado) |
| tournaments | 5 (+ composición branding bloqueada) | — | — | public page settings, visual policy, logo upload (bloqueados; bypass F8) |
| team registration/roster | 12 | `search_tournament_players` → `directory_players` | — | portraits/foto/escudo (bloqueados; bypass F8) |
| invitations | 2 | `accept_…` → `verified_email` | deep link requiere login Core previo | — |
| Core team import | 1 (+ #21 con `p_arma2_team_id`) | `directory_teams`, `team_snapshot` | — | — |
| team entry review | 1 | — | — | — |

---

## 4. Mapa de las 126 bloqueadas → pantallas / UI

Tratamientos: **OCULTAR** (no montar ruta ni nav), **GATE** (feature map, render alternativo "no disponible en staging-v1"), **READ-ONLY** (se muestra sin acción), **BLOQUEA NAV** (sin gate rompe la navegación básica del flujo permitido).

### 4.1 Pantallas enteras fuera de staging-v1 (ocultar ruta + entrada de sidebar)

| Pantalla / ruta | RPC bloqueadas (count) | Tratamiento | Nota |
| --- | --- | --- | --- |
| `FixtureWorkspacePage` (`torneo/:id/fixture/**`, `programacion`) + `context/TorneosFixtureContext` | 24 (fixture 14, sedes/canchas 2, schedule 8 incl. las 3 del dinámico) | OCULTAR nav "Fixture"; ruta → página "no disponible". | El índice canónico `torneo/:id` redirige a `fixture` (`CanonicalIndexRedirect to="fixture"`, Shell :436) → **BLOQUEA NAV**: hay que redirigir a `configuracion` o `equipos` en la composición v1. |
| `MatchOperationsPage` (`partidos/**`) | 16 | OCULTAR nav "Partidos". | — |
| `CompetitionCenterPage` (`competencia/**`) | 5 | OCULTAR nav "Competencia". | `tournamentSectionRoute` cae en `tournamentTable` para paths desconocidos — revisar en composición. |
| `MediaAdminPage` + `MediaUploadQueue` + `ParticipantMediaGallery` (`multimedia`, hub fotos) | 11 + 2 + `request/cancel_tournament_media_upload_session` | Ya gateado por `torneosFeatureFlags.mediaEnabled` → mantener `false`. | Storage + Edge signer fuera del contrato gateway. |
| `SocialStudioPage` (`estudio-social`) | 3 (+ `set_tournament_social_permission` sin caller) | Ya gateado por `socialContentGenerator` → `false`. | — |
| `CommunicationsAdminPage` (`comunicaciones`) | 9 (+ `set_tournament_announcement_audience` sin caller) | OCULTAR nav "Comunicaciones". | — |
| `MyCommunicationsPage` (`/torneos/comunicados`) | 3 | OCULTAR ruta. | — |
| `TournamentHubPage` (`/torneos/torneo/:id/**`, hub participante) + `TournamentCommunicationsPanel` | 9 + 7 | OCULTAR rutas del hub. | `MyTournamentsPage` (permitida) enlaza acá → READ-ONLY: lista sin links o link a "no disponible". |
| `MyTournamentMatchesPage` + `CaptainMatchSquadPage` (`mis-partidos/**`) | 3 + 3 | OCULTAR rutas. | `record_manual_match_availability` sin caller. |
| `OrganizationVenuesPage` (`sedes/**`) | 2 RPC + 2 **tablas** (`tournament_venues`, `tournament_courts`) | OCULTAR (relatedPath de "Fixture"). | `update_tournament_venue/court` sin caller. |
| `PlanExperiencePage` / `PurchaseStatusPage` (`temporada/:id/plan/**`, `torneo/:id/plan/**`, `configuracion/plan`) | `get_tournament_purchase`, `cancel_tournament_purchase` (sin caller) + **Edge Functions** `tournament-checkout`, `tournament-fake-payment` + `get_effective_tournament_*_entitlements` | OCULTAR rutas; quitar links `seasonPlan`/`tournamentPlan` (`CompetitionOverviewPage` :69, :96; `SeasonFormPage` :116; `OrganizationSettingsNav`). | Edge Functions no tienen path en el contrato del gateway. |
| `PublicTournamentPage` (montada en `App.js:210`, fuera de `/torneos`) | 2 (`get_public_tournament_page`, `get_public_tournament_branding`, anon) | Ya gateada por `publicPages` → `false`. | Usa el singleton Core anon; queda fuera del híbrido. |
| `IsolatedTorneosPage` (lab 1.5) | tabla `sso_probe` | Sin cambio: gate loopback `isolatedSsoEnabled`. | No reutilizar. |

### 4.2 Sub-features bloqueadas **dentro de pantallas permitidas** (requieren GATE; son las que más importan)

| Pantalla permitida | Sub-feature | RPC / superficie bloqueada | Tratamiento | ¿Bloquea nav? |
| --- | --- | --- | --- | --- |
| `TorneosDashboard` (`inicio`) | `CompetitionLifecycleActions` (Iniciar / Finalizar / Reabrir) | `start_/finish_/reopen_tournament_competition` | GATE: no montar. | No. |
| `TorneosDashboard`, `TeamsPage`, `CompetitionOverviewPage`, `CompetitionSelector` | badge de plan / entitlements | `get_effective_tournament_season_entitlements`, `get_effective_tournament_entitlements` (`TorneosCompetitionContext` :~306-330) | READ-ONLY fail-closed: el adapter **no** expone `loadSeasonEntitlements`/`loadEntitlements` → el provider ya cae a `FAIL_CLOSED_ENTITLEMENTS` (plan FREE, todo `false`) **sin llamar backend** (duck-typing `typeof service?.loadSeasonEntitlements === 'function'`). | No. |
| `TorneosCompetitionContext.refresh` (todas las pantallas de org) | branding de contexto | `get_tournament_branding_context` (composición dentro de `loadTournamentCompetitionContext`) | Adapter devuelve RPC cruda; `logoPath: null`. | **Sí si no se separa**: hoy un error de branding tira todo el contexto. |
| `TournamentWizardPage` (existente) | Página pública | `get_/set_tournament_public_page_published`, `get_tournament_public_page_settings` (`TournamentPublicPageSettings`, **bypass F8**) | GATE: no montar (`!isNew && feature.publicPages`). | No. |
| `TournamentWizardPage` (existente) | Autogestión visual | `get_/set_tournament_team_visual_policy` (`TeamVisualPolicySettings`, **bypass F8**) | GATE: no montar. | No. |
| `TournamentWizardPage` paso 0, `OrganizationSettingsPage`, `TeamRegistrationPage` | Logo / escudo (`BrandingAssetField`) | `storage.from().upload/remove` + `set_tournament_branding_reference` | GATE: campo deshabilitado / oculto. `BrandingImage` READ-ONLY con fallback (iniciales) — su URL se compone contra Core storage. | No. |
| `TeamRegistrationPage` (todas las tabs) | Retratos de jugadores | `list_tournament_player_portrait_refs` (`loadRosterPortraits`, mount, **bypass F8**) + `set_tournament_player_portrait_crop` (`PlayerPortraitActions`) + Edge portrait | GATE: no invocar en mount; `RosterPlayerPortrait` con iniciales. | No (falla silenciosa hoy, pero emite tráfico a Core). |
| `TeamRegistrationPage` (Información, Identidad visual) | Foto del equipo | `get_tournament_team_photo_state` (mount, **bypass F8**), `revoke_tournament_team_photo`, `set_tournament_team_photo_editorial_status` (`TeamPhotoPanel`) + Edge | GATE: ocultar tab "Identidad visual" y `TeamPhotoBanner`. | No. |
| `TeamsPage` | Retirar equipo de la competencia (`TeamWithdrawalDialog`) | `withdraw_tournament_competition_participant` | GATE: no montar botón/diálogo. | No. |
| `OrganizationMembersPage` (`miembros`) | Lista de miembros | **tabla** `tournament_organization_members` (`listMembers`) | **Pendiente R4** (Data API vía gateway). Sin eso: GATE de página entera. | **Sí** para el flujo collaborators. |
| `OrganizationMembersPage` | Límite de colaboradores | `get_effective_tournament_season_entitlements` en `Promise.all` | Adapter debe devolver `null`/fail-closed sin red, o la página tolerar `loadSeasonEntitlements` ausente. | Sí (hoy el `Promise.all` rechaza). |
| `TorneosLanding`, `MyTournamentsPage` | Links al hub participante | rutas `/torneos/torneo/:id/**` (bloqueadas) | READ-ONLY: lista sin navegación o destino "no disponible". | No. |
| `TorneosShell` sidebar | "Fixture", "Partidos", "Competencia", "Comunicaciones" (+ Multimedia/Estudio Social ya por flag) | — | Filtrar `organizationNavigation` por feature map. | No. |
| `TorneosShell` `torneo/:id` index | `CanonicalIndexRedirect to="fixture"` | — | Redirigir a `configuracion` o `equipos`. | **Sí.** |

### 4.3 Bloqueadas sin caller UI (17 — no requieren gate)
`cancel_tournament_purchase`, `create_tournament_disciplinary_override`, `create_tournament_points_adjustment`, `revoke_tournament_points_adjustment`, `get_player_tournament_statistics`, `get_player_tournament_suspensions`, `get_tournament_season_media_usage`, `lock_tournament_roster`, `mark_tournament_suspension_served`, `record_manual_match_availability`, `save_tournament_match_operation_draft`, `set_tournament_announcement_audience`, `set_tournament_social_permission`, `update_tournament_court`, `update_tournament_venue`, `update_tournament_media_gallery`, `void_tournament_match_operation`.

### 4.4 Superficies no-RPC legacy (inventario completo, 32 llamadas)
`storage`: branding upload/remove/getPublicUrl (3). `from` tabla: `tournament_organization_members`, `tournament_venues`, `tournament_courts`, `sso_probe` (lab) (4). `auth.getSession`: media upload client, portrait service, team photo service (3, para Edge Functions con bearer Core). `transport` fetch/XHR: Edge media/portrait/photo, social `loadBitmap`, lab (8). `functions.invoke`: checkout, fake payment (2). `persistence`: workspace hint, `MobileAppCallout`, `premiumIntent` (7, sin backend). Ninguna está en el contrato del gateway salvo, potencialmente, las tablas (pendiente R4).

---

## 5. Plan de transporte post-R4 — interfaz que B04 esperará

### 5.1 CONFIRMADO por contratos actuales (lab Phase 1.5/3A/2D en `2058da03`)
Fuentes: `integration/torneos-core-contracts/gateway.mjs`, `integration/torneos-sso/token.mjs` (montado verbatim), `adapter.mjs`, `core-client.mjs`, `backend/torneos/phase2d/REPORT.md` §9, `phase2d/staging-v1-rpc-allowlist.json`. Todo esto es **lab loopback**; describe la *forma* del contrato, no los valores de staging.

| Aspecto | Contrato |
| --- | --- |
| Exchange | `POST {GATEWAY}/exchange`, `Authorization: Bearer <access_token Core>`, body vacío o `{}` (otro body → 400). 200 `{access_token, token_type:'Bearer', expires_in}` (lab 120). Verifica el token contra GoTrue `/user` + sesión activa en `auth.sessions` + `aud/role='authenticated'` + no anónimo. |
| Bearer Torneos | JWT RS256 opaco para el frontend. Claims: `sub` = identity id Torneos (≠ user id Core), `core_user_id`, `session_id` (sesión Core), `role:'authenticated'`, `jti`, `iat=nbf`, `exp−iat=TTL`. **No decodificar ni confiar client-side**; sólo cachear por `(coreToken → token, until)`. |
| Renovación | **No hay refresh endpoint.** Renovar = nuevo `/exchange` con el Core token vigente. Cambio de Core token (refresh GoTrue) ⇒ nuevo exchange (patrón `isolated/createTorneosClient.js`: cache keyed por `coreToken`, margen 20 s, dedupe de exchange en vuelo, `generation` para descartar respuestas tardías). |
| RPC | `POST {GATEWAY}/torneos/rest/v1/rpc/<name>` (también GET), `Authorization: Bearer <torneos>`, body JSON = params PostgREST (`p_*`). Headers reenviados: `accept`, `content-type`, `prefer`, `range`. Respuesta = **passthrough** de PostgREST (status + body, incl. error JSON `{message, code, details, hint}` y `content-range`). |
| Orden de chequeos | bearer inválido/ausente → **401** `{error:'access denied'}` · nombre fuera de allowlist → **403** `{error:'rpc not enabled'}` (antes de la sesión) · sesión Core inactiva (logout) → **401** · identidad no coincide → **401** · GoTrue/DB Core caídos → **503** `{error:'access denied'}`. |
| 4 RPC con contrato Core | `accept_tournament_team_invitation` (verified_email), `search_tournament_players` (directory_players), `search_tournament_arma2_teams` (directory_teams), `create_tournament_team_entry` con `p_arma2_team_id` (team_snapshot). Errores del adapter **antes** del proxy: 400 `{error:'invalid json'}` / `INVALID_REQUEST`; 403 `{error:'TORNEOS_*'}` (p.ej. `TORNEOS_RESOURCE_FORBIDDEN`); 400 para SQLSTATE 22023; **429 `TORNEOS_SEARCH_RATE_LIMITED`**; **503 `TORNEOS_UNAVAILABLE`** (fallo SQL del adapter); **503 `CORE_UNAVAILABLE`**; `CORE_DENIED` con el status (<500) que devolvió Core. |
| Tablas | `{GATEWAY}/torneos/rest/v1/<table>` GET/HEAD/POST/PATCH/DELETE, proxied con el bearer → RLS. (Lab: "tabla vía proxy → 200 RLS, sin cambio".) |
| Logout / revocación | Logout Core → sesión inactiva → 401 en RPC allowlisted, 403 en no-allowlisted. Sin endpoint de logout Torneos: el bearer muere con la sesión Core (chequeo online por request) y por TTL. |
| Límites | body ≤ 16 KB; timeout upstream 5 s; request/headers timeout 10 s; `cache-control: no-store`; `redirect:'error'`. `Origin` debe coincidir con el origin del gateway (lab: uno solo). |
| Salud | `GET /health` → 200/503 `{ready}`. `GET /config` es del lab: **no** depender. |
| Frontend existente | `unwrapRpc`/`toWorkspaceError` (S :171-195) buscan `TORNEOS_*` en `error.message|details|hint|code` de la forma supabase-js. `TorneosBoundaryError(code)` de la foundation. `createRecoverableTournamentService` aplica timeout 12 s por método. |

### 5.2 PENDIENTE de R4 (no inventar)
- URL base real del gateway (`REACT_APP_TORNEOS_GATEWAY_URL`) y si existe `REACT_APP_TORNEOS_API_URL` separada (Data API) o todo cuelga del gateway.
- Si el gateway de staging **expone rutas de tabla** y para cuáles (`tournament_organization_members` decide el flujo collaborators).
- Issuer/audience/kid/JWKS y **TTL** del bearer (lab 120 s; `isolated/createTorneosClient.js` asserta `expires_in !== 120` → esa aserción **no** debe copiarse).
- Issuer Core aceptado por `/exchange` (lab: `${origin}/auth/v1`; staging: `https://<ref>.supabase.co/auth/v1`).
- CORS: origins permitidos, preflight, headers expuestos (`content-range`), credenciales (`credentials:'omit'` en el lab).
- Forma **final** del cuerpo de error del gateway (¿se mantiene `{error: string}`?; ¿`WWW-Authenticate`?), y si el passthrough de PostgREST se conserva tal cual.
- Límites reales (body, timeouts, rate limit de `/exchange` y de búsquedas), comportamiento ante refresh de Core token en otra pestaña, `/health`.
- Edge Functions (`tournament-checkout`, media/portrait/photo signers) **no están** en el contrato → fuera de v1 salvo decisión explícita.
- Comportamiento certificado de logout multi-pestaña y de `USER_UPDATED`.

### 5.3 Interfaz frontend a definir (sin implementar)
```
createTorneosClient({
  gatewayUrl,                 // de readDualBackendConfig; https, sin credenciales, ≠ origin Core
  getCoreAccessToken,         // () => Promise<string|null>  — composición: coreSupabase.auth.getSession()
  onCoreAuthChange,           // (cb) => unsubscribe          — composición: coreSupabase.auth.onAuthStateChange
  fetchImpl = fetch, now = Date.now,
})
  .execute(operation, params = {}, { signal } = {}) → Promise<data>
  .clear()   // descarta bearer cacheado (logout, cambio de usuario, 401)
  .dispose()

Errores (TorneosBoundaryError.code, con { status, cause }):
  TORNEOS_OUTSIDE_STAGING_V1        client-side, antes de red (ya existe)
  TORNEOS_TRANSPORT_NOT_CONNECTED   foundation (ya existe)
  CORE_AUTH_REQUIRED                sin sesión Core válida → no hay exchange
  TORNEOS_EXCHANGE_DENIED           /exchange 401
  CORE_UNAVAILABLE                  /exchange 503, o body.error === 'CORE_UNAVAILABLE'
  TORNEOS_UNAVAILABLE               503 genérico, red, timeout, body.error === 'TORNEOS_UNAVAILABLE'
  TORNEOS_SESSION_INVALID           RPC 401 → clear(); UN reintento con exchange fresco; si repite, surface
  TORNEOS_FORBIDDEN                 403 sin código TORNEOS_* (p.ej. 'rpc not enabled' — no debería ocurrir: scope == allowlist)
  TORNEOS_RATE_LIMITED              429
  TORNEOS_RPC_ERROR                 error PostgREST/adapter → se re-mapea a {message, code, details, hint}
                                    para que toWorkspaceError/ERROR_MESSAGES sigan funcionando sin tocar 190 códigos
Reglas: nunca reenviar a Core; nunca persistir el bearer; nunca decodificarlo; fallar cerrado ante
sesión ausente/vencida, logout, cambio de usuario, timeout y respuesta de exchange con generation vieja.
```

---

## 6. Feature gating — matriz staging-v1

Mecanismo mínimo: un mapa estático `stagingV1Features` en `foundation/` (datos puros, derivado de las 8 keys de `stagingV1Scope` + las superficies no-RPC) consumido **sólo** por la composición nueva (B04-J): filtro de `organizationNavigation`, reemplazo de rutas por `StagingV1Unavailable`, y props `feature.*` a los componentes con sub-features. Los flags existentes (`torneosFeatureFlags`) siguen mandando para media/social/public. Hoy: sólo tests estáticos (T13, §8).

| Feature | staging-v1 | Motivo | UI behavior |
| --- | --- | --- | --- |
| organizations_workspaces | **ON** | 11 ops allowlisted | Landing, crear org, switcher, settings (nombre/slug/archivar). Logo: OFF. |
| collaborators | **PARCIAL / pendiente R4** | RPC OK; `listMembers` es tabla; entitlements bloqueada | Si R4 no expone la tabla → página entera "no disponible". Si la expone → assign/remove con límite `—`. |
| seasons | **ON** | 2 ops | Crear/editar; sin link a Plan. |
| tournaments (draft/registration/archived) | **ON** | 5 ops + contexto | Wizard 6 pasos; sin página pública, sin autogestión visual, sin logo; sin Iniciar/Finalizar/Reabrir. |
| team_registration_basic_roster | **ON** | 12 ops | Equipos, nueva inscripción (manual/provisional/import), tabs Información/Plantel/Revisión; tab Identidad visual OFF; retratos/foto/escudo OFF; retirar equipo OFF. |
| invitations | **ON** | 2 ops (Core verified_email server-side) | Invitar responsable; aceptar por deep link tras login Core. |
| core_team_import | **ON (cond. R4 Core real)** | 1 op + snapshot | Búsqueda de equipos Arma2 en nueva inscripción. |
| team_entry_review | **ON** | 1 op | Tab Revisión para roles con `canReview`. |
| entitlements / plan / premium / checkout / compra | **OFF** | RPC bloqueadas + Edge Functions fuera del contrato | Fail-closed FREE sin red; rutas plan/compra ocultas; links removidos. |
| fixtures / sorteo / programación / sedes | **OFF** | 26 RPC + 2 tablas | Nav oculta; rutas → no disponible; índice de torneo → `configuracion`. |
| partidos / actas / convocatorias / mis-partidos | **OFF** | 22 RPC | Nav y rutas ocultas. |
| tabla / estadísticas / clasificación / disciplina | **OFF** | 5 RPC (+ ajustes sin caller) | Nav oculta. |
| comunicaciones (admin, inbox, panel hub) | **OFF** | 12 RPC | Nav y rutas ocultas. Flag `notifications`: sin cambio, verificar en B04-J. |
| multimedia / galerías / upload | **OFF** | ya `mediaEnabled=false` | Sin cambio. |
| estudio social | **OFF** | ya `socialContentGenerator=false` | Sin cambio. |
| páginas públicas | **OFF** | ya `publicPages=false`; anon RPC vía Core | Sin cambio. |
| hub participante (`/torneos/torneo/:id/**`) | **OFF** | 16 RPC | `mis-torneos` READ-ONLY sin links. |
| branding images (`BrandingImage`) | **READ-ONLY** | compone URL contra storage Core sin red | Fallback iniciales; no upload. |
| lab isolated (Phase 1.5) | sin cambio | gate loopback | No reutilizar. |

---

## 7. Orden de integración B04

| Etapa | Contenido | Depende de | Independiente de R4 |
| --- | --- | --- | --- |
| **B04-A clients/config** | Adoptar `REACT_APP_CORE_*` junto con `scripts/validate-build-env.mjs`, `featureFlags.js` (lee `REACT_APP_SUPABASE_URL`) y lectores directos; cablear `readDualBackendConfig` a la validación de build (F6). No cambia el singleton. | — | **Sí** (puede prepararse ya). |
| **B04-B auth bridge** | Transporte real detrás de `torneosClient` (§5.3): exchange, cache de bearer, listener de auth Core, `clear/dispose`, mapeo de errores. Construible contra el contrato del lab con dobles; **activación** sólo con valores R4. | A; R4 para activar | Código + tests con fake transport: **sí**. Activación: **no**. |
| **B04-C organizations/workspaces** | Adapter `stagingV1WorkspaceService` con la **misma interfaz de aliases** que `tournamentWorkspaceService` (`loadContext`, `setPreference`, `createOrganization`, `updateOrganization`, `checkSlugAvailability`, `loadMyTournaments`, `loadExperienceRelations`, `createIdempotencyKey`, `resolveTeamShieldUrl`/`resolveTournamentLogoUrl` → null) sobre `execute()`; **sin** métodos bloqueados (el duck-typing del provider hace el resto). Composición `StagingV1TorneosApp` → `TorneosWorkspaceProvider service={adapter}` (nunca el default ni `TorneosApp`). | B | Adapter + tests: **sí**. |
| **B04-D seasons** | `createSeason`, `updateSeason`; `loadCompetitionContext` **sin** branding. | C | Sí. |
| **B04-E tournaments** | `createTournament`, `updateTournament`, `saveCategory`, `changeTournamentStatus` (validar `p_status` ∈ set permitido), `setTournamentContext`; **primer edit legacy**: `TournamentWizardPage` deja de montar public/visual settings bajo feature map (o recibe `service`). | D, J parcial | Sí. |
| **B04-F teams/roster** | 12 ops; `TeamRegistrationPage` gate de portraits/foto/escudo en mount (F8); `TeamsPage` sin withdrawal; `OrganizationRouteGuard` acceso relacional. | E, J parcial | Sí. |
| **B04-G invitations** | `inviteTeamManager`, `acceptTeamInvitation`; ruta `/torneos/invitacion/equipo/:token` con login-first. | F; **R4** (verified_email real) | Adapter: sí. E2E: no. |
| **B04-H Core team import** | `searchArma2Teams` + `createTeamEntry` con `p_arma2_team_id`. | F; **R4** (directory/snapshot real) | Adapter: sí. E2E: no. |
| **B04-I team review** | `reviewTeamEntry`. | F | Sí. |
| **B04-J blocked feature gates** | Feature map estático + `StagingV1Unavailable` + filtro sidebar + índice de torneo + collaborators (decisión R4 tabla) + links plan/hub. | C; **R4** para collaborators | Mayoría: sí. |
| **B04-K full regression** | `test:ci` verde (requiere resolver F2 en la cadena), Jest torneos con adapter fake, contract tests offline vs fixtures grabadas del lab, luego E2E staging **sólo** con autorización R4/R5. | todo; **R4/R5** | Offline: sí. Staging: no. |

Ruta crítica: A → B(código) → C → D → E → F → I → J son ejecutables **antes** de R4 PASS con un transporte doble; lo que queda gateado por R4 es la **activación** de B (valores, CORS, TTL), G/H (contratos Core reales), collaborators (Data API) y toda ejecución contra staging (K).

---

## 8. Test plan — tests a implementar (todos offline; ninguno contra staging)

| ID | Detecta | Mecanismo | Dónde |
| --- | --- | --- | --- |
| T1 | **Segundo login** | AST: ningún `createClient(`, `.auth.signIn*`, `setSession`, `persistSession` fuera de `lib/supabaseClient.js` e `isolated/` (allowlist de 2 archivos). Runtime: sandbox vm con `createClient` stub → `creations.length === 1` al cargar la composición staging-v1 completa. | extiende `foundation.test.mjs` (hoy sólo valida foundation aislada). |
| T2 | **Fallback a Core** | Adapter con transporte fake que lanza `TORNEOS_UNAVAILABLE`/`401`: afirmar que el stub del singleton Core registra **0** llamadas `rpc/from/storage/functions` durante el flujo. Además: el adapter no debe tener propiedad alguna que apunte al singleton (`Object.values(adapter)` ≠ funciones del legacy). | nuevo `scripts/torneos-frontend/adapter.test.mjs`. |
| T3 | **RPC fuera de allowlist** | Ya cubierto (test 4). Sumar: cada alias del adapter mapea a un nombre ∈ `stagingV1Scope`; y **nombres derivados en runtime** (p.ej. `p_status` → `active`) rechazados antes de red. | idem. |
| T4 | **Uso accidental del singleton Core desde Torneos** (F8) | Jest: render de `TournamentWizardPage` (tournament existente), `TeamRegistrationPage`, `OrganizationSettingsPage`, `TeamsPage` bajo la composición staging-v1 con `jest.mock('../../../lib/supabaseClient')` que **falla** en cualquier acceso → 0 llamadas. Complemento estático: grep de `from '../api/tournamentWorkspaceService'` / `tournamentBrandingService` / `tournamentTeamPhotoService` / `tournamentPlayerPortraitService` en componentes montables en v1 → allowlist vacía o justificada. | `src/__tests__/torneosStagingV1Isolation.test.jsx` + guard estático. |
| T5 | **service_role** | Ya cubierto (test 9/10). Extender el escaneo a `build/` post-build (`grep` de `service_role`, JWT con role, `sb_secret_`) como paso de B04-K. | script CI. |
| T6 | **Hardcoded project refs** | Ya cubierto para líneas nuevas. Sumar: `readDualBackendConfig` rechaza `gatewayUrl` cuyo hostname sea `<ref>.supabase.co` de Core/Production (`REACT_APP_PRODUCTION_PROJECT_REF`) y cualquier host con la etiqueta del ref de Production (reusar la regla de `torneos-media-hostname-guard`). | `config.test`. |
| T7 | **Disabled feature calling backend** | Con feature map v1: render de cada ruta bloqueada → `StagingV1Unavailable` y transporte fake con contador = 0; sidebar sin las 4 entradas; índice `torneo/:id` no redirige a fixture; `OrganizationMembersPage` con `listMembers` ausente → estado "no disponible" sin `Promise.all` rechazado. | Jest. |
| T8 | **401** | Transporte fake: RPC → 401 una vez → adapter hace `clear()` + **un** exchange nuevo + reintento; segundo 401 → `TORNEOS_SESSION_INVALID` sin más red; `OrganizationRouteGuard` → `forbidden`. | adapter.test. |
| T9 | **403** | `{error:'rpc not enabled'}` → `TORNEOS_FORBIDDEN` **sin reintento ni exchange**; `{error:'TORNEOS_RESOURCE_FORBIDDEN'}` → `TournamentWorkspaceError.code === 'TORNEOS_RESOURCE_FORBIDDEN'` con el mensaje de `ERROR_MESSAGES`. | adapter.test. |
| T10 | **CORE_UNAVAILABLE** | `/exchange` 503 y body `CORE_UNAVAILABLE` en RPC → `CORE_UNAVAILABLE`, sin reintento en bucle, sin caída a Core; UI muestra estado "Core no disponible" y **no** desloguea. | adapter.test + Jest. |
| T11 | **TORNEOS_UNAVAILABLE** | 503 genérico, `fetch` reject, `AbortSignal.timeout` → `TORNEOS_UNAVAILABLE`; cache de bearer limpiado; siguiente request rehace exchange. | adapter.test. |
| T12 | **Logout / revocación** | `onAuthStateChange('SIGNED_OUT'|'SIGNED_IN'|'TOKEN_REFRESHED'|'USER_UPDATED')` → `clear()`; tras logout `execute` → `CORE_AUTH_REQUIRED` **sin red**; cambio de usuario → exchange con el nuevo token y descarte de respuestas de la `generation` anterior (respuesta tardía del usuario A no se cachea para B). Reutilizar los casos de `torneosIsolatedSso.test.js` generalizados (sin origin loopback ni `expires_in===120`). | adapter.test. |
| T13 | **Guards estáticos de gating** (sin runtime) | `stagingV1Features` keys ON == keys de `stagingV1Scope`; toda ruta del Shell aparece en el mapa (ON/OFF) — ninguna sin clasificar; `organizationNavigation` entries cubiertas. | foundation.test extensión. |
| T14 | **Contrato de transporte (fixtures)** | Respuestas grabadas del lab 3A/2D (exchange 200/401/503, rpc 200/401/403/429/503, PostgREST error JSON) como fixtures JSON → el adapter produce exactamente los códigos de §5.3. Se regraban cuando R4 publique los reales. | `scripts/torneos-frontend/transport-contract.test.mjs`. |
| T15 | **CI** | Resolver F1 (fixture de baseline en vez de SHA) y F2 (static guard) para que `test:ci` sea verde en la cadena antes de B04-K. | — |

---

## 9. Blockers que dependen de R4 / R5

| # | Blocker | Bloquea | Fuente |
| --- | --- | --- | --- |
| R4-1 | URL(s) reales del gateway staging + CORS + TTL + issuer/JWKS | B04-B activación, todo E2E | §5.2 |
| R4-2 | ¿Data API (rutas de tabla) expuesta por el gateway? → `tournament_organization_members` | collaborators (B04-J), `OrganizationMembersPage` | §3.2, §4.2 |
| R4-3 | Contratos Core **reales** en staging (verified_email, directory_players, directory_teams, team_snapshot) — Phase 3A fue lab local | B04-G, B04-H, `search_tournament_players` en F | §3.5-3.7 |
| R4-4 | Forma final de errores del gateway (401/403/503, passthrough PostgREST, `WWW-Authenticate`) | mapeo §5.3, T8-T11 | §5.2 |
| R4-5 | Límites (body 16 KB vs `p_patch`/`p_issues`; timeouts 5 s vs 12 s frontend; rate limits de exchange y búsqueda) | B04-E/F | §5.1 |
| R4-6 | Certificación de logout multi-pestaña / refresh de Core token → nuevo exchange | T12 | §5.2 |
| R4-7 | Edge Functions fuera del contrato (checkout, media/portrait/photo signers) → confirmar que quedan OFF en v1 | matriz §6 | §4 |
| R5-1 | Autorización explícita para ejecutar contra staging (hoy prohibido) | B04-K E2E, B04 PASS | mandato |
| R5-2 | Decisión sobre la cadena codex en `main` (merge no-squash o fixture de baseline) y F2 | `test:ci` verde | F1/F2 |
| — | Astra sigue certificando R4 en `plan-r2-local-f7ace5` — no tocar | — | mandato |

---

## 10. Estimación de trabajo frontend restante

Supuestos: una persona frontend; contratos R4 estables al activar; sin nuevas RPC; sin rediseño de pantallas; Docker/backend fuera de alcance.

| Etapa | Estimación | Antes de R4 PASS |
| --- | --- | --- |
| B04-A clients/config | 0,5–1 d | sí |
| B04-B auth bridge (código + T8–T12 + T14 con fixtures) | 2,5–3,5 d | código sí / activación no |
| B04-C organizations + composición staging-v1 | 1,5–2 d | sí |
| B04-D seasons + split de competition context | 0,5 d | sí |
| B04-E tournaments + gate wizard | 1–1,5 d | sí |
| B04-F teams/roster + gates F8 | 1,5–2 d | sí |
| B04-G invitations | 0,5 d (+0,5 d E2E) | adapter sí |
| B04-H Core team import | 0,5 d (+0,5 d E2E) | adapter sí |
| B04-I review | 0,25 d | sí |
| B04-J feature gates + T7/T13 + collaborators (según R4-2) | 1,5–2,5 d | mayoría sí |
| B04-K regresión (F1/F2, Jest con adapter, `test:ci`, build scan T5) | 1,5–2,5 d | offline sí |
| **Total** | **≈ 12–17 días-persona** | **≈ 9–12 d ejecutables antes de R4 PASS** |

Riesgos de la estimación: (1) si R4-2 exige reescribir collaborators sin tabla (+1–2 d); (2) si el mapeo de errores del gateway difiere del lab, T8–T11 y el mapeo se rehacen (+1 d); (3) si se decide plumbing de `service` en vez de gate por mount en wizard/registration (+1 d); (4) F2 puede requerir coordinación con Astra.

---

## Anexo — reproducibilidad de esta review
- Inventario: `node scripts/torneos-frontend/report.mjs` (regenera `legacy-audit.json` + `TORNEOS-CALL-MAP.md` desde `2058da03`); mi reconciliación fue un script independiente sobre ese JSON + grep sintáctico.
- Matriz pantalla→RPC: script de scratchpad (`screen-matrix.mjs`) que sigue `service.<alias>(` en `components/` y `context/`, resuelve alias→función→RPC (incluida la composición `loadTournamentCompetitionContext → loadTournamentBrandingContext`) y clasifica contra la allowlist; 98/126 bloqueadas atribuidas por alias, 11 por import directo, 17 sin caller UI.
- No se escribió ningún archivo dentro del worktree; no se ejecutó nada contra remoto; el worktree `plan-r2-local-f7ace5` no se tocó.
