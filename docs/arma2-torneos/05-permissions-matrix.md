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
