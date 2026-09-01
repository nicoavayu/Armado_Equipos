# Comunicados, documentos oficiales y notificaciones internas

## Alcance de la fase

Esta fase agrega un canal institucional autenticado dentro de Torneos. No
conecta el dominio con notificaciones productivas existentes ni habilita push,
email, SMS, WhatsApp, cron, Edge Functions, Storage o páginas públicas.

La separación conceptual es deliberada:

- un **comunicado** es contenido informativo publicado por una organización;
- un **documento oficial** es una referencia versionada e inmutable;
- una **notificación interna** es una entrega breve que habilita el comunicado
  en el inbox de una cuenta relacionada;
- una **preferencia** configura canales futuros, nunca autorización.

## Entidades

### `tournament_announcements`

Identidad y versión de un comunicado. Requiere organización, temporada y
torneo; la categoría es opcional. Los estados son `draft`, `scheduled`,
`published`, `superseded`, `archived`, `cancelled` y `revoked`.

Título, resumen y cuerpo son texto plano con límites explícitos. Los constraints
rechazan `<` y `>` para que HTML, scripts, iframes, formularios y estilos no
puedan convertirse en contenido ejecutable. No existe editor HTML.

Un comunicado publicado es inmutable. Una corrección crea otro registro con
`version`, `supersedes_id` y `correction_reason`. La publicación de la
corrección mueve el anterior a `superseded`, sin borrar su entrega ni lecturas.
Si existen borradores alternativos sobre la misma versión, sólo el primero que
se publica puede avanzar; los demás fallan cerrados.

### `tournament_announcement_audiences`

Describe criterios estructurados:

- organización;
- participantes del torneo;
- categoría;
- equipo;
- capitanes/delegados;
- jugadores;
- participantes de partido;
- local;
- visitante;
- usuario específico relacionado.

Cada forma tiene un constraint de shape. No acepta arrays de destinatarios. Los
IDs de categoría, equipo y partido se revalidan contra organización, torneo,
estado y fixture publicado.

### `tournament_announcement_deliveries`

Snapshot deduplicado por comunicado y usuario. Sus estados son `available`,
`read`, `confirmed`, `archived` y `revoked`. Una entrega sólo se crea durante
una publicación atómica y no dispara un proveedor externo.

La entrega no reemplaza autorización: inbox, detalle y confirmación vuelven a
resolver la audiencia original contra relaciones actuales. Mantener otra
relación dentro del mismo torneo no conserva acceso a un aviso privado del
equipo o categoría anterior, y una relación removida no conserva acceso por
haber recibido antes un UUID.

### `tournament_announcement_links`

Los enlaces internos usan tipo y recurso. Torneo, categoría, partido, jornada,
tabla, disciplina y documento se validan contra el scope. Los externos deben
usar HTTPS y el cliente muestra el dominio. Se rechazan rutas arbitrarias y
esquemas como `javascript:`.

### Documentos

`tournament_documents` conserva la identidad, tipo, título, alcance y versión
activa. `tournament_document_versions` conserva contenido, vigencia, número,
motivo y estado. Una versión publicada es inmutable; publicar otra supersede la
anterior. `tournament_document_acknowledgements` registra `read` o `confirmed`
por versión y usuario.

El contenido es estructurado en base de datos. Esta fase no sube archivos.

### Preferencias

`tournament_notification_preferences` contiene:

- generales;
- cambios de partidos;
- convocatorias;
- disciplina;
- documentos;
- resúmenes.

Se actualiza sólo para `auth.uid()`. Avisos urgentes de un partido propio,
sanciones propias y documentos requeridos siguen presentes en el inbox. Las
preferencias preparan canales futuros y no alteran RLS ni entregas.

## Capabilities

El resolver dedicado `tournament_communications_role_capabilities` expone:

```text
announcements.read
announcements.create
announcements.update_draft
announcements.publish
announcements.schedule
announcements.archive
announcements.revoke
documents.read
documents.create
documents.update_draft
documents.publish
documents.archive
audiences.preview
deliveries.read_summary
notification_preferences.manage_self
```

Owner y admin tienen administración operativa completa. Collaborator puede
leer y preparar sus propios drafts y documentos, pero no publicar, archivar ni
revocar. Capitán, delegado y jugador leen sólo entregas relacionadas y
administran sus propias preferencias.

La UI consume capabilities resueltas por backend. No infiere autorización a
partir de strings de rol dispersos.

## Publicación y audiencia

La publicación:

1. valida sesión, capability, estado y organización;
2. bloquea el comunicado `FOR UPDATE`;
3. adquiere un advisory lock por organización;
4. aplica rate limit de 20 publicaciones por hora;
5. exige entre 1 y 12 criterios;
6. resuelve cuentas desde memberships, managers y rosters actuales;
7. deduplica múltiples relaciones;
8. rechaza cero o más de 5000 destinatarios;
9. crea todas las entregas con `INSERT ... SELECT`;
10. guarda criterio, cantidad y hora en `audience_snapshot`;
11. publica o hace rollback completo;
12. agrega auditoría append-only.

El conteo de preview es informativo. La publicación vuelve a resolver y devuelve
`audienceChanged` si la cifra enviada como expectativa dejó de coincidir.

Jugadores provisionales sólo son destinatarios cuando el provisional está
`claimed` y vinculado a una cuenta. Equipos retirados, memberships suspendidas,
managers revocados, categorías archivadas, fixtures superseded, rosters
superseded y jugadores removidos no resuelven.

## Programación futura

`scheduled_for` y el estado `scheduled` están modelados, pero
`scheduledPublishingEnabled` es `false`. No existe daemon ni cron oculto. Un
scheduled permanece cerrado hasta una llamada explícita y autorizada al RPC de
publicación. La UI lo explica y no promete automatización productiva.

## RPCs

Mutaciones organizativas:

- `create_tournament_announcement_draft`
- `update_tournament_announcement_draft`
- `set_tournament_announcement_audience`
- `replace_tournament_announcement_audience`
- `set_tournament_announcement_link`
- `preview_tournament_announcement_audience`
- `publish_tournament_announcement`
- `archive_tournament_announcement`
- `revoke_tournament_announcement`
- `create_tournament_document`
- `create_tournament_document_version`
- `update_tournament_document_draft`
- `publish_tournament_document_version`
- `archive_tournament_document`

Lecturas y acciones personales:

- `get_tournament_communications_inbox`
- `get_tournament_announcement`
- `mark_tournament_announcement_read`
- `get_published_tournament_documents`
- `acknowledge_tournament_document`
- `get_my_tournament_notification_preferences`
- `update_my_tournament_notification_preferences`

Contexto organizativo:

- `get_tournament_communications_admin_context`

Todos los RPCs de cliente derivan actor de `auth.uid()`, son
`SECURITY DEFINER`, fijan `search_path = ''`, usan schemas explícitos, revocan
`PUBLIC`/`anon` y conceden sólo `authenticated`. Los helpers de autorización y
resolución no son ejecutables por el cliente.

Las tablas tienen RLS sin grants directos para `anon` o `authenticated`; todas
las escrituras son RPC-only.

## Idempotencia, abuso y concurrencia

- creación deduplicada por organización, autor e idempotency key;
- reusar una clave con otro payload falla como conflicto;
- publicación ya completada devuelve el mismo resultado;
- unique por comunicado/usuario impide entregas duplicadas;
- advisory lock evita bypass concurrente del rate limit;
- máximo 100 drafts abiertos por autor/organización;
- máximo 12 audiencias, 5 enlaces y 5000 destinatarios;
- inbox limitado a 50 filas por página y offset máximo 5000;
- contextos organizativos limitan listados grandes a 100;
- longitudes máximas: título 120, resumen 280, comunicado 12000 y documento
  20000 caracteres.

Los índices corresponden a consultas reales: drafts por autor, comunicados por
scope/estado, inbox por destinatario/estado/fecha, resumen de entregas por
comunicado, documentos por scope y versiones por documento.

## Lectura y confirmación

La acción visible es “Marcar como leído” o “Confirmo que lo leí”. El payload
declara `confirmationIsLegalAcceptance: false`. Una nueva versión documental no
borra confirmaciones de la versión anterior.

Revocar un comunicado conserva sus lecturas, cambia las entregas a `revoked` y
audita el motivo. No hay eliminación física de publicados.

## Rutas y experiencia

- `/torneos/comunicados`: inbox personal entre torneos;
- `/torneos/torneo/:tournamentId/novedades`: Novedades, documentos y
  preferencias dentro del Participant Hub;
- `/torneos/organizacion/:organizationId/comunicaciones`: compositor y
  documentos para organizadores.

El inbox prioriza urgente, importante y luego fecha. Cada card comunica emisor,
torneo, categoría, fecha, tipo y lectura. Urgencia usa texto, icono y borde; no
depende sólo del color.

El compositor tiene seis pasos: tipo, contenido, audiencia, contexto, preview y
confirmación. La preview móvil muestra título, resumen, prioridad, CTA, criterio
y cantidad estimada. El CTA usa una ruta canónica al torneo, categoría o partido
elegido y se revalida al publicar. Publicar describe el efecto irreversible e
interno.

Las superficies tienen skeleton, vacío, error/offline, draft, scheduled,
published, superseded, revoked, read-only, audiencia vacía, audiencia cambiada y
éxito atómico.

## Accesibilidad y responsive

CSS define breakpoints compactos, móvil/tablet y desktop. Los targets son de al
menos 44 px, el foco es visible, labels y fieldsets conservan semántica,
prioridad no depende de color, el layout reduce a una columna y los pasos
admiten scroll local sin overflow global. `prefers-reduced-motion` elimina
animaciones y transiciones.

## Límites de esta fase

- no push, email, SMS ni WhatsApp;
- no cron ni publicación automática;
- no Storage ni archivos;
- no comentarios, chat ni respuestas;
- no página pública;
- no conexión con el sistema productivo existente de notificaciones;
- no significado de aceptación legal;
- no migración cloud ni datos reales.

Antes de habilitar un canal externo se requiere una auditoría de compatibilidad,
consentimiento, preferencias, proveedores, rate limits, observabilidad,
retención y rollback.
