# COMPETITION-V1 — contrato de competencia completa para la composición hybrid

**Veredicto: `TORNEOS_FULL_COMPETITION_LOCAL_CERTIFIED` → STOP — DECISION_CRITICAL.**
Nada se aplicó en remoto: 0 writes en Torneos Production (`onzpwnqxnvlgsevivngf`), 0 cambios en Core,
Vercel sin tocar, sin push, sin merge. Base: `main` `ff9f9a77` (PR #158).

## 1. Qué se decidió

Se abre la competencia **completa** en hybrid: organización → torneo → temporada → equipos/planteles →
fixture (sorteo, bombos, grupos, versiones, playoffs) → programación (sedes, canchas, ventanas) →
convocatorias → actas → revisión / validación / oficialización / corrección → tabla, estadísticas,
clasificación → ciclo de vida (iniciar / finalizar / reabrir) → retiro de equipos → portal del participante
→ comunicados + documentos + preferencias de notificación → página pública.

Cada RPC sale de un journey real del frontend (alias de un componente), no de "existe". El contrato es
[`contract.json`](contract.json); el inventario por superficie (rutas, componentes, tablas, autoridad,
ACL, veredicto 2B, journey, matriz negativa) es [`INVENTORY.md`](INVENTORY.md).

**Queda OFF** (sin RPC en ninguna allowlist, feature map en `false`): media / media upload, social studio,
billing / plan / entitlements, branding uploads, retratos, fotos de equipo, política visual, roster lock.
Ninguno es necesario para jugar la competencia (no hubo DECISION_CRITICAL por eso).
**Fuera por diseño:** `archive_tournament_fixture`, `postpone/cancel/restore_tournament_match`,
`ready_tournament_match`, `schedule_tournament_match_resumption` son SERVICE_ONLY desde el baseline (el
frontend legacy nunca pudo usarlos); ajustes de puntos, overrides disciplinarios, suspensiones cumplidas y
disponibilidad manual no tienen pantalla que los llame.

## 2. Código (3 commits locales en `claude/torneos-competition-certification-305ffc`)

| commit | contenido |
|---|---|
| `344f3353` | migration `00000000000004_competition_v1_rpc_exposure.sql`, rollback documentado, `contract.json`; gateway `competition.ts` + `competition-v1-rpc-allowlist.json` (Edge `index.ts` y gateway Node del lab); suite `competition.test.mjs`; pines del bundle (14→16) y del diagnóstico Deno |
| `61b177a7` | frontend: feature map, `competitionV1Scope.js`, cliente/transporte público, alias del adapter, gating de UI, `PublicTournamentRoute`, tests (paridad, composición, ruta pública), auditoría B04 regenerada |
| `f1c883f7` | suites históricas del lab desplazadas exactamente por el delta COMPETITION-V1 (+ pines de 0003 que ya estaban vencidos en main), tripwire INFRA-1 |

## 3. Migration nueva `00000000000004` (append-only; 0001 intacta, sha `3df4b96e…`)

sha256 `36e45eddf576…` (archivo en este árbol). Una transacción:

1. **Precondiciones fail-closed** (`TORNEOS_COMPETITION_V1_PRECONDITION_FAILED`): existen las 38 funciones
   involucradas; las 15 a otorgar son SECURITY DEFINER con `search_path=""`, anon/PUBLIC/roles servidor sin
   EXECUTE, service_role con EXECUTE; las 17 gateadas restantes y las 6 service-only siguen cerradas para
   anon/authenticated (prueba que 0001 está vigente). Se registra el conteo previo.
2. **Fix de temporada** `update_draft_fixture`: la capability se pasaba en un `CASE` que el generador de
   Phase 2B no reconoció (misma clase que el P0 de 2D) → un admin sentado sólo en otra temporada de la
   organización podía editar el borrador de esta. Cuerpo = baseline + `has_tournament_season_access(org,
   season de la versión)`. md5 `390a1e4c…` → `53fd2b4b…`, ambos pineados.
3. **Fix de orden de autorización** `publish_tournament_document_version`: devolvía su respuesta idempotente
   (`documentId`, `versionId`, `published`) a **cualquier** bearer antes de chequear `documents.publish` y la
   temporada — oráculo cross-workspace hallado por la matriz negativa. Ahora autoriza primero (sin lockear
   filas para el no autorizado); comportamiento autorizado idéntico. md5 `1000277b…` → `6830b726…`.
4. **15 GRANT EXECUTE … TO authenticated** — exactamente las que 0001 cerró y un journey necesita:
   `reopen_tournament_participants`, `save_tournament_draw_pots`, `update_draft_fixture`,
   `publish_tournament_fixture`, `supersede_tournament_fixture`, `schedule_tournament_match`,
   `auto_schedule_tournament_matches` (el padre que 0001 cerró), `submit_match_squad`,
   `void_tournament_match_event`, `review_tournament_match_operation`, `validate_tournament_match_operation`,
   `make_tournament_match_official`, `request_tournament_match_correction`,
   `create_tournament_match_correction`, `resolve_tournament_qualification`.
5. **Postcondiciones**: las 15 con authenticated y sin anon/PUBLIC/roles servidor; las 23 cerradas siguen
   cerradas; `authenticated` sube exactamente lo que faltaba (147 → 162) y anon no cambia (12).

Re-aplicar es no-op (probado); un estado sin 0001 aborta antes de cualquier cambio (probado).

**Rollback** ([`rollback/…rollback.sql`](rollback/00000000000004_competition_v1_rpc_exposure.rollback.sql),
no es migration): REVOKE de las 15 a `authenticated`, con pre/postcondiciones; conserva los dos fixes
(son endurecimiento) y no borra datos. Probado en transacción revertida (A5).

## 4. Security diff

| capa | antes (main) | después |
|---|---|---|
| DB `authenticated` EXECUTE (public) | 147 | 162 (+15 del manifiesto; nada más) |
| DB `anon` EXECUTE | 12 | 12 |
| DB PUBLIC / roles servidor sobre las 15 | 0 | 0 |
| Cuerpos de funciones | — | 2 fixes (temporada; orden de autorización) |
| Gateway ruta autenticada | 43 RPC | 43 + 74 = 117 (bearer + sesión Core viva + identidad, igual que antes) |
| Gateway ruta anónima | no existía | `POST /torneos/public/v1/rpc/get_public_tournament_page`: 1 RPC, rechaza Authorization/apikey, cuerpo = argumentos exactos, ≤ 2 KiB, como `anon`, `no-store` |
| Allowlist malformada | gateway no arranca | idem para la de competencia (loader fail-closed, disjunta de staging v1) |
| Frontend scope | 43 RPC + 1 tabla | 43 + 74 RPC + 3 tablas (members, venues, courts, sólo GET) + cliente público de 1 RPC |
| `/torneos/publico/:slug` | usaba el cliente **Core** | hybrid → ruta pública del gateway; LOCAL → servicio legacy; resto → cerrado sin requests |
| Wizard (panel página pública) | default = servicio legacy (Core) | recibe el servicio montado; sólo se muestra si el servicio lo ofrece |

Hallazgos corregidos en el camino: los dos fixes de DB, y en el frontend el panel de página pública del
wizard que en hybrid habría llamado al **Core Production** (lo detectó la trampa del singleton Core en
`torneosMpA51PremiumIntentRoute`). La ruta de tablas del gateway sigue siendo genérica (heredado), pero
ninguna tabla tiene policy de escritura para clientes: D7 prueba que un bearer ajeno no escribe.

## 5. Tests y certificación LOCAL

Lab aislado desde volúmenes vacíos (`arma2-competition-cert`: Postgres 17.6.1.143, GoTrue, PostgREST 14.15,
edge-runtime; migraciones 0000→0004 del árbol), Core real + contrato Core real. Evidencia en
[`evidence/`](evidence/): `node/results.json`, `edge/results.json`, `regression.json`, `ui-smoke.json`.

**`competition.test.mjs`: 37/37 checks en gateway Node y 37/37 en gateway Edge** (el que va a Deno Deploy).

- A — instalación y ACL: delta exacto, fixes pineados, idempotencia, rechazo sin 0001, rollback.
- B — journey con actores reales (owner, admin de temporada, collaborator, 4 capitanes vía contrato Core de
  email verificado, jugador Arma2): torneo → equipos aprobados → congelar (idempotente) → generar
  (idempotente) → validar → publicar → supersede + borrador editado (admin de otra temporada rechazado) →
  iniciar (idempotente) → sedes/canchas/ventanas → programar / auto-programar / reprogramar →
  disponibilidad del jugador → convocatorias (carrera de submit: 1 ganador; capitán rival rechazado) →
  acta 2-1 con eventos + evento anulado → revisión → doble control (quien presenta no valida) → oficial ×2
  concurrente (idempotente) → tabla 3/0 (rebuild idempotente) → publicar → corrección (carrera: una sola
  versión) → 1-1 → tabla 1/1 → estadísticas → hub → comunicados/documentos/preferencias (draft idempotente)
  → página pública (anon, sin datos privados) → torneo de 2 equipos: finalizar / reabrir (admin rechazado,
  owner OK) → retiro → grupos: congelar / reabrir / bombos / sorteo / fixture de grupos / versión manual →
  clasificación de grupos + playoffs de liga + resolución de clasificados (admin de otra temporada rechazado).
- C — matriz negativa: 295 filas, todas 42501 (otro workspace, membresía `removed`, admin de otra
  temporada, collaborator en escrituras, jugador, capitán en RPC de staff); 74/74 sin bearer → 401;
  anon directo a PostgREST y las 23 cerradas con bearer → negadas por ACL.
- D — bordes: RPC fuera de contrato → 403 `rpc not enabled`; ruta pública (credenciales, nombre, método,
  content-type, JSON, argumentos, tamaño); IDs inválidos; bridge vencido → 401 y re-exchange; sesión
  forjada → 401; logout Core → 401; Core caído → 503 sin escritura; Torneos REST caído → 503 (también la
  ruta pública); persistencia tras reinicio del gateway; escritura directa de tabla bloqueada; 793/793
  respuestas con `Cache-Control: no-store`.

Regresión (mismo lab): Phase 3A E2E 41/41 Node y Edge · equivalencia Node≡Edge 8/8 · D1 6/6 · exposure
19/19 Node y Edge · acl 14/17 (las 2 fallas son los objetos de pago de 0003, **idénticas en main**, medido
en un lab aparte desde `ff9f9a77`). Offline: frontend foundation/transport/adapter/competition/commerce
64/64 · Jest completo 334 suites / 3234 tests (Torneos 1205/1205 ×3) · static guard CI 257/257 · infra
(foundation 53, gateway-remote 8, gateway-auth 27+12+5, core-prod 41, payments-session 13, gateway-port 6)
· Deno 2.1.4 compat 8/8 + hardening 30/30 · `react-scripts build` OK.

Smoke en navegador (app hybrid real contra el lab, ver `ui-smoke.json`): página pública anónima (sólo la
ruta pública), fixture, partidos, tabla (Recalcular y Publicar desde la UI), comunicaciones, configuración
(panel de página pública vía gateway), portal del capitán sin "Fotos". Ninguna llamada Core `rpc/*` ni
`tournament_*`.

## 6. Riesgos

1. **Ruta pública sin rate limit** (heredado de la arquitectura del gateway: no hay rate limiting en
   ninguna ruta). Sólo lee páginas publicadas; mitigable después en el gateway o en Deno Deploy.
2. **Plan FREE: 1 asiento de colaborador por temporada** (trigger). El doble control exige owner + 1 admin
   para oficializar: funciona con FREE, pero un owner solo no puede oficializar su propia acta.
3. **Ruta de tablas genérica**: sin policies de escritura hoy (probado); una policy futura quedaría expuesta
   al instante. Recomendado: restringirla a GET sobre las 3 tablas del contrato en una fase posterior.
4. **Merge a main** cambia `/torneos/publico/*` en Production: hoy consulta el proyecto Core; después queda
   cerrado ("Torneo no disponible") mientras Torneos/public pages estén apagados. No hay páginas públicas
   legítimas en Core Production, pero es un cambio visible.
5. **Sin push/email**: "notificaciones" = inbox interno + preferencias. Entrega externa sería Core
   (DECISION_CRITICAL si se requiere).
6. Observación: el hub muestra como "Próxima cita" un partido ya oficial si su horario es futuro (lógica
   heredada, idéntica en legacy).
7. Deno Deploy corre su propia versión de Deno; certificado con edge-runtime 1.74.2 y Deno 2.1.4 locales.

## 7. Fase G — plan exacto para Torneos Production (NO ejecutado)

Orden y writes exactos. Todo lo remoto lo tipea Nico en su terminal; ningún secreto en archivos.

**G0 (local, sin red):** dos incrementos de tooling con tests offline y ensayo:
(a) un modo `--apply-competition-v1` (patrón psql de INFRA-1: pooler sa-east-1, `verify-full`, password del
Keychain, frase armada, re-hash del archivo `36e45edd…` antes de leerlo), porque `--migrate` está pineado a
0000–0003; (b) comando `redeploy` en `torneos-gateway-remote` (sólo deploy de fuente, env intacto) y
probes nuevas en B7 (ruta pública: credenciales 400, RPC no pública 403, slug inexistente → `null`;
RPC de competencia sin bearer → 401; RPC OFF con bearer → 403).

**G1 (read-only, 0 writes):** sobre `onzpwnqxnvlgsevivngf`: catálogo = pin de INFRA-1 (0000–0003); md5 de
`update_draft_fixture` = `390a1e4c…` y de `publish_tournament_document_version` = `1000277b…`; las 15 con
authenticated=false; conteos authenticated 147 / anon 12; owner de las dos funciones = el rol instalador
(el `CREATE OR REPLACE` debe correr como ese rol); gateway revision `3rvq2wx9tyyg` sana.

**W1 — DB (1 transacción psql):** ejecutar `00000000000004_competition_v1_rpc_exposure.sql` completo como
el rol instalador. Efecto exacto: 2 `CREATE OR REPLACE FUNCTION` (cuerpos pineados) + 15 `GRANT EXECUTE …
TO authenticated`. Nada más. Postcheck read-only: 162 / 12, md5 nuevos, ACL de las 15 y de las 23.
Entre W1 y W2 las 15 no son alcanzables por el gateway (siguen fuera de su allowlist).

**W2 — gateway (Deno Deploy, app `torneos-gateway` `5d4f18e9…`):** un deploy de revisión con el bundle de
HEAD (16 archivos, digest `b6e4caa527aa…`), **env sin cambios** (13 nombres), commerce OFF. Luego B7 +
probes nuevas y actualizar `pins/gateway-deploy.json`.

**No incluido en G (decisión posterior):** merge a `main` (despliega el frontend en Vercel; inerte mientras
Torneos esté apagado salvo el punto 6.4) y las variables `REACT_APP_TORNEOS_*` de Production
(`…_ENABLED`, `…_WORKSPACES_ENABLED`, `…_PUBLIC_PAGES_ENABLED`, `REACT_APP_TORNEOS_GATEWAY_URL`, …).

**Rollback:** W2 → redeploy de la revisión anterior (fuente `bea307a3`, digest `723c5d39…`); W1 → el
script de rollback (REVOKE de las 15; los fixes quedan). Orden inverso: primero gateway, después DB.

**Credenciales que harían falta:** PAT scoped (Database/Project Settings Read) para G1; password del rol
instalador (Keychain) para W1; token de organización de Deno Deploy para W2. Recordatorio pendiente de
fases anteriores: revocar el PAT y el token Deno expuestos antes.
