# Núcleo de configuración competitiva

## Alcance

Esta fase implementa la configuración previa a la operación deportiva dentro de
un workspace de organización. Permite crear temporadas, torneos y categorías,
definir reglas, seleccionar el contexto activo y preparar un torneo para una
futura inscripción.

No implementa equipos, inscripciones reales, planteles, fixture, partidos,
resultados, tablas, sanciones, comunicaciones ni páginas públicas. Los módulos
futuros del dashboard son informativos y no enlazan a rutas incompletas.

## Modelo persistido

La migración
`20260725120000_tournament_competition_core.sql` agrega las siguientes tablas:

| Tabla | Responsabilidad |
|---|---|
| `tournament_sport_modalities` | Catálogo estable de modalidades |
| `tournament_competition_formats` | Catálogo estable de formatos |
| `tournament_seasons` | Ciclos competitivos de una organización |
| `tournaments` | Configuración general de una competencia |
| `tournament_categories` | Segmentos ordenados de un torneo |
| `tournament_scoring_rules` | Puntuación y opciones administrativas futuras |
| `tournament_tiebreak_rules` | Criterios de desempate ordenados |
| `tournament_discipline_rules` | Reglas disciplinarias previas |
| `user_tournament_context_preferences` | Temporada y torneo activos por usuario y organización |

Todas usan UUID, timestamps y RLS. Los recursos editables se archivan de forma
lógica; la interfaz no expone borrado físico.

### Relaciones

```text
tournament_organizations
  └── tournament_seasons
        └── tournaments
              ├── tournament_categories
              ├── tournament_scoring_rules (1:1)
              ├── tournament_tiebreak_rules (1:n ordenado)
              └── tournament_discipline_rules (1:1)

auth.users + tournament_organizations
  └── user_tournament_context_preferences
        ├── active_season_id
        └── active_tournament_id
```

Las claves foráneas compuestas repiten `organization_id` deliberadamente. Así,
un cambio de identificador no puede mover una temporada, torneo, categoría o
preferencia hacia otro tenant.

## Catálogos

### Modalidades

Se crean `football_5`, `football_6`, `football_7`, `football_8`, `football_9` y
`football_11`. Cada fila incluye cantidad de jugadores, suplentes recomendados,
integrantes sugeridos para un futuro equipo de la fecha, duración de referencia
y uso de arquero.

El torneo define la modalidad por defecto. Una categoría sólo la sobrescribe
cuando guarda explícitamente otro `sport_modality`; `NULL` significa herencia.
La misma regla se aplica a `gender_category` y `team_size`.

### Género o tipo

Los identificadores son `male`, `female`, `mixed` y `open`. No se infieren a
partir de nombres ni perfiles y todavía no expresan reglas de composición.

### Formatos

El catálogo contiene:

- `league`;
- `knockout`;
- `groups`;
- `groups_and_playoffs`;
- `league_and_playoffs`.

`format_settings` es JSONB validado en servidor según el formato. Conserva
únicamente opciones de configuración; no crea jornadas, grupos ni llaves.

## Estados y transiciones

### Temporada

```text
draft → active → completed → archived
   └────────────────────────→ archived
```

No existen transiciones inversas. Se permiten varias temporadas activas porque
pueden representar calendarios solapados; la preferencia del usuario determina
cuál administra. Una temporada archivada no se devuelve como seleccionable ni
acepta torneos nuevos. Para evitar contextos huérfanos, no puede archivarse
mientras conserve torneos no archivados.

### Torneo

```text
draft ⇄ registration
  └───────────────→ archived
registration ─────→ archived
```

`scheduled`, `active` y `completed` están reservados en el constraint, pero esta
fase no permite alcanzarlos desde RPC ni UI. Volver de `registration` a `draft`
es seguro mientras todavía no existe el dominio de equipos.

La transición a `registration` exige el checklist completo. Sólo prepara la
competencia para la fase siguiente; no abre formularios ni envía invitaciones.

## Reglas

### Puntuación

Los valores por defecto son 3/1/0. Walkover ganado/perdido es opcional. Todos los
valores son enteros acotados. Los flags de descuento manual y resultado
administrativo preparan comportamiento futuro y no activan operaciones ahora.

### Desempates

`points` es el criterio base implícito y no se almacena como fila removible. El
orden inicial persistido es:

1. `goal_difference`;
2. `goals_for`;
3. `head_to_head`;
4. `fair_play`.

También pueden elegirse `matches_won`, `playoff_match` y `draw`. Los índices y
constraints impiden posiciones o criterios duplicados. La semántica detallada
de `head_to_head` —mini tabla, cantidad de enfrentamientos y desempate
recursivo— se definirá junto al motor de tabla.

### Disciplina

Se guardan umbral de amarillas, fechas por acumulación, sugerencia opcional para
roja directa, doble amarilla, reinicio por fase y puntos de fair play. Son reglas
previas: no crean casos, suspensiones ni decisiones automáticas.

## Categorías

No se crea una categoría general automática. La decisión explícita evita que
una categoría implícita se confunda con una división administrada. Al menos una
categoría activa es requisito para pasar a `registration`.

El slug es único dentro del torneo. Edades y overrides son opcionales; si ambas
edades existen, `min_age <= max_age`. Archivar retira la categoría de la
configuración seleccionable. El servidor impide archivar la última categoría
activa de un torneo que ya está en `registration`.

## Autorización y RLS

La fuente de autorización es la membership activa en una organización activa.
La función central `tournament_role_capabilities()` se mantiene sincronizada
con `src/features/torneos/domain/capabilities.js`.

- owner y admin pueden crear/editar temporadas, torneos, categorías y reglas;
- owner y admin pueden ejecutar las transiciones habilitadas;
- collaborator sólo puede leer;
- una membership suspendida o removida pierde todo acceso;
- una organización archivada bloquea sus recursos.

Todas las tablas tienen policies de lectura por tenant. El cliente autenticado
no recibe grants directos de escritura: las mutaciones pasan por RPCs. Los
catálogos sólo exponen lectura.

Las funciones `SECURITY DEFINER`:

- obtienen identidad exclusivamente desde `auth.uid()`;
- usan `search_path = ''` y nombres de schema explícitos;
- validan capability y pertenencia de cada relación;
- revocan ejecución a `PUBLIC` y `anon`;
- conceden sólo a `authenticated`;
- emiten códigos funcionales que no distinguen ausencia de falta de permiso.

## RPCs

| RPC | Efecto |
|---|---|
| `create_tournament_season` | Crea una temporada idempotente |
| `update_tournament_season` | Edita o cambia su estado validado |
| `create_tournament_with_defaults` | Crea torneo, puntuación, desempates, disciplina y contexto en una transacción |
| `update_tournament_configuration` | Aplica un patch permitido a un draft |
| `save_tournament_category` | Crea, edita, reordena o archiva una categoría |
| `change_tournament_status` | Ejecuta sólo transiciones autorizadas |
| `set_active_tournament_context` | Valida y persiste temporada/torneo activos |
| `get_tournament_competition_context` | Devuelve catálogos y agregado autorizado |

Las creaciones de temporada y torneo usan una clave UUID de idempotencia con
índices únicos por organización/actor. La creación del torneo es atómica: no
puede quedar sin sus tres configuraciones iniciales.

## Contexto activo y caché

El workspace sigue representando la organización. Dentro de él,
`TorneosCompetitionContext` carga una única proyección autoritativa, descarta
respuestas fuera de orden y limpia temporadas/torneos durante loading o error.

La preferencia vive en PostgreSQL. Una selección sólo se acepta si la temporada
pertenece a la organización, no está archivada y el torneo pertenece exactamente
a esa temporada. Si el recurso dejó de ser válido, la RPC repara la preferencia
con un fallback seguro o `NULL`; no se confía en `localStorage`.

## Rutas

Todas están debajo del guard de producto, workspace y organización:

```text
/torneos/organizacion/:organizationId/inicio
/torneos/organizacion/:organizationId/temporadas
/torneos/organizacion/:organizationId/temporadas/nueva
/torneos/organizacion/:organizationId/temporadas/:seasonId
/torneos/organizacion/:organizationId/torneos
/torneos/organizacion/:organizationId/torneos/nuevo
/torneos/organizacion/:organizationId/torneos/:tournamentId
/torneos/organizacion/:organizationId/torneos/:tournamentId/configuracion
/torneos/organizacion/:organizationId/torneos/:tournamentId/categorias
```

Las rutas de detalle simple redirigen a la pantalla implementada y categorías
abre el paso correspondiente del wizard.

## Flujo frontend

1. El dashboard muestra estado vacío real o el torneo activo.
2. La pantalla Torneos administra temporadas y lista competencias.
3. La temporada se crea o edita en un formulario breve.
4. El wizard divide el torneo en información, modalidad, formato, reglas,
   categorías y revisión.
5. Cada paso persistible guarda un patch acotado y previene doble envío.
6. La revisión usa el checklist calculado en backend.
7. Owner/admin pueden preparar inscripción o archivar; collaborator ve los
   mismos datos en modo consulta.

Los módulos futuros quedan visibles como “Próximamente”, sin links, métricas ni
datos simulados.

## Pruebas y entorno

`scripts/db-integration/torneos-competition-core.mjs` aplica desde cero primero
la migración de workspaces y después esta migración en PostgreSQL embebido. Sus
casos cubren schema, catálogos, RLS, grants, tenants, roles, idempotencia,
concurrencia, transiciones y preferencias.

La UI tiene pruebas de servicio, validación, contexto, rutas, permisos, CSS
responsive y flujo. Los builds con Torneos apagado y con el entorno aislado
activo validan que las flags continúan fail-closed en producción.

Docker no estaba disponible durante esta fase. Por ello no se ejecutó
`supabase db reset`; la aplicación desde cero se verificó con PostgreSQL
embebido y no se tocó ningún proyecto Supabase cloud.

## Capturas de QA

- [Dashboard desktop 1440 × 900](assets/competition-core-desktop.jpg)
- [Dashboard móvil 390 × 844](assets/competition-core-mobile-390.jpg)
- [Wizard móvil 390 × 844](assets/competition-wizard-mobile-390.jpg)
- [Dashboard tablet 768 × 1024](assets/competition-core-tablet-768.jpg)

También se verificó 320 × 700. En los cuatro breakpoints el ancho del documento
coincide con el viewport.

## Decisiones descartadas

- No guardar modalidad, formato ni desempates como texto libre.
- No crear una categoría general implícita.
- No habilitar updates directos a las tablas.
- No mezclar la preferencia competitiva con la preferencia de workspace.
- No usar un único JSONB opaco para todas las reglas.
- No implementar estados futuros antes de contar con sus invariantes.
- No simular módulos posteriores para completar el dashboard.

## Limitaciones y próxima fase

La configuración no produce efectos deportivos. Faltan equipos, invitaciones,
rosters, validación de edad real, fixture, motor de tabla, disciplina operativa,
auditoría de cambios, páginas públicas y notificaciones.

La próxima fase debe comenzar por inscripciones y planteles sólo después de una
directiva explícita. Deberá diseñar `TournamentEntry` y rosters versionados sin
reutilizar `team_members` como plantel competitivo.
