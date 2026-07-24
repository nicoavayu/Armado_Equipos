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

## Estado y caché

El contexto de workspace contiene selección y capacidades resueltas. La fase inicial usa datos ficticios y persiste una preferencia versionada en `localStorage`. En la fase de workspaces:

1. leer preferencia;
2. pedir memberships vigentes;
3. elegir sólo si sigue autorizada;
4. limpiar caché incompatible al cambiar;
5. persistir la nueva preferencia;
6. resolver permisos por acción.

Datos remotos deberán usar claves que incluyan organización/torneo para impedir contaminación entre espacios.

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
3. Configuración de competencia.
4. Inscripciones y rosters.
5. Fixture y operación.
6. estadísticas/disciplinas transaccionales.
7. publicación y contenido.
8. integración explícita con Arma2.

