# Partido automático — backend (documento canónico)

Fuente de verdad de las reglas de backend de **Partido automático** (gestación
automática de partidos a partir de `player_availability`). El detalle línea a
línea vive en los headers de cada migración de `supabase/migrations/`; este
documento resume la línea de tiempo aplicada y las reglas vigentes para evitar
tener que reconstruirlas leyendo todo el SQL.

Toda corrección se implementa como **migración nueva y aditiva**: nunca se edita
una migración ya aplicada. `supabase/migrations/README.md` sigue siendo la
fuente de verdad del *flujo* de migraciones (`npm run db:list` / `npm run db:push`).

## Línea de tiempo de migraciones (auto-match)

| Timestamp | Archivo | Qué introdujo |
|-----------|---------|---------------|
| 20260710101500 | `availability_auto_match_mvp` | Modelo de disponibilidad + matcher inicial |
| 20260710113000 | `create_auto_match_proposal_rpc` | RPC de creación de propuesta |
| 20260711034500 | `auto_match_gestation_mvp` | Gestación (propuestas + miembros) |
| 20260711150000 | `fix_auto_match_gestation_sync` | Fixes de sync (alias ORDER BY, wrap 24 h) |
| 20260711210000 | `auto_match_organizer_flow` | Organizador, expiración, `resolve_full_cupo` |
| 20260712120000 | `auto_match_proposal_chat` | Chat de la gestación (RLS + RPC) |
| 20260712220000 | `auto_match_overbooking_confirmation_order` | Sobreconvocatoria `ceil(req×1.5)`, orden de confirmación, `invite_deadline` (10 h) |
| 20260712230000 | `auto_match_substitutes` | Suplentes + reapertura de vacantes |
| 20260713120000 | `auto_match_roster_cap_and_promotion` | Plantel final `required+4`, promoción suplente→titular |
| 20260713190000 | `auto_match_progressive_cohorts` | Cohortes progresivas (salas en cascada) |

### Migraciones de la auditoría independiente — **aplicadas a producción**

Antes de la corrección A2/A3 (este documento) ya estaban **aplicadas en
producción** las tres migraciones que la auditoría revisó:

- **`20260714030000_auto_match_backend_initial_sweep`** — el cron `auto_match_sweep`
  (cada 5 min) llama a `auto_match_scheduled_sweep`, que ahora inicia la primera
  gestación desde el backend aunque ningún cliente abra la app.
- **`20260714223000_auto_match_response_and_real_overlap_fix`** — snapshots
  inmutables por miembro, reconciliación geográfica y respuesta atómica.
- **`20260715003000_auto_match_materialization_schedule_fix`** — la
  materialización (`finalize_auto_match_proposal`) es el **único** punto donde se
  toma posesión del horario: bloquea el roster en orden de UUID, deriva los
  comienzos posibles cada 15 min de los snapshots inmutables y compara rangos
  semiabiertos de 120 min contra los partidos reales. Esta migración **neutralizó**
  los helpers `user_has_overlapping_auto_match` / `user_declined_auto_match_slot`
  a `select false` (quedan como shims de compatibilidad).

### Corrección A2/A3 (esta entrega)

- **`20260716120000_auto_match_real_conflict_slots_and_invite_capacity_race`** —
  ver reglas abajo. Aditiva: sólo redefine funciones y agrega helpers internos;
  no toca datos, tablas, columnas, índices, constraints, RLS ni el cron.

## Regla final A2 — conflictos con partidos reales

> **Nota sobre el bloqueo `#621`.** El comentario de
> `20260714030000` que dice que la superposición «se evalúa antes del mínimo… así
> los usuarios del partido real #621 nunca inflan la cohorte» quedó **obsoleto**:
> el helper global `user_has_overlapping_auto_match` que implementaba ese bloqueo
> fue neutralizado a `select false` en `20260715003000`. El bloqueo **global**
> por partido real ya **no** está vigente; fue reemplazado por la validación
> **por oportunidad** que describe esta sección. No se restauran los helpers
> globales.

Un partido real confirmado **no** desactiva la búsqueda ni cancela ninguna
oportunidad completa. La regla se evalúa **por oportunidad y por sus horarios
candidatos**, en el backend (no sólo en el frontend):

- Los **horarios candidatos** de una oportunidad son exactamente los que
  `finalize_auto_match_proposal` puede elegir por defecto: la grilla de 15 min en
  `proposed_starts_at ± 120 min`, acotada a la misma fecha local de
  `America/Argentina/Buenos_Aires`, dentro de la ventana del jugador (mismo día
  ISO, comienzo ≥ `time_start`, y ≥ 60 min hasta `time_end`).
- El **solapamiento** usa el mismo rango semiabierto de 120 min
  (`auto_match_play_range`) y los mismos estados de partido vigentes que la
  materialización. Helper compartido: `auto_match_user_real_match_conflict`.
- **Si existe al menos un horario candidato libre**, la oportunidad se permite y
  la materialización elegirá ese horario.
- **Si todos los horarios candidatos están ocupados** por partidos reales del
  jugador, se lo **excluye de esa oportunidad**: no se lo invita, no se le envía
  push ni se generan eventos de notificación. Su búsqueda sigue **activa** y es
  elegible para otros días, formatos y horarios.

La regla se impone en tres momentos (defensa en profundidad):

1. **Al generar la oportunidad** (`sync_my_auto_match_gestations`,
   `spawn_next_auto_match_cohort`, backfill y el trigger de elegibilidad en
   INSERT, vía `auto_match_availability_fits_proposal` →
   `auto_match_availability_has_free_slot`): un jugador sin ningún candidato
   libre no infla la cohorte ni cuenta para el mínimo.
2. **Al aceptar** (`respond_to_auto_match_proposal`): se **revalida** bajo el
   lock de la propuesta (el jugador pudo crear/aceptar un partido real después de
   ser invitado). Si ya no queda ningún candidato libre, la membresía pasa al
   estado **terminal** `expired` con motivo `schedule_conflict` (nunca queda
   pendiente indefinidamente), se ejecuta el **backfill** normal para reponer el
   lugar, y se reutiliza un motivo que el cliente 1.1.15 (34) ya traduce.
3. **Al materializar** (`finalize_auto_match_proposal`, sin cambios): recalcula
   los partidos reales bajo los locks por jugador y elige un horario alternativo
   válido; si no existe, aborta con `no_compatible_final_time` sin cancelar la
   sala. Última defensa.

## Regla final A3 — exceso transitorio de invitaciones

La Fase A de `sync_my_auto_match_gestations` evaluaba el conteo de convocados en
el filtro del `SELECT … FOR UPDATE SKIP LOCKED`. Como incorporar un miembro no
modifica la fila de la propuesta, el snapshot previo al lock podía quedar
desactualizado. Ahora, tras adquirir el lock de la fila, se **vuelve a contar**
los miembros vivos en un statement nuevo (igual que la Fase B); si la sala llegó
a capacidad o dejó de ser compatible, se descarta la incorporación sin insertar
ni notificar. Así **el total de invitados/pendientes nunca supera la capacidad**
`ceil(jugadores_requeridos × 1.5)` (F5 = 15), ni siquiera transitoriamente bajo
concurrencia real. No se agregan locks nuevos ni cambia su orden; la corrección
es idempotente y los sweeps repetidos no duplican miembros ni notificaciones.

## Invariantes que se conservan

Mínimo de 4 interesados; cohortes progresivas (con 19 hay segunda sala);
oportunidades simultáneas independientes; capacidad F5 = 15; primeros 10
confirmados + máx. 4 suplentes; ventana de invitación de 10 h; confirmar /
rechazar / bajarse; backfill; pushes idempotentes; expiración; sweep cada 5 min;
finalización única sin partidos duplicados ni deadlocks; chat de gestación
cerrado al materializar; radios geográficos simétricos; usuarios sin coordenadas
fuera del matcher; zona horaria `America/Argentina/Buenos_Aires`; elección
correcta de horarios alternativos.

## Cobertura de tests

- `scripts/db-integration/run.mjs` (`npm run test:db`): suite de integración con
  Postgres embebido y una conexión por usuario. Escenarios **22** (A2: conflicto
  total, alternativa horaria, partido creado entre invitación y aceptación, borde
  de medianoche, sweeps repetidos sin re-invitar) y **23** (A3: carrera por el
  último lugar de convocatoria, 6 rondas, idempotencia y cupo de aceptados).
- `src/__tests__/autoMatchRealConflictSlotsMigrationSql.test.js`: aserciones
  estructurales sobre el SQL de la migración (aditividad, `search_path`,
  `REVOKE`/`GRANT`, reutilización de reglas, no restauración de los helpers
  globales `#621`).
