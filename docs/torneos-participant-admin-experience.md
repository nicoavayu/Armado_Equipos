# Arma2 Torneos: experiencia participante y administración

## Decisión de producto

Arma2 conserva una sola identidad basada en Supabase Auth y `auth.uid()`, pero
dos dominios de producto:

- **Arma2 Jugadores**: partidos informales, grupos, votaciones, auto-match,
  desafíos, perfil y estadísticas generales. Es un producto native-only para
  iOS y Android.
- **Arma2 Torneos**: experiencia autenticada de participantes, responsables de
  equipo, colaboradores y administradores. Está disponible tanto en browser
  como en Capacitor iOS/Android.

No se crean usuarios, sesiones ni cuentas paralelas. Una persona puede ser
jugador en un torneo, capitán en otro y administrar una organización con el
mismo `auth.uid()`.

Las futuras páginas públicas de fixture, resultados, tabla o goleadores no son
parte de esta entrega. Tampoco lo son el sitio de marketing
`arma2.com.ar/torneos` ni billing, Mercado Pago, Apple IAP o Google Billing.

## Situación previa

Las superficies participant y admin ya estaban construidas dentro del mismo
`TorneosShell`, pero el entrypoint `/torneos` sólo resolvía
`get_tournament_workspace_context()` y redirigía automáticamente a la
organización preferida. El Participant Hub existía, aunque quedaba conectado
sólo mediante botones genéricos y el workspace switcher.

Esto producía tres problemas de integración:

1. un participant sin organización no obtenía una portada contextual;
2. un usuario dual podía saltar directamente al admin workspace y perder de
   vista su actividad deportiva;
3. el estado vacío no distinguía entre participación y administración.

No había una diferencia funcional intencional entre web y native dentro de
Torneos: las rutas y componentes ya eran compartidos y responsive.

## Arquitectura encontrada

- `App.js` contiene el router padre y autentica `/torneos/*` con el mismo
  `AppAuthWrapper` que el resto de Arma2.
- `TorneosFeatureGate` aplica los flags globales y monta `TorneosApp`.
- `TorneosApp` monta `TorneosWorkspaceProvider` y `TorneosShell`.
- `TorneosWorkspaceContext` carga la preferencia y organizaciones autorizadas
  mediante `get_tournament_workspace_context()`.
- `TorneosShell` aloja rutas participant, admin y special en una sola jerarquía.
- Los módulos consumen `tournamentWorkspaceService`, que llama RPCs
  autenticadas y tenant-scoped.

La detección canónica de producto se centraliza ahora en
`runtimePlatform.js`, usando `Capacitor.isNativePlatform()` y
`Capacitor.getPlatform()`. No usa viewport, media query ni user-agent. El
viewport sólo adapta layout.

## Clasificación de rutas

### Participant

- `/torneos/mis-torneos`: relaciones devueltas por
  `get_my_tournament_memberships`.
- `/torneos/mis-partidos` y `/:matchId`: partidos del roster del usuario y
  partidos gestionados como capitán/delegado.
- `/torneos/mis-partidos/:matchId/convocatoria`: convocatoria limitada al
  equipo que el usuario gestiona.
- `/torneos/comunicados`: inbox resultante de audiencias server-side.
- `/torneos/torneo/:tournamentId/...`: Participant Hub, fixture publicado,
  resultados, tabla, estadísticas, equipos, fotos y disciplina.

### Admin

Todas viven bajo `/torneos/organizacion/:organizationId/`:

- `inicio`;
- `temporadas` y `torneos`;
- `equipos`, inscripción, plantel y revisión;
- `fixture`, participantes, bombos, sorteo, grupos, jornadas y llave;
- `programacion` y `sedes`;
- `partidos`, acta, revisión e historial;
- `competencia/tabla`, estadísticas, clasificación y disciplina;
- `comunicaciones`;
- `multimedia`;
- `estudio-social`;
- `miembros` y `configuracion`.

La presencia de una ruta no otorga su capacidad de escritura. Las páginas
ocultan o deshabilitan acciones según capabilities y cada RPC vuelve a validar
actor, organización, torneo y recurso.

### Shared

- `/torneos` es el entrypoint unificado.
- `TournamentHubPage` también admite a un miembro de organización porque
  `can_read_tournament_participant_hub` reconoce una relación organizacional
  activa. El payload diferencia `organizationRole`, `managerRole`, `isPlayer`,
  `canManageTournament` y `canManageTeam`.
- `TorneosShell`, auth, estilos responsive, errores y loading states son
  compartidos por web y native.

### Special

- `/torneos/invitacion/equipo/:token`: aceptación de invitación privada y de un
  solo uso; no revela el equipo antes de validar identidad/token.
- `/torneos/organizacion/:organizationId/equipos/:teamEntryId/...`: un
  capitán/delegado puede obtener acceso relacional exclusivamente a su
  inscripción. `OrganizationRouteGuard` no convierte esa relación en una
  membresía administrativa y deja de autorizarla fuera de ese scope.
- La creación de una organización es un flujo de provisioning autenticado. No
  deriva de ser participant y no se presenta como acción de participant.

Los standalone históricos de encuesta, resultados, pagos, invitación y votación
de partidos informales siguen fuera del shell autenticado, pero atraviesan la
misma frontera de producto: conservan sus deep links en native y no montan
Arma2 Jugadores en browser.

## Punto de entrada final

`/torneos` resuelve dos proyecciones server-side existentes:

1. `get_tournament_workspace_context()` para organizaciones/membresías;
2. `get_my_tournament_memberships()` paginada para relaciones deportivas.

El resolver de frontend sólo clasifica esos resultados ya autorizados:

- **participant only**: muestra `Mi actividad`, con Mis torneos, Mis partidos y
  Comunicados; no muestra administración;
- **admin/collaborator only**: muestra `Administrar` y sus organizaciones;
- **participant + admin**: muestra ambas áreas en la misma portada;
- **sin relaciones**: muestra “No participás ni administrás torneos todavía”.

Una relación se considera participant cuando el servidor devuelve un
`teamEntryId` y un rol deportivo (`player`, `captain`, `delegate` o equivalentes
compatibles). Una relación de organización `owner`, `admin` o `collaborator` no
se reetiqueta como participante aunque `get_my_tournament_memberships` permita
consultar el torneo.

La clasificación controla composición y navegación, no autorización. Un
cliente modificado no puede obtener datos adicionales porque los RPCs y RLS
siguen siendo la autoridad.

## Permisos y aislamiento

Las identidades y fuentes se mantienen separadas:

- identidad: Supabase Auth / `auth.uid()`;
- participación: roster activo, team manager o membresía organizacional
  reconocida por `can_read_tournament_participant_hub`;
- administración: membership y capabilities de organización/módulo;
- entitlements: proyección comercial FREE/PRO independiente.

`OrganizationRouteGuard` sólo activa organizaciones presentes en el contexto
server-side. Una URL de Organization B no se valida con datos de Organization
A. Los RPCs participant validan torneo, categoría, fixture publicado, equipo y
roster; los RPCs admin validan organization/tournament scope y capability. Los
errores de acceso se traducen a mensajes seguros sin nombres de tenants.

El rol `collaborator` no equivale a admin completo. El preset general es de
lectura; módulos como Comunicaciones o Estudio Social proyectan sus propias
capacidades más granulares. La navegación no cambia esas capacidades y las
acciones siguen dependiendo del payload del módulo y del RPC correspondiente.

## Entitlements y Social Studio

`20260810160355_tournament_entitlements_foundation.sql` permanece intacta.
FREE/PRO no participa en el resolver del entrypoint y nunca crea roles.

Estudio Social conserva tres compuertas independientes:

1. `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED`;
2. `get_effective_tournament_entitlements()` y
   `social_studio.basic`, consultados fail-closed;
3. capabilities sociales server-side (`social.read`, `social.create`,
   `social.export`, etc.).

El entitlement decide disponibilidad comercial; el rol/permisos decide qué
puede hacer el usuario. No se habilitan flags remotos en esta entrega.

## Frontera web/native

El shell autenticado de Arma2 Jugadores está detrás de
`PlayerProductRouteBoundary`:

- en Capacitor iOS/Android continúa montando `MainLayout`, onboarding, tab bar,
  notificaciones y todas las funciones tradicionales;
- en browser redirige centralmente a `/torneos`, sin montar providers ni
  efectos del runtime personal para esa URL.

Dentro de Torneos, plataforma no decide permisos. Web y native usan las mismas
rutas, componentes, servicios y RPCs. La única diferencia de navegación es que
“Volver a Arma2” y el workspace personal aparecen sólo en native. Un Chrome de
390 px sigue siendo web y mantiene toda la experiencia de Torneos autorizada.

## Matriz de paridad

| Surface | Participant | Admin | Web | Native | Permission source |
| --- | --- | --- | --- | --- | --- |
| Entry `/torneos` | Sí | Sí | Sí | Sí | workspace context + memberships RPC |
| Mis torneos | Sí | Consulta permitida | Sí | Sí | `get_my_tournament_memberships` |
| Mis partidos/disponibilidad | Sí | Si además tiene relación deportiva | Sí | Sí | player/managed matches RPCs |
| Convocatoria propia | Capitán/delegado | Si gestiona ese equipo | Sí | Sí | managed squad RPC |
| Comunicados personales | Sí | Sí | Sí | Sí | audience-scoped communications RPC |
| Tournament Hub | Sí | Sí | Sí | Sí | `can_read_tournament_participant_hub` |
| Fixture/resultados publicados | Sí | Sí | Sí | Sí | participant published RPCs |
| Tabla/estadísticas/disciplina publicada | Sí | Sí | Sí | Sí | published projection RPCs |
| Galerías participant | Según visibilidad/entitlement | Sí | Sí | Sí | participant media RPC + entitlement |
| Organization dashboard | No | Según membership | Sí | Sí | workspace context + route guard |
| Torneos/equipos/planteles admin | No | Según capability | Sí | Sí | organization RPC capabilities |
| Fixture/programación/sedes admin | No | Según capability | Sí | Sí | organization RPC capabilities |
| Actas/resultados admin | No | Según capability | Sí | Sí | match operation RPC capabilities |
| Competencia admin | No | Según capability | Sí | Sí | projection RPC capabilities |
| Comunicaciones admin | No | Granular | Sí | Sí | communications capabilities RPC |
| Multimedia admin | No | Granular + entitlement | Sí | Sí | media capabilities + entitlement |
| Estudio Social | No | Flag + entitlement + permiso | Sí | Sí | feature flag + entitlement RPC + social RPC |
| Miembros/configuración | No | Según capability | Sí | Sí | organization membership capabilities |
| Arma2 Jugadores tradicional | No | No | No | Sí | runtime product boundary |

## Gaps y futuro

- Las páginas públicas de Torneos se implementan en la fase documentada en
  `docs/torneos-public-pages.md`, con URL estable, publicación opt-in y una
  proyección anónima deportiva específica.
- `arma2.com.ar/torneos` sigue perteneciendo al proyecto de marketing separado.
- Billing y providers de pago siguen fuera de alcance.
- Arma2 Jugadores completo es native-only. Los public/special standalone flows
  permitidos mantienen acceso browser aislado según el contrato de cada ruta.
- La compuerta de entitlement de Estudio Social se aplica en el cliente usando
  la proyección canónica existente; una futura fase de enforcement comercial
  puede incorporar el mismo predicado dentro de los RPCs sociales sin modificar
  esta separación de roles.

## Backend y migraciones

Esta experiencia autenticada original no agregó tablas ni RPCs. La fase pública
posterior incorpora una migración nueva y aislada, sin modificar migraciones
históricas ni requerir contacto con Staging o Production; ver
`docs/torneos-public-pages.md`.
