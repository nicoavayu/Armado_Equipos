# Modelo de dominio

Las fases de workspaces y núcleo competitivo materializan organización,
membership, temporadas, torneos, categorías, reglas y preferencias. El resto de
este documento continúa como modelo futuro y no autoriza tablas adicionales.

## Núcleo implementado

- `tournament_organizations`: nombre, slug, logo opcional, estado, creador, clave de idempotencia y timestamps.
- `tournament_organization_members`: organización, usuario, rol, estado, invitador opcional e ingreso.
- `user_workspace_preferences`: contexto personal u organización activa.

Roles implementados: `owner`, `admin`, `collaborator`. Estados de membresía: `active`, `suspended`, `removed`.

La creación atómica garantiza un owner activo. Un índice parcial limita cada organización a un único owner activo y un trigger impide degradarlo o eliminarlo hasta que exista un flujo formal de transferencia.

## Núcleo competitivo implementado

- `tournament_seasons`: período institucional con slug por organización,
  calendario opcional y ciclo `draft → active → completed → archived`.
- `tournaments`: competencia de una temporada con modalidad, formato, tipo,
  calendario y estado.
- `tournament_categories`: divisiones ordenadas, archivables y con overrides
  explícitos.
- `tournament_scoring_rules`: puntuación estructurada 1:1.
- `tournament_tiebreak_rules`: criterios únicos y ordenados.
- `tournament_discipline_rules`: configuración previa 1:1, sin sanciones.
- `tournament_sport_modalities` y `tournament_competition_formats`: catálogos.
- `user_tournament_context_preferences`: contexto activo por usuario y
  organización.

El torneo aporta modalidad, género y team size por defecto. Una categoría con
valor `NULL` hereda; sólo un valor explícito sobrescribe. No se crea categoría
general automática.

## Núcleo institucional futuro

- **Organization**: owner, nombre, slug, branding, contacto, ubicación, estado y configuración.
- **OrganizationMembership**: usuario, organización, estado y vigencia.
- **Role / Permission / RoleGrant**: catálogo de capacidades y asignaciones; el nombre del rol no decide permisos.
- **TournamentGrant**: restricciones o capacidades adicionales para un torneo.
- Branding, privacidad avanzada y grants limitados por torneo.

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

### Operación implementada

- **MatchSquad / MatchSquadPlayer**: convocatoria y snapshot de alineación.
- **AvailabilityResponse**: respuesta propia o manual auditada.
- **MatchOperation**: versión del acta y autoridad de workflow.
- **MatchOperationPlayer**: snapshot inmutable usado por eventos.
- **MatchOutcome / MatchScore**: qué ocurrió y su marcador, sin confundirlos.
- **MatchReview / MatchResumption**: doble control, corrección y continuación.

`MatchOperation(official)` es la única raíz consumible por futuros derivados.
El fixture nunca se consulta como fuente de marcador.

## Tabla y estadísticas

- **StandingRuleSet**: puntos, desempates ordenados, clasificación y descenso.
- **StandingSnapshot / StandingRow**: proyección versionada y reconstruible.
- **PlayerTournamentStat / TeamTournamentStat**: derivados por scope.
- **OfficialHistoryLink**: integración futura con historial Arma2, separada del scoring personal.

Fuente de verdad: partidos confirmados, eventos vigentes y resoluciones disciplinarias. Los snapshots son derivados.

### Proyección implementada

`StandingsRevision` enlaza `ProjectionSource`, `TeamStanding`,
`TeamStatistic`, `PlayerStatistic`, `DisciplineLedger` y `PlayerSuspension`.
`QualificationSlot` conserva la fuente y `QualificationResolution` su
asignación o bloqueo histórico. `PointsAdjustment`, `DisciplinaryOverride` y
`SuspensionServedMatch` son resoluciones explícitas; nunca reescriben el acta.

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

### Multimedia implementada

- **MediaGallery**: colección editorial scoped a torneo, categoría o partido,
  con audiencia, workflow y portada.
- **MediaAsset / MediaVariant**: metadatos privados del original y sus tamaños
  procesados; no almacenan URLs públicas.
- **MediaUploadSession**: autorización efímera hasheada, limitada y de un solo
  uso; la finalización pertenece al adaptador confiable.
- **MediaRelation / MediaGalleryItem**: tags tipados y orden editorial sin
  trasladar el asset entre tenants.
- **MediaModerationAction**: transición append-only.
- **MediaConsent**: decisión explícita, vigente y revocable por sujeto.
- **MediaReport**: reporte privado y resolución auditable.
- **MediaAssignment**: fotógrafo habilitado por torneo y vigencia.

Un tag individual no concede consentimiento. Archivar, revocar u ocultar
preserva la historia y retira el contenido de la proyección participante.

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
Match 1──* MatchSquad 1──* MatchSquadPlayer
Match 1──* MatchOperation 1──1 MatchOutcome
MatchOperation 1──0..1 MatchScore
MatchOperation 1──* MatchReview
Match *──1 ScheduleSlot *──1 Court *──1 Venue
Tournament 1──* DisciplinaryCase 1──* Sanction
```

## Temas abiertos antes de migrar módulos deportivos

- tratamiento legal y consentimiento para documentos y menores;
- estrategia de identidad provisional y reclamo;
- snapshot vs cálculo bajo demanda para tablas grandes;
- normalización de mejores terceros y series ida/vuelta;
- retención de evidencia y exportaciones;
- reglas exactas de estadísticas oficiales frente al scoring actual.

## Participación implementada

`tournament_team_entries` separa `teams` de la participación concreta.
Managers, invitaciones, versiones de plantel, usuarios Arma2 y provisionales son
entidades tenant-scoped. La identidad con cuenta es `auth.users.id`;
`jugadores` continúa reservado a participaciones en partidos.

## Preferencia del Participant Hub

`tournament_participant_hub_preferences` relaciona usuario y torneo con su
última categoría autorizada. No otorga acceso: cada lectura vuelve a comprobar
membership organizacional, manager o roster activo. Su RLS no concede acceso
directo y sólo los RPCs específicos pueden leerla o modificarla.

## Comunicación oficial

`tournament_announcements` versiona el contenido; sus audiencias son criterios
estructurados y `tournament_announcement_deliveries` congela una entrega
deduplicada. `tournament_documents` mantiene identidad y versión activa,
`tournament_document_versions` conserva historia inmutable y los
acknowledgements pertenecen a una versión. Las preferencias personales nunca
son una frontera de autorización. Ver [19-communications.md](19-communications.md).
