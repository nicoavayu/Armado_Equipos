# Arma2 Torneos — contrato de ejecución A1

## Estado y alcance

Este contrato corrige los bloqueos de timeouts, SHA histórico, planes stale y
registro atómico de una migración. No autoriza ejecutar A1 dentro de este PR.
Staging y Production no fueron contactadas, no se aplicaron migraciones remotas
y no se modificaron Storage, Functions, workers, secretos ni flags.

La única migración aceptada es
`supabase/migrations/20260802090000_tournament_media_upload_pipeline.sql`,
versión `20260802090000`, SHA-256
`793ffbbe8cf7f7f94b4924d781fa81e01ebf92208c80e70b60e2daf92a72a417`.
A2 y Social permanecen pendientes y bloqueadas.

## Verificación de Supabase CLI y contrato oficial

La CLI disponible en `PATH` es Supabase CLI 2.84.2. No se actualizó. El
`package-lock.json` fija 2.110.0 para instalaciones reproducibles del repo,
pero no se sustituyó la CLI del host.

Se revisaron el [changelog oficial](https://supabase.com/changelog.md), la
[guía actual de migraciones](https://supabase.com/docs/guides/deployment/database-migrations),
la ayuda local de `migration`, `migration up`, `migration repair` y `db push`,
y el código oficial de CLI 2.84.2 para
[`schema_migrations`](https://github.com/supabase/cli/blob/v2.84.2/pkg/migration/history.go)
y la [aplicación transaccional](https://github.com/supabase/cli/blob/v2.84.2/pkg/migration/file.go).
No apareció un breaking change de migraciones aplicable a este contrato.

Supabase registra oficialmente la versión, nombre y sentencias en
`supabase_migrations.schema_migrations`; `version` es la clave primaria. El
CLI agrega el `INSERT` al mismo batch que las sentencias de la migración y ese
batch es implícitamente transaccional. `migration repair --status applied`
sólo repara historial: no aplica el SQL.

En 2.84.2, `migration up` no acepta archivo, versión, límite ni cantidad. Toma
la lista completa de pendientes y la recorre. `db push` tiene la misma
propiedad para pendientes remotas. Por eso ninguno sirve para certificar una
única A1 cuando A2 y Social también están pendientes.

La alternativa mínima conserva el contrato oficial: `psql -X --no-psqlrc
--set=ON_ERROR_STOP=1 --file=-`, con el SQL A1 y el registro de historial en su
única transacción canónica. No se modifica el archivo de migración ni su
checksum.

## SHA dinámico y planes fail-closed

`inspect` y `dry-run` exigen `--expected-repository-sha=<40 hex>`. El valor:

1. debe coincidir con `git rev-parse HEAD`;
2. debe descender de `origin/epic/arma2-torneos`;
3. debe incluir los merge commits de los PR #122, #123, #124 y #125;
4. se copia sin cambios al snapshot, plan, dry-run y receipt.

El plan incluye SHA de repositorio, SHA canónico del manifiesto, SHA canónico
del snapshot, project ref, lista/orden/checksum de pendientes, creación y
vencimiento. Su ID es el SHA-256 del contenido completo. Cualquier diferencia
aborta antes de importar `pg`, ejecutar `psql` o abrir una conexión.

El plan histórico
`dd06024015444217e9cd87054b165b7fe902d15b920d5842af1825c947355762`
queda preservado como evidencia con estado `superseded`. No puede ejecutarse.

## Timeouts y exclusión

A1 exige exactamente:

- `lockTimeoutMs: 5000` (máximo permitido 10000);
- `statementTimeoutMs: 120000` (máximo permitido 300000);
- `idleInTransactionSessionTimeoutMs: 60000` (máximo permitido 120000).

Ausencia, cero, negativos o valores fuera de límite abortan. Los valores se
aplican con `SET LOCAL` dentro de la transacción A1 junto con
`application_name=arma2-torneos-a1-migrate`. Son guardas, no estimaciones de
duración.

El executor toma un advisory transaction lock y luego `SHARE ROW EXCLUSIVE`
sobre `supabase_migrations.schema_migrations`. Relee el historial exacto antes
de ejecutar A1 y vuelve a comprobar el historial esperado después del insert.
Esto evita dos ejecutores cooperantes y bloquea escritores concurrentes del
historial durante toda la transacción.

## Inspect y dry-run local

Estos comandos son los únicos modos ejecutados durante este PR:

```bash
EXPECTED_SHA="$(git rev-parse HEAD)"
ARTIFACTS_DIR="$(mktemp -d)"

npm run torneos:staging:a1 -- inspect \
  --expected-repository-sha="$EXPECTED_SHA" \
  --fixture=ops/torneos-staging/fixtures/remote-readonly-equivalent.json \
  --output-dir="$ARTIFACTS_DIR"

npm run torneos:staging:a1 -- dry-run \
  --expected-repository-sha="$EXPECTED_SHA" \
  --snapshot="$ARTIFACTS_DIR/staging-readonly-snapshot.json" \
  --output-dir="$ARTIFACTS_DIR"
```

La fixture es sintética. Snapshot y dry-run deben informar las tres
migraciones pendientes, bucket/signer/processor/secret ausentes, readiness
cerrada, `remoteCalls: 0` y `mutationsPerformed: 0`.

## Apply futuro, sólo bajo nueva autorización

Después del merge se debe reinspeccionar, generar un plan nuevo y obtener una
aprobación A1 específica. `STAGING_MIGRATION_DATABASE_URL` se suministra por un
canal externo y nunca como argumento, archivo o log.

```bash
EXPECTED_SHA="$(git rev-parse HEAD)"

npm run torneos:staging:a1 -- apply \
  --project-ref=hhyvmhgpapyuzjgxfnqv \
  --production-guard=PRODUCTION-IS-FORBIDDEN \
  --expected-repository-sha="$EXPECTED_SHA" \
  --snapshot=/absolute/path/staging-readonly-snapshot.json \
  --snapshot-sha=<sha256-canónico> \
  --plan=/absolute/path/staging-readonly-dry-run.json \
  --plan-id=<plan-id> \
  --migration=supabase/migrations/20260802090000_tournament_media_upload_pipeline.sql \
  --migration-version=20260802090000 \
  --migration-checksum=793ffbbe8cf7f7f94b4924d781fa81e01ebf92208c80e70b60e2daf92a72a417 \
  --confirmation=APPLY-ONLY-A1-20260802090000 \
  --approval-token=<token-A1-del-plan>
```

El modo rechaza directorios, globs, rangos, múltiples archivos, “all”, otra
migración, A1 ya aplicada, historial inesperado y cualquier argumento
incompleto. Nunca continúa con A2 o Social.

## Verify, receipt y recuperación

Tras `apply`, se pausa. `verify` reutiliza exactamente snapshot, plan, SHA,
identidad A1 y approval; abre una transacción `READ ONLY` y exige el historial
anterior más A1, una sola vez. Debe verificar además los objetos A1, ausencia
de A2/Social, readiness cerrada y ausencia de bucket y servicios.

`receipt` sólo se genera desde un resultado `HISTORY_OK`. Registra SHA del
repo, project ref, plan, snapshot, manifiesto, versión, checksum, historial
anterior/posterior, timeouts, `application_name`, transacción,
`ON_ERROR_STOP` y pausa obligatoria.

Ante timeout o error, el proceso `psql` termina y PostgreSQL revierte la
transacción abierta. No se usa `migration repair`, no se registra historia por
separado y no se reintenta. Se ejecuta una reinspección read-only; si cambió
HEAD, manifiesto, snapshot, historial o venció el plan, se descartan los
artefactos operativos y se genera un plan nuevo.

## Certificación local y limitaciones reales

`npm run test:staging:a1:local` usa PostgreSQL efímero exclusivo desde el estado
previo a A1. Certifica caso feliz sólo A1, historial singular, A2/Social
pendientes, readiness cerrada, lock timeout cercano a 5 s, cero aplicación
parcial, rollback por fallo SQL, rollback por fallo al registrar historial,
drift y rechazo de repetición.

En este host no existe `docker`, y la CLI 2.84.2 tampoco puede leer la clave
`local_smtp` del `config.toml` actual. Por eso no se pudo iniciar el stack
Supabase local completo. Tampoco existe un binario host `psql`; la prueba live
ejecuta el mismo batch en el driver PostgreSQL real, mientras la suite unitaria
certifica la invocación `ON_ERROR_STOP`. Esta limitación también existe en la
epic prístina y no se ocultó actualizando CLI o modificando configuración.

## Aborto anterior preservado

- Operation ID:
  `923932cc1b75c6b98432c00dd0e7da8b6feda55e2229ff7b76f43792fadd3f24`.
- Receipt SHA:
  `841ff4a1963d5c8d38c8fccac8fb81fe614b2ba23479ee09e8ea14873ea8d3a5`.
- A1 no fue aplicada.
- Staging no fue contactada por ese intento.
- El intento abortó por contratos incompletos.
- El plan anterior quedó `superseded`.
