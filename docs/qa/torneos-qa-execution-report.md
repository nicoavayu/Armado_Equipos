# Reporte de ejecución — dataset QA real

Fecha: 2026-07-30.

- Base exacta: `94e4b0825a0c166289982edd045edbb715ff138c`.
- Rama: `codex/torneos-qa-seed`.
- Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-torneos-qa-seed`.
- Supabase efímero local: API `57321`, PostgreSQL `57322`.
- Staging/Production: no conectados, no ejecutados.

## Resultado local

| Verificación | Resultado |
| --- | --- |
| `npm ci --ignore-scripts` | OK; dependencias del lockfile |
| dry-run seed/usuarios/cleanup | OK; cero conexiones y cero escrituras |
| usuarios QA local | 6 creados/resueltos; 6 perfiles canónicos |
| preflight inicial | `create`, 587 esperadas, 0 presentes, 0 colisiones |
| primera ejecución | `created`, 587 filas, 32 tablas |
| segunda ejecución | `skip`, 587/587 presentes, 0 inserts |
| colisión de registro ajeno | `reject: foreign_data_collision` |
| fallo deliberado tras `tournament_matches` | rollback completo; 0 filas del seed |
| rollback | `cleaned`; 0 seed rows; 0 leftovers por organization |
| segundo rollback | `already_clean` |
| roja/sanción | mismo `roster_player_id` y `source_event_id` |
| outsider | 0 memberships |
| equipo ideal | 5 IDs únicos, criterio `manual_curated`, selección no automática |
| rechazo Production/ref/host | OK |
| rechazo credenciales incompletas/ambiguas | OK |
| `npm run test:qa:guards` | 8 passed, integración local omitida sin DB URL |
| `npm run test:qa:torneos:local` | 1 passed; reset completo + ciclo end-to-end |
| auditoría RPCs anon | 9/9 inspeccionadas; sin cambios de permisos |
| FKs sin índice | 197 clasificadas: 91 críticas, 87 corto plazo, 19 sin evidencia |

## Observaciones

- El primer intento local falló por la regla canónica que vuelve inmutable una operación oficial. La transacción revirtió todo; el runner se corrigió para finalizar operaciones después de sus hijos dentro de la misma transacción.
- El cleanup necesita bypass transaccional de triggers porque el historial oficial es append-only. Está habilitado sólo para local con doble confirmación y verificación pre-commit/post-commit.
- El advisor local actual reporta 244 FKs sin índice en todo `public`; el inventario Torneos solicitado contiene 197. Hay tres FKs adicionales de la tabla raíz `tournaments` y 44 ajenas al conjunto.
- `npm ci` conserva 70 vulnerabilidades del árbol existente (10 low, 27 moderate, 29 high, 4 critical). No se ejecutó `npm audit fix`.

## Artefactos

- Arquitectura y operación: `docs/qa/torneos-demo-dataset.md`.
- RPCs anon: `docs/qa/torneos-anon-rpc-audit.md`.
- FKs: `docs/qa/torneos-foreign-key-classification.md`.
- Dry-run completo: `node scripts/qa/seed-torneos-demo.mjs --dry-run`.
