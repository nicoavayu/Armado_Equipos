# Matriz de permisos

Los roles son presets editables de capacidades. La autorización efectiva se calcula por usuario, organización, torneo, estado del recurso y, cuando corresponda, relación con equipo/partido.

## Capacidades iniciales

Leyenda: ✓ por defecto, ◐ acotado/asignado, — no otorgado.

| Capacidad | Owner | Admin | Tournament manager | Fixture manager | Match official | Discipline manager | Content manager | Collaborator | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Ver dashboard privado | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ |
| Editar organización | ✓ | ✓ | — | — | — | — | — | — | — |
| Transferir propiedad | ✓ | — | — | — | — | — | — | — | — |
| Administrar miembros/roles | ✓ | ✓ | — | — | — | — | — | — | — |
| Crear/archivar torneos | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| Configurar competencia | ✓ | ✓ | ✓ | ◐ | — | — | — | — | — |
| Gestionar equipos/rosters | ✓ | ✓ | ✓ | — | — | — | — | ◐ | — |
| Generar/editar fixture | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — |
| Programar cancha/árbitro | ✓ | ✓ | ✓ | ✓ | ◐ | — | — | ◐ | — |
| Cargar partido asignado | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ◐ | — |
| Modificar confirmado | ✓ | ✓ | ◐ | — | — | — | — | — | — |
| Gestionar disciplina | ✓ | ✓ | ◐ | — | — | ✓ | — | — | — |
| Publicar comunicaciones | ✓ | ✓ | ◐ | — | — | — | ✓ | ◐ | — |
| Generar contenido | ✓ | ✓ | ✓ | — | — | — | ✓ | ◐ | — |
| Exportar datos | ✓ | ✓ | ◐ | ◐ | — | ◐ | ◐ | — | — |
| Ver auditoría | ✓ | ✓ | ◐ | — | — | ◐ | — | — | — |

## Roles relacionales

- **Capitán**: edita exclusivamente la inscripción y roster de su equipo durante ventanas habilitadas.
- **Jugador**: consulta su estado y puede reclamar identidad; no edita resultados.
- **Árbitro asignado**: carga el partido asignado dentro de una ventana y alcance definidos.
- **Público**: sólo accede a campos publicados por políticas explícitas.

## Reglas de evaluación

1. sesión válida;
2. organización activa;
3. membership vigente;
4. capacidad otorgada en organización;
5. restricción o grant específico del torneo;
6. relación con el recurso si aplica;
7. transición permitida por el estado;
8. campos sensibles autorizados;
9. auditoría obligatoria para la acción.

Denegar ante cualquier ambigüedad. El frontend usa capacidades para UX; RLS/RPC/API vuelve a evaluarlas.

## Acciones de alto riesgo

Requieren confirmación reforzada, motivo y auditoría:

- transferir propiedad;
- cambiar permisos;
- modificar fixture iniciado;
- alterar resultado confirmado;
- anular partido;
- aplicar o levantar sanción;
- publicar datos sensibles;
- emitir exportaciones completas;
- generar enlaces o QR con capacidad de escritura.
