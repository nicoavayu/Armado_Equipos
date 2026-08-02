# Implementación de workspaces

## Alcance

Esta fase permite:

```text
usuario autenticado
→ crea organización en una transacción
→ recibe membership owner
→ la organización queda activa
→ entra al dashboard privado
→ cambia a Arma2 personal
→ vuelve a una organización autorizada
→ el backend conserva el último contexto
```

No implementa temporadas, torneos deportivos, categorías, equipos, planteles, fixture, partidos, resultados, tabla, estadísticas, disciplina, comunicaciones, placas, páginas públicas ni integración con datos productivos.

## Entorno

Implementación utilizada:

- rama `feature/torneos-workspaces`;
- worktree independiente;
- Postgres embebido para migración, seed ficticio y RLS;
- Supabase CLI instalado, pero stack Docker no disponible;
- ningún proyecto Supabase cloud enlazado;
- ninguna variable, usuario o dato productivo utilizado.

Estrategia para Preview/QA:

1. Crear un proyecto Supabase exclusivo de staging.
2. Aplicar migraciones desde un checkout controlado de la epic.
3. Configurar Auth, Database y Storage del Preview con ese mismo proyecto.
4. Crear únicamente usuarios ficticios.
5. Establecer `REACT_APP_DEPLOY_ENV=staging`.
6. Establecer `REACT_APP_TORNEOS_DATA_ENV=staging`.
7. Establecer `REACT_APP_TORNEOS_STAGING_PROJECT_REF` con el project ref de staging.
8. Activar sólo producto, workspaces y selector.
9. Mantener deep links, notificaciones, estadísticas oficiales, páginas públicas y generador social apagados.

No se debe mezclar Auth productivo con base staging.

## Variables

```text
REACT_APP_DEPLOY_ENV
REACT_APP_TORNEOS_DATA_ENV
REACT_APP_TORNEOS_STAGING_PROJECT_REF
REACT_APP_TORNEOS_ENABLED
REACT_APP_TORNEOS_WORKSPACES_ENABLED
REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED
REACT_APP_TORNEOS_DEEP_LINKS_ENABLED
REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED
REACT_APP_TORNEOS_OFFICIAL_STATS_ENABLED
REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED
REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED
```

Resolución fail-closed:

- sólo `true` literal;
- deploy environment allowlisted;
- backend local o staging comprobado;
- project ref productivo conocido bloqueado aunque se etiquete como staging;
- producción fuerza todo apagado;
- variables faltantes o inválidas fuerzan apagado.

## Tablas

### `tournament_organizations`

Campos: `id`, `name`, `slug`, `logo_path`, `status`, `created_by`, `creation_key`, `created_at`, `updated_at`, `archived_at`.

Constraints:

- nombre trimmeado de 3 a 80 caracteres;
- slug normalizado de 3 a 48;
- slug único;
- estado `active` o `archived`;
- `archived_at` consistente con estado;
- `creation_key` única por creador;
- logo limitado a una ruta relativa de storage, sin esquemas, query strings ni
  segmentos de traversal.

### `tournament_organization_members`

Campos: `id`, `organization_id`, `user_id`, `role`, `status`, `created_at`, `updated_at`, `invited_by`, `joined_at`.

Constraints e índices:

- roles `owner`, `admin`, `collaborator`;
- estados `active`, `suspended`, `removed`;
- `joined_at` obligatorio en esta fase sin invitaciones pendientes;
- membership única por organización/usuario;
- índice parcial: un owner activo por organización;
- índices de lookup por usuario y organización;
- trigger que impide remover/degradar al owner activo.

### `user_workspace_preferences`

Campos: `user_id`, `workspace_type`, `active_organization_id`, `updated_at`.

`personal` exige organización nula; `tournament_organization` exige organización no nula. La RPC vuelve a validar membership en cada carga.

## Policies RLS

| Tabla | Operación cliente | Regla |
|---|---|---|
| organizations | SELECT | membership y organización activas |
| organization_members | SELECT | capacidad `members.read` en el tenant |
| workspace_preferences | SELECT | `user_id = auth.uid()` |
| las tres | INSERT/UPDATE/DELETE | sin policy; denegado |

Los helpers `is_tournament_organization_member()` y `has_tournament_organization_capability()` son `SECURITY DEFINER`, `STABLE`, con `search_path=''`, filtros explícitos y grants mínimos. No usan SQL dinámico.

## Funciones y RPCs

### `create_tournament_organization`

- exige `auth.uid()`;
- no acepta `user_id`;
- normaliza y valida nombre/slug de forma consistente con acentos españoles;
- rechaza términos reservados;
- limita cinco creaciones cada diez minutos;
- serializa las creaciones por usuario para sostener idempotencia y rate limit
  también bajo concurrencia;
- crea organization, owner y preferencia en una transacción;
- una repetición con la misma clave devuelve la misma organización;
- devuelve JSON allowlisted.

### `get_tournament_workspace_context`

- obtiene sólo organizaciones activas del usuario;
- incluye rol y capacidades;
- valida la preferencia;
- proyecta como `personal` las preferencias ausentes, revocadas o archivadas;
- no inserta, actualiza ni repara preferencias durante una lectura;
- vuelve a `personal` sin revelar datos del tenant anterior ni cambiar la fila
  almacenada.

### `is_tournament_organization_slug_available`

Comprueba disponibilidad sin devolver datos de la organización. Exige sesión, normaliza el valor y rechaza slugs inválidos o reservados. La creación vuelve a comprobar dentro de la transacción para evitar carreras.

### `set_tournament_workspace_preference`

Permite `personal` o una organización activa con `workspace.access`. Es el único
RPC que persiste esta selección; reemplazar `organization_id` en DevTools no
supera la validación.

### `update_tournament_organization`

Requiere `organization.update`; archivar requiere además `organization.archive`. Nombre, slug y estado se revalidan en servidor. Archivar limpia preferencias activas.

## Rutas

```text
/torneos
/torneos/nueva-organizacion
/torneos/organizacion/:organizationId
/torneos/organizacion/:organizationId/inicio
/torneos/organizacion/:organizationId/configuracion
/torneos/organizacion/:organizationId/miembros
```

`/torneos` resuelve preferencia y organizaciones. Las rutas directas esperan el contexto autoritativo, verifican que el UUID pertenezca a la respuesta y recién entonces renderizan. Un UUID ajeno redirige sin revelar nombre o existencia.

Cada revalidación limpia primero los datos privados en memoria. Respuestas
anteriores fuera de orden se ignoran, y volver a enfocar/mostrar la pestaña o
cambiar de workspace en otra pestaña dispara una nueva validación.

## Cambio de shell

```text
Perfil Arma2
  └─ selector habilitado por flags
       ├─ Arma2 → persiste personal → /
       ├─ organización → valida/persiste → /torneos/organizacion/:id/inicio
       └─ crear → /torneos/nueva-organizacion

Torneos
  └─ selector propio
       ├─ Arma2 personal
       ├─ memberships activas
       └─ crear organización
```

Al entrar a Torneos se desmontan providers personales, TabBar, onboarding, mapas, push, listeners de notificación, prefetch y analytics de partido.

## UI y capacidades

- dashboard con nombre, logo/placeholder, rol, estado y fecha real;
- acciones de configuración y miembros según capacidades;
- configuración editable por owner/admin;
- collaborator en lectura;
- archivo sólo para owner y con confirmación;
- miembros con identificador minimizado, rol, estado y fecha;
- invitación visible como `Próximamente` y deshabilitada;
- módulos deportivos visibles únicamente como placeholders deshabilitados;
- sin partidos, métricas ni datos ficticios.

## Estados de error

La capa de servicio traduce tokens controlados:

- sesión requerida;
- nombre o slug inválido;
- slug ocupado;
- rate limit;
- workspace u organización prohibidos;
- archivo prohibido;
- owner activo requerido;
- error de red genérico.

No se muestran detalles SQL ni nombres de organizaciones ajenas.

## Tests y seeds

Tests frontend:

```bash
CI=true npm test -- --watchAll=false --runInBand \
  src/__tests__/torneosFeatureFlags.test.js \
  src/__tests__/torneosRouteIsolation.test.jsx \
  src/__tests__/torneosWorkspaceContext.test.jsx \
  src/__tests__/torneosCapabilities.test.js \
  src/__tests__/torneosOrganizationValidation.test.js \
  src/__tests__/torneosOrganizationCreation.test.jsx \
  src/__tests__/tournamentWorkspaceService.test.js \
  src/__tests__/torneosRuntimeIsolation.test.jsx \
  src/__tests__/torneosResponsiveCss.test.js
```

RLS/migración con Postgres embebido:

```bash
npm run test:db:torneos
```

El harness crea usuarios ficticios A, B, C, D, suspendido, admin y actores
separados para concurrencia. Aplica la migración desde cero y prueba
aislamiento, escrituras falsificadas, owner, idempotencia, preferencias,
revocación, colisiones de slug, updates simultáneos y rate limit concurrente.

Con Docker activo, validación Supabase local:

```bash
npx supabase start
npx supabase db reset
npm run test:db:torneos
```

No enlazar el CLI a un proyecto productivo y no ejecutar `npm run db:push` desde esta rama.

## Decisiones descartadas

- Dos clientes/sesiones Supabase en el mismo runtime: aumenta el riesgo de mezclar Auth y datos.
- `localStorage` como autoridad: falsificable y obsoleto tras revocación.
- Inserts directos para crear organization/membership: permiten estados parciales.
- Policies amplias de update: no pueden proteger campos e invariantes con suficiente precisión.
- Invitaciones incompletas por email: se posponen hasta tener token, expiración, aceptación y revocación.
- Logo en esta fase: no se habilita carga hasta contar con bucket staging y policies verificadas.

## Limitaciones y riesgos pendientes

- Falta provisionar y validar staging cloud.
- Docker no estuvo disponible para ejecutar `supabase db reset`; la migración sí fue aplicada desde cero en Postgres embebido.
- `AuthProvider` sigue compartido y resuelve el perfil personal; se acepta para mantener una única sesión.
- La transferencia de ownership no existe; el owner actual queda protegido.
- Invitaciones y mutaciones de memberships no están expuestas.
- No hay audit log todavía; deberá agregarse antes de operaciones deportivas sensibles.

## Próxima fase

Provisionar staging y ejecutar QA con usuarios ficticios; luego implementar temporadas, torneos y categorías sobre esta frontera de organización, sin integrar todavía partidos o estadísticas con Arma2 productivo.
