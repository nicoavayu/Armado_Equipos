# Arma2 Torneos — contrato de ejecución A1

## Estado y alcance

Este contrato corrige los bloqueos de timeouts, SHA histórico, planes stale y
registro atómico de una migración. No autoriza ejecutar A1 dentro de este PR.
La auditoría final sólo contacta Staging con transacciones `READ ONLY` y
listados de metadata; Production no se contacta. No se aplican migraciones
remotas ni se modifican Storage, Functions, workers, secretos o flags.

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

Supabase registra oficialmente la versión, nombre y el array de sentencias
parseadas en `supabase_migrations.schema_migrations`; `version` es la clave
primaria. El executor usa la misma separación léxica del CLI (quotes,
dollar-quotes, comentarios, bloques y paréntesis) y no guarda el archivo SQL
completo como un único elemento incompatible. El CLI agrega el `INSERT` al
mismo batch que las sentencias de la migración y ese batch es implícitamente
transaccional. `migration repair --status applied` sólo repara historial: no
aplica el SQL.

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

Los planes pre-merge
`dd06024015444217e9cd87054b165b7fe902d15b920d5842af1825c947355762` y
`e4144f8bcb810755d18c471e85e389faaa2e4448f68d356367fb4551cfd6e88e`
quedan preservados como evidencia con estado `superseded`. Ninguno puede
ejecutarse.

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

El historial proveniente del snapshot se convierte explícitamente a versiones
textuales de 14 dígitos, rechaza duplicados y versiones inesperadas, y se
ordena antes de construir ambos lados de la comparación. Por eso el orden del
JSON remoto no puede producir drift falso. Un segundo intento devuelve
`A1 already applied` después de adquirir el lock y no ejecuta el body.

Los errores de `psql` conservan el código de salida, el SQLSTATE cuando está
disponible y el mensaje técnico acotado, pero eliminan URLs, credenciales,
JWT, parámetros sensibles, refs prohibidas y paths locales. El SQL enviado no
se refleja en el error.

## Contrato de conexión de `psql`

### Causa raíz del defecto corregido

La primera versión del executor entregaba la URL completa de conexión en la
variable `PGDATABASE`. **libpq no expande una URI de conexión recibida por
`PGDATABASE`**: la expansión (`expand_dbname`) sólo aplica al parámetro
`dbname` que `psql` recibe como argumento posicional. Por variable de entorno,
libpq trata el string `postgresql://…` como un **nombre literal de base** y
cae al socket Unix local.

El síntoma es inequívoco y no depende de la credencial:

```
psql: error: connection to server on socket "/tmp/.s.PGSQL.5432" failed:
No such file or directory
```

Nunca intenta resolver el host de la URI. Los modos `apply` y `verify` —y
cualquier llamada a `runPsql()`— eran por lo tanto inutilizables contra
Staging, con cualquier credencial. El defecto no se detectó porque las pruebas
unitarias sólo verificaban el SQL generado por `buildTransactionalSql()` y la
suite live conectaba con el cliente `pg` de Node, sin ejercitar `runPsql()`.

### Proyección discreta de variables libpq

`buildPsqlConnectionEnv()` parsea la URL exclusivamente en memoria y proyecta
variables libpq discretas: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE` —sólo el nombre real de la base— y, cuando la URL los declara,
`PGSSLMODE`, `PGCONNECT_TIMEOUT`, `PGTARGETSESSIONATTRS` y `PGCHANNELBINDING`.
Soporta host directo, pooler oficial, usernames que incluyen el project ref,
credenciales y nombres de base percent-encoded (decodificados exactamente una
vez) y puerto explícito, con `5432` por defecto. La URL completa no queda en
ninguna variable libpq.

Sólo se aceptan estos parámetros de conexión en la URL: `sslmode`,
`connect_timeout`, `target_session_attrs` y `channel_binding`, cada uno con
sus valores válidos. Cualquier otro parámetro —incluidos `application_name`,
`options`, `statement_timeout`, `lock_timeout`, `service` y `passfile`—
aborta: la URL no puede sustituir el `application_name` ni los timeouts de la
migración, que el contrato A1 fija con `SET LOCAL` dentro de la transacción.
TLS falla cerrado: `PGSSLMODE` vale `require` salvo que la URL lo baje
explícitamente. Se rechazan además URLs malformadas, esquemas ajenos,
fragmentos, usuario ausente, base ausente y —para `apply` y `verify`—
password ausente.

El entorno del proceso hijo se construye desde una allowlist (`PATH`, `LANG`,
`LC_ALL`) en lugar de heredar `process.env`, de modo que ninguna configuración
libpq ambiente puede redirigir el destino ni sustituir la credencial:
`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`, `PGOPTIONS`, `PGHOSTADDR`,
`PGREQUIRESSL`, `PGSSLCERT`, `PGSSLKEY`, `PGSSLROOTCERT` y cualquier otra
`PG*` heredada quedan fuera.

La validación de destino Supabase sigue en `validateTarget`, que
`prepareExecution` aplica antes de abrir cualquier conexión; el ref de
Production se rechaza además dentro de la propia proyección, como defensa en
profundidad y antes de que exista proceso hijo.

### Protección del secreto

La URL y su password nunca aparecen en argv, stdout, stderr, logs ni receipts.
`psql` se sigue invocando con `shell:false`, `-X`, `--no-psqlrc`,
`--set=ON_ERROR_STOP=1` y el SQL por stdin. El sanitizador de errores recibe
además el valor literal de la credencial —en claro y percent-encoded— para
redactarlo aunque no coincida con ningún patrón genérico.

### Ruta de `psql`

El default sigue siendo `psql` resuelto por `PATH`. Cuando libpq está
instalado keg-only y `psql` no está en `PATH`, la ruta se pasa por argumento,
por ejemplo `--psql=/opt/homebrew/opt/libpq/bin/psql`. Esa ruta es una
conveniencia del host, no una constante del producto.

### Pruebas de regresión

`scripts/torneos-staging/psql-connection-contract.test.mjs` inyecta un `spawn`
controlado y verifica argv, `shell:false`, SQL por stdin, `ON_ERROR_STOP=1`,
el entorno discreto resultante, la eliminación de las `PG*` hostiles y la
sanitización de errores. `scripts/torneos-staging/psql-connection-live.test.mjs`
ejercita `runPsql()` real contra un PostgreSQL local efímero por TCP: `SELECT
1`, el SQL de `verify`, una ruta de `psql` fuera de `PATH`, una URI incorrecta
que falla sanitizada, y reproduce la proyección anterior (`PGDATABASE=URI`)
demostrando que contra el mismo servidor no puede conectarse. Ambas suites
corren dentro de `test:staging:guard`, que ejecuta el Quality Gate vía
`test:ci`. Ninguna contacta Staging ni Production.

### Consecuencia operativa

El fix cambia el HEAD de la epic. Todo snapshot, dry-run, plan y approval
token anterior queda inválido: después del merge hay que reinspeccionar en
read-only y generar un plan nuevo ligado al SHA nuevo antes de cualquier
apply.

## Inspect y dry-run local

Estos son los modos locales usados para construir y probar los artefactos:

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

Cuando `dry-run` recibe además snapshot, plan e identidad A1 exactos, cambia a
preview del executor: valida el contrato completo sin URL de base ni conexión,
informa una sola migración, historia anterior/posterior normalizada, timeouts,
locks, transacción, stdin, `shell:false` y pausa. Sólo muestra el SHA-256 del
token de aprobación derivable; no persiste el token.

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

Si `psql` no está en `PATH` —por ejemplo con libpq keg-only— se agrega
`--psql=<ruta absoluta a psql>`. La conexión sigue llegando únicamente por
`STAGING_MIGRATION_DATABASE_URL`, nunca como argumento.

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
