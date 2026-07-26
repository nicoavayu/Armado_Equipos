# Operación de partidos, actas y resultados

## Alcance y autoridad

Esta fase implementa convocatoria, disponibilidad, alineación, asistencia,
acta, resultado, eventos, resoluciones administrativas, revisión y corrección
versionada. No calcula tablas, goleadores, sanciones ni clasificados.

`tournament_matches` continúa siendo la autoridad de programación: rival,
jornada, fase, fecha, sede y cancha. El resultado oficial existe únicamente en
una `tournament_match_operation` con estado `official`, su
`tournament_match_score` y su `tournament_match_outcome`. Ningún campo editable
del fixture se interpreta como marcador.

## Modelo persistido

La migración `20260726150000_tournament_match_operations.sql` agrega:

- `tournament_match_squads` y `tournament_match_squad_players`;
- `tournament_match_availability_responses`;
- `tournament_match_operations` y `tournament_match_operation_players`;
- `tournament_match_outcomes` y `tournament_match_scores`;
- `tournament_match_events`;
- `tournament_match_reviews`;
- `tournament_match_resumptions`.

Una convocatoria activa es única por partido/equipo. Una operación editable es
única por partido y una versión oficial activa también. Índices parciales y
advisory locks protegen apertura, oficialización y corrección concurrentes.
Todos los hijos conservan organización, partido y equipo para que las FKs
compuestas detecten cruces de tenant o dominio.

La apertura toma el fixture publicado vigente, resuelve los dos participantes,
copia identidad del partido/equipos, copia jugadores de convocatorias
presentadas y bloquea esas convocatorias. No modifica el plantel oficial.

## Identidad, disponibilidad y convocatoria

Un roster player posee exactamente una identidad: `arma2_user_id` o
`provisional_player_id`. La respuesta propia se resuelve exclusivamente desde
`auth.uid()`; la RPC no acepta usuario, equipo ni roster player elegidos por el
cliente. Captain/delegate puede registrar una respuesta manual de su propio
plantel con motivo obligatorio. La respuesta no implica convocatoria,
alineación ni presencia.

La convocatoria sólo acepta jugadores activos y elegibles del roster aprobado
o bloqueado del equipo. El backend limita titulares a `category.team_size`,
exige exactamente esa cantidad al presentar y un único capitán. Dorsal,
posición, nombre, avatar y condición de arquero quedan fotografiados.

## Acta, resultados y eventos

La operación usa estados:

```text
draft → submitted → under_review → validated → official
official ── revisión de corrección abierta ──→ nueva draft → … → official
    └──────────────── visible hasta el reemplazo atómico ─────→ superseded
draft/submitted/review → voided
```

El estado deportivo usa:

```text
ready → in_progress
ready → administrative
in_progress → played | suspended | abandoned
played | administrative → awaiting_validation → official
```

Score y outcome se escriben con RPCs separadas. Los outcomes distinguen jugado,
postergado antes del inicio, suspendido, abandonado, ausencias local/visitante,
doble ausencia, walkover, administrativo, cancelado y no jugado. No existe
marcador automático de walkover. `counts_for_standings`,
`counts_for_player_stats` y `requires_resolution` son decisiones explícitas.

Los eventos iniciales son goles, goles en contra, asistencias, amarillas,
segunda amarilla, roja, cambios, penales, hitos temporales, suspensión,
incidencia y ausencia. La secuencia es única por operación. Anular agrega actor,
fecha y motivo; nunca elimina. Un gol puede omitir autor sólo con motivo. En un
gol en contra, el equipo del evento es el beneficiado y el autor pertenece al
oponente. Una asistencia referencia un gol vigente del mismo equipo. Segunda
amarilla exige una amarilla previa; una expulsión bloquea eventos posteriores
incompatibles.

## Validación, oficialidad y corrección

Presentar revalida outcome, resolución, score, tipo administrativo, walkover,
goles vigentes, asistencias y suspensión. Revisión y validación son pasos
separados; el usuario que presentó no puede validar. Oficializar vuelve a
ejecutar la validación, toma lock y rechaza revisiones incompatibles. No calcula
derivados.

Una oficial es inmutable. Solicitar corrección mantiene vigente y visible esa
oficial, abre una revisión y permite clonar exactamente una versión. La nueva
copia snapshots, outcome, score y eventos vigentes; las referencias de
asistencias y sustituciones se reconstruyen hacia los eventos clonados. Al
oficializar la corrección, una única transacción resuelve la revisión, cambia
la fuente a `superseded` y publica la nueva versión. Nunca hay un intervalo sin
resultado oficial ni dos oficiales activas.

## RLS, capabilities y RPCs

Todas las tablas nuevas tienen RLS. `authenticated` recibe `SELECT` sujeto a
capability organizacional, relación captain/delegate o vínculo del propio
usuario con un roster player habilitado. No hay policies de escritura cliente.
Las mutaciones usan RPCs `SECURITY DEFINER`, `search_path = ''`, `auth.uid()`,
tenant y relación revalidados. `PUBLIC` y `anon` no ejecutan RPCs.

Owner/Admin operan por capabilities `match_operations.*`, `match_squads.*`,
`match_availability.*`, `match_events.*`, `match_outcomes.manage`,
`match_scores.manage` y `match_administrative_results.manage`. Collaborator
lee. Captain/delegate y jugador se autorizan por relación, sin recibir
membership organizacional.

Las RPCs cliente cubren listas de jugador/capitán, disponibilidad propia/manual,
contextos, guardar/presentar convocatoria, abrir/guardar acta, outcome, score,
eventos, presentación, revisión, validación, oficialización, corrección y
anulación. La función de reanudación queda revocada a `authenticated` hasta que
esa fase tenga contrato y UI completos. Ninguna RPC gigante concentra todo el
flujo.

## Auditoría

`tournament_audit_log` registra respuestas, convocatorias, apertura, outcome,
score, evento, anulación, suspensión, ausencia, presentación, validación,
oficialización, corrección, reanudación y anulación. La metadata es allowlisted
y no incluye emails, teléfonos, tokens ni el payload completo del acta.

## UX

Organizador:

```text
/torneos/organizacion/:organizationId/partidos
/torneos/organizacion/:organizationId/partidos/:matchId
/convocatorias | /acta | /revision | /historial
```

Jugador y captain/delegate:

```text
/torneos/mis-partidos
/torneos/mis-partidos/:matchId
/torneos/mis-partidos/:matchId/convocatoria
```

La UI es mobile-first, usa secciones y acciones sticky, targets de 44 px,
selector roster-only, timeline vertical y recarga autoritativa. Descarta
respuestas fuera de orden y bloquea doble click. No usa drag-and-drop ni
modifica Home personal.

## Verificación y límites

El harness PostgreSQL embebido aplica las cinco migraciones Torneos desde cero y
ejercita disponibilidad propia/manual y sus carreras, captain, convocatoria,
apertura/cancelación concurrentes, apertura y oficialización idempotentes,
snapshots, eventos relacionados, coherencia outcome/score/goles, doble control,
inmutabilidad, rollbacks tardíos de auditoría, reemplazo atómico de corrección,
RLS, revocación inmediata, grants y auditoría.

Docker no está disponible, por lo que esto no equivale a validar
Supabase/PostgREST completo. No se conectó un proyecto cloud ni se aplicaron
migraciones remotas.

Quedan para fases siguientes: tablas y estadísticas agregadas, sanciones,
resolución de llaves, tribunal/reclamos, evidencia en Storage, notificaciones,
árbitros formales y reanudación minuto a minuto. La tabla de reanudaciones sólo
conserva el contrato de futura continuación sobre la misma operación.
