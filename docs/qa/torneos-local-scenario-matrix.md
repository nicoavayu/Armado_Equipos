# Matriz determinista de QA LOCAL — Arma2 Torneos

Estado: REVIEW. Fecha de referencia: 2026-08-12. Zona horaria de producto:
`America/Argentina/Buenos_Aires`. Seed fija: `QA_SCENARIO_SEED=20260812`.

Esta matriz se definió antes de crear datos adicionales. Reutiliza el baseline
aprobado `torneos-demo-v4` y `qa.local_review.supplement.v1`; los huecos se
materializan en dos supplements eliminables: `qa.scenarios.edge.v1` (humano) y
`qa.scenarios.volume.v1` (volumen). Ningún caso modifica el seed canónico.

| Scenario ID | Cobertura | Fuente | Contrato esperado |
| --- | --- | --- | --- |
| TQ-ORG-FRESH | Organización recién creada | edge | Activa, owner único, temporada activa sin datos deportivos |
| TQ-ORG-COMPLETE | Organización con datos completos | v4+v1 | 8 equipos, fixture, resultados, tabla, disciplina, comunicaciones y galería |
| TQ-ORG-NO-ACTIVE-COMP | Organización sin competición activa | edge | Sólo borradores/archivados |
| TQ-ORG-MULTI-SEASON | Varias temporadas | v1+edge | Activa, futura, terminada y archivada |
| TQ-ORG-ARCHIVED | Organización archivada | edge | `status=archived`, `archived_at` coherente |
| TQ-ORG-MULTI-MEMBERSHIP | Owner en varias organizaciones | edge+volume | Selector lista scopes sin mezclar contexto |
| TQ-SEASON-ACTIVE | Temporada activa | v4 | Fechas 2026 y competición activa |
| TQ-SEASON-FUTURE | Temporada futura | v1 | Borrador 2027 |
| TQ-SEASON-COMPLETED | Temporada terminada | edge | `status=completed` |
| TQ-SEASON-ARCHIVED | Temporada archivada | v1 | Estado y timestamp consistentes |
| TQ-SEASON-NO-COMP | Temporada sin competiciones | edge | Lista vacía controlada |
| TQ-SEASON-MULTI-COMP | Temporada con varias competiciones | v4+edge | Estados y conteos distintos |
| TQ-COMP-FRESH | Competición recién creada | edge | Borrador, categoría default, sin equipos |
| TQ-COMP-DRAFT | Competición borrador | v4 | No se publica accidentalmente |
| TQ-COMP-ACTIVE | Competición activa | v4 | Navegación completa |
| TQ-COMP-COMPLETED | Competición completada | v4 | Resultados históricos y tabla final |
| TQ-COMP-ARCHIVED | Competición archivada | v4+v1 | Visible sólo donde corresponda |
| TQ-COMP-0-TEAMS | Sin equipos | edge | Empty state |
| TQ-COMP-1-TEAM | Un equipo | edge | No permite fixture válido |
| TQ-COMP-2-TEAMS | Dos equipos | edge | Mínimo válido de fixture |
| TQ-COMP-ODD-5 | Número impar/libre | edge | 5 participantes, round-robin sin duplicados |
| TQ-COMP-8-TEAMS | Ocho equipos | v4 | Baseline humano completo |
| TQ-COMP-20-TEAMS | Volumen razonable | volume | 20 equipos y 190 partidos |
| TQ-TEAM-NO-ROSTER | Equipo sin fila de plantel | edge | UI no asume roster existente |
| TQ-TEAM-ROSTER-EMPTY | Plantel aprobado vacío | edge | Conteo cero sin crash |
| TQ-TEAM-BELOW-MIN | Cuatro jugadores para F5 | edge | Estado incompleto legible |
| TQ-TEAM-AT-MIN | Cinco jugadores para F5 | edge | Umbral exacto |
| TQ-TEAM-ABOVE-MIN | Seis jugadores | edge | Estado válido |
| TQ-TEAM-LARGE-ROSTER | Dieciocho jugadores | edge | Lista larga y scroll |
| TQ-PLAYER-NO-SHIRT | Dorsal `null` | edge | Fallback, no `undefined` |
| TQ-PLAYER-NO-POSITION | Posiciones `null` | edge | Fallback, no crash |
| TQ-PLAYER-NO-PHOTO | Avatar `null` | v4+edge | Iniciales/placeholder local |
| TQ-PLAYER-CAPTAIN | Capitán | v4 | Rol visible y permisos acotados |
| TQ-PLAYER-DELEGATE | Manager/delegado | v4 | Acceso de equipo sin admin global |
| TQ-PLAYER-OPTIONAL-NULLS | Campos opcionales `null` | edge | Render consistente |
| TQ-NAME-SHORT | Nombre válido mínimo | edge | Dos caracteres aceptados |
| TQ-NAME-LONG | Nombre cerca del máximo | edge | Truncado/ajuste sin overflow |
| TQ-NAME-UNICODE | Tildes, apóstrofe y caracteres válidos | edge | Búsqueda/render correctos |
| TQ-FIXTURE-NONE | Fixture inexistente | edge | Empty state y CTA según permiso |
| TQ-FIXTURE-DRAFT | Fixture parcialmente generado | edge | Versión draft aislada |
| TQ-FIXTURE-COMPLETE | Fixture completo/publicado | v4 | 31 partidos publicados |
| TQ-ROUND-EMPTY | Jornada sin partidos | edge | Empty state |
| TQ-ROUND-COMPLETE | Jornada completa | v4 | Todos los cruces visibles |
| TQ-FIXTURE-BYE | Cantidad impar/libre | edge | Libre sin participante fantasma |
| TQ-MATCH-UNSCHEDULED | Sin programar | edge | Sin fecha/sede/cancha, permitido por contrato |
| TQ-MATCH-SCHEDULED | Programado | edge | Fecha+sede+cancha+duración atómicos |
| TQ-MATCH-FUTURE | Futuro | edge+v1 | Clasificado como próximo |
| TQ-MATCH-PLAYED | Jugado | v4 | Resultado oficial visible |
| TQ-MATCH-0-0 | Cero a cero | v4 | Empate y tabla correctos |
| TQ-MATCH-DRAW-GOALS | Empate con goles | v4 | Estadísticas correctas |
| TQ-MATCH-BLOWOUT | Goleada | v4 | Diferencia amplia sin layout roto |
| TQ-MATCH-MIN-RESULT | Resultado mínimo | v4 | 1-0 correcto |
| TQ-MATCH-POSTPONED-PAST | Postergado en pasado | v4+edge | No aparece como jugado ni próximo normal |
| TQ-MATCH-SUSPENDED | Suspendido | v4 | Minuto 63 y outcome coherente |
| TQ-MATCH-CANCELLED | Cancelado | edge | Soportado por `tournament_matches.status` |
| TQ-MATCH-NO-VENUE | Sin cancha/sede/horario | edge | Sólo en estado `unscheduled` |
| TQ-MATCH-RESULT-PENDING | Resultado pendiente | v4 | Partido listo sin score oficial |
| TQ-MATCH-WITH-EVENTS | Con eventos | v4 | Goles/asistencias/tarjetas |
| TQ-MATCH-NO-EVENTS | Sin eventos | v4 | Lista vacía |
| TQ-TIME-YEAR-AGO | Hace un año | v1 | Histórico |
| TQ-TIME-YESTERDAY | Ayer 20:30 ART | edge | Histórico |
| TQ-TIME-TODAY-EARLY | Hoy 00:05 ART | edge | Histórico del día |
| TQ-TIME-NOW-PLUS-5 | En cinco minutos | edge | Próximo inmediato |
| TQ-TIME-TONIGHT | Hoy 23:30 ART | edge | Próximo del día |
| TQ-TIME-TOMORROW | Mañana 09:00 ART | edge | Próximo |
| TQ-TIME-DAY-CHANGE | 23:59→00:01 ART | edge | No cambia día en UTC por error |
| TQ-TIME-MONTH-END | 31/08→01/09 ART | edge | Orden cronológico correcto |
| TQ-TIME-YEAR-END | 31/12→01/01 ART | edge | Año y zona correctos |
| TQ-STANDINGS-ZERO | Todos con 0 PJ | edge | Posiciones deterministas |
| TQ-STANDINGS-TIED | Empate en puntos | v4 | Aplica desempate configurado |
| TQ-STANDINGS-TIED-GD | Empate en puntos y diferencia | v4 | Siguiente criterio trazable |
| TQ-STANDINGS-LARGE-DIFF | Diferencias grandes | v4 | Números y orden correctos |
| TQ-STANDINGS-UNBEATEN | Equipo invicto | v4 | Racha y tabla |
| TQ-STANDINGS-WINLESS | Equipo sin victorias | v4 | Ceros correctos |
| TQ-STANDINGS-UNEQUAL-PJ | PJ desiguales | v4 | Tabla permite estado intermedio |
| TQ-STANDINGS-FINAL | Competición finalizada | v4 | Revisión publicada final |
| TQ-STATS-NO-EVENTS | Jugador sin eventos | v4 | No aparece con conteos inventados |
| TQ-STATS-TOP-SCORER | Un goleador | v4 | Ranking correcto |
| TQ-STATS-SCORER-TIE | Empate de goleadores | v4 | Desempate estable |
| TQ-STATS-ASSISTS | Asistencias | v4 | Conteo oficial |
| TQ-STATS-MULTI-EVENT | Varios eventos mismo partido | v4 | No duplica partido/jugador |
| TQ-STATS-HISTORICAL | Eventos históricos | v4 | Acumulado correcto |
| TQ-DISC-YELLOW | Amarilla | v4 | Ledger correcto |
| TQ-DISC-MULTI-YELLOW | Múltiples amarillas | v4 | Umbral real |
| TQ-DISC-RED | Roja directa | v4 | `automatic_suspensions=1` |
| TQ-DISC-ACTIVE | Sanción activa | v4 | Próximo partido afectado |
| TQ-DISC-SERVED | Sanción cumplida | v4 | Served match trazable |
| TQ-COMMS-NONE | Sin comunicados | edge | Empty state |
| TQ-COMMS-DRAFT | Borrador | v1 | Sólo roles autorizados |
| TQ-COMMS-PUBLISHED | Publicado | v1 | Audiencia correcta |
| TQ-COMMS-READ-UNREAD | Leído/no leído | v1 | Delivery por usuario |
| TQ-MEDIA-NONE | Sin galerías | edge | Empty state |
| TQ-MEDIA-EMPTY-DRAFT | Galería vacía/borrador | v1 | Sin servicios externos |
| TQ-PUBLIC-WITH-DATA | Publicado con datos | v4 | Superficie anon sanitizada |
| TQ-PUBLIC-NO-FUTURE | Publicado sin futuros | v4 | Históricos solamente |
| TQ-PUBLIC-NO-RESULTS | Publicado sin resultados | v4 | Próximos solamente |
| TQ-PUBLIC-HISTORY-FUTURE | Históricos + futuros | v4+v1 | Clasificación temporal correcta |
| TQ-ROLE-OWNER | Owner | v4 | Administración completa |
| TQ-ROLE-ADMIN | Admin | v4 | Administración delegada |
| TQ-ROLE-DELEGATE | Delegate/manager | v4 | Sólo equipo delegado |
| TQ-ROLE-PLAYER | Player | v4 | Hub participante |
| TQ-ROLE-COLLABORATOR | Colaborador/árbitro funcional | v4 | Lectura/colaboración, sin manager |
| TQ-ROLE-OUTSIDER-DIRECT-URL | Outsider por URL directa | v4 | Denegación sin fuga ni loop |
| TQ-ROLE-MULTI-ORG | Owner en múltiples organizaciones | edge+volume | Selector y contexto estable |
| TQ-VOLUME-20-240-190 | 20 equipos/240 jugadores/190 partidos | volume | Carga visual razonable, sin N+1 evidente |
| TQ-SPACE-A2-TO-TORNEOS | Arma2→Torneos | runner | Guarda/restaura contexto |
| TQ-SPACE-TORNEOS-TO-A2 | Torneos→Arma2 | runner | Vuelve a última ruta Arma2 |
| TQ-SPACE-REFRESH | Refresh | runner | Mantiene espacio y ruta |
| TQ-SPACE-DEEP-LINK | Deep link | runner | Resuelve guard/contexto |
| TQ-SPACE-HISTORY | Back/Forward | runner | Historial sin loop |

## Límites del modelo (no se materializan como inconsistencias)

- `TQ-MATCH-NO-REFEREE`: no existe entidad/campo de árbitro en el schema actual.
- `TQ-MATCH-TIME-WITHOUT-COURT` y `TQ-MATCH-COURT-WITHOUT-TIME`: la constraint
  `tournament_matches_schedule_fields_check` exige fecha, sede, cancha y
  duración en conjunto; se valida el rechazo, no se persiste el estado inválido.
- Cambio de plantel histórico: el modelo conserva snapshots de participantes,
  pero no hay flujo de producto explícito de transferencia de jugador; no se
  inventa en esta pasada.
- Sanción futura: el contrato modela sanción activa/servida y partidos a cumplir,
  no un estado independiente `future`.

