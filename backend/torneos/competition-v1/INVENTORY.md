# COMPETITION-V1 — Inventario (Fase A)

Generado por `build-inventory.mjs` desde [`contract.json`](contract.json) y la evidencia de certificación LOCAL (`evidence/node|edge/results.json`). No editar a mano.

Contrato: **75 RPC** en 9 superficies (74 autenticadas + 1 pública), 3 tablas leídas por la ruta de tablas (members, venues, courts). Categorías: ADMIN_OWNER, PRIVATE_AUTHENTICATED, PUBLIC_READ_ONLY, SYSTEM_ONLY.

Columnas: **cat** = categoría del contrato · **scope** = season / organization / resource / self / public · **DB** = de dónde sale el EXECUTE · **2B** = veredicto Phase 2B · **journey** = ejercida con éxito por `integration/torneos-core-contracts/competition.test.mjs` (Node y Edge) · **matriz** = actores rechazados con 42501 en C2.

## fixtures

- Rutas: `/torneos/organizacion/:org/torneo/:t/fixture{,/participantes,/bombos,/sorteo,/grupos,/generar,/version/:v,/jornadas,/jornadas/:r,/partidos/:m,/llave}` · `/torneos/organizacion/:org/torneo/:t/programacion` · `/torneos/organizacion/:org/sedes{,/:venueId}`
- Componentes: `FixtureWorkspacePage`, `OrganizationVenuesPage`, `TorneosFixtureContext`
- Tablas (GET, RLS): `tournament_venues (GET, RLS venues.read)`, `tournament_courts (GET, RLS courts.read)`
- Tests frontend existentes: `torneosFixtureContext`, `torneosCompetitionFlow`, `torneosDesktopSchedulingLayout`, `tournamentFixtureService`; agregados: `competition-adapter.test.mjs` (paridad de payload), `torneosStagingV1Composition` (composición híbrida).
- Riesgo: Writes the competition structure. Season scope was missing on update_draft_fixture (fixed in 0004). Service-only archive/postpone/cancel/restore stay closed; the UI hides "Descartar borrador".

| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |
|---|---|---|---|---|---|---|---|---|---|
| `get_tournament_fixture_context` | `loadFixtureContext` | ADMIN OWNER | season | no | fixture.read (or the entry's team manager) | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `get_tournament_schedule_context` | `loadScheduleContext` | ADMIN OWNER | season | no | fixture.read | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `freeze_tournament_participants` | `freezeParticipants` | ADMIN OWNER | season | sí | participants.freeze | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `reopen_tournament_participants` | `reopenParticipants` | ADMIN OWNER | season | sí | participants.reopen | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `save_tournament_draw_pots` | `saveDrawPots` | ADMIN OWNER | season | sí | draw.manage | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `execute_tournament_group_draw` | `executeGroupDraw` | ADMIN OWNER | season | sí | draw.execute / draw.publish | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `generate_tournament_fixture` | `generateFixture` | ADMIN OWNER | season | sí | fixture.generate | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `create_manual_fixture_version` | `createManualFixture` | ADMIN OWNER | season | sí | fixture.create_manual | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `update_draft_fixture` | `updateDraftFixture` | ADMIN OWNER | season | sí | fixture.update_draft / rounds.manage / matches.create (+ season access, COMPETITION-V1 fix) | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `validate_tournament_fixture` | `validateFixture` | ADMIN OWNER | season | no | fixture.read | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `publish_tournament_fixture` | `publishFixture` | ADMIN OWNER | season | sí | fixture.publish (fixture.supersede when replacing) | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `append_tournament_playoff_phase` | `appendPlayoffPhase` | ADMIN OWNER | season | sí | fixture.publish | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `supersede_tournament_fixture` | `supersedeFixture` | ADMIN OWNER | season | sí | fixture.supersede | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `create_tournament_venue` | `createVenue` | ADMIN OWNER | organization | sí | venues.create | authenticated (baseline) | ORG_SCOPED | sí | cross-workspace, inactive-membership, collaborator-write, participant, captain |
| `create_tournament_court` | `createCourt` | ADMIN OWNER | organization | sí | courts.create | authenticated (baseline) | ORG_SCOPED | sí | cross-workspace, inactive-membership, collaborator-write, participant, captain |
| `save_tournament_schedule_windows` | `saveScheduleWindows` | ADMIN OWNER | season | sí | schedule_windows.manage | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `validate_tournament_match_schedule` | `validateMatchSchedule` | ADMIN OWNER | season | no | fixture read scope | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `schedule_tournament_match` | `scheduleMatch` | ADMIN OWNER | season | sí | matches.schedule (schedule_conflicts.override to force) | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `reschedule_tournament_match` | `rescheduleMatch` | ADMIN OWNER | season | sí | matches.reschedule (schedule_conflicts.override to force) | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `auto_schedule_tournament_matches` | `autoScheduleMatches` | ADMIN OWNER | season | sí | matches.schedule | granted by 0004 | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |

## match_operations

- Rutas: `/torneos/organizacion/:org/torneo/:t/partidos{,/:m,/:m/convocatorias,/:m/acta,/:m/revision,/:m/historial}` · `/torneos/mis-partidos{,/:m,/:m/convocatoria}`
- Componentes: `MatchOperationsPage`, `MyTournamentMatchesPage`, `CaptainMatchSquadPage`
- Tests frontend existentes: `torneosMatchOperationsFlow`, `torneosMatchLocalization`, `torneosAttendanceActorContract`, `torneosPlayerMatchesRelations`, `tournamentMatchOperationsService`; agregados: `competition-adapter.test.mjs` (paridad de payload), `torneosStagingV1Composition` (composición híbrida).
- Riesgo: Official results feed standings. Dual control (submitter ≠ validator), official/correction idempotent under concurrency, captains limited to their own squad — all exercised.

| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |
|---|---|---|---|---|---|---|---|---|---|
| `get_player_tournament_matches` | `loadPlayerMatches` | PRIVATE AUTHENTICATED | self | no | own active roster rows | authenticated (baseline) | NOT_SWEPT | sí | — |
| `get_managed_tournament_matches` | `loadPlayerMatches` | PRIVATE AUTHENTICATED | self | no | own active team-manager rows | authenticated (baseline) | NOT_SWEPT | sí | — |
| `respond_match_availability` | `respondMatchAvailability` | PRIVATE AUTHENTICATED | resource | sí | the caller's own roster player in the match | authenticated (baseline) | NOT_SWEPT | sí | cross-workspace |
| `get_tournament_match_operations_context` | `loadMatchOperations` | ADMIN OWNER | season | no | match_operations.read | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `get_tournament_match_operation_context` | `loadMatchOperation` | ADMIN OWNER | season | no | match_operations.read | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `get_match_squad_context` | `loadMatchSquad` | PRIVATE AUTHENTICATED | resource | no | match_squads.read + season, or the team's active manager · capitán del equipo | authenticated (baseline) | SCOPED | sí | cross-workspace |
| `get_my_managed_match_squad_context` | `loadMyManagedMatchSquad` | PRIVATE AUTHENTICATED | self | no | own active team-manager row · capitán del equipo | authenticated (baseline) | NOT_SWEPT | sí | — |
| `save_match_squad` | `saveMatchSquad` | PRIVATE AUTHENTICATED | resource | sí | match_squads.manage + season, or the team's active manager · capitán del equipo | authenticated (baseline) | SCOPED | sí | cross-workspace |
| `submit_match_squad` | `submitMatchSquad` | PRIVATE AUTHENTICATED | resource | sí | match_squads.manage + season, or the team's active manager · capitán del equipo | granted by 0004 | INCONCLUSIVE | sí | cross-workspace |
| `open_tournament_match_operation` | `openMatchOperation` | ADMIN OWNER | season | sí | match_operations.open | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `set_tournament_match_outcome` | `setMatchOutcome` | ADMIN OWNER | season | sí | match_outcomes.manage (administrative results: match_administrative_results.manage) | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `set_tournament_match_score` | `setMatchScore` | ADMIN OWNER | season | sí | match_scores.manage | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `add_tournament_match_event` | `addMatchEvent` | ADMIN OWNER | season | sí | match_events.create | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `void_tournament_match_event` | `voidMatchEvent` | ADMIN OWNER | season | sí | match_events.void | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `submit_tournament_match_operation` | `submitMatchOperation` | ADMIN OWNER | season | sí | match_operations.submit | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `review_tournament_match_operation` | `reviewMatchOperation` | ADMIN OWNER | season | sí | match_operations.review | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `validate_tournament_match_operation` | `validateMatchOperation` | ADMIN OWNER | season | sí | match_operations.validate (dual control: never the submitter) | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `make_tournament_match_official` | `makeMatchOfficial` | ADMIN OWNER | season | sí | match_operations.make_official | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `request_tournament_match_correction` | `requestMatchCorrection` | ADMIN OWNER | season | sí | match_operations.request_correction | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `create_tournament_match_correction` | `createMatchCorrection` | ADMIN OWNER | season | sí | match_operations.correct | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |

## standings

- Rutas: `/torneos/organizacion/:org/torneo/:t/competencia{,/tabla,/estadisticas,/clasificacion,/disciplina}`
- Componentes: `CompetitionCenterPage`
- Tests frontend existentes: `torneosCompetitionCenter`; agregados: `competition-adapter.test.mjs` (paridad de payload), `torneosStagingV1Composition` (composición híbrida).
- Riesgo: Published table is what participants and the public page see. Rebuild is idempotent by key; qualification refuses ambiguous tables.

| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |
|---|---|---|---|---|---|---|---|---|---|
| `get_tournament_standings_context` | `loadStandings` | ADMIN OWNER | season | no | standings.read + season (or a manager/player of the tournament) | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `get_tournament_statistics_context` | `loadStatistics` | ADMIN OWNER | season | no | statistics.read + season (or a manager/player of the tournament) | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `rebuild_tournament_standings` | `rebuildStandings` | ADMIN OWNER | season | sí | standings.rebuild | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `publish_tournament_standings_revision` | `publishStandings` | ADMIN OWNER | season | sí | standings.publish | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `resolve_tournament_qualification` | `resolveQualification` | ADMIN OWNER | season | sí | qualification.resolve | granted by 0004 | INCONCLUSIVE | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |

## lifecycle_actions

- Rutas: `/torneos/organizacion/:org/inicio (CompetitionLifecycleActions)`
- Componentes: `CompetitionLifecycleActions`, `TorneosCompetitionContext`
- Tests frontend existentes: `torneosCompetitionContext`, `torneosCompetitionFlow`; agregados: `competition-adapter.test.mjs` (paridad de payload), `torneosStagingV1Composition` (composición híbrida).
- Riesgo: Finish requires no pending commitments; reopen is owner-only (tournaments.reopen).

| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |
|---|---|---|---|---|---|---|---|---|---|
| `start_tournament_competition` | `startCompetition` | ADMIN OWNER | season | sí | tournaments.start | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `finish_tournament_competition` | `finishCompetition` | ADMIN OWNER | season | sí | tournaments.finish | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `reopen_tournament_competition` | `reopenCompetition` | ADMIN OWNER | season | sí | tournaments.reopen (owner only) | authenticated (baseline) | CAPABILITY_DENIED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |

## participant_withdrawal

- Rutas: `/torneos/organizacion/:org/torneo/:t/equipos (TeamWithdrawalDialog)`
- Componentes: `TeamsPage`, `TeamWithdrawalDialog`
- Tests frontend existentes: `torneosTeamsFlow`; agregados: `competition-adapter.test.mjs` (paridad de payload), `torneosStagingV1Composition` (composición híbrida).
- Riesgo: Irreversible for the season; participants.withdraw staff only (captains/collaborators refused).

| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |
|---|---|---|---|---|---|---|---|---|---|
| `withdraw_tournament_competition_participant` | `withdrawCompetitionParticipant` | ADMIN OWNER | season | sí | participants.withdraw | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |

## participant_hub

- Rutas: `/torneos/torneo/:t{,/partidos,/partidos/:m,/tabla,/estadisticas,/equipos,/disciplina}` · `/torneos/mis-torneos (hub links)`
- Componentes: `TournamentHubPage`, `MyTournamentsPage`
- Tests frontend existentes: `torneosParticipantHub`, `torneosParticipantHubService`, `torneosUnifiedExperience`; agregados: `competition-adapter.test.mjs` (paridad de payload), `torneosStagingV1Composition` (composición híbrida).
- Riesgo: Read-only published projections for participants; hub access = season staff or active captain/delegate/player of an approved entry.

| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |
|---|---|---|---|---|---|---|---|---|---|
| `get_tournament_participant_hub` | `loadParticipantHub` | PRIVATE AUTHENTICATED | resource | no | season staff, or an active captain/delegate/player of an approved entry | anon + authenticated (baseline) | SCOPED | sí | cross-workspace |
| `set_my_tournament_hub_category` | `setHubCategory` | PRIVATE AUTHENTICATED | resource | sí | own preference, hub access required | authenticated (baseline) | SCOPED | sí | cross-workspace |
| `get_published_tournament_matches` | `loadPublishedMatches` | PRIVATE AUTHENTICATED | resource | no | hub access; published data only | anon + authenticated (baseline) | SCOPED | sí | cross-workspace |
| `get_tournament_participant_match` | `loadParticipantMatch` | PRIVATE AUTHENTICATED | resource | no | hub access; published data only | anon + authenticated (baseline) | SCOPED | sí | cross-workspace |
| `get_published_tournament_teams` | `loadPublishedTeams` | PRIVATE AUTHENTICATED | resource | no | hub access; published data only | anon + authenticated (baseline) | SCOPED | sí | cross-workspace |
| `get_published_tournament_standings` | `loadPublishedStandings` | PRIVATE AUTHENTICATED | resource | no | hub access; published revision only | anon + authenticated (baseline) | SCOPED | sí | cross-workspace |
| `get_published_tournament_statistics` | `loadPublishedStatistics` | PRIVATE AUTHENTICATED | resource | no | hub access; published revision only | anon + authenticated (baseline) | SCOPED | sí | cross-workspace |

## communications

- Rutas: `/torneos/organizacion/:org/comunicaciones` · `/torneos/comunicados` · `/torneos/torneo/:t/novedades`
- Componentes: `CommunicationsAdminPage`, `MyCommunicationsPage`, `TournamentCommunicationsPanel`
- Tests frontend existentes: `torneosCommunications`, `torneosCommunicationsService`; agregados: `competition-adapter.test.mjs` (paridad de payload), `torneosStagingV1Composition` (composición híbrida).
- Riesgo: Recipients are resolved server-side at publish; collaborators may draft but never publish. Publishing a document had an authorization-order oracle (fixed in 0004).

| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |
|---|---|---|---|---|---|---|---|---|---|
| `get_tournament_communications_inbox` | `loadCommunicationsInbox` | PRIVATE AUTHENTICATED | self | no | own recipient rows | authenticated (baseline) | NOT_SWEPT | sí | — |
| `get_tournament_announcement` | `loadAnnouncement` | PRIVATE AUTHENTICATED | resource | no | recipient of the announcement, or announcements.read staff | anon + authenticated (baseline) | SCOPED | sí | cross-workspace |
| `mark_tournament_announcement_read` | `markAnnouncementRead` | PRIVATE AUTHENTICATED | resource | sí | recipient of the announcement | authenticated (baseline) | NOT_SWEPT | sí | cross-workspace |
| `get_published_tournament_documents` | `loadPublishedDocuments` | PRIVATE AUTHENTICATED | resource | no | tournament communications access | anon + authenticated (baseline) | SCOPED | sí | cross-workspace |
| `acknowledge_tournament_document` | `acknowledgeDocument` | PRIVATE AUTHENTICATED | resource | sí | tournament communications access | authenticated (baseline) | NOT_SWEPT | sí | cross-workspace |
| `get_tournament_communications_admin_context` | `loadCommunicationsAdminContext` | ADMIN OWNER | season | no | announcements.read · collaborator redacta | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `create_tournament_announcement_draft` | `createAnnouncementDraft` | ADMIN OWNER | season | sí | announcements.create · collaborator redacta | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, participant, captain |
| `update_tournament_announcement_draft` | `updateAnnouncementDraft` | ADMIN OWNER | season | sí | announcements.update_draft · collaborator redacta | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, participant, captain |
| `replace_tournament_announcement_audience` | `replaceAnnouncementAudience` | ADMIN OWNER | season | sí | announcements.update_draft (via set_tournament_announcement_audience) · collaborator redacta | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, participant, captain |
| `set_tournament_announcement_link` | `setAnnouncementLink` | ADMIN OWNER | season | sí | announcements.update_draft · collaborator redacta | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, participant, captain |
| `preview_tournament_announcement_audience` | `previewAnnouncementAudience` | ADMIN OWNER | season | no | audiences.preview · collaborator redacta | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `publish_tournament_announcement` | `publishAnnouncement` | ADMIN OWNER | season | sí | announcements.publish | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `create_tournament_document` | `createDocument` | ADMIN OWNER | season | sí | documents.create · collaborator redacta | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, participant, captain |
| `publish_tournament_document_version` | `publishDocumentVersion` | ADMIN OWNER | season | sí | documents.publish | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |

## notifications

- Rutas: `/torneos/torneo/:t/novedades (preferences panel)`
- Componentes: `TournamentCommunicationsPanel`
- Tests frontend existentes: `torneosCommunications`; agregados: `competition-adapter.test.mjs` (paridad de payload), `torneosStagingV1Composition` (composición híbrida).
- Riesgo: Own preferences only; no delivery channel exists in Torneos (in-app inbox).

| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |
|---|---|---|---|---|---|---|---|---|---|
| `get_my_tournament_notification_preferences` | `loadNotificationPreferences` | PRIVATE AUTHENTICATED | resource | no | own preferences, tournament communications access | authenticated (baseline) | SCOPED | sí | cross-workspace |
| `update_my_tournament_notification_preferences` | `updateNotificationPreferences` | PRIVATE AUTHENTICATED | resource | sí | own preferences, tournament communications access | authenticated (baseline) | SCOPED | sí | cross-workspace |

## public_pages

- Rutas: `/torneos/publico/:publicSlug (anonymous)` · `/torneos/organizacion/:org/torneo/:t/configuracion (TournamentPublicPageSettings)`
- Componentes: `PublicTournamentPage`, `TournamentPublicPageSettings`
- Tests frontend existentes: `torneosPublicPages`, `torneosPublicPagesService`, `torneosCompetitionV1PublicRoute (new)`; agregados: `competition-adapter.test.mjs` (paridad de payload), `torneosStagingV1Composition` (composición híbrida).
- Riesgo: The only anonymous surface: one read RPC behind the gateway public route (no credential accepted, exact arguments, 2 KiB). Unpublished/unknown slug → null.

| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |
|---|---|---|---|---|---|---|---|---|---|
| `get_tournament_public_page_settings` | `loadPublicPageSettings` | ADMIN OWNER | season | no | tournaments.read | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season |
| `set_tournament_public_page_published` | `setPublicPagePublished` | ADMIN OWNER | season | sí | tournaments.update | authenticated (baseline) | SCOPED | sí | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain |
| `get_public_tournament_page` | `loadPage (public service)` | PUBLIC READ_ONLY | public | no | anon: published page, active tournament only (visibility predicates in the function) | anon + authenticated (baseline) | NOT_SWEPT | B14 + D2 | — |

## Fuera del contrato

| RPC / alias | motivo |
|---|---|
| `archive_tournament_fixture` | service only baseline — legacy alias archiveFixture (draft discard after start): SERVICE_ONLY since the baseline, never reachable by a client; the hybrid adapter omits the alias and the UI hides the action |
| `postpone_tournament_match` | service only baseline — legacy changeMatchPlan: SERVICE_ONLY, no page calls it |
| `cancel_tournament_match` | service only baseline — legacy changeMatchPlan: SERVICE_ONLY, no page calls it |
| `restore_tournament_match_unscheduled` | service only baseline — legacy changeMatchPlan: SERVICE_ONLY, no page calls it |
| `ready_tournament_match` | service only baseline — server-side state transition |
| `schedule_tournament_match_resumption` | service only baseline — server-side, suspended matches |
| `lock_tournament_roster` | feature off kept revoked — roster_lock: no page calls lockRoster |
| `record_manual_match_availability` | feature off kept revoked — no page calls recordManualMatchAvailability |
| `create_tournament_points_adjustment` | feature off kept revoked — no page calls it |
| `revoke_tournament_points_adjustment` | feature off kept revoked — no page calls it |
| `create_tournament_disciplinary_override` | feature off kept revoked — no page calls it |
| `mark_tournament_suspension_served` | feature off kept revoked — no page calls it |
| `authorize_tournament_social_export` | feature off kept revoked — social_studio OFF |
| `cancel_tournament_purchase` | feature off kept revoked — billing OFF |
| `has_tournament_entitlement` | feature off kept revoked — billing OFF |
| `get_tournament_player_portrait_ref` | feature off kept revoked — player_portraits OFF |
| `revoke_tournament_player_portrait_publication` | feature off kept revoked — player_portraits OFF |
| `set_tournament_player_portrait_crop` | feature off kept revoked — player_portraits OFF |
| `set_tournament_player_portrait_editorial_status` | feature off kept revoked — player_portraits OFF |
| `revoke_tournament_team_photo` | feature off kept revoked — team_photos OFF |
| `change_tournament_media_gallery_state` | feature off kept revoked — media OFF |
| `report_tournament_media_asset` | feature off kept revoked — media OFF |
| `transition_tournament_media_asset` | feature off kept revoked — media OFF |
| `update_tournament_venue` | not called by any page |
| `update_tournament_court` | not called by any page |
| `set_tournament_announcement_audience` | not called by any page |
| `save_tournament_match_operation_draft` | not called by any page |
| `void_tournament_match_operation` | not called by any page |
| `get_player_tournament_statistics` | not called by any page |
| `get_player_tournament_suspensions` | not called by any page |
| `get_public_tournament_branding` | not called by any page — (branding OFF: the hybrid public page renders without logos) |
| `get_tournament_branding_context` | not called by any page |
