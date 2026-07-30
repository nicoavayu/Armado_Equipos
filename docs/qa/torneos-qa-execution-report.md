# Reporte de ejecución — dataset QA real

Fecha: 2026-07-30.

- Base exacta de esta revisión: `387d13ea3b2340214c6def912aa4a35c3162540d`.
- Rama: `codex/torneos-qa-seed`.
- Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-torneos-qa-seed`.
- Supabase efímero local: API `57321`, PostgreSQL `57322`.
- Staging/Production: no conectados, no ejecutados.

## Resultado local

| Verificación | Resultado |
| --- | --- |
| `npm ci --ignore-scripts` | OK; dependencias del lockfile |
| dry-run seed/usuarios/cleanup | OK; cero conexiones y cero escrituras |
| usuarios QA local | 6 creados por Auth sin fijar UUID; 6 perfiles canónicos |
| preflight inicial | `create`, 587 esperadas, 0 presentes, 0 colisiones |
| primera ejecución | `created`, 587 filas, 32 tablas |
| segunda ejecución | `skip`, 587/587 presentes, 0 inserts |
| colisión de registro ajeno | `reject: foreign_data_collision` |
| fallo deliberado tras `tournament_matches` | rollback completo; 0 filas del seed |
| cambio de una identidad | `reject: identity_map_changed` |
| cleanup con FKs/triggers activos | `reject: active_append_only_cleanup_guards`; cero deletes |
| segundo cleanup / cero huérfanos | bloqueado por los mismos guards; no ejecutable sin migración acotada |
| roja/sanción | mismo `roster_player_id` y `source_event_id` |
| outsider | 0 memberships y 0 organizaciones visibles bajo RLS |
| equipo ideal | 5 IDs únicos, criterio `manual_curated`, selección no automática |
| rechazo Production/ref/host | OK |
| rechazo credenciales incompletas/ambiguas | OK |
| retry SERIALIZABLE | 2 fallos sintéticos `40001`, éxito en intento 3; `23503` no reintentado |
| `node --test scripts/qa/*.test.*` | 12 passed; integración local omitida sin DB URL |
| `npm run test:qa:torneos:local` | 1 passed; reset completo + ciclo conectado hasta diagnóstico de cleanup |
| auditoría RPCs anon | 9/9 inspeccionadas; sin cambios de permisos |
| FKs sin índice | 197 clasificadas: 91 críticas, 87 corto plazo, 19 sin evidencia |

## Observaciones

- El primer intento local falló por la regla canónica que vuelve inmutable una operación oficial. La transacción revirtió todo; el runner se corrigió para finalizar operaciones después de sus hijos dentro de la misma transacción.
- Se eliminó por completo el uso de `session_replication_role`. El catálogo confirmó guards append-only/no-delete en audit log, operaciones y sus hijos, reviews y standings revisions. Con triggers activos, el esquema actual no ofrece una secuencia legal de DELETE. El runner rechaza antes de mutar y el runbook define la migración mínima futura: excepción transaccional sólo para filas verificadas del seed, sin deshabilitar triggers ni FKs.
- El advisor local actual reporta 244 FKs sin índice en todo `public`; el inventario Torneos solicitado contiene 197. Hay tres FKs adicionales de la tabla raíz `tournaments` y 44 ajenas al conjunto.
- `npm ci` conserva 70 vulnerabilidades del árbol existente (10 low, 27 moderate, 29 high, 4 critical). No se ejecutó `npm audit fix`.

## Artefactos

- Arquitectura y operación: `docs/qa/torneos-demo-dataset.md`.
- Identidades y plan remoto A–G: `docs/qa/torneos-qa-auth-runbook.md`.
- RPCs anon: `docs/qa/torneos-anon-rpc-audit.md`.
- FKs: `docs/qa/torneos-foreign-key-classification.md`.
- Dry-run completo: `node scripts/qa/seed-torneos-demo.mjs --dry-run`.
