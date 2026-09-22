# Phase 2B — Final core wiring + SECURITY DEFINER semantic certification

**Conclusión binaria: A) CLEAN TORNEOS BASELINE PASS** (calculada por `phase2b/run.py` desde la evidencia; ver `results.json`).

> Core contract integration certified against the Phase 2A local contract implementation.
> Real Core endpoint implementation remains pending and is required before Production.

No se abrió Phase 3, no se creó ningún proyecto Supabase, no hubo deploy ni contacto con Production/Core reales. El gateway Node de Phase 1.5 no se modificó.

## Base, branch y archivos

- Branch: `codex/torneos-clean-baseline-phase2`. Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-torneos-clean-baseline-phase2`.
- HEAD previo a esta pasada: `af2ae7aa8b457821b72900e5ae3e11dad0ef5168`. Se conservó y continuó el trabajo sin commit de Astra (dos bugs de seguridad reproducidos y en corrección; probes `phase2b/test_temp_relations.py` y `phase2b/test_season_reads.py`).
- Candidato: `supabase/migrations/00000000000000_torneos_baseline_v1.sql`, SHA-256 `7ec33549c8ce398c1e8330794aa19fda80321c597ff61ed3134382513639cffb` (`evidence/install.json`). `tools/build.py` lo reproduce byte a byte desde la referencia histórica: el generador sigue siendo la fuente de verdad.
- Cambios confinados a `backend/torneos/`. Lista en [changed-files.txt](changed-files.txt); manifiesto en `evidence/manifest.sha256`.

Reproducción completa desde el worktree (recrea sólo la DB `baseline` del contenedor local etiquetado y sin red, y lo detiene al final):

```sh
python3 backend/torneos/phase2b/run.py
```

## A) Las 4 RPC históricas conectadas al contrato Phase 2A

Boundary SQL nuevo (`contracts/core-boundary.sql`), incorporado por el generador después del dump:

- `torneos_core_adapter`: rol NOLOGIN, **INSERT-only** sobre `private.core_contract_attestations`; no puede leer, reusar, extender ni borrar atestaciones, ni leer tablas de dominio, ni ejecutar RPC de dominio.
- `private.core_contract_attestations`: atestación por `identity_id` + `session_id` (la sesión Core que ya viaja en el claim local) + `contract` + `request_hash` (SHA-256 canónico calculado **sólo en SQL**), respuesta Core, `observed_at`, TTL ≤ 10 s por CHECK, `consumed_at`. RLS + FORCE; ningún rol cliente tiene privilegio alguno.
- `private.authorize_core_contract(contract, request)`: pre-autorización DEFINER ejecutable sólo por el adaptador; evalúa el **mismo predicado local** que la RPC (capacidad, temporada, estado de invitación/torneo/categoría, largo de query, límite de tasa) antes de que el servidor llame a Core, y devuelve el request exacto y su hash.
- `private.consume_core_attestation(contract, request)`: consumo **de un solo uso** dentro de la RPC (INVOKER, sólo owner): identidad actual + sesión del claim + contrato + hash recomputado desde los inputs ya validados de la RPC.
- `private.tournament_team_entry_core_snapshots`: representación congelada propia de Torneos (nombre, escudo, candidatos visibles, revisión de origen, captura, importador), privada.

Secuencia del gateway modelada en `phase2b/adapter.py` sobre el laboratorio: token verificado → `authorize_core_contract` como adaptador → `CoreClient` firmado (Phase 2A) contra el Core mock → atestación → RPC histórica ejecutada como `authenticated` con los mismos claims que pondría PostgREST. Ninguna parte es un GUC del cliente, un booleano de body, un claim de email ni una tabla legible por el navegador.

Recableado de cuerpos históricos (`phase2b/core_wiring.py`, ediciones ancladas y únicas):

| RPC | Cambio respecto del histórico |
|---|---|
| `accept_tournament_team_invitation(text)` | La lectura de `auth.users` (email verificado) se reemplaza por la atestación `verified_email` ligada al `email_normalized` de la invitación; token/estado/expiración/manager sin cambios |
| `search_tournament_players(...)` | Directorio Core atestado; exige acceso a temporada y query 2..100; `userId` es la identidad local (se asigna la shadow identity con el mismo upsert que usa el bridge); `teamName` null y sin prioridad por equipo (fuera del contrato) |
| `search_tournament_arma2_teams(...)` | Directorio de equipos importables/descubribles; `primaryColor/secondaryColor/format` null (fuera del contrato) |
| `create_tournament_team_entry(...)` | Importación Core consume la atestación `team_snapshot` (org+torneo+categoría+equipo); nombre desde Core, colores como se envían, candidatos guardados en privado; flujo manual/provisional y guard 2A intactos |

**68/68** pruebas reales en `phase2b/test_core_wiring.py` (`core-wiring-results.json`): aceptación con email verificado y coincidente; rechazos por no verificado, email cambiado, otra identidad, segunda aceptación, invitación expirada (Core no llamado), atestación de otra invitación, otra sesión Core, expirada, sesión Core revocada, `anon`; búsqueda de jugadores con identidades locales usables por `add_tournament_roster_player`; replay de atestación consumida; binding a query/torneo/identidad; admin sin temporada, outsider y otro workspace denegados **antes** de Core (exactamente una llamada Core en ese bloque); límite de tasa local antes de Core; el adaptador no lee atestaciones ni ejecuta RPC; importación idempotente con reautorización Core fresca; snapshot inmutable ante ediciones Core posteriores; mismo equipo con otra clave → `TORNEOS_TEAM_ALREADY_REGISTERED`; equipo oculto importable sólo por su importador autorizado; equipo sin autoridad de importación, borrado y de más de 80 jugadores denegados por Core; respuesta/equipo distintos rechazados aunque el hash coincida; caídas de Core sin efectos.

## B) Los dos bugs de seguridad, cerrados

**1. Relación temporal reutilizada bajo privilegios elevados** (encontrado y reproducido por Astra). `rank_tournament_standings` / `rebuild_tournament_standings` hacían `create temporary table if not exists` y ejecutaban DML sobre una relación que podía haber creado `authenticated` con triggers propios, que corrían como owner. Corrección: la relación se recrea siempre (`if to_regclass('pg_temp.…') is not null then drop table …; end if; create temporary table …`), sin el NOTICE que emitía `drop … if exists` en sesiones sin schema temporal. **11/11** probes (`temp-relation-results.json`): reproducción del histórico con trap ejecutado como `supabase_admin`, ejecución real anidada con tabla/vista hostil y sin relación previa, sin wrappers retenidos.

**2. Fuga entre temporadas.** Astra corrigió 3 lecturas. El barrido dinámico de esta pasada (`phase2b/season_scope_sweep.py`) mostró que era **la clase entera**: el modelo de asientos por temporada (owner no consume asiento; admin/collaborator necesitan asignación) estaba aplicado en RLS y en pocas RPC, y la mayoría de las DEFINER autorizaba recursos de un torneo con la capacidad de organización sola. Antes de la corrección: **41 LEAK** confirmados (owner pasa en la temporada no asignada y el admin no asignado también), incluidas escrituras (`start_tournament_competition`, `set_tournament_public_page_published`, `archive_tournament_team_entry`, `create_tournament_announcement_draft`, `create_tournament_document`, `create_tournament_media_gallery`, `publish_tournament_document_version`, …).

Corrección sistémica en el generador (`phase2b/season_scope.py`, `season-scope-edits.json`, `contracts/season-scope.sql`), 111 funciones:

- R2 (64): toda llamada `has_tournament_{organization,communications,media,social}_capability(p_organization_id, cap)` en una función con recurso scoped se envuelve con `and has_tournament_season_access(p_organization_id, <temporada resuelta desde el parámetro>)`; resolvedores explícitos para 26 parámetros (torneo, entry, partido, operación, versión de fixture, fase, ronda, grupo, roster, jugador, galería, asset, documento, versión, anuncio, compra, retrato, foto, suspensión, ajuste, evento, participante…).
- R1 (33): lo mismo para llamadas sobre variables de fila (`v_announcement`, `v_gallery`, `v_document`, `v_purchase`, `v_revision`, `v_version`→documento, `v_asset`→galería, …).
- R3 (14): ediciones ancladas en helpers compartidos sin `p_organization_id` o con capacidad no literal: `assert_tournament_fixture_scope`, `can_read_tournament_match`, `can_read_tournament_participant_hub`, `can_access_tournament_communications`, los cuatro helpers visuales `_as` (con `private.has_tournament_season_access_as`), `get_tournament_branding_context`, `get_published_tournament_documents`, `get_tournament_communications_admin_context` (denegación explícita + filtros de los tres listados), más las 3 de Astra.
- Las ramas de participante, manager y jugador no se tocan; el owner sigue sin consumir asiento.

Después: **0 LEAK / 0 ORG_LEAK**. Barrido sobre las 179 DEFINER llamables por `authenticated`, con dos pares de torneos gemelos fixturados por las RPC históricas (registration y play: entries, participantes congelados, fixture generado y publicado, competencia iniciada, partido agendado con venue/cancha, operación abierta, anuncio, documento, galería, revisión de standings) — 154 ejercitadas: **101 SCOPED** (owner pasa en B, admin pasa en A y es denegado en B), **15 ORG_SCOPED** (owner de otra organización denegado), 1 CAPABILITY_DENIED (`reopen_tournament_competition`, capacidad de owner), 4 PRECONDITION (fallo idéntico pre-guard para los tres actores: pipeline de media no listo, argumentos inválidos), 33 INCONCLUSIVE (el control positivo del owner no pudo satisfacerse con los fixtures: assets/retratos/fotos sin pipeline, compras, estados avanzados de operación, fixture en borrador; en todas ellas la regla está aplicada en el SQL y el admin fue denegado en la temporada no asignada); 25 fuera de alcance (auto-scoped, sin recurso, o las 4 Core cubiertas por su suite). Cada llamada corre en una transacción con rollback. `season-read-results.json` 18/18 y `phase2a/test_season_boundary.py` siguen verdes.

**Hallazgo adicional cerrado durante el barrido:** `reject_tournament_projection_mutation` permitía mutar proyecciones sólo si `current_user in ('postgres','service_role')` — nombre de owner hardcodeado; en un owner distinto de `postgres` (este laboratorio) `rebuild_tournament_standings` fallaba al marcar empates para revisión manual. Ahora acepta el owner de la propia función o `service_role` (mismo intento, portable). Con eso el rebuild de standings, la generación/publicación de fixture, el inicio de competencia, el agendado y la apertura de operación quedaron ejercitados de verdad sobre el baseline.

## C) 305/305 SECURITY DEFINER con disposición, 0 UNKNOWN

`phase2b/semantic_review.py` → `evidence/security-definer-review.json` y [SECURITY-DEFINER-REVIEW.md](SECURITY-DEFINER-REVIEW.md). 305 = 304 históricas + `private.authorize_core_contract`. Por función: grantees efectivos, owner, search_path fijo, escrituras, tablas leídas sin política SELECT de cliente (necesidad de DEFINER: no existe ninguna política de escritura para clientes, así que toda escritura la exige), guards directos/delegados/auto-scope, regla de temporada aplicada, veredicto del barrido, SQL dinámico (sólo `tournament_media_storage_contract_status`, sentencias constantes sin interpolación), relaciones temporales y pruebas que la ejercitan (170 ejercitadas).

| Categoría | N | Disposición |
|---|---|---|
| CLIENT_RPC_GUARDED | 144 | guard directo de identidad/capacidad/scope antes de leer o escribir; regla de temporada donde aplica |
| SERVICE_ONLY | 106 | EXECUTE sólo `service_role`; inalcanzable desde bearers anon/authenticated; el servicio que la invoca es dueño de la autorización de sus inputs |
| CLIENT_PREDICATE | 16 | booleano sobre el acceso propio de la identidad actual |
| TRIGGER | 10 | disparado por DML; sin EXECUTE de cliente; invariantes append-only/inmutabilidad/scope |
| IDENTITY_GATED_READ | 9 | `anon` puede ejecutar pero el cuerpo exige identidad + predicado de hub/comunicaciones (denegación de `anon` probada en `tools/test.py`) |
| INTERNAL | 9 | sin EXECUTE de cliente ni servicio; sólo desde otras DEFINER |
| CORE_CONTRACT_BOUND | 4 | las RPC de A) |
| PUBLIC_READ | 3 | lectura anónima limitada a filas publicadas/activas |
| CLIENT_RPC_DELEGATED | 2 | autorización delegada al callee DEFINER guardado invocado primero |
| ADAPTER_ONLY / CATALOG_READ | 1 / 1 | pre-autorización del adaptador / matriz estática de roles |

El inventario `phase2a/FUNCTIONS.md` ahora apunta a esa disposición (`semantic_certification: true`, `undisposed_definer: []`), **366/366** chequeos ACL/owner/search_path.

`plpgsql_check`: 71 diagnósticos, 26 de nivel error, clasificados: 20 sobre `pg_temp.*` (el analizador estático no ve relaciones creadas en ejecución; los probes dinámicos las cubren), 2 sobre `storage.*` (schema no provisionado; detrás del gate de readiness `55000`), 4 sobre campos de `NEW` en triggers compartidos (ramas por `tg_table_name`). No son fallos funcionales; se conservan en `evidence/function-analysis.json`.

## D) Recertificación completa

| Evidencia | Resultado |
|---|---|
| Instalación desde `template0` con `public` vacío | PASS; segunda ejecución rechazada atómicamente |
| `tools/test.py` | **79/79** (incluye boundary Core cerrado a clientes, adaptador append-only, TTL por constraint, `anon` denegado en las 9 lecturas gated) |
| `phase2a/test_contracts.py` | 63/63 |
| `phase2a/test_season_boundary.py` | PASS |
| `phase2b/test_temp_relations.py` | 11/11 |
| `phase2b/test_season_reads.py` | 18/18 |
| `phase2b/test_core_wiring.py` | 68/68 |
| `phase2b/season_scope_sweep.py` | 0 LEAK, 0 ORG_LEAK, 101 SCOPED, 15 ORG_SCOPED |
| `phase2b/semantic_review.py` | 305/305, 0 UNKNOWN |
| `phase2a/inventory.py` | 366/366 |
| `tools/compare.py` | 103/103 tablas (102 iguales, 1 sin FK física Core), 367/367 índices, 61/61 políticas, 110/110 triggers, 358/358 funciones presentes (241 idénticas; 117 diferencias, **todas** con motivo en `intentional-function-differences.json`; ninguna «review required») |
| `tools/compare-seeds.py` | 10/10 |
| Sin FK física a Core, sin `auth.*`, sin endpoints/JWT incrustados, sin FDW | PASS |

Diferencias intencionales (118 en `equivalence.json`): 111 por scope de temporada, 4 por el boundary Core, 2 por relaciones temporales, 1 por portabilidad del owner de proyecciones, 1 tabla (FK Core removida). Las de temporada endurecen; las del boundary cambian la fuente de verdad (Core atestado en lugar de tablas Core) y dejan `teamName`, `primaryColor/secondaryColor/format` en null por estar fuera del contrato certificado.

## Límites explícitos

- El contrato Core es la implementación **local** de Phase 2A (mock de autoridad + cliente firmado). El endpoint Core real, su transporte y sus credenciales de servicio siguen pendientes y son requisito antes de Production.
- El enrutado HTTP del gateway para las 4 RPC está modelado por `phase2b/adapter.py`; el gateway Node de Phase 1.5 no fue modificado ni recertificado con navegador.
- 33 funciones quedan INCONCLUSIVE en el barrido dinámico (listadas en `season-scope-sweep.json`); su disposición es estática + denegación observada del admin.
- La asignación de identidades shadow en la búsqueda de jugadores es una decisión de esta fase (misma fila y mismo upsert que el bridge); se documenta como diferencia intencional.
- Storage, cron, push, flags, Mercado Pago y Phase 3 siguen fuera.
