# Modelo de dominio propuesto

Este documento define conceptos y relaciones; no autoriza migraciones. Los nombres físicos se validarán antes de la fase de datos.

## Núcleo institucional

- **Organization**: owner, nombre, slug, branding, contacto, ubicación, estado y configuración.
- **OrganizationMembership**: usuario, organización, estado y vigencia.
- **Role / Permission / RoleGrant**: catálogo de capacidades y asignaciones; el nombre del rol no decide permisos.
- **TournamentGrant**: restricciones o capacidades adicionales para un torneo.
- **Season**: período institucional.
- **Tournament**: competencia, formato, estado, fechas, privacidad, reglas y apariencia.
- **Category**: segmento competitivo dentro de una organización o torneo.

## Participación

- **Arma2Team**: referencia al equipo general existente.
- **TournamentEntry**: inscripción del equipo a torneo/categoría/grupo, con capitán, colores y estado propios.
- **RosterSubmission**: versión presentada del plantel.
- **RosterPlayer**: participación del jugador en esa versión, dorsal, posición y habilitación.
- **PlayerIdentity**: unión a usuario/perfil Arma2 o identidad provisional reclamable.
- **TransferRecord**: historial de alta, baja y transferencia.

Invariante: equipo general, inscripción y roster son entidades distintas.

## Competencia y fixture

- **Stage**: fase de liga, grupos o eliminación.
- **Group**: agrupación dentro de una etapa.
- **Round**: jornada o ronda.
- **BracketNode**: cruce y progresión de playoffs.
- **FixtureRevision**: versión estructural auditable.
- **Match**: partido oficial, amistoso institucional o importado, con estado y referencias competitivas.
- **ScheduleSlot**: fecha, hora, sede, cancha y árbitro.
- **Venue / Court**: sede y cancha con disponibilidad y modalidad.
- **OfficialAssignment**: árbitro/colaborador asignado y alcance de carga.

## Operación del partido

- **MatchReport**: carga, confirmación, reclamo y resolución.
- **MatchResult**: tiempo regular, extra, penales, walkover o decisión administrativa.
- **MatchEvent**: gol, asistencia, tarjetas, penal, incidente, MVP u observación.
- **MatchEventRevision**: before/after, autor, motivo y fecha.
- **Evidence**: metadatos y storage protegido.

La confirmación posterior requiere una transición explícita. Editar un partido confirmado recalcula derivados en una transacción o no modifica nada.

## Tabla y estadísticas

- **StandingRuleSet**: puntos, desempates ordenados, clasificación y descenso.
- **StandingSnapshot / StandingRow**: proyección versionada y reconstruible.
- **PlayerTournamentStat / TeamTournamentStat**: derivados por scope.
- **OfficialHistoryLink**: integración futura con historial Arma2, separada del scoring personal.

Fuente de verdad: partidos confirmados, eventos vigentes y resoluciones disciplinarias. Los snapshots son derivados.

## Disciplina

- **DisciplineRuleSet**: acumulaciones y consecuencias.
- **DisciplinaryCase**: expediente, sujetos, motivo, evidencia y estado.
- **Sanction**: alcance, duración, partidos afectados y cumplimiento.
- **Appeal / Resolution**: revisión humana y decisión.
- **EligibilityProjection**: habilitación derivada, reconstruible.

Las sugerencias automáticas no son sanciones irreversibles; requieren la transición configurada y auditoría.

## Comunicación y publicación

- **Publication**: aviso, noticia o comunicado, audiencia, estado y programación.
- **Gallery / MediaAsset**: contenido y privacidad.
- **PublicPageConfig**: campos públicos por organización/torneo/equipo.
- **ContentTemplate / GeneratedAsset**: tipo, datos, versión, formato, sponsors y estado de vigencia.
- **ExportJob / DocumentJob**: solicitud, permisos, snapshot y resultado temporal.

## Auditoría transversal

`AuditEvent` registra actor, organización, torneo, acción, recurso, before/after seguro, motivo, correlation id, fecha e IP/dispositivo cuando sea legítimo. No duplica secretos ni datos sensibles completos.

## Relaciones clave

```text
Organization 1──* Season 1──* Tournament
Organization 1──* Membership *──1 User
Tournament 1──* Category
Arma2Team 0..1──* TournamentEntry 1──* RosterSubmission 1──* RosterPlayer
Tournament 1──* Stage 1──* Round 1──* Match
Match 1──* MatchEvent
Match *──1 ScheduleSlot *──1 Court *──1 Venue
Tournament 1──* DisciplinaryCase 1──* Sanction
```

## Temas abiertos antes de migrar

- tratamiento legal y consentimiento para documentos y menores;
- estrategia de identidad provisional y reclamo;
- cardinalidad de categorías entre organización y torneo;
- snapshot vs cálculo bajo demanda para tablas grandes;
- retención de evidencia y exportaciones;
- reglas exactas de estadísticas oficiales frente al scoring actual.
