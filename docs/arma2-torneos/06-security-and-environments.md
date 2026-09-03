# Seguridad y entornos

## Modelo de entornos

| Recurso | Local | Staging Torneos | Producción Arma2 |
|---|---|---|---|
| Código | feature worktree | epic/preview | `main`/release |
| Supabase | local o proyecto dev | proyecto exclusivo | proyecto actual |
| Storage | local/dev | buckets exclusivos | actual |
| Usuarios | ficticios | ficticios | reales |
| Push | stub/dry run | credenciales sandbox | actual, sin eventos Torneos |
| Analytics | desactivado | proyecto/dataset test | actual, sin eventos Torneos |
| Dominio | localhost | preview privado | sin ruta pública |
| Flags Torneos | opt-in | opt-in | cerradas salvo contrato de Production completo (hoy sin activar) |

Esta fase fue implementada y probada contra Postgres embebido/local. No se provisionó staging cloud porque el entorno no dispone de credenciales de infraestructura y no se reutilizaron credenciales productivas.

## Variables

`REACT_APP_DEPLOY_ENV` identifica `development`, `test`, `preview`, `staging` o `production`. En entornos no productivos las flags requieren `true` literal y backend aislado verificado:

- `REACT_APP_TORNEOS_DATA_ENV=local` sólo acepta `REACT_APP_SUPABASE_URL` en `localhost` o `127.0.0.1`.
- `REACT_APP_TORNEOS_DATA_ENV=staging` exige que `REACT_APP_TORNEOS_STAGING_PROJECT_REF` coincida con el hostname Supabase configurado.
- Cualquier valor faltante o inválido fuerza todas las flags a `false`.

Production tiene un único camino de apertura, explícito y evaluado en conjunto.
Si falta una sola condición, Torneos queda cerrado:

- `NODE_ENV=production` (build de Production real);
- `REACT_APP_DEPLOY_ENV=production`;
- `REACT_APP_TORNEOS_DATA_ENV=production`;
- `REACT_APP_TORNEOS_PRODUCTION_ENABLED=true`, literal;
- `REACT_APP_SUPABASE_URL` exactamente `https://<REACT_APP_PRODUCTION_PROJECT_REF>.supabase.co`, sin puerto, path, query ni credenciales.

La apertura de Production habilita solamente las superficies elegibles
—`TORNEOS`, `WORKSPACES`, `WORKSPACE_SWITCHER`, `DEEP_LINKS`, `NOTIFICATIONS`,
`OFFICIAL_STATS`, `PUBLIC_PAGES`—, cada una todavía con su propia variable en
`true`. Multimedia (`MEDIA_*`) y el generador social quedan cerrados ahí aunque
sus variables digan `true`: su infraestructura no está certificada en
Production. El espacio personal en web sigue disponible sólo en entornos
aislados. Ampliar la lista de superficies elegibles es una decisión explícita.

Nunca se versionan URLs, anon keys, service role keys ni secretos reales. La anon key tampoco sustituye autorización.

## Defensa por capas

- Route gate para no montar la interfaz deshabilitada.
- Autenticación común.
- Resolución de membership y capacidades.
- RLS por operación.
- RPC/API para invariantes multi-entidad.
- políticas de Storage.
- auditoría y observabilidad sin PII innecesaria.
- flags como control de release, no de seguridad.

## RLS implementada

Las tres tablas tienen RLS habilitada. Organizaciones y memberships sólo permiten `SELECT` a memberships activas; preferencias sólo permiten `SELECT` al propio usuario. No hay policies cliente para `INSERT`, `UPDATE` o `DELETE`: los cambios pasan por RPCs controladas.

Los helpers de autorización deben ser estables, testeables y evitar recursión de RLS. Se evalúa una tabla de grants normalizada y funciones `STABLE` con permisos mínimos.

## `SECURITY DEFINER`

Checklist obligatorio:

- necesidad documentada;
- `auth.uid()` no nulo;
- pertenencia y capacidad verificadas;
- IDs resueltos en servidor;
- `SET search_path` fijo;
- SQL dinámico evitado o parametrizado;
- ownership/grants mínimos;
- respuesta sin datos sensibles;
- pruebas positivas, negativas y cross-tenant;
- auditoría dentro de la misma transacción.

## Storage

Buckets separados por propósito: branding público, rosters privados, evidencia disciplinaria privada, contenido generado y exportaciones temporales. Los paths incluyen IDs internos, no slugs confiados. Descargas sensibles usan URLs firmadas breves.

## Datos sensibles y menores

Documentos, contactos, nacimiento y evidencia se separan de proyecciones públicas. Se define propósito, base legal, consentimiento, retención, acceso y borrado antes de almacenar. Torneos de menores quedan fuera del lanzamiento hasta una revisión específica.

## Push y deep links

No se crean eventos Torneos en esta fase. Staging usará tokens de prueba y provider sandbox/dry-run. Un deep link nunca concede permisos y no incluirá secretos permanentes.

## Providers y efectos globales

En `/torneos/*` no se montan `BadgeProvider`, `NotificationProvider`, Google Maps, push, redirects de notificaciones, route prefetch, analytics de partidos, `MainLayout`, TabBar ni onboarding personal.

`AuthProvider` permanece compartido porque aporta una única sesión Supabase. También resuelve el perfil Arma2 y contexto Sentry del usuario; es el único riesgo compartido aceptado en esta fase. No se creó una segunda sesión Supabase.

## Procedimientos operativos

- No ejecutar `supabase db push` desde este worktree.
- No enlazar el CLI al proyecto productivo.
- No copiar dumps productivos.
- No usar service role en el cliente.
- No activar workflows programados.
- Revisar logs para excluir tokens, documentos y contenido de evidencia.
- Rotar secretos si un preview deja de ser controlado.

## Amenazas prioritarias

| Amenaza | Control |
|---|---|
| Cross-tenant por ID/slug | RLS + membership + tests entre organizaciones |
| Workspace local falsificado | servidor autoritativo |
| Escalada por nombre de rol | capacidades normalizadas |
| Enlace/QR reutilizado | token hash, scope, expiración y revocación |
| Edición parcial de resultado | RPC transaccional e idempotency key |
| Fuga en exportación | snapshot allowlisted, autorización al crear y descargar |
| Evidencia pública accidental | bucket privado y proyección separada |
| Notificación a usuario real | proyecto/credenciales sandbox y flags |

## Hardening de inscripciones

Las invitaciones guardan SHA-256 y son de un solo uso. Límites y exclusividad se
revalidan bajo locks. Las tablas nuevas tienen RLS y ninguna escritura directa a
`authenticated`; la auditoría rechaza update/delete. Autocompletados acotan
consulta/resultados y no proyectan PII.

## Hardening de operación de partidos

Las diez entidades nuevas tienen RLS y carecen de escritura directa para
`authenticated`. Los helpers resuelven ambos equipos desde el fixture publicado,
no desde IDs declarados por el cliente. Disponibilidad propia deriva el roster
player de `auth.uid()`; captain/delegate queda acotado a su `team_entry_id`.

Advisory locks e índices parciales impiden dos aperturas, dos oficiales o dos
correcciones activas. Las oficiales rechazan edición directa; eventos se anulan
sin borrar. Score y eventos se revalidan al presentar y oficializar. No hay
Storage, notificaciones, emails, datos productivos ni service role en cliente.

## Hardening de proyecciones oficiales

Las proyecciones tienen RLS y cero escrituras directas de `authenticated`.
Rebuild/publicación/resolución/override son RPCs separadas con `auth.uid()`,
capability, scope compuesto, `search_path = ''`, grants mínimos, locks e
idempotencia. La publicación compara fingerprint y rechaza una revisión stale.
Drafts sólo son visibles para quien puede reconstruir; participantes reciben
publicados por relación. No se ejecutaron migraciones cloud.

## Hardening del Participant Hub

El navegador sólo consume ocho RPCs allowlisted. Todos derivan identidad de
`auth.uid()`, fijan `search_path = ''`, revocan `PUBLIC` y revalidan torneo,
categoría, inscripción y relación activa. Los payloads separan contexto propio
de información publicada y excluyen notas, actores, auditoría, disponibilidad
rival, drafts, avatares sin consentimiento y fingerprints. Tabla y estadísticas
usan contratos participantes distintos de los contratos administrativos. Los
listados tienen límites máximos e índices por scope. No se agregaron canales
públicos, Storage ni ejecución remota.

## Hardening de comunicaciones

Ocho tablas tienen RLS y cero grants directos de cliente. Mutaciones y lecturas
son RPC-only con `auth.uid()`, `search_path = ''`, schemas explícitos, revokes y
grants mínimos. Las audiencias no aceptan arrays arbitrarios: se resuelven desde
memberships, managers, rosters y fixture publicado. Publicar usa row lock,
advisory lock, rate limit, máximo de destinatarios, snapshot, deduplicación,
idempotencia y auditoría en una transacción.

Inbox y detalle revalidan una relación actual además de la entrega. Publicados
y versiones documentales son inmutables; corregir supersede y revocar conserva
historia. HTML, esquemas inseguros y enlaces cross-tenant se rechazan. Push,
email, cron, Edge Functions y Storage permanecen inexistentes.
