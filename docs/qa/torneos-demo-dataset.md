# Dataset QA real de Torneos

Estado: `torneos-demo-v3` preparado para validación local. Staging y Production
no fueron conectados ni modificados; `torneos-demo-v2` continúa intacto.

## Arquitectura

El dataset `torneos-demo-v3` se compone de cinco capas:

1. `torneos-demo-dataset.mjs`: casos semánticos determinísticos.
2. `buildBaseManifest()`: manifest determinístico independiente de Auth.
3. `QAIdentityMap`: seis UUID reales, emails QA esperados, roles y relaciones proyectadas.
4. `resolveCanonicalManifest()`: manifest final y hash sobre UUIDs reales.
5. `torneos-seed-db.mjs`: preflight, SERIALIZABLE con retry `40001`, advisory lock, inserciones sin upsert, idempotencia y cleanup guardado.

El dry-run offline es el default y no abre sockets. `--apply`, `--execute` y `--apply-remote` están bloqueados. Sólo `--apply-local` existe y exige target PostgreSQL loopback, `QA_SEED_ENV=local`, `QA_SEED_PROJECT_REF=local` y opt-in específico.

## Materialización canónica

La carga inserta 587 filas en 32 tablas:

- `tournament_organizations`, `tournament_organization_members`;
- `tournament_seasons`, `tournaments`, `tournament_categories`;
- `tournament_team_entries`, `tournament_team_managers`;
- `tournament_rosters`, `tournament_roster_players`, `tournament_provisional_players`;
- `tournament_participant_sets`, `tournament_competition_participants`;
- `tournament_fixture_versions`, `tournament_phases`, `tournament_rounds`, `tournament_matches`;
- `tournament_match_operations`, `tournament_match_operation_players`;
- `tournament_match_scores`, `tournament_match_outcomes`, `tournament_match_events`, `tournament_match_reviews`;
- `tournament_standings_revisions`, `tournament_projection_sources`;
- `tournament_team_standings`, `tournament_team_statistics`, `tournament_player_statistics`;
- `tournament_discipline_rules`, `tournament_discipline_ledgers`;
- `tournament_player_suspensions`, `tournament_suspension_served_matches`;
- `tournament_audit_log`.

No se invoca ninguna RPC para materializar: el runner usa SQL parametrizado directo en una única sesión para garantizar atomicidad. Las RPCs públicas se auditan, pero no se modifican.

El torneo activo usa `league_and_playoffs`, por lo que no corresponde crear grupos. El manifest soporta fases de liga, semifinal y final; si el formato cambia a grupos, el preflight debe exigir `tournament_groups` y `tournament_group_members` reales antes de ampliar el dataset.

## Contenido

- 1 organización, 3 memberships organizacionales y 1 temporada.
- 4 torneos: draft, active, completed y archived.
- 1 categoría, 8 equipos aprobados, 9 managers/delegados.
- 8 planteles aprobados, 80 roster players: 2 vinculados a identidades Arma2 y 78 provisionales.
- 1 participant set congelado, 8 participantes y 1 fixture publicado.
- 3 fases, 9 jornadas y 31 partidos.
- 31 operaciones; 30 scores; 31 outcomes; 14 eventos; 2 revisiones abiertas.
- 1 revisión de tabla publicada, 25 fuentes oficiales, tablas y estadísticas derivadas.
- Disciplina derivada, una sanción activa por roja directa y una cumplida por cinco amarillas.
- Equipo ideal manual de cinco jugadores.

Los casos incluyen resultado normal, empate, penales con empate previo y ganador 5–4, walkover 3–0, suspendido al minuto 63, postergado sin score y resultado bajo revisión excluido de la proyección publicada.

## Usuarios QA

Las seis identidades son `owner`, `admin`, `delegate`, `player`, `collaborator` y `outsider`.

- owner: membership `owner` activa y capitanía activa de BNO, RIB, PPC, EDS,
  FER, SDC y VIL.
- admin: membership `admin` activa y capitanía activa de HOR.
- collaborator: una única membership `collaborator` activa; cero managers,
  roster links o equipos administrados.
- delegate: manager `delegate` del primer equipo y roster player Arma2.
- player: roster player Arma2.
- outsider: perfil real sin membership, manager ni roster.

`prepare-torneos-qa-users.mjs` usa `supabase.auth.admin.createUser` sólo contra Auth local y nunca envía un `id`; Supabase Auth genera los UUIDs. El trigger canónico debe crear `public.usuarios`. El mapa resultante puede persistirse en una ruta nueva ignorada por Git, modo `0600`. En remoto el script sólo genera un plan. El mapa rechaza contraseñas, tokens, service-role keys, roles incompletos y relaciones incompatibles.

La validación deriva todas las referencias reales a UUIDs QA por tabla/columna,
además de memberships, managers, roster links, creador y validadores. Compara el
resultado exacto con `QA_IDENTITY_RELATIONS` y rechaza faltantes, inesperadas,
rol/estado incorrecto y relaciones duplicadas antes de cualquier conexión.

Auth es una transacción administrativa separada. Si falla el seed, esas identidades quedan preparadas, no parcialmente relacionadas. La compensación local opcional verifica `raw_app_meta_data.qa_seed_key`, ausencia total de relaciones y doble confirmación antes de eliminar perfil/Auth.

## Seed key e idempotencia

La prueba persistente de ownership combina:

- `tournament_organizations.creation_key` determinística;
- evento `tournament_audit_log` con `resource_type=qa_seed_execution`;
- `seed_key`, versión, hash resuelto, identity fingerprint y ownership fingerprint;
- IDs determinísticos del manifest.

No se usa upsert. Sin marker, cualquier colisión de ID, slug, creation key, idempotency key o natural key declarada rechaza la operación. Con marker exacto, mismo mapa y contenido exacto de las 587 filas, la reejecución devuelve `skip`. Un mapa distinto devuelve `identity_map_changed`; marker distinto, duplicado o dataset parcial/tampered devuelve `reject`. La presencia del marker `torneos-demo-v2` devuelve `replacement_authorization_required`: v3 nunca borra ni reemplaza v2 automáticamente.

Valores autorizados de v3 para las identidades QA existentes:

- marker: `85ab8c2e-6cd5-54c4-86b6-fbbfc0f0b050`;
- manifest hash: `0afc357d733bdfbed0bae9ea8bf87b6c0b58a05ada2c0d8b65ef4b51cbb596f4`;
- identity map fingerprint: `d13bf642667c8a02c79a6f7b6db3325be3a2196c1569cfb655d67a72a3ab4cdd`;
- ownership fingerprint: `940e50032644694b3e2e06f0a022ada8b0474bfa4e70cb22ea45e4ceb3701d7a`.

## Transacción

La materialización usa `BEGIN ISOLATION LEVEL SERIALIZABLE` y `pg_advisory_xact_lock(seed_key)`. Reintenta como máximo tres veces, con backoff, únicamente SQLSTATE `40001`; validaciones, permisos, FKs y constraints no se reintentan. Las operaciones de partido no-draft se insertan primero como draft, se cargan hijos mientras el historial es editable y se finalizan como `under_review`/`official` al final de la misma transacción. Un error revierte todo.

El fallo deliberado después de `tournament_matches` confirmó que no queda organización, marker ni fila determinística parcial.

## Rollback

El cleanup default es offline. El dry-run local comprueba marker, hash, creation key y presencia exacta de las 587 identidades. El apply requiere:

- `QA_ALLOW_LOCAL_CLEANUP=true`;
- `QA_CONFIRM_SEED_KEY=torneos-demo-v3`;
- `QA_CONFIRM_ORGANIZATION_SLUG=qa-metropolitana`.

El cleanup no usa `session_replication_role` ni deshabilita FKs. Verifica marker,
fingerprints, contenido exacto y ausencia de filas ajenas, conserva el marker
hasta el final y proyecta deletes inversos. Por defecto rechaza los guards
append-only activos. Sólo `--apply-local`, después de validar target loopback y
doble confirmación, toma locks `ACCESS EXCLUSIVE`, deshabilita transaccionalmente
los guards de DELETE identificados (nunca triggers internos/FK), elimina
exclusivamente las 587 identidades verificadas y restaura cada guard antes del
commit. Un error revierte tanto los deletes como el estado de los triggers.

## Equipo ideal

El esquema canónico no tiene una tabla/RPC dedicada. Para no inventar una entidad, la selección se persiste como evento canónico en `tournament_audit_log`, con:

- `action=qa.team_of_round.manual_curated`;
- `resource_type=manual_curated_team`;
- `criterion=manual_curated`;
- selector owner;
- formación `ARQ, DEF, MED, DEL, DEL`;
- cinco roster player IDs únicos y elegibles;
- `automaticSelection=false`.

Esto cubre persistencia y auditoría del seed, pero todavía no ofrece una fuente de lectura de producto. Una tabla/RPC canónica específica requerirá otra etapa de esquema.

## Seguridad de target

- Ref remoto autorizado para plan: `hhyvmhgpapyuzjgxfnqv`.
- Ref Production bloqueado: `rcyuuoaqfwcembdajcss`.
- Host bloqueado: `app.arma2.com.ar`.
- Se rechazan Production, variables faltantes y URLs ambiguas.
- El plan remoto no acepta credenciales ni abre conexión.
- No existe ref, URL ni credencial fallback para operaciones conectadas.
- El Session Pooler usa exclusivamente puerto `5432`; `6543` se rechaza sin
  fallback.
- En Session Pooler, la identidad del proyecto deriva del usuario
  `postgres.<project-ref>`, no del hostname compartido.
- TLS se valida en el socket cliente→Pooler con CA local, hostname,
  `rejectUnauthorized: true`, versión y cipher negociados. `pg_stat_ssl` se
  informa aparte porque describe el backend Pooler→Postgres y no sustituye la
  evidencia TLS del cliente.

## Diagnóstico remoto read-only

El diagnóstico no carga el manifest, no pide confirmación de escritura y no
invoca `materializeManifest`. Abre `BEGIN READ ONLY`, ejecuta un único `SELECT`
de identidad/estado de conexión y finaliza con `ROLLBACK`:

```bash
node scripts/qa/apply-torneos-seed-direct.mjs \
  --diagnose \
  --ca-cert .secrets/supabase-prod-ca-2021.crt
```

La connection string se ingresa de forma oculta. El reporte sanitizado publica
por separado `project_ref`, `database`, `username`, `session_pooler`,
`ssl_active`, `tls_version`, `certificate_validation` y `port`, cada uno con
`pass`/`fail` y motivo. También observa `current_database()`, `current_user`,
`session_user`, `inet_server_addr()`, `inet_server_port()`,
`pg_backend_pid()` y el registro del backend actual en `pg_stat_ssl`.

No se emiten connection strings, contraseñas ni UUIDs completos. Cualquier
rechazo enumera los controles exactos que fallaron.

## Comandos

```bash
npm run qa:torneos:users:dry-run
npm run qa:torneos:seed:dry-run
npm run qa:torneos:cleanup:dry-run
npm run test:qa:guards
npm run test:qa:torneos:local
```

Aplicación local explícita:

```bash
export QA_SEED_ENV=local
export QA_SEED_PROJECT_REF=local
# Resolver DB_URL con `npx supabase status -o env` y exportarlo sólo en la shell.
export QA_SEED_DATABASE_URL="<DB_URL local no versionada>"
export QA_SUPABASE_URL="<API_URL loopback>"
export QA_LOCAL_SERVICE_ROLE_KEY="<sólo en memoria>"
export QA_IDENTITY_MAP_OUTPUT=".secrets/torneos-qa-identity-map.local.json"

QA_ALLOW_LOCAL_USER_PREP=true \
  node scripts/qa/prepare-torneos-qa-users.mjs --apply-local

export QA_IDENTITY_MAP_FILE=".secrets/torneos-qa-identity-map.local.json"

QA_ALLOW_LOCAL_SEED=true \
  node scripts/qa/seed-torneos-demo.mjs --apply-local
```

No ejecutar `--apply` remoto. No se hizo ningún cambio de migración, RLS, policy, Storage, Edge Function, Vercel o build móvil.
