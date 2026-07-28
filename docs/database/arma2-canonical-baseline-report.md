# Informe de baseline canónico Arma2

Fecha: 2026-07-28.

Estado: **baseline y correcciones P1 certificadas localmente**.

## Alcance y aislamiento

El trabajo se realizó en
`/Users/nicoavayu/Downloads/arma2/arma2-canonical-p1-fixes`, rama
`feature/canonical-p1-guest-tournament`, creada desde el head exacto del PR
#107:
`feature/arma2-canonical-schema@fa06080e955c01495a362590a7ffe28bfeba653e`.

La transferencia original de la baseline se conserva sin cambios. Esta rama
agrega exclusivamente las correcciones P1 del ingreso guest y del catálogo de
modalidades; no incluye cambios visuales ni estéticos.

No se vinculó ni consultó un proyecto Supabase remoto. No se ejecutaron
`supabase link`, `db pull`, `db push` ni comandos contra producción. No se
modificaron `main`, producción, stores, PR #103, PR #104, PR #107, PR #109, el
worktree fuente, el checkout de release, los cambios iOS locales, `.claude` ni
`build-device`.

## Compatibilidad

El contrato observable final registra:

- 1.093 operaciones Supabase estáticas;
- 44 tablas/vistas consumidas directamente;
- 213 nombres de RPC estáticas;
- 7 Edge Functions invocadas;
- 2 buckets activos;
- 19 suscripciones Realtime.

El detalle navegable está en
[`arma2-functional-contract.md`](./arma2-functional-contract.md). La matriz
objeto por objeto contiene 136 relaciones públicas y 456 nombres únicos de
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
| Sobrecargas de función `public` | 458 |
| Policies `public` + `storage` | 169 |
| Triggers `public` | 115 |
| Índices `public` | 447 |
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
funciones/sobrecargas. La final tiene 127 y 458, sin objetos removidos.

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
| `assign_substitute_slot()` | Restaura la asignación histórica de titulares y hasta cuatro suplentes en orden estable | Trigger interno, lock por partido, sin `EXECUTE` público | `canonical-p1-regressions` (titular, orden 1..4, cupo y carrera) |
| `join_guest_match_with_invite(bigint, text, uuid, text, text)` | Une consumo de invitación e inserción guest en una única transacción idempotente | `EXECUTE` exclusivo de `service_role`; respuesta sanitizada | `canonical-p1-regressions` (errores, replay, carrera y Edge real) |

### Correcciones P1 de QA cloud

**P1-A — ingreso guest.** La baseline retenía
`promote_next_substitute()` y los consumidores seguían leyendo
`substitute_order`, pero `public.jugadores` había perdido la columna y su
trigger de asignación. La Edge Function además consumía la invitación mediante
una RPC y realizaba el `INSERT` del jugador en una segunda operación. Un fallo
entre ambas dejaba consumo parcial.

La evidencia histórica fija el contrato como `smallint`, nullable, sin default,
con índice por
`(partido_id, is_substitute, substitute_order, created_at)`. Los primeros
`cupo_jugadores` son titulares; los siguientes ocupan las posiciones de
suplente 1..4. Al borrar un titular, se promueve primero el menor
`substitute_order`, desempata por `created_at` e `id`, y se reordena la cola.
La corrección restaura exactamente ese contrato. El consumo del token y la
creación del jugador ahora ocurren dentro de
`join_guest_match_with_invite(...)`; el lock por partido serializa cupo, orden
y replay, y cualquier error de inserción revierte el consumo.

**P1-B — modalidades.** La tabla
`tournament_sport_modalities` estaba presente pero la baseline había omitido
las filas originales. Se restauró el seed determinista e idempotente con las
seis claves históricas estables:

| Código | Nombre | Equipo | Suplentes recomendados | Equipo de la fecha | Duración |
| --- | --- | ---: | ---: | ---: | ---: |
| `football_5` | Fútbol 5 | 5 | 3 | 5 | 40 min |
| `football_6` | Fútbol 6 | 6 | 4 | 6 | 50 min |
| `football_7` | Fútbol 7 | 7 | 5 | 7 | 50 min |
| `football_8` | Fútbol 8 | 8 | 5 | 8 | 60 min |
| `football_9` | Fútbol 9 | 9 | 6 | 9 | 70 min |
| `football_11` | Fútbol 11 | 11 | 7 | 11 | 90 min |

Todas requieren arquero. El esquema histórico no define UUID, columna de
deporte, orden adicional ni flag activo, por lo que no se inventó ninguno.

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

La baseline original registró cinco `supabase db reset --local --no-seed`.
Después del último cambio SQL de esta corrección P1 se ejecutaron otros tres
resets consecutivos; los tres terminaron correctamente.

| Suite | Resultado |
| --- | --- |
| Golden Supabase real local | 41/41 + regresiones P1 40/40 |
| Seguridad DB | 104/104 |
| DB integración Arma2 personal/auto-match | 420/420 |
| DB integración Arma2 Torneos | 880/880 en 9 suites |
| Contratos Edge Functions | 14/14 |
| Jest frontend/servicios/migraciones | 249 suites, 1.858 tests |
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

## Reconstrucción remota pendiente

La corrección se entrega en un PR técnico independiente contra
`feature/arma2-canonical-schema`. No autoriza reset, borrado, reconstrucción ni
deploy remoto. Staging debe reconstruirse sólo después de aprobación explícita,
con guard de destino, backup verificable, exactamente las dos migraciones
canónicas, despliegue explícito de Edge Functions y verificación posterior.
Producción y los proyectos pausados permanecen fuera de alcance.
