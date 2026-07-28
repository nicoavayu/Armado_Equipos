# Informe de baseline canónico Arma2

Fecha: 2026-07-28.

Estado: **transferido y certificado localmente; sin commit, push ni PR**.

## Alcance y aislamiento

El trabajo se realizó en
`/Users/nicoavayu/Downloads/arma2/arma2-canonical-schema`, rama
`feature/arma2-canonical-schema`, creada desde
`epic/arma2-torneos@5c3b06c7335fbd566c6e8af1c435788cdb6bec17`.

La fuente técnica fue el worktree
`/Users/nicoavayu/Downloads/arma2/arma2-schema-baseline`. Antes de transferir
se generaron un patch binario de tracked y un archivo de untracked, se
calcularon sus SHA-256 y `git apply --check` confirmó cero colisiones. Se
excluyó deliberadamente
`docs/arma2-torneos/22-reproducible-schema-baseline.md`.

No se vinculó ni consultó un proyecto Supabase remoto. No se ejecutaron
`supabase link`, `db pull`, `db push` ni comandos contra producción. No se
modificaron `main`, producción, stores, PR #103, PR #104, el worktree fuente,
el checkout de release, los cambios iOS locales, `.claude` ni `build-device`.

## Compatibilidad

El contrato observable final registra:

- 1.097 operaciones Supabase estáticas;
- 44 tablas/vistas consumidas directamente;
- 213 nombres de RPC estáticas;
- 7 Edge Functions invocadas;
- 2 buckets activos;
- 19 suscripciones Realtime.

El detalle navegable está en
[`arma2-functional-contract.md`](./arma2-functional-contract.md). La matriz
objeto por objeto contiene 136 relaciones públicas y 454 nombres únicos de
función pública en
[`arma2-object-compatibility.md`](./arma2-object-compatibility.md).

No se eliminó ningún objeto final por mera ausencia de referencias directas.
Los objetos inciertos permanecen por compatibilidad. Las únicas ausencias
deliberadas son:

- `public.exec_sql`: sólo aparece en scripts de reparación y permitiría SQL
  arbitrario desde el cliente;
- `public.compute_awards_for_match`: el cliente declara esa RPC opcional y
  conserva el cálculo/persistencia canónicos como fallback probado.

## Baseline

La fuente ejecutable queda reducida a dos archivos:

1. `20260727090000_arma2_canonical_baseline.sql`: estado completo de
   `public`, constraints, índices, vistas, funciones, triggers, grants,
   revokes, RLS, policies, extensiones y Storage.
2. `20260727215106_canonical_core_rls_contracts.sql`: contratos fuera del
   alcance de un dump `public`, hardening y compatibilidad; incluye Stage A,
   Stage B, puente `auth.users -> usuarios`, RLS base, RPCs pre-versionadas,
   wrappers `pgcrypto`, Realtime, `pg_cron` y ocho jobs.

Las nueve migraciones de Torneos y Stage A/B quedan incorporados en la
baseline. El historial se preserva en `supabase/migrations_history/` con 216
archivos, 214 de ellos SQL. Supabase CLI sólo aplica las dos migraciones
canónicas.

Estado reconstruido:

| Componente | Resultado |
| --- | ---: |
| Tablas `public` | 127 |
| Vistas `public` | 9 |
| Sobrecargas de función `public` | 456 |
| Policies `public` + `storage` | 169 |
| Triggers `public` | 113 |
| Índices `public` | 446 |
| Tablas `public` sin RLS | 0 |
| `SECURITY DEFINER` sin `search_path` fijo | 0 |
| Jobs `pg_cron` | 8 |
| Tablas en publicación Realtime | 4 |
| Buckets | `jugadores-fotos`, `team-crests` |

## Inspección final de integridad

Los 214 SQL de `supabase/migrations_history/` se compararon por nombre y por
bytes contra el worktree fuente y, para los nueve archivos que todavía estaban
activos allí, contra `origin/epic/arma2-torneos`. El resultado final es
**214/214 byte-idénticos**, sin archivos históricos modificados.

El SHA-256 del manifiesto ordenado `SHA-256 + ruta` del conjunto es
`ec33175a6296c9edfe6e03ae70c47e0af45b2a8c4fb60f43ee18438d7bf01484`.
El SHA-256 de la serialización ordenada `ruta NUL + contenido` es
`b56067f486429db981047f0cc5a248fb52fe42f2e2859e7e438536777ff3eb59`.

Cuatro históricos originales conservan `OWNER TO postgres` como evidencia no
ejecutable:

- `20260319184500_add_send_match_kicked_notification.sql`;
- `20260322190000_match_kicked_cancels_pending_invite_pushes.sql`;
- `20260323141315_make_notify_admin_join_request_security_definer.sql`;
- `setup_notifications_read_and_survey_constraints.sql`.

La ruta activa contiene únicamente las dos migraciones canónicas y su README.
El catálogo `supabase_migrations.schema_migrations` contiene exclusivamente
`20260727090000` y `20260727215106`; ninguna Stage A, Stage B ni migración de
Torneos se ejecuta como versión adicional.

### Delta de inventario explicado

La baseline previa reconstruida tiene 125 tablas y 448
funciones/sobrecargas. La final tiene 127 y 456, sin objetos removidos.

| Objeto adicional | Origen y necesidad | Seguridad | Cobertura |
| --- | --- | --- | --- |
| `voting_photo_upload_tokens` | Contrato durable de token de un solo uso para foto guest | RLS; sin grants para `anon`/`authenticated`; sólo `service_role` | `securityPatchMigrationsSql` y `securityPatchClientFallback` |
| `voting_photo_slot_claims` | Fija atómicamente la primera ranura elegida por una sesión guest | RLS; sin grants para clientes; sólo `service_role` | `security_patch` (primera elección, reintento, expiración y carrera) |
| `_clamp_player_rating(numeric)` | Clamp canónico 1..10 usado por el reconciliador no-show | Sin `EXECUTE` para clientes | `security_patch` (penalización, rating e idempotencia) |
| `_match_no_show_eligible(bigint)` | Deriva elegibilidad sólo desde encuestas persistidas | `SECURITY DEFINER`, `search_path` fijo, sin `EXECUTE` para clientes | `security_patch` (encuesta cerrada/elegible y rechazo prematuro) |
| `_no_show_confirmed_absent_player_ids(bigint)` | Exige dos votantes distintos y evita autoconfirmación | `SECURITY DEFINER`, `search_path` fijo, sin `EXECUTE` para clientes | `security_patch` (ausente confirmado y penalización única) |
| `process_match_no_show_ranking(bigint, boolean)` | Reconciliación autoritativa, transaccional e idempotente | Sólo participante/admin autenticado; `anon` revocado | `security_patch` (autorización, fórmula, replay y Stage B) |
| `_derive_no_show_streak(uuid)` | Reconstruye racha desde resultados cerrados | `SECURITY DEFINER`, `search_path` fijo, sin `EXECUTE` para clientes | `security_patch` (reconciliación y revocación explícita) |
| `_normalize_award_type(text)` | Normaliza aliases históricos de premios | `anon` revocado; uso acotado por RPC validada | `security_patch` (tipo inválido, ganador real y aliases históricos) |
| `create_notification(text, uuid, jsonb)` | Fanout tipado con contenido generado en servidor | `anon` revocado; autorización por tipo y recurso; `search_path` fijo | `security_patch` (amistad, partido, encuesta, premios, pagos y desafíos) |
| `bind_voting_photo_slot(bigint, text, bigint)` | Claim atómico invocado sólo por Edge Function | `EXECUTE` exclusivo de `service_role`; tablas privadas | `security_patch` y `securityPatchClientFallback` |

### Acceso anónimo efectivo

En `public` sólo hay dos policies aplicables a `anon`, ambas de lectura:

| Relación | Operación | `USING` | `WITH CHECK` | Motivo / test |
| --- | --- | --- | --- | --- |
| `partidos` | `SELECT` | `app_private.is_public_match_visible(id)` | — | Link de partido activo, con código, no borrado/cancelado; golden “Link público…” |
| `jugadores` | `SELECT` | `app_private.is_public_match_visible(partido_id)` | — | Roster del mismo recurso compartido; golden “roster visible” |

No hay DML directo de `anon` sobre tablas `public`. Las nueve vistas públicas
tienen `security_invoker` y heredan RLS. El allowlist anónimo de RPCs tiene 18
firmas: cuatro de links/invitaciones, cinco de votación pública y nueve de
publicación de Torneos. Golden verifica que ningún otro `SECURITY DEFINER` sea
ejecutable por `anon`; las suites de Torneos prueban que los datos privados no
son accesibles y que sólo se proyectan recursos publicados.

En `storage.objects`, `anon` sólo recibe:

| Bucket | Operación | `USING` | `WITH CHECK` | Motivo / test |
| --- | --- | --- | --- | --- |
| `jugadores-fotos` | `SELECT` | `bucket_id = 'jugadores-fotos'` | — | Fotos públicas; suites de Storage Stage A/B y golden |
| `team-crests` | `SELECT` | `bucket_id = 'team-crests'` | — | Escudos públicos; tests de policies y golden |

No existe escritura anónima en Storage. La foto guest pasa por
`issue-voting-photo-token` y `upload-voting-photo`, con estado privado y
`service_role`; el fallback del cliente permanece probado.

## Hardening y adaptaciones

- Se eliminaron 584 sentencias de ownership de la fuente ejecutable; quedan 0
  `OWNER TO` en las migraciones activas. Los cuatro `OWNER TO` históricos
  originales se conservan byte a byte como evidencia no ejecutable.
- Se eliminaron ACL/ownership no portables.
- `anon` conserva SELECT y sólo 18 RPCs públicas explícitas; no conserva
  ningún grant de escritura sobre tablas públicas.
- Se revocaron expresamente `INSERT`, `UPDATE` y `DELETE` de `anon` sobre
  `rating_adjustments` y `no_show_recovery_state`.
- Storage conserva lectura pública y escritura autenticada limitada al
  propietario en `jugadores-fotos` y `team-crests`.
- Se eliminaron las policies amplias
  `jugadores_fotos_authenticated_insert` y
  `jugadores_fotos_authenticated_update`.
- `create_notification` usa `public.notifications.id%TYPE`, corrigiendo la
  adaptación interna al UUID canónico sin cambiar RPC, payload ni
  comportamiento observable.
- RLS permanece default-deny y los flujos públicos de votación, invitaciones,
  ingreso guest y fotos guest vía Edge Functions están cubiertos por tests.

## Certificación

Se ejecutaron cinco `supabase db reset --local --no-seed` consecutivos
después del último cambio de esquema. Los cinco terminaron correctamente.

| Suite | Resultado |
| --- | --- |
| Golden Supabase real local | 41/41 |
| Seguridad DB | 104/104 |
| DB integración Arma2 personal/auto-match | 420/420 |
| DB integración Arma2 Torneos | 879/879 en 9 suites |
| Jest frontend/servicios/migraciones | 248 suites, 1.856 tests |
| ESLint | aprobado |
| Build con flags apagados | aprobado |
| Build con Torneos habilitado y Multimedia apagado | aprobado |
| Guard de fuente de migraciones | 2 migraciones canónicas |
| `git diff --check` | limpio |
| Secret scan / project-ref scan | 0 / 0 |

La repetición focal posterior a la inspección de integridad también aprobó:
`supabase db reset --local --no-seed`, golden 41/41, seguridad 104/104,
`migrations:guard` con dos archivos y `git diff --check`. En catálogo: 0
`SECURITY DEFINER` sin `search_path`, 0 tablas `public` sin RLS, 0 DML
innecesario de `anon`, 0 policies cliente con `WITH CHECK (true)`, 0
`public.exec_sql` y 0 `public.compute_awards_for_match`.

El cron `push_sender_dispatch_scheduler` se probó con trabajo listo y Vault
vacío dentro de una transacción revertida: respondió `misconfigured` con
`missing_vault_secrets`, no generó `request_id` y por lo tanto falla cerrado.

Auth, PostgREST, Storage y los contenedores DB/Realtime quedaron saludables.
La publicación Realtime contiene cuatro tablas y la estructura `pg_cron`
contiene ocho jobs.

## Estado de producto

- **Multimedia Upload:** apagado. No existe bucket `tournament-media`; las
  cargas reales siguen fail-closed.
- **Estudio Social:** apagado. No se agregaron objetos ni permisos.
- **Torneos:** aislado por flags, apagado por defecto y certificado también
  en build opt-in.
- **Arma2 personal 1.1.20/40:** contrato observable y suites golden,
  seguridad, integración y frontend aprobados sin cambios funcionales.

## Próximo paso

Revisar este inventario y sus logs. Sólo después de aprobar la transferencia
y certificación corresponde crear el commit y el PR independiente contra
`epic/arma2-torneos`. Antes de cualquier transición remota de Supabase debe
ensayarse sobre un proyecto temporal nuevo; este trabajo no la autoriza.
