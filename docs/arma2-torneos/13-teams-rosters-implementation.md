# Equipos, inscripciones y planteles

## Alcance

Esta fase implementa la participación de equipos sin crear fixture, partidos,
resultados, estadísticas ni comunicaciones productivas. Continúa aislada detrás
del feature gate de Torneos y admite sólo backend local o staging dedicado.

```text
registration → alta/invitación → edición del capitán → presentación
→ observación/corrección → aprobación → equipo y plantel habilitados
```

## Modelo

`public.teams` conserva la identidad general del equipo. Una fila de
`tournament_team_entries` es el snapshot de su participación en una categoría.
Puede vincular `arma2_team_id`, pero sus datos competitivos no se sobrescriben
cuando cambia el equipo general.

`public.jugadores` no se reutiliza como catálogo porque representa participantes
de partidos. Un jugador Arma2 se referencia por `auth.users.id`; nombre, avatar y
posiciones son snapshots. Quien no tiene cuenta vive en
`tournament_provisional_players`. El claim futuro está modelado pero deshabilitado.

La migración `20260725210000_tournament_teams_rosters.sql` agrega:

- `tournament_roster_settings`
- `tournament_team_entries`
- `tournament_team_managers`
- `tournament_team_invitations`
- `tournament_provisional_players`
- `tournament_rosters`
- `tournament_roster_players`
- `tournament_team_reviews`
- `tournament_audit_log`

Los FKs compuestos preservan organización, torneo, temporada, categoría,
inscripción y plantel. Índices parciales bloquean el mismo equipo vinculado,
usuario o provisional duplicado. Advisory locks serializan altas contra el máximo
y aprobaciones cross-team.

El mínimo inicial usa `team_size`; el máximo suma suplentes configurados o, si no
existen, otro equipo completo. Los settings siguen siendo personalizables.

## Estados

Inscripción:

```text
draft → invited/in_progress
invited → in_progress
in_progress → submitted
submitted → changes_requested/approved/rejected
changes_requested → submitted
draft/invited/in_progress/changes_requested/approved → withdrawn
estados administrativos permitidos → archived
```

Plantel:

```text
draft → submitted
submitted → changes_requested/approved
changes_requested → submitted
approved → locked/superseded (reservados para una ventana futura)
```

La aprobación vuelve a validar mínimos, máximos, arqueros, dorsales, posiciones y
exclusividad. Cuando `require_individual_player_approval` está activo, todos los
jugadores deben estar explícitamente habilitados; cuando
`allow_players_without_account` está apagado, tampoco se admiten provisionales.
Un plantel aprobado no vuelve a edición silenciosamente y puede bloquearse
explícitamente con una RPC administrativa.

## RPCs

- Contexto: `get_tournament_teams_context`, `get_team_registration_context`.
- Inscripción: `create_tournament_team_entry`,
  `update_tournament_team_entry`, `submit_tournament_team_entry`,
  `review_tournament_team_entry`, `approve_tournament_team_entry`,
  `reject_tournament_team_entry`, `withdraw_tournament_team_entry`,
  `archive_tournament_team_entry`.
- Responsables: `invite_tournament_team_manager`,
  `accept_tournament_team_invitation`,
  `revoke_tournament_team_invitation`.
- Plantel: `create_tournament_provisional_player`,
  `add_tournament_roster_player`, `update_tournament_roster_player`,
  `remove_tournament_roster_player`, `validate_tournament_roster`,
  `lock_tournament_roster`.
- Autocomplete: `search_tournament_players`,
  `search_tournament_arma2_teams`.

Las búsquedas exigen dos caracteres, limitan a doce resultados, normalizan
acentos/case y no proyectan email, teléfono, nacimiento o documento. El
organizador busca dentro de su tenant; un capitán o delegado sólo puede buscar
jugadores desde su propia inscripción editable. La búsqueda de equipos devuelve
únicamente equipos permanentes que el usuario puede administrar. Ambas tienen
rate limit de 30 consultas por minuto y dejan auditoría sin PII.

## Capabilities y RLS

Owner/Admin reciben `team_entries.*`, `team_managers.*`, `rosters.*`,
`roster_players.*`, `provisional_players.*` y el override reservado.
Collaborator recibe sólo lectura.

Capitán y delegado no reciben capabilities organizacionales: el backend resuelve
su relación con `is_tournament_team_manager(team_entry_id)`. El route guard
permite abrir sólo esa inscripción incluso sin membership del workspace.

Todas las tablas tienen RLS. Las mutaciones son RPC-only. Para evitar filtrar
datos sensibles, `authenticated` recibe `SELECT` sólo sobre columnas públicas:
quedan fuera emails y hashes de invitación, datos de contacto provisionales y
metadata interna. Las funciones definer validan `auth.uid()`, usan
`search_path = ''`, schemas explícitos y grants mínimos.

Las escrituras comprueban nuevamente organización, torneo, categoría, estado y
ventana temporal. Capitán y delegado deben estar activos; un responsable
pendiente no obtiene acceso. Los recursos archivados salen de las políticas de
lectura operativa.

## Invitaciones

La RPC genera 32 bytes aleatorios y persiste sólo SHA-256. El token expira a los
siete días, es revocable, de un solo uso y exige una identidad autenticada con
email verificado que coincida exactamente con el destinatario normalizado. La
aceptación vuelve a comprobar tenant, torneo, categoría y ventana. El token plano
aparece una vez con `environment: test-only`.

No se envían emails ni notificaciones. QA copia el enlace manualmente. El alta
de una inscripción provisional genera el enlace en un segundo paso visible una
sola vez; no crea responsables activos a partir de datos aportados por el
cliente.

## Auditoría

`tournament_audit_log` es append-only: no tiene grants de escritura y un trigger
rechaza `UPDATE/DELETE`. `append_tournament_audit` acepta metadata acotada a
8 KiB. Registra altas, ediciones, invitaciones, aceptación, revocación,
jugadores, presentación, observación, aprobación, rechazo, retiro, archivo,
bloqueo y búsquedas sin tokens ni PII.

## Rutas y UX

- `/torneos/organizacion/:organizationId/equipos`
- `/torneos/organizacion/:organizationId/equipos/nuevo`
- `/torneos/organizacion/:organizationId/equipos/:teamEntryId`
- `/torneos/organizacion/:organizationId/equipos/:teamEntryId/inscripcion`
- `/torneos/organizacion/:organizationId/equipos/:teamEntryId/plantel`
- `/torneos/organizacion/:organizationId/equipos/:teamEntryId/revision`
- `/torneos/invitacion/equipo/:token`

La lista usa filtros y métricas reales. En móvil las filas son tarjetas, los
controles tienen 44 px mínimos y las acciones críticas permanecen visibles. El
autocomplete tiene debounce, descarta respuestas fuera de orden y crea
provisionales desde el texto buscado.

## Evidencia visual de QA

Las capturas siguientes se generaron con los componentes productivos y un
servicio efímero en memoria. Usan fixtures sintéticos, no representan datos
reales y el arnés no forma parte del código entregado.

| Viewport | Recorrido | Evidencia |
| --- | --- | --- |
| 320 × 700 | Lista, métricas y CTA | [teams-mobile-320.jpg](assets/teams-mobile-320.jpg) |
| 390 × 844 | Alta manual | [new-team-mobile-390.jpg](assets/new-team-mobile-390.jpg) |
| 768 × 1024 | Plantel y requisitos | [roster-tablet-768.jpg](assets/roster-tablet-768.jpg) |
| 1440 × 900 | Revisión e historial | [review-desktop-1440.jpg](assets/review-desktop-1440.jpg) |

En los cuatro casos `scrollWidth` coincidió con el ancho del viewport. La
primera pasada detectó y corrigió un crecimiento intrínseco del grid en 320 px
y contraste insuficiente en el progreso completo.

## Storage, pruebas y limitaciones

Storage no se conecta: `shield_path` permanece opcional y la UI usa monograma.

`scripts/db-integration/torneos-teams-rosters.mjs` aplica desde cero workspaces,
competition core y esta fase en PostgreSQL embebido. La auditoría final ejecutó
221 checks DB: 61 de workspaces, 72 de competition core y 88 de esta fase. La
cobertura focalizada incluye RLS, grants por columna, idempotencia, concurrencia,
capitán, collaborator, cross-tenant, provisionales, snapshots permanentes,
presentación, observación, aprobación, archivo/bloqueo, auditoría e invitaciones
verificadas de un solo uso. Jest cubre estados, requisitos, contratos,
lista/filtros, acceso relacional y redacción de tokens en rutas de retorno.

Docker no está instalado en el entorno de desarrollo, por lo que no se levantó
Supabase local. PostgreSQL embebido no equivale completamente a Supabase. Antes
de lanzamiento se requiere repetir en staging dedicado. Siguen fuera de alcance
emails, claim, Storage, transferencias, fixture, partidos, tabla, disciplina y
estadísticas.
