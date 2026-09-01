# Arma2 Torneos — inspector remoto read-only de Staging

## Alcance

Este comando inspecciona exclusivamente el proyecto Staging
`hhyvmhgpapyuzjgxfnqv`. Rechaza Production, refs desconocidos, URLs
inconsistentes, roles PostgreSQL con cualquier privilegio de escritura y SQL
fuera de una allowlist read-only. No enlaza proyectos, no migra, no despliega,
no modifica Storage, no configura secretos, no ejecuta workers ni llama probes
de health o atestación.

`scripts/torneos-staging/readiness.mjs` conserva su contrato histórico de
fixture local y `remoteCalls=0`. El inspector remoto es un entrypoint separado.

## Credenciales requeridas

Sólo se aceptan estos nombres:

- `STAGING_READONLY_DATABASE_URL`: URL PostgreSQL independiente de un rol con
  `CONNECT`, `USAGE` y `SELECT`, sin atributos ni grants de escritura.
- `AUTHORIZED_STAGING_PROJECT_REF`: debe ser exactamente
  `hhyvmhgpapyuzjgxfnqv`.
- sesión autenticada existente de Supabase CLI o, alternativamente,
  `SUPABASE_ACCESS_TOKEN`: usada únicamente por los listados de metadata de
  Functions y Secrets del proyecto explícito. El inspector no extrae ni
  imprime el token persistido por la CLI.

El inspector nunca imprime sus valores. Si falta la URL read-only o el project
ref, el preflight enumera únicamente el nombre y abre cero conexiones remotas.
Para metadata, una sesión CLI autenticada válida evita exigir una variable de
token explícita. Una credencial PostgreSQL más privilegiada no es un reemplazo
válido.

## Consultas y garantías

El archivo `inspect-remote-readonly.sql` se analiza completamente antes de
abrir red. Sólo permite `BEGIN READ ONLY`, cuatro `SET LOCAL` explícitos,
`SELECT` con funciones allowlisteadas y `COMMIT`. Se rechazan DML, DDL,
administración de privilegios, `COPY`, `CALL`, `DO` y funciones no aprobadas.
El driver aborta ante el primer error de consulta, con semántica equivalente a
`ON_ERROR_STOP`; no se ejecutan meta-comandos psql.

Al conectar, el inspector:

1. inicia `BEGIN READ ONLY`;
2. configura `statement_timeout=5s`, `lock_timeout=1s`,
   `idle_in_transaction_session_timeout=20s` y `search_path` explícito;
3. comprueba `current_setting('transaction_read_only') = 'on'`;
4. comprueba `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`,
   `NOREPLICATION`, `NOINHERIT`, `CREATE` efectivo y privilegios efectivos de
   escritura efectivamente utilizables sobre relaciones (incluido `USAGE` del
   schema contenedor);
5. consulta catálogos, `information_schema`, historial de migraciones, metadata
   de Storage y agregados de Media/Social;
6. invoca `tournament_media_pipeline_readiness()` sólo si existe y el catálogo
   declara que no es volátil;
7. confirma la transacción sin ejecutar DDL ni DML.

Las únicas otras llamadas remotas son equivalentes a:

```text
supabase functions list --project-ref hhyvmhgpapyuzjgxfnqv -o json
supabase secrets list --project-ref hhyvmhgpapyuzjgxfnqv -o json
supabase db query --linked <BEGIN READ ONLY + storage.buckets/policy/grant catalogs>
```

La tercera llamada sólo se usa en el refresco focal de Storage. Crea un
workdir local temporal con el ref autorizado, no ejecuta `supabase link`, no
consulta filas de `storage.objects` y elimina el workdir local al terminar.

## Uso remoto

Desde un worktree limpio, el SHA operativo se obtiene de `HEAD` y se entrega
explícitamente. Debe ser un commit completo, descender de
`origin/epic/arma2-torneos` e incluir los merges de #122, #123, #124 y #125:

```bash
EXPECTED_SHA="$(git rev-parse HEAD)"
npm run torneos:staging:inspect:remote:readonly -- \
  --expected-repository-sha="$EXPECTED_SHA"
```

El snapshot se escribe con modo `0600` en un directorio temporal fuera del
repositorio. La salida estándar contiene sólo su ruta, SHA-256, cantidad de
llamadas y `mutationsPerformed: 0`.

Luego, usando el path informado:

```bash
npm run torneos:staging:dry-run:readonly -- \
  --snapshot=/absolute/path/staging-readonly-snapshot.json \
  --expected-repository-sha="$EXPECTED_SHA"
```

Esto genera Markdown y JSON temporales. No existe modo apply ni continuación
automática desde el plan.

Para refrescar exclusivamente Edge, nombres de Secrets y metadata
administrativa de Storage a partir de un snapshot sanitizado ya autorizado:

```bash
AUTHORIZED_STAGING_PROJECT_REF=hhyvmhgpapyuzjgxfnqv \
npm run torneos:staging:inspect:remote:readonly -- \
  --expected-repository-sha="$EXPECTED_SHA" \
  --prior-snapshot=/absolute/path/staging-readonly-snapshot.json \
  --prior-snapshot-sha256=<sha256-autorizado>
```

El refresco valida el hash del snapshot fuente y mantiene explícita su
procedencia. Los datos no focales no se vuelven a consultar con privilegios
administrativos.

## Fixture local

La fixture equivalente permite validar el flujo sin red:

```bash
npm run torneos:staging:inspect:remote:readonly -- \
  --expected-repository-sha="$(git rev-parse HEAD)" \
  --fixture=ops/torneos-staging/fixtures/remote-readonly-equivalent.json \
  --timestamp=2026-08-03T02:00:00.000Z \
  --allow-dirty
```

Una fixture siempre informa `remoteCalls: 0`. No se confunde con evidencia
real de Staging.

## Sanitización y limitaciones

El snapshot incluye sólo nombres de objetos, privilegios, policies, conteos y
estados agregados, timestamps de atestación, capacidades booleanas y evidencia
allowlisteada. Rechaza claves o valores que parezcan credenciales, JWTs, URLs,
emails, UUIDs, object paths, signed URLs, payloads o contenido editorial.

El historial estándar de Supabase no expone checksums, por lo que se declara
`remoteChecksumUnavailable: true` y sólo se calculan checksums locales. La API
de Functions tampoco prueba el contenido desplegado. Las flags frontend quedan
`unknown` porque esta tarea no contacta Vercel. El worker externo sólo se
describe mediante evidencia ya persistida en la base; no se lo contacta.
Cuando RLS impide distinguir una tabla vacía de filas no visibles para el rol
mínimo, el snapshot conserva `unknown`; nunca convierte esa falta de visibilidad
en “ausente” o cero ni amplía permisos para resolverla.

## Evidencia de cero mutaciones

El snapshot registra el guard de transacción, el guard de rol, las categorías
de comandos remotos, cero DDL, cero DML y `mutationsPerformed: 0`. Los tests
negativos verifican Production, refs/hosts inconsistentes, roles privilegiados,
SQL mutante, funciones volátiles, historial y configuración inesperados, y
salidas no sanitizadas.

## Inspección remota real — 2026-08-03

Esta sección preserva evidencia histórica y no autoriza reutilizar su SHA ni
sus planes. La inspección real se ejecutó exclusivamente contra Staging
`hhyvmhgpapyuzjgxfnqv`, con la epic
`93225cae8fde398e1c73b8a9e077325bda6d450d` y el inspector en
`1464b13e772cc3e7bdfe8ea89bf202b98b09d04a`. La sesión autenticada existente
de Supabase CLI fue suficiente para Functions y nombres de Secrets; no se
extrajo ni imprimió su token.

No existía una credencial PostgreSQL read-only aceptable. Se creó
temporalmente `arma2_staging_readonly_audit_20260802` con expiración de cinco
horas, `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`,
`NOBYPASSRLS`, `NOINHERIT` y `default_transaction_read_only=on`. Sólo recibió
`CONNECT`, `USAGE`, `SELECT` sobre la allowlist existente y `EXECUTE` sobre la
función `STABLE` de readiness cuando estuviera presente. Las pruebas reales
confirmaron rechazo de `CREATE`, `INSERT`, `UPDATE`, `DELETE` y `auth.users`.
El rol quedó sin sesiones, sus grants fueron revocados y el rol fue eliminado;
la contraseña temporal fue sobrescrita y borrada.

Evidencia final sanitizada:

- snapshot: SHA-256
  `56b82e1a186e32cb2d3aa11e71874bc70c7b9948b776b0316f2168d106617950`,
  timestamp `2026-08-03T02:00:24.843Z`, 25 llamadas remotas y
  `mutationsPerformed: 0`;
- dry-run JSON: SHA-256
  `c70b72020b334c0a2106ebba48056bea213cccdeddc82fbd3b6f1682de34c4d9`;
- dry-run Markdown: SHA-256
  `e3456304192b7c12cfc25f25ce8e249cf58e1c95e6a9e944a67276ea4d5fbbb2`;
- plan ID:
  `e98d91e84bdebd65144b122ff3d55c4753b0900e42f8a5307b08cf977991ec7c`;
- los snapshots anterior y posterior coincidieron en todo el estado funcional;
  sólo varió el timestamp.

Resultados reales:

- historial remoto: tres versiones, sin duplicados ni versiones inesperadas;
  las tres migraciones objetivo `20260802090000`, `20260802120000` y
  `20260803090000` están pendientes en ese orden;
- checksums remotos no disponibles; checksums locales incluidos en el dry-run;
- catálogo inspeccionado: 79 tablas, 82 columnas, 198 funciones, 4.850 ACLs,
  60 policies, 283 índices, 0 triggers y 740 constraints;
- bucket y conteos de objetos: `unknown` por RLS; las cuatro policies
  `tournament_media_service_*` existen, alcanzan sólo `service_role` y no se
  detectaron roles cliente con escritura directa;
- agregados de sesiones, assets y variantes: `unknown` por RLS; jobs,
  atestaciones y Social objetivo aún no existen porque sus migraciones están
  pendientes;
- Functions objetivo `tournament-media-signer` y
  `tournament-media-processor`: ausentes; contenido/checksum remoto no
  verificable; las nueve Functions existentes se conservaron sin cambios;
- secreto faltante: `TOURNAMENT_MEDIA_ATTESTATION_SECRET`; sólo se inspeccionó
  presencia por nombre;
- `uploadReady`, worker externo y flags remotas: `unknown`; no se contactaron
  workers, health probes mutantes ni Vercel.

Blockers reales: `edge.tournament-media-processor_absent`,
`edge.tournament-media-signer_absent`, `edge.unexpected_function`,
`readiness.upload_not_ready` y `storage.bucket_unknown`.

El dry-run no se aplicó. Staging quedó sin cambios funcionales, Production no
fue contactada y el PR permaneció draft y sin merge.

## Reinspección focal real — 2026-08-03

La segunda inspección partió del snapshot sanitizado anterior, cuyo SHA-256
se revalidó como
`56b82e1a186e32cb2d3aa11e71874bc70c7b9948b776b0316f2168d106617950`.
Volvió a consultar únicamente Functions, presencia de Secrets por nombre y
metadata de `storage.buckets`, policies, grants y RLS dentro de una transacción
administrativa `BEGIN READ ONLY`. No consultó filas ni nombres de
`storage.objects`.

El blocker `edge.unexpected_function` era un falso positivo: la implementación
anterior lo agregaba por cada Function cuyo nombre no fuera uno de los dos
objetivos. Las nueve Functions preexistentes son de otras verticales, están
activas en versión 5, no pertenecen a Torneos y no colisionan con los nombres
objetivo:

| Function | Actualizada UTC | Clase | Torneos | Colisión |
| --- | --- | --- | --- | --- |
| `accept-invite` | 2026-07-29 23:51:12.971 | B | no | no |
| `approve-join-request` | 2026-07-29 23:51:31.182 | B | no | no |
| `delete-account` | 2026-07-29 23:51:37.948 | B | no | no |
| `issue-voting-photo-token` | 2026-07-29 23:51:45.322 | B | no | no |
| `join-match-guest` | 2026-07-29 23:51:53.887 | B | no | no |
| `push-auto-match-now` | 2026-07-29 23:52:22.396 | B | no | no |
| `push-dispatch-now` | 2026-07-29 23:52:39.863 | B | no | no |
| `push-sender` | 2026-07-29 23:52:45.668 | B | no | no |
| `upload-voting-photo` | 2026-07-29 23:52:50.284 | B | no | no |

La corrección clasifica como A los dos objetivos, B las Functions ajenas, C
las Functions Torneos preexistentes declaradas y D cualquier nombre no
declarado dentro de `tournament-*` o `torneos-*`. Una Function clase D sigue
activando `edge.unexpected_function`; una coincidencia exacta con signer o
processor activa un blocker de colisión porque el contenido remoto no es
verificable. Las regresiones cubren los tres casos.

Storage quedó resuelto exactamente como `bucket_absent`: no existe una fila
`tournament-media` en `storage.buckets`. Por lo tanto privacidad, límite,
MIME, owner, AVIF y tipo no aplican todavía y no se infieren desde policies.
Las cuatro policies objetivo existen sobre `storage.objects`, son
`PERMISSIVE` y alcanzan exclusivamente `service_role`:

- `tournament_media_service_read`: `SELECT`, scope `tournament-media`;
- `tournament_media_service_insert`: `INSERT`, scope `tournament-media`;
- `tournament_media_service_update`: `UPDATE`, deny-all;
- `tournament_media_service_delete`: `DELETE`, deny-all.

`storage.objects` tiene RLS habilitado. `PUBLIC` no posee grants directos. Los
roles `anon` y `authenticated` tienen grants de tabla por el contrato general
de Storage, pero sus únicas policies de escritura observadas están acotadas a
`jugadores-fotos` y `team-crests`; no existe una policy cliente aplicable a
`tournament-media`. En consecuencia, `directWriteRoles` es vacío. El conteo
de objetos permanece `unknown` deliberadamente porque no se leyó contenido ni
metadata de archivos.

Artefactos temporales sanitizados de la reinspección:

- snapshot: SHA-256
  `a52d2de311e08e869ddef4bc818c85c6bea95cf5bbcf5f375bc48cec47983c8f`,
  3 llamadas remotas y `mutationsPerformed: 0`;
- dry-run JSON: SHA-256
  `2ce256398fdab7ac5e32777e2f51ed597e5783f1aaef80866d8fdcf00d7df6fc`;
- dry-run Markdown: SHA-256
  `b0a190cefb8c89bab1d15997d35be946a1e2e99943de7efc0524b8e5602567d0`;
- plan ID:
  `dd06024015444217e9cd87054b165b7fe902d15b920d5842af1825c947355762`.

Ese plan fue generado para un commit anterior. Queda explícitamente
`superseded` y el guard actual lo rechaza antes de abrir red. El plan histórico
seguía dividido en autorizaciones independientes y no se ejecutó:

1. Migraciones: aplicar `20260802090000`, `20260802120000` y
   `20260803090000` en ese orden, cada una con validación y pausa. No existe
   evidencia de duración en Staging, por lo que la estimación queda
   explícitamente `unknown`.
2. Storage: crear un bucket privado de 12 MiB con JPEG, PNG y WebP, sin SVG;
   conservar las cuatro policies existentes, verificar por catálogos y pausar.
3. Secrets: configurar por autorización separada
   `TOURNAMENT_MEDIA_ATTESTATION_SECRET`, una alternativa de credencial de
   servidor y una alternativa de credencial pública; no se generaron valores.
4. Edge: desplegar signer, validar health, desplegar processor y validar
   health, con pausa por Function.
5. Worker: aprovisionar runtime externo, ClamAV/freshclam, red, credenciales,
   self-test, atestación, observabilidad y rollback; no se aprovisionó.
6. Readiness: verificar gates, probar `uploadReady=true`, revocación, retorno a
   false y recuperación.
7. Flags y QA: Multimedia, QA Multimedia, Social y QA Social; ambos flags
   permanecen OFF.

Las tres migraciones continúan pendientes y ordenadas, el secreto de
atestación y las dos Functions objetivo continúan ausentes, y worker,
atestaciones, readiness operativo y flags remotas continúan `unknown` o no
listos. El blocker falso fue retirado; los blockers reales son la ausencia de
signer, processor y bucket, más `readiness.upload_not_ready`.

No se creó un rol PostgreSQL específico de la tarea en esta segunda
inspección. La consulta administrativa confirmó que el rol temporal de la
inspección anterior ya no existe; los roles de transporte de CLI son roles
gestionados por la plataforma, no creados por este PR. No se expusieron
credenciales ni valores de Secrets. Staging no recibió modificaciones
funcionales, Production no fue contactada y no se ejecutó ningún build móvil.
