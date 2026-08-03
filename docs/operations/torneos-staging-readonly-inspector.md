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
```

No se usa `supabase link`.

## Uso remoto

Desde un worktree limpio de `feature/torneos-staging-readonly-inspector`:

```bash
npm run torneos:staging:inspect:remote:readonly
```

El snapshot se escribe con modo `0600` en un directorio temporal fuera del
repositorio. La salida estándar contiene sólo su ruta, SHA-256, cantidad de
llamadas y `mutationsPerformed: 0`.

Luego, usando el path informado:

```bash
npm run torneos:staging:dry-run:readonly -- \
  --snapshot=/absolute/path/staging-readonly-snapshot.json \
  --repository-sha=93225cae8fde398e1c73b8a9e077325bda6d450d
```

Esto genera Markdown y JSON temporales. No existe modo apply ni continuación
automática desde el plan.

## Fixture local

La fixture equivalente permite validar el flujo sin red:

```bash
npm run torneos:staging:inspect:remote:readonly -- \
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

La inspección real se ejecutó exclusivamente contra Staging
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
