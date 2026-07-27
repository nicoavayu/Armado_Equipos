# Matriz de permisos

La UI utiliza capacidades, no comparaciones dispersas de roles. La matriz se replica en `domain/capabilities.js` para UX y en `tournament_role_capabilities()` para RLS/RPC. El backend siempre vuelve a evaluar.

## Capacidades vigentes

| Capacidad | Owner | Admin | Collaborator |
|---|:---:|:---:|:---:|
| `organization.read` | ✓ | ✓ | ✓ |
| `organization.update` | ✓ | ✓ | — |
| `organization.archive` | ✓ | — | — |
| `members.read` | ✓ | ✓ | ✓ |
| `members.invite` | ✓ | ✓ | — |
| `members.update_role` | ✓ | ✓ | — |
| `members.remove` | ✓ | ✓ | — |
| `workspace.access` | ✓ | ✓ | ✓ |
| `workspace.manage` | ✓ | ✓ | — |
| `seasons.read` | ✓ | ✓ | ✓ |
| `seasons.create` | ✓ | ✓ | — |
| `seasons.update` | ✓ | ✓ | — |
| `seasons.archive` | ✓ | ✓ | — |
| `tournaments.read` | ✓ | ✓ | ✓ |
| `tournaments.create` | ✓ | ✓ | — |
| `tournaments.update` | ✓ | ✓ | — |
| `tournaments.change_status` | ✓ | ✓ | — |
| `tournaments.archive` | ✓ | ✓ | — |
| `categories.read` | ✓ | ✓ | ✓ |
| `categories.create` | ✓ | ✓ | — |
| `categories.update` | ✓ | ✓ | — |
| `categories.archive` | ✓ | ✓ | — |
| `competition_rules.read` | ✓ | ✓ | ✓ |
| `competition_rules.update` | ✓ | ✓ | — |

Las capacidades de invitación y administración están preparadas, pero la UI de invitación permanece deshabilitada hasta implementar tokens, expiración, aceptación y revocación de forma completa.

## Invariantes

- Nadie puede asignarse una membership directamente desde el cliente.
- Un admin no puede archivar la organización.
- Un admin no puede modificar al owner.
- Ningún usuario puede cambiar su propio rol mediante esta fase.
- El owner activo no se puede degradar ni borrar.
- Roles desconocidos resuelven a cero capacidades.
- Memberships `suspended` o `removed` resuelven a cero acceso.
- Un collaborator puede consultar toda la configuración, pero ninguna RPC de
  mutación acepta su rol.
- El cliente no recibe grants de escritura directa sobre tablas competitivas.

## Roles futuros

Tournament manager, fixture manager, match official, discipline manager, content manager y viewer se incorporarán cuando existan recursos deportivos concretos. No se agregan roles sin una matriz de capacidades y enforcement de servidor.

## Equipos y planteles

- Owner/Admin: alta, invitación, edición, revisión, aprobación, rechazo y retiro.
- Collaborator: lectura organizacional únicamente.
- Captain/Delegate: lectura y edición relacional de su `team_entry_id`; presenta
  y corrige, pero nunca aprueba.
- Assistant: lectura relacional sin administración organizacional.

## Operación de partidos

| Familia | Owner | Admin | Collaborator | Captain/Delegate | Jugador |
|---|:---:|:---:|:---:|:---:|:---:|
| `match_operations.read` | ✓ | ✓ | ✓ | su partido | publicado |
| `match_operations.open/update_draft/submit` | ✓ | ✓ | — | — | — |
| `match_operations.review/validate/make_official` | ✓ | ✓ | — | — | — |
| `match_operations.request_correction/correct/void` | ✓ | ✓ | — | — | — |
| `match_squads.read` | ✓ | ✓ | ✓ | su equipo | propia publicación |
| `match_squads.manage/submit` | ✓ | ✓ | — | su equipo | — |
| `match_availability.read` | ✓ | ✓ | ✓ | su equipo | propia |
| `match_availability.respond_self` | — | — | — | si es jugador | propia |
| `match_availability.record_manual` | ✓ | ✓ | — | su equipo | — |
| `match_events.read` | ✓ | ✓ | ✓ | su partido | oficial |
| `match_events.create/void` | ✓ | ✓ | — | — | — |
| `match_outcomes/scores/administrative_results.manage` | ✓ | ✓ | — | — | — |

Captain/delegate y jugador se autorizan por relación en cada RPC; no reciben
membership ni capabilities organizacionales. El usuario que presenta un acta
no puede validarla.

## Proyecciones, clasificación y disciplina

| Familia | Owner | Admin | Collaborator | Captain/Delegate | Jugador |
|---|:---:|:---:|:---:|:---:|:---:|
| `standings/statistics/qualification/discipline/suspensions.read` | ✓ | ✓ | ✓ | publicado relacionado | publicado relacionado |
| `standings.rebuild/publish/override` | ✓ | ✓ | — | — | — |
| `statistics.rebuild` | ✓ | ✓ | — | — | — |
| `qualification.resolve/override` | ✓ | ✓ | — | — | — |
| `discipline.manage/resolve/override` | ✓ | ✓ | — | — | — |
| `suspensions.manage/mark_served` | ✓ | ✓ | — | — | — |

Los roles relacionales nunca reciben estas capabilities: RLS resuelve su
relación y oculta drafts e información interna.

## Participant Hub autenticado

| Lectura/acción | Owner/Admin | Collaborator | Captain/Delegate | Jugador |
|---|:---:|:---:|:---:|:---:|
| Ver torneos relacionados | ✓ | ✓ | su inscripción | su roster |
| Ver fixture/resultados/tabla publicados | ✓ | ✓ | categoría relacionada | categoría relacionada |
| Ver equipos/roster publicable | ✓ | ✓ | categoría relacionada | categoría relacionada |
| Ver disponibilidad/convocatoria | agregados autorizados | — | su equipo | propia |
| Responder disponibilidad | si integra roster | si integra roster | si integra roster | propia |
| Ver sanciones personales | si integra roster | si integra roster | si integra roster | propia |
| Abrir gestor organizacional | por capability | — | — | — |

La relación se comprueba nuevamente al abrir el hub, cambiar categoría y abrir
un partido. Haber visitado antes una URL no conserva acceso.
