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
`options`, `statement_timeout`, `lock_timeout`, `search_path`, `service`,
`passfile` y `hostaddr`— aborta: la URL no puede sustituir el
`application_name` ni los timeouts de la migración, que el contrato A1 fija
con `SET LOCAL` dentro de la transacción. Se rechazan además URLs malformadas,
esquemas ajenos, fragmentos, usuario ausente, base ausente, path con más de
una base, parámetros duplicados y —para `apply` y `verify`— password ausente.

`connect_timeout` exige un entero positivo en segundos, sin ceros a la
izquierda: `0` (que en libpq significa "esperar indefinidamente") se rechaza,
y el máximo es **30 segundos** (`MAX_CONNECT_TIMEOUT_SECONDS`), para que una
URL hostil no pueda dejar al executor colgado de un host inalcanzable mientras
la ventana de aprobación del operador sigue abierta.

### TLS: Staging nunca permite downgrade

**En el camino operativo remoto no existe forma de bajar TLS.** El piso es
`require` y los únicos valores aceptados son:

| `sslmode` | Proyección | `apply` / `verify` remotos |
| --- | --- | --- |
| `verify-full` | aceptado | **único aceptado** |
| `require`, `verify-ca` | aceptado | **rechazado** (`TLS_VERIFICATION_REQUIRED`) |
| `disable`, `allow`, `prefer` | **rechazado** (`DATABASE_URL_PARAMETER`) | rechazado |

Sin `sslmode` en la URL, el valor efectivo es `require`: falla cerrado. Una
URL que pida `sslmode=disable` no "degrada": **aborta**, porque con esos tres
modos un atacante pasivo —o una respuesta DNS hostil— leería la credencial de
migración en claro. Lo mismo vale para `channel_binding`: en remoto sólo se
aceptan `prefer` y `require`; `disable` se rechaza, y sólo se reconsideraría
con una razón técnica documentada y demostrada, que hoy no existe para este
executor. Un `PGSSLMODE=disable` heredado del ambiente tampoco puede degradar
nada, porque el entorno del hijo no hereda `PG*`.

La única excepción es de **pruebas locales**: los PostgreSQL efímeros que usan
las suites no tienen TLS. Para eso existe `buildLocalTestConnection({ …,
allowInsecureLocalTestConnection: true })`, y está deliberadamente fuera del
alcance operativo:

* default `false`, y exige el booleano literal (`'true'` no alcanza);
* ningún argumento de CLI y ninguna variable de entorno la activan;
* nunca se serializa en snapshots, planes, dry-runs ni receipts;
* exige host loopback (`127.0.0.1`, `::1`, `localhost`);
* rechaza cualquier host Supabase y el ref de Production;
* produce un descriptor con `targetMode: 'local-test'`, que `apply` y `verify`
  jamás emiten.

El contrato remoto no se relaja para facilitar las pruebas.

El entorno del proceso hijo se construye desde una allowlist (`PATH`, `LANG`,
`LC_ALL`) en lugar de heredar `process.env`, de modo que ninguna configuración
libpq ambiente puede redirigir el destino ni sustituir la credencial:
`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`, `PGOPTIONS`, `PGHOSTADDR`,
`PGREQUIRESSL`, `PGSSLCERT`, `PGSSLKEY` y cualquier otra `PG*` heredada quedan
fuera. `PGSSLROOTCERT` es el único caso que además **aborta** en lugar de
descartarse en silencio (`CA_CERT_INHERITED`): un operador que exportó una CA
no debe poder creer que es la que se está verificando.

### CA explícita: `STAGING_DATABASE_CA_CERT`

`verify-full` sin ancla de confianza no verifica nada, y **`NODE_EXTRA_CA_CERTS`
no sirve**: configura únicamente el stack TLS de Node y `psql`/libpq jamás lo
lee. El executor por lo tanto no lo consulta.

La CA viaja por una variable dedicada, `STAGING_DATABASE_CA_CERT`, se valida
antes de proyectarse y sólo entonces se traduce a `PGSSLROOTCERT` para el
proceso hijo. El archivo debe ser:

* una ruta **absoluta**, sin NUL ni saltos de línea (`CA_CERT_INVALID`);
* un **archivo regular**, nunca un symlink —cuyo destino podría cambiarse entre
  la validación y el `spawn`— ni un directorio (`CA_CERT_INSECURE` /
  `CA_CERT_INVALID`);
* **propiedad del usuario actual** (`CA_CERT_INSECURE`);
* **no escribible por grupo ni por otros** (`CA_CERT_INSECURE`);
* no vacío, de a lo sumo 256 KB, y con un bundle PEM
  (`-----BEGIN CERTIFICATE-----`) adentro (`CA_CERT_INVALID`).

Ausente, vacía o inválida, `apply` y `verify` remotos **abortan**
(`CA_CERT_REQUIRED`) antes de cualquier `spawn`. `sslrootcert` sigue fuera de
la allowlist de la URL: no hay forma de inyectar una CA arbitraria por
`STAGING_MIGRATION_DATABASE_URL`. La CA no es un argumento de CLI: como la
credencial, llega por ambiente.

### Validación de destino obligatoria

`apply` y `verify` **siempre** validan el destino, y no por convención: por
construcción.

1. `main()` sólo obtiene una conexión a través de `prepareExecution`.
2. `prepareExecution` corre `validateTarget` y, sólo después, emite un
   **descriptor de conexión validado** vía `buildOperationalConnection`, que
   vuelve a correr `validateTarget` como defensa en profundidad.
3. `runPsql` ya **no acepta una URL**: exige ese descriptor, marcado con un
   `Symbol` privado del módulo que ningún caller externo puede falsificar ni
   viajar en un JSON. Un objeto plano —aunque copie todos los campos— se
   rechaza con `CONNECTION_NOT_VALIDATED` antes de cualquier `spawn`.
4. No existe argumento ni modo que saltee la validación: el `targetMode` sale
   del modo de la CLI, no de un flag, y un descriptor de modo `receipt` no es
   spawneable.
5. No existe call site remoto alternativo: `runPsql` sólo se invoca desde
   `apply-single-migration.mjs`, con `connection: contract.connection`.

La URL cruda muere en `prepareExecution`: el contrato devuelto ya no expone
`databaseUrl`. El descriptor guarda el entorno con la credencial en una
propiedad no enumerable y serializa sólo su identidad
(`profile`, `projectRef`, `targetMode`, `databaseHostKind`), de modo que no
puede filtrarse a un snapshot, un plan o un receipt. El ref de Production se
rechaza además dentro de la propia proyección, antes de que exista proceso
hijo.

### Protección del secreto

La URL y su password nunca aparecen en argv, stdout, stderr, logs ni receipts.
`psql` se sigue invocando con `shell:false`, `-X`, `--no-psqlrc`,
`--set=ON_ERROR_STOP=1` y el SQL por stdin. El sanitizador de errores recibe
además el valor literal de la credencial —en claro y percent-encoded— para
redactarlo aunque no coincida con ningún patrón genérico.

### Transporte de stdin: un hijo que deja de leer

`child.stdin` es un `Writable`. Si `psql` termina antes de consumir todo el
payload —el SQL de A1 supera holgadamente el buffer de un pipe— la escritura
falla con `EPIPE`. Sin listener, Node lo eleva a `uncaughtException` y el
proceso muere **perdiendo la única evidencia de lo que pasó del otro lado**:
exit code, señal y el stderr de `psql`.

El executor ahora:

* registra `child.stdin.on('error')` antes de escribir, y también captura el
  throw sincrónico de escribir sobre un pipe ya destruido;
* reconoce `EPIPE` como síntoma de cierre temprano, no como error fatal;
* **siempre espera el evento `close` del hijo** —el único que trae el resultado
  real— y difiere el settle un turno para que un `EPIPE` entregado junto al
  `close` igual se vea;
* un `stdin` truncado invalida el resultado **aunque el exit code sea 0**:
  `psql` no puede haber ejecutado SQL que nunca recibió;
* **no reintenta** y **no afirma rollback**: el hijo pudo morir después de que
  el `COMMIT` llegara al servidor.

Ante fallo devuelve un error estructurado —`PSQL_STDIN_TRANSPORT` si hubo error
de stdin, `PSQL_FAILED` si sólo falló el proceso, `PSQL_EXECUTION` si nunca
hubo proceso— con `psqlExitCode`, `signal`, `stdinErrorCode`, `stderr`
sanitizado y `requiresReadOnlyReinspection: true`. Ese último campo es el
contrato operativo: **el estado remoto queda indeterminado hasta reinspeccionar
en read-only**.

### Ruta de `psql`

El default sigue siendo `psql` resuelto por `PATH`. Cuando libpq está
instalado keg-only y `psql` no está en `PATH`, la ruta se pasa por argumento,
por ejemplo `--psql=/opt/homebrew/opt/libpq/bin/psql`. Esa ruta es una
conveniencia del host, no una constante del producto.

### Pruebas de regresión

`scripts/torneos-staging/psql-connection-contract.test.mjs` inyecta un `spawn`
controlado y verifica argv, `shell:false`, SQL por stdin, `ON_ERROR_STOP=1`,
el entorno discreto resultante, la eliminación de las `PG*` hostiles y la
sanitización de errores. Cubre además las regresiones del contrato TLS y de
validación de destino:

1. `sslmode=disable` remoto rechazado.
2. `sslmode=allow` remoto rechazado.
3. `sslmode=prefer` remoto rechazado.
4. `sslmode=require` aceptado por la proyección, rechazado para `apply`/`verify`.
5. `sslmode=verify-ca` idem.
6. `sslmode=verify-full` aceptado, único válido para `apply`/`verify`.
7. ausencia de `sslmode` remoto produce `require`, insuficiente para operar.
8. conexión local sin TLS rechazada sin el flag test-only.
9. conexión local sin TLS aceptada sólo con el flag test-only explícito.
10. flag test-only con host Supabase rechazado.
11. `apply` siempre pasa por `validateTarget`.
12. `verify` siempre pasa por `validateTarget`.
13. `runPsql` no acepta un descriptor no validado.
14. Production aborta antes del `spawn`.
15. host desconocido aborta antes del `spawn`.
16. ningún secreto aparece en argv, logs ni errores.

Y las del contrato de CA y de transporte:

17. una CA válida se proyecta como `PGSSLROOTCERT`.
18. CA ausente falla cerrado (`CA_CERT_REQUIRED`).
19. CA insegura o malformada falla cerrado —symlink, escribible por grupo u
    otros, de otro dueño, directorio, no-PEM, vacía, sobredimensionada,
    inexistente, relativa, con salto de línea.
20. `PGSSLROOTCERT` heredado aborta (`CA_CERT_INHERITED`), no se ignora.
21. `sslrootcert` dentro de la URL sigue rechazado.
22. `apply` y `verify` remotos exigen `verify-full`.
23. un hijo que termina antes con payload > 100 KB no produce
    `uncaughtException`, captura `EPIPE`, espera `close` y conserva exit code,
    señal y stderr —con un mock determinístico y con un proceso real.
24. exit code 0 no absuelve un `stdin` truncado.
25. un hijo sano consume el payload completo byte a byte.
26. ningún secreto aparece en el error de transporte, y nada afirma rollback.
27. Production sigue bloqueada y el executor sigue seleccionando sólo A1.

`scripts/torneos-staging/psql-connection-live.test.mjs` ejercita `runPsql()`
real contra un PostgreSQL local efímero **por TCP, nunca por socket Unix**:
`SELECT 1`, el SQL de `verify`, una ruta de `psql` fuera de `PATH`, una URI
incorrecta que falla sanitizada, y reproduce la proyección anterior
(`PGDATABASE=URI`) demostrando que contra el mismo servidor no puede
conectarse. Es el único consumidor de la excepción loopback test-only. Ambas
suites corren dentro de `test:staging:guard`, que ejecuta el Quality Gate vía
`test:ci`. Ninguna contacta Staging ni Production.

### Consecuencia operativa

El fix cambia el HEAD de la epic. **Todo plan anterior al merge queda
inválido**: snapshot, dry-run, plan y approval token están ligados al SHA del
repositorio, y el approval token se deriva del `planId` y de ese SHA. Después
del merge hay que reinspeccionar en read-only y generar un plan nuevo ligado
al SHA nuevo antes de cualquier `apply`; reutilizar artefactos previos aborta
con `SNAPSHOT_DRIFT`, `PLAN_ID_DRIFT` o `APPROVAL_TOKEN`.

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
canal externo y nunca como argumento, archivo o log. `STAGING_DATABASE_CA_CERT`
apunta al bundle PEM de la CA de Supabase, con permisos `0600` y del usuario
que ejecuta; la URL debe pedir `sslmode=verify-full`.

```bash
EXPECTED_SHA="$(git rev-parse HEAD)"
# El bundle debe ser archivo regular, propio y no escribible por grupo/otros.
chmod 600 "$STAGING_DATABASE_CA_CERT"

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
`STAGING_MIGRATION_DATABASE_URL` y la CA por `STAGING_DATABASE_CA_CERT`, nunca
como argumento.

Si `apply` falla con `PSQL_STDIN_TRANSPORT`, `PSQL_FAILED` o `PSQL_EXECUTION`,
**no se reintenta**: el error trae `requiresReadOnlyReinspection: true` y el
paso siguiente es reinspeccionar en read-only para determinar el estado real
del historial antes de decidir nada.

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
