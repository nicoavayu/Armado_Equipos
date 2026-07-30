# Reporte de ejecución — dataset QA real

Fecha: 2026-07-30.

- Base remota anterior a la corrección: `33906604ea5cd0e6b5a66134f082d38ddcfdeac9`.
- Rama: `codex/torneos-qa-seed`.
- Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-torneos-qa-seed`.
- Supabase efímero local: API `57321`, PostgreSQL `57322`.
- Staging: auditado sólo con `SELECT`; seed no ejecutado.
- Production: no conectado ni ejecutado.

## Rechazo de Session Pooler

La condición exacta era `server.rows[0].ssl !== true` en
`apply-torneos-seed-direct.mjs`. El único `if` posterior a `connect()` combinaba
`current_database() !== 'postgres' || !pg_stat_ssl.ssl` bajo el error genérico.
La connection string ya había sido validada con pathname `/postgres`, y la
sesión autenticó, por lo que el rechazo correspondió al segundo operando.

La validación confundía dos tramos distintos: `pg_stat_ssl` observa la conexión
del backend Pooler→Postgres, mientras que Node había validado CA, hostname,
versión y cipher en el socket cliente→Pooler. La corrección usa el `TLSSocket`
autorizado como prueba de TLS del cliente y conserva `pg_stat_ssl` como dato
observado, sin convertirlo en sustituto del socket cliente.

Valores sanitizados observados:

- hostname compartido `aws-0-us-east-1.pooler.supabase.com`;
- usuario `postgres.hhyvmh…`; project ref derivado `hhyvmh…`;
- database/current user/session user: `postgres`;
- endpoint y backend en puerto `5432`; backend PID observado;
- dirección de backend sanitizada `2600:…`;
- conexión SQL read-only de control: TLS `TLSv1.3`,
  `TLS_AES_256_GCM_SHA384`;
- marker `0`; huellas de filas del manifest `0/587`;
- identidades preparadas intactas: 6 Auth + 6 perfiles;
- outsider: 0 relaciones en 119 columnas FK inspeccionadas;
- transacciones del runner `0`; advisory locks del seed `0`.

## Corrección

- nuevo modo `--diagnose`, mutuamente exclusivo con `--execute`;
- `BEGIN READ ONLY`, un `SELECT` de identidad/SSL y `ROLLBACK`;
- controles independientes con `pass`/`fail`: `project_ref`, `database`,
  `username`, `session_pooler`, `ssl_active`, `tls_version`,
  `certificate_validation` y `port`;
- identidad de Session Pooler derivada de `postgres.<project-ref>`, nunca del
  hostname compartido;
- `rejectUnauthorized: true`, CA, `checkServerIdentity`, servername y puerto
  `5432` conservados;
- puerto `6543`, TLS overrides y targets ajenos continúan rechazados sin
  fallback;
- cada rechazo enumera los controles fallidos; se eliminó el error genérico.

## Resultado local

| Verificación | Resultado |
| --- | --- |
| auditoría remota read-only previa | marker 0; manifest 0/587; 12 identidades intactas; outsider 0 relaciones; 0 transacciones/locks |
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
| runner directo y TLS | 21 passed; incluye Session Pooler válido, 8 rechazos separados, CA y hostname |
| `npm run test:qa:guards` | 34 passed; 1 integración local omitida fuera del comando conectado |
| `npm run test:qa:torneos:local` | 1 passed; reset completo + ciclo conectado hasta diagnóstico de cleanup |
| auditoría RPCs anon | 9/9 inspeccionadas; sin cambios de permisos |
| FKs sin índice | 197 clasificadas: 91 críticas, 87 corto plazo, 19 sin evidencia |

## Observaciones

- El primer intento local falló por la regla canónica que vuelve inmutable una operación oficial. La transacción revirtió todo; el runner se corrigió para finalizar operaciones después de sus hijos dentro de la misma transacción.
- El rechazo remoto investigado ocurrió antes de `BEGIN`; por eso no pudo
  persistir filas ni adquirir el advisory lock transaccional del seed. La
  auditoría posterior confirmó ambos contadores en cero.
- Se eliminó por completo el uso de `session_replication_role`. El catálogo confirmó guards append-only/no-delete en audit log, operaciones y sus hijos, reviews y standings revisions. Con triggers activos, el esquema actual no ofrece una secuencia legal de DELETE. El runner rechaza antes de mutar y el runbook define la migración mínima futura: excepción transaccional sólo para filas verificadas del seed, sin deshabilitar triggers ni FKs.
- El advisor local actual reporta 244 FKs sin índice en todo `public`; el inventario Torneos solicitado contiene 197. Hay tres FKs adicionales de la tabla raíz `tournaments` y 44 ajenas al conjunto.
- `npm ci` conserva 70 vulnerabilidades del árbol existente (10 low, 27 moderate, 29 high, 4 critical). No se ejecutó `npm audit fix`.

## Artefactos

- Arquitectura y operación: `docs/qa/torneos-demo-dataset.md`.
- Identidades y plan remoto A–G: `docs/qa/torneos-qa-auth-runbook.md`.
- RPCs anon: `docs/qa/torneos-anon-rpc-audit.md`.
- FKs: `docs/qa/torneos-foreign-key-classification.md`.
- Dry-run completo: `node scripts/qa/seed-torneos-demo.mjs --dry-run`.
