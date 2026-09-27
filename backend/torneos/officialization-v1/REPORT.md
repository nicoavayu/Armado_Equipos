# OFFICIALIZATION-V1 — oficialización de resultados + membresía de la organización

**Veredicto: `TORNEOS_RESULT_OFFICIALIZATION_LOCAL_CERTIFIED` → STOP.**
Nada se aplicó en remoto: 0 writes en Torneos Production, Core sin tocar, Vercel sin tocar, Deno sin tocar,
sin push, sin PR. Base: `main` `5b786051` (PR #159). El QA de Production del smoke
(org `ff425559-…`, temporada `8b82d3ab-…`, torneo `f45575dc-…`) no se tocó.

## 1. Causa raíz (medida en el smoke de Production y reproducida en local)

1. `make_tournament_match_official` exige una operación `validated`.
2. `validate_tournament_match_operation` rechazaba **siempre** que quien valida sea quien presentó
   (`TORNEOS_MATCH_DUAL_CONTROL_REQUIRED`).
3. Presentar / revisar / validar / oficializar exigen owner o admin (`match_operations.*`).
4. La única ruta que inserta `tournament_organization_members` era `create_tournament_organization` (el owner).
   La matriz de capacidades ya tenía `members.invite / update_role / remove`, pero **ninguna RPC** las usaba y la
   UI decía «Invitar miembro: Próximamente».

⇒ Ninguna organización real podía oficializar un resultado; por cascada quedaban bloqueados tabla,
estadísticas, clasificación, playoffs, correcciones y el cierre del torneo.

Foundation reutilizada (no se inventó arquitectura): roles `owner/admin/collaborator` y su matriz, índice único
de un owner activo + trigger `protect_tournament_organization_owner`, asientos por temporada
(`tournament_season_member_assignments` + límite por plan), el patrón de invitación con token de un solo uso de
los equipos, y el contrato Core `verified_email` que ya usa `accept_tournament_team_invitation`
(`private.authorize_core_contract` → Core → atestación de un solo uso → la RPC la consume). No hay segundo login.

## 2. Diseño final

**Doble control = política del torneo.** `tournaments.match_result_dual_control_enabled boolean NOT NULL DEFAULT false`.

| política | quién presenta | quién valida / oficializa |
|---|---|---|
| OFF (default, incluye los torneos existentes) | owner/admin con acceso a la temporada | el mismo owner/admin puede validar su propia acta |
| ON | owner/admin con acceso a la temporada | cualquier otra identidad autorizada; **nunca** quien presentó |

- La autovalidación **no es un bypass genérico**: `validate_tournament_match_operation` conserva todos sus guards
  (identidad del bridge, organización, capacidad `match_operations.validate`, acceso a la temporada, estado
  `under_review`, validación del payload) y sólo omite la comparación submitter≠validator cuando la política del
  torneo de **esa** operación está OFF. Un torneo que no se puede leer cuenta como ON (fail-closed).
- Auditoría: se mantienen `submitted_by/at`, `validated_by/at`, `official_by/at` (ya existía `official_by`) y
  cada paso sigue siendo su propia entrada de `tournament_audit_log`; la validación registra
  `{dualControl, selfValidated}`; el cambio de política registra `tournament.match_dual_control_changed {enabled, previous}`.
- Cambiar la política: `set_tournament_match_dual_control`, capacidad nueva `match_operations.configure_dual_control`
  **sólo del owner** (como `tournaments.reopen`), con acceso a la temporada; rechazada con la competencia
  finalizada/archivada (`TORNEOS_COMPETITION_READ_ONLY`); encenderla exige ≥ 2 validadores elegibles en la
  temporada (`TORNEOS_DUAL_CONTROL_SECOND_VALIDATOR_REQUIRED`), así nunca deja un torneo sin forma de oficializar.
- `get_tournament_match_operation_context` agrega `dualControl {enabled, submittedByViewer, validatedByViewer}`
  para que la UI nunca ofrezca un botón que termina en 403.

**Membresía.**

| rol | cuántos | puede |
|---|---|---|
| OWNER | exactamente 1 (índice único + trigger, sin cambios) | todo; único que invita/asigna Administradores, cambia roles y la política de doble control; nunca se quita ni cambia de rol, ni por RPC ni por SQL |
| ADMIN | N | administra torneos, presenta/valida según la política, invita Colaboradores, quita Colaboradores; no toca al owner, no cambia roles, no quita admins |
| COLLABORATOR | N | lectura (sin ver emails de invitación), sin invitaciones |

Invitación por email: token de 32 bytes (sólo se guarda su sha256), 7 días, un pendiente por email (reinvitar
reemplaza el enlace), rate limit 10 / 10 min por actor y 50 pendientes por organización. Aceptar exige la
atestación Core `verified_email` del **email invitado** para la identidad y la sesión Core del bearer (la misma
tubería que los capitanes); un miembro quitado vuelve con el rol invitado. Quitar un miembro libera sus asientos
de temporada y el acceso termina en la siguiente llamada (todas las autorizaciones exigen membresía `active`).
Nadie cambia ni quita su propia membresía; el owner no puede quedar afuera ni haber dos owners.

## 3. Migration `00000000000005_officialization_v1.sql` (append-only; 0000–0004 byte-idénticas)

sha256 `51fe200f2124e786345a85e5dbadfc844765db550a7f8cc837adefbddf0aeb78`. Una transacción:

1. **Precondiciones** (`TORNEOS_OFFICIALIZATION_V1_PRECONDITION_FAILED`): 0004 vigente (sus 15 grants presentes,
   sus 23 funciones cerradas siguen cerradas); cada cuerpo a reemplazar es exactamente el POST_0004 certificado
   o el de esta migración (nunca un tercer estado); columna/tabla/RPCs nuevas todas presentes o todas ausentes.
2. **Esquema**: columna de política (default false), tabla `tournament_organization_invitations` (RLS on, sin
   policy, **ningún** privilegio para anon/authenticated/service_role: sólo RPC), capacidad owner-only.
3. **Cuerpos reemplazados** (derivados byte a byte del POST_0004 + la edición explícita):

| función | md5 antes | md5 después | cambio |
|---|---|---|---|
| `validate_tournament_match_operation` | `4f43a729…` | `349c89ce…` | submitter≠validator sólo con política ON; auditoría `{dualControl, selfValidated}` |
| `get_tournament_match_operation_context` | `2f43290e…` | `86186ea0…` | agrega `dualControl` |
| `private.authorize_core_contract` | `488ca6bb…` | `1ac5d513…` | rama `verified_email` para `{organization_invitation_token}`; rama de equipos idéntica |

4. **9 RPCs nuevas**, SECURITY DEFINER con `search_path=""`, EXECUTE sólo a `authenticated` + `service_role`
   (nunca anon, PUBLIC ni roles servidor): `invite_tournament_organization_member`,
   `list_tournament_organization_invitations`, `revoke_tournament_organization_invitation`,
   `accept_tournament_organization_invitation`, `list_tournament_organization_members`,
   `update_tournament_organization_member_role`, `remove_tournament_organization_member`,
   `get_tournament_match_dual_control`, `set_tournament_match_dual_control`.
5. **Postcondiciones**: ACL exacta de las 9, las 23 cerradas siguen cerradas, cuerpos pineados, authorizer
   privado, tabla sin privilegios, columna `boolean NOT NULL DEFAULT false`, capacidad sólo owner,
   `authenticated` sube exactamente las nuevas (**162 → 171**) y anon no cambia (**12**).

Re-aplicar es no-op (probado); un estado sin 0004 o con un cuerpo distinto aborta antes de cualquier cambio (probado).

**Rollback** ([`rollback/…rollback.sql`](rollback/00000000000005_officialization_v1.rollback.sql), no es migration):
restaura los tres cuerpos POST_0004 byte a byte (md5 pineados), borra las 9 RPCs (171 → 162); conserva columna,
tabla, fila de capacidad, membresías aceptadas y auditoría (inertes sin las RPCs). Orden: primero el gateway,
después la DB. Probado en transacción revertida.

Códigos de estado usan `P0001` (→ HTTP 400 en PostgREST) y no `55000` (→ 500, que el transporte del frontend
trata como «no disponible» y además limpia el bearer).

## 4. Gateway

`officialization-v1-rpc-allowlist.json` (9 RPCs, 2 features) cargado por el mismo `competition.ts` que usan el
gateway Edge (Deno) y el Node del lab, con el mismo loader fail-closed (documento malformado, nombre inválido,
duplicado, solapamiento con staging v1 / COMPETITION-V1 / ruta pública ⇒ el gateway no arranca). Sólo ruta
autenticada (bearer + sesión Core viva + identidad); la ruta pública no sirve ninguna (403 `rpc not enabled`).
`accept_tournament_organization_invitation` pasa por el adapter Core (`verified_email`), igual que la de equipos.
`competition-v1-rpc-allowlist.json` queda byte-idéntico. Bundle del gateway: 16 → 17 archivos. `no-store` en
todas las respuestas; commerce OFF sin cambios.

## 5. Frontend

- Scope `foundation/officializationV1Scope.js` (= allowlist = contract.json, guard), el cliente lo permite; feature
  map `organization_members` + `match_dual_control` ON en hybrid.
- Adapter hybrid: `listMembers` pasa de la ruta de tabla a la RPC de miembros (rol, «vos», email para quien
  gestiona), + `listMemberInvitations`, `inviteMember`, `revokeMemberInvitation`, `acceptOrganizationInvitation`,
  `updateMemberRole`, `removeMember`, `loadMatchDualControl`, `setMatchDualControl`. El servicio legacy LOCAL no
  los tiene (su DB no tiene 0005): la UI no los ofrece y no pide nada.
- **Miembros**: «Invitar miembro» real (email + rol según quién invita), enlace de un solo uso para compartir,
  pendientes con vencimiento y «Revocar», cambio de rol (sólo owner), «Quitar» (reglas del backend). Sin «Próximamente».
- **`/torneos/invitacion/organizacion/:token`**: aceptar con la cuenta del email invitado.
- **Acta / revisión**: con política OFF, «Presentar y oficializar» (en el cierre) y «Confirmar y oficializar» (en la
  revisión) recorren submit → review → validate → official leyendo el estado después de cada paso (reanuda si
  se interrumpe); con ON, se muestra «Presentada por vos / por otro miembro» y quien presentó no ve «Validar acta».
- **Configuración del torneo**: panel «Doble control de actas» (owner cambia; el resto consulta).
- Fixes baratos del smoke: el aviso «Entorno aislado» ya no aparece en Production (ni sin `DATA_ENV`; sólo
  `local`/`staging`); la página pública muestra «Fútbol 5 · Grupos y eliminatorias» en vez de `FOOTBALL_5`;
  copy obsoleta de la tabla reemplazada; «Plantel vacío Buscá…» con espacio; iniciales de nombres numerados
  («QA Equipo 1/2/3» → Q1/Q2/Q3, el resto igual); «Presentar plantel» deshabilitado (con explicación) hasta que la
  inscripción esté en curso con un responsable activo — antes siempre terminaba en 403.

## 6. Certificación LOCAL

Lab desde volúmenes vacíos (0000→0005 del árbol), Core real (GoTrue + contrato Core), gateways Node y Edge.
Evidencia en [`evidence/`](evidence/): `node/results.json`, `edge/results.json`, `regression.json`, `ui-smoke.json`.

**`officialization.test.mjs`: 39/39 checks en gateway Node y 39/39 en gateway Edge** (0 skips).

- **A — instalación / ACL / pines (7):** 0005 aplicada desde el directorio y 0000–0004 byte-idénticas; ACL exacta
  de las 9 (authenticated + service_role; anon/PUBLIC/adapter/writer no; DEFINER + `search_path`), 162→171 / 12,
  las 23 cerradas siguen cerradas, authorizer privado; tabla sin privilegios ni policies; columna default false;
  capacidad sólo owner; cuerpos pineados; re-apply no-op; sin 0004 o con un cuerpo distinto → abortada sin
  cambios; rollback en transacción revertida → 162 + md5 POST_0004; allowlist = contract.json, disjunta.
- **B — membresía (11):** owner único crea la org; invita ADMIN (token 64 hex, sólo sha256 en DB); otra cuenta
  no puede aceptar (email verificado ≠); B acepta por el contrato Core → admin activo, ve la org; el token no
  se reusa; owner invita admins y colaboradores, admin sólo colaboradores, colaborador y otra org no invitan,
  «owner» nunca asignable; revocar (idempotente, admin no revoca invitación de admin); vencida → EXPIRED y
  listada como vencida; reinvitar reemplaza el enlace (el viejo deja de servir); roles sólo por el owner, nadie
  se cambia a sí mismo, owner protegido, segundo owner imposible también en la DB; quitar: admin no quita admins
  ni al owner, nadie se quita, el owner no se puede quitar ni por SQL (trigger), quitar es idempotente y el
  quitado pierde el acceso; cross-org en lectura y gestión; escritura directa de la tabla de miembros → nada.
- **C — journey + doble control (14):** asientos (FREE = 1 por RPC, resto fixture); torneo A con 4 equipos
  (capitanes por contrato Core), fixture publicado, iniciado, 6 partidos programados, política OFF por defecto
  (4 validadores elegibles); **owner solo**: resultado 2-1 → revisión → **valida su propia acta** → oficial,
  `submitted_by = validated_by = official_by`, auditoría `{dualControl:false, selfValidated:true}`; tabla y
  estadísticas; **matriz OFF** sobre un acta pendiente (colaborador, capitán, jugador, otra org, otra temporada,
  sin bearer → rechazados; nada cambia) y admin B se autovalida; **corrección con owner solo** → superseded,official
  → tabla recalculada; **política**: admin/colaborador/otra temporada/otra org no la cambian, `null` → 400,
  idempotente, auditada, org de un solo validador no puede encenderla; **ON**: owner presenta → no valida (contexto
  lo dice) → admin B valida → oficial; B presenta → B no valida → owner valida; **matriz ON** (otra org, otra
  temporada, colaborador, capitán, jugador, sin bearer y el admin **quitado**, que además pierde lectura y sus
  asientos) → admin C valida (admin A → admin B); doble validación rechazada; doble oficialización concurrente →
  200/200 y una sola oficial (una auditoría); estados viejos (validar/oficializar un borrador o un presentado,
  revisar un oficial) rechazados; tabla correcta con oficializaciones OFF y ON mezcladas; **playoffs** agregados
  desde la liga y **clasificación** resuelta (final completa); **finalizar** (admin) con ON → política de sólo
  lectura → **reabrir** (owner) → OFF; **equipo retirado**: su partido no admite acta, el resto lo oficializa el
  owner solo.
- **D — bordes (7):** IDs aleatorios / pares cruzados → 403 sin oráculo; tokens inválidos; email/rol inválidos →
  400; sin bearer → 401 en las 9 y la ruta pública no sirve ninguna (403); **PostgREST directo**: anon negado por
  ACL en las 9, un bearer válido **sin** la atestación del gateway no puede aceptar
  (`TORNEOS_CORE_ATTESTATION_REQUIRED`), la tabla de invitaciones negada (anon, bearer y ruta de tablas del
  gateway); **Core caído** al aceptar → 503 y la invitación sigue pendiente, recupera y acepta; **logout Core** →
  exchange y RPC 401; **455/455** respuestas con `Cache-Control: no-store`; las 9 RPCs ejercitadas positivamente.
- Matriz negativa registrada: 95 filas por gateway (más los rechazos del journey).

**Regresión (mismo lab, fresco, secuencial):** COMPETITION-V1 37/37 Node y Edge · Phase 3A E2E 41/41 Node y
Edge · ACL (Phase 2C) 17/17 · exposure (Phase 2D) 19/19 Node y Edge · equivalencia Node≡Edge 8/8 · D1 sesión
6/6. Desplazamientos, todos por el delta de 0005 y nada más: conteos del catálogo (+9 funciones DEFINER, +1
tabla, 162→171), listas de migraciones, y COMPETITION-V1 B8 enciende la política antes de afirmar que quien
presenta no valida.

**Offline:** frontend foundation/transport/adapter/competition/**officialization**/commerce 69/69 · static guard +
quality gate 257/257 · competition-remote 7/7 · gateway-remote 8/8 (bundle 16→17) · torneos-foundation 53/53 ·
gateway-auth 44/44 · core-prod 41/41 · reconcile 2/2 · Deno 2.1.4 compat 8/8 (los 3 diagnósticos estrictos
preexistentes, sólo movidos de línea) + hardening 30/30 · **Jest completo 335 suites / 3254 tests** (nuevos:
`torneosOfficializationV1.test.jsx` 20) · `react-scripts build` OK · escaneo de secretos/hosts de Production
sobre las líneas agregadas: limpio.

**UI real** ([`ui-smoke.json`](evidence/ui-smoke.json), navegador contra el lab hybrid): owner invita a Ana como
Administradora desde Miembros; otra cuenta es rechazada; Ana acepta; owner le asigna la temporada; **owner solo
oficializa un 2-1 con «Presentar y oficializar»**; owner enciende el doble control; en el partido 2 el owner
(que presentó) ve «Presentada por vos. Otro Administrador debe validarla.» sin botón de validar; Ana ve
«Presentada por otro miembro», valida y oficializa; el panel de política es de sólo lectura para Ana; iniciales
Q1/Q2/Q3; aviso «Entorno local» (no aparece en Production).

Las suites históricas reescriben su propia evidencia versionada en cada corrida: esos archivos se restauraron
byte-idénticos (certifican fases anteriores); los resultados de esta fase están en
[`evidence/regression.json`](evidence/regression.json).

Hallazgos en el camino (no bloqueantes, fuera de scope): (a) varias RPCs del baseline levantan `55000`
(`TORNEOS_MATCH_REVIEW_OPEN`, `TORNEOS_MATCH_CORRECTION_STALE`, …) que PostgREST responde como HTTP 500 según su
mapeo de SQLSTATE, y el transporte las trata como «Torneos no disponible» — no verificado en vivo en esta fase;
(b) la ruta de tabla `tournament_organization_members` sigue en el scope del cliente aunque ya no la usa ninguna
pantalla (sólo GET con RLS); se puede retirar en una fase posterior.

## 7. Plan para Production (NO ejecutado)

Mismo patrón que COMPETITION-V1: G1 read-only (catálogo POST_0004 = 162/12, md5 de los tres cuerpos =
`4f43a729…/2f43290e…/488ca6bb…`, owner = rol instalador) → **W1** una transacción psql con
`00000000000005_officialization_v1.sql` como el rol instalador (efecto: columna + tabla + fila de capacidad + 3
`CREATE OR REPLACE` + 9 funciones; postcheck 171/12) → **W2** un deploy Deno de la revisión con el bundle de HEAD
(17 archivos), env sin cambios → probes (9 RPCs sin bearer → 401; en la ruta pública → 403; con bearer de un
usuario sin organización → 42501). Entre W1 y W2 las RPCs nuevas no son alcanzables (fuera de la allowlist
desplegada) y la política OFF ya rige para `validate`. El tooling de sesión remota (`--apply` de 0005,
`redeploy`) requiere su propio incremento offline antes de G1. Rollback: W2 → W1 (script de rollback).
Frontend (merge + env de Vercel) es una decisión posterior.
