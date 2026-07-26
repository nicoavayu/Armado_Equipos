# Arquitectura propuesta

## Decisión principal

Construir Arma2 Torneos como un bounded context dentro del monorepo actual, con:

- shell y rutas propios;
- módulos de dominio propios;
- autorización por organización y torneo;
- adaptadores para identidad, perfiles y equipos Arma2;
- backend Supabase separado durante desarrollo;
- reglas de negocio compartidas entre web y móvil.

No se crea una segunda aplicación todavía: compartir el cliente reduce duplicación de autenticación, deep links y diseño. Si el crecimiento del bundle o los ciclos de release lo exigen, el límite modular permitirá extraer otra entry point más adelante.

## Capas

```text
Arma2 personal shell        Arma2 Torneos shell
          \                    /
        identidad, auth y servicios compartidos
                       |
        aplicación de Torneos (casos de uso)
                       |
     dominio de Torneos + políticas de permisos
                       |
      repositorios/RPCs/Edge Functions de Torneos
                       |
       Supabase de desarrollo o staging aislado
```

## Fronteras

`src/features/torneos/` contiene interfaz, navegación, contexto y, en fases posteriores, módulos de aplicación. El frontend no consulta tablas de Torneos desde componentes: utiliza repositorios o servicios. Los cálculos críticos de tabla, sanciones y derivados deben ser transaccionales en servidor.

Entidades compartidas se referencian, no se absorben:

- `auth.users` representa identidad.
- `usuarios` puede aportar perfil compatible.
- `teams` representa un equipo Arma2 general.
- `tournament_entries` representará su inscripción específica.
- `team_members` no equivale al roster presentado.
- partidos personales y oficiales mantienen tipos y reglas separados.

## Routing

La ruta preliminar es `/torneos/*`, autenticada y protegida por flag. Se monta fuera de `MainLayout`, por lo que no hereda TabBar ni onboarding personal. El esquema canónico futuro será:

```text
/torneos/o/:organizationSlug/inicio
/torneos/o/:organizationSlug/t/:tournamentSlug/partidos
/torneos/o/:organizationSlug/t/:tournamentSlug/equipos
```

Los slugs sólo resuelven recursos; la autorización siempre usa el usuario autenticado y políticas del servidor.

## Flags

La resolución de flags es central y fail-closed:

- valor explícito `true`;
- entorno explícitamente no productivo;
- producción fuerza todo Torneos a `false`.

Flags iniciales: producto, selector de espacios, deep links, notificaciones, estadísticas oficiales, páginas públicas y generador social. Las flags no sustituyen RLS.

## Estado y caché implementados

El contexto de workspace obtiene organizaciones, membresías, capacidades y preferencia mediante `get_tournament_workspace_context()`. La respuesta del servidor es la única autoridad.

1. La RPC toma el usuario exclusivamente de `auth.uid()`.
2. Filtra memberships `active` y organizaciones `active`.
3. Si la preferencia dejó de ser válida, la restablece a `personal`.
4. El cliente no muestra datos institucionales hasta recibir esa respuesta.
5. `localStorage` conserva sólo un hint versionado posterior a la validación; nunca concede acceso.
6. Cambiar de organización persiste mediante `set_tournament_workspace_preference()`.

Datos remotos deberán usar claves que incluyan organización/torneo para impedir contaminación entre espacios.

El contexto competitivo implementado repite el mismo patrón con
`get_tournament_competition_context()`. Limpia datos privados mientras valida,
ignora respuestas fuera de orden y persiste temporada/torneo mediante una
preferencia separada y autoritativa. Las keys lógicas contienen siempre
organización, temporada y torneo.

## Backend implementado

La migración `20260724233000_tournament_organization_workspaces.sql` implementa tres tablas con RLS, helpers de capacidades y cuatro RPCs controladas. La creación de organización, owner y preferencia es una única transacción idempotente.

La migración `20260725120000_tournament_competition_core.sql` implementa
temporadas, torneos, categorías, catálogos, reglas y contexto activo. Las
escrituras pasan por RPCs transaccionales; el cliente sólo tiene SELECT sujeto a
RLS. La creación de torneo incorpora reglas por defecto y preferencia en una
sola transacción.

La migración `20260726150000_tournament_match_operations.sql` mantiene tres
autoridades separadas: programación, operación versionada y resultado oficial.
Convocatorias, disponibilidad y actas referencian fixture/rosters sin absorber
los partidos personales. Score, outcome y eventos son contratos independientes;
una corrección clona la oficial y conserva la fuente como histórica.

## Backend futuro

- Tablas pequeñas y normalizadas por agregado.
- RLS en toda tabla accesible por cliente.
- RPCs transaccionales para cambios que regeneran derivados.
- `SECURITY DEFINER` sólo cuando RLS no alcance, con `auth.uid()`, permisos explícitos, `search_path` fijo y grants mínimos.
- Audit log append-only para acciones sensibles.
- Storage con buckets/prefijos separados y políticas equivalentes.
- trabajos asíncronos idempotentes para PDF, exportaciones y contenido.

## Estrategia de evolución

1. Foundation sin datos.
2. Membresías y permisos.
3. Configuración de competencia — implementada.
4. Inscripciones y rosters.
5. Fixture y operación.
6. estadísticas/disciplinas transaccionales.
7. publicación y contenido.
8. integración explícita con Arma2.
