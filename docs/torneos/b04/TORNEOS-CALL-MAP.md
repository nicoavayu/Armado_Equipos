# TORNEOS-CALL-MAP — auditoría B04

Inventario legacy congelado en `2058da039a2a5eaaed22d87d01946bc596ae5f50` (Phase 2D); árbol integrado auditado en `92b881060696b4f9ed609efde5d93363e8e6fa4d`. Reconstruido del código. No representa resultados de R2/R3/R4/R5.

191 sitios RPC legacy; 190 nombres distintos; 108 nombres dentro de scope; 82 fuera. La selección dinámica de `changeTournamentMatchPlan` se resuelve a sus tres nombres literales. No quedan RPC dinámicas sin resolver.

## Encaminadas por el adapter híbrido — staging v1 + COMPETITION-V1 (108)

`src/features/torneos/stagingV1/stagingV1WorkspaceService.js` expone la misma interfaz de aliases que `tournamentWorkspaceService` para estas 108 RPC (mismo nombre, mismo payload `p_*`, verificado alias por alias contra el servicio legacy en `scripts/torneos-frontend/adapter.test.mjs` y `competition-adapter.test.mjs`) sobre `foundation/torneosClient.execute` → `foundation/torneosTransport` → `POST {gateway}/torneos/rest/v1/rpc/<name>`. Los sitios legacy siguen existiendo para la composición single-project LOCAL; la composición híbrida nunca los alcanza.

| RPC | Función frontend legacy | Sitio legacy |
| --- | --- | --- |
| `accept_tournament_team_invitation` | `acceptTournamentTeamInvitation` | [src/features/torneos/api/tournamentWorkspaceService.js:748](../../../src/features/torneos/api/tournamentWorkspaceService.js#L748) |
| `acknowledge_tournament_document` | `acknowledgeTournamentDocument` | [src/features/torneos/api/tournamentWorkspaceService.js:1784](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1784) |
| `add_tournament_match_event` | `addTournamentMatchEvent` | [src/features/torneos/api/tournamentWorkspaceService.js:1195](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1195) |
| `add_tournament_roster_player` | `addTournamentRosterPlayer` | [src/features/torneos/api/tournamentWorkspaceService.js:661](../../../src/features/torneos/api/tournamentWorkspaceService.js#L661) |
| `append_tournament_playoff_phase` | `appendTournamentPlayoffPhase` | [src/features/torneos/api/tournamentWorkspaceService.js:871](../../../src/features/torneos/api/tournamentWorkspaceService.js#L871) |
| `archive_tournament_team_entry` | `archiveTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:722](../../../src/features/torneos/api/tournamentWorkspaceService.js#L722) |
| `assign_tournament_season_member` | `assignTournamentSeasonMember` | [src/features/torneos/api/tournamentWorkspaceService.js:146](../../../src/features/torneos/api/tournamentWorkspaceService.js#L146) |
| `auto_schedule_tournament_matches` | `autoScheduleTournamentMatches` | [src/features/torneos/api/tournamentWorkspaceService.js:1053](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1053) |
| `change_tournament_status` | `changeTournamentCompetitionStatus` | [src/features/torneos/api/tournamentWorkspaceService.js:497](../../../src/features/torneos/api/tournamentWorkspaceService.js#L497) |
| `create_manual_fixture_version` | `createManualTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:838](../../../src/features/torneos/api/tournamentWorkspaceService.js#L838) |
| `create_tournament_announcement_draft` | `createTournamentAnnouncementDraft` | [src/features/torneos/api/tournamentWorkspaceService.js:1815](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1815) |
| `create_tournament_court` | `createTournamentCourt` | [src/features/torneos/api/tournamentWorkspaceService.js:976](../../../src/features/torneos/api/tournamentWorkspaceService.js#L976) |
| `create_tournament_document` | `createTournamentDocument` | [src/features/torneos/api/tournamentWorkspaceService.js:1934](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1934) |
| `create_tournament_match_correction` | `createTournamentMatchCorrection` | [src/features/torneos/api/tournamentWorkspaceService.js:1249](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1249) |
| `create_tournament_organization` | `createTournamentOrganization` | [src/features/torneos/api/tournamentWorkspaceService.js:232](../../../src/features/torneos/api/tournamentWorkspaceService.js#L232) |
| `create_tournament_provisional_player` | `createTournamentProvisionalPlayer` | [src/features/torneos/api/tournamentWorkspaceService.js:653](../../../src/features/torneos/api/tournamentWorkspaceService.js#L653) |
| `create_tournament_season` | `createTournamentSeason` | [src/features/torneos/api/tournamentWorkspaceService.js:353](../../../src/features/torneos/api/tournamentWorkspaceService.js#L353) |
| `create_tournament_team_entry` | `createTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:627](../../../src/features/torneos/api/tournamentWorkspaceService.js#L627) |
| `create_tournament_venue` | `createTournamentVenue` | [src/features/torneos/api/tournamentWorkspaceService.js:954](../../../src/features/torneos/api/tournamentWorkspaceService.js#L954) |
| `create_tournament_with_defaults` | `createTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:412](../../../src/features/torneos/api/tournamentWorkspaceService.js#L412) |
| `execute_tournament_group_draw` | `executeTournamentGroupDraw` | [src/features/torneos/api/tournamentWorkspaceService.js:816](../../../src/features/torneos/api/tournamentWorkspaceService.js#L816) |
| `finish_tournament_competition` | `finishTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:526](../../../src/features/torneos/api/tournamentWorkspaceService.js#L526) |
| `freeze_tournament_participants` | `freezeTournamentParticipants` | [src/features/torneos/api/tournamentWorkspaceService.js:789](../../../src/features/torneos/api/tournamentWorkspaceService.js#L789) |
| `generate_tournament_fixture` | `generateTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:827](../../../src/features/torneos/api/tournamentWorkspaceService.js#L827) |
| `get_managed_tournament_matches` | `loadPlayerTournamentMatches` | [src/features/torneos/api/tournamentWorkspaceService.js:1078](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1078) |
| `get_match_squad_context` | `loadTournamentMatchSquad` | [src/features/torneos/api/tournamentWorkspaceService.js:1131](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1131) |
| `get_my_managed_match_squad_context` | `loadMyManagedTournamentMatchSquad` | [src/features/torneos/api/tournamentWorkspaceService.js:1139](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1139) |
| `get_my_tournament_memberships` | `loadMyTournamentMemberships` | [src/features/torneos/api/tournamentWorkspaceService.js:1363](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1363) |
| `get_my_tournament_notification_preferences` | `loadTournamentNotificationPreferences` | [src/features/torneos/api/tournamentWorkspaceService.js:1535](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1535) |
| `get_player_tournament_matches` | `loadPlayerTournamentMatches` | [src/features/torneos/api/tournamentWorkspaceService.js:1077](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1077) |
| `get_published_tournament_documents` | `loadPublishedTournamentDocuments` | [src/features/torneos/api/tournamentWorkspaceService.js:1774](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1774) |
| `get_published_tournament_matches` | `loadPublishedTournamentMatches` | [src/features/torneos/api/tournamentWorkspaceService.js:1446](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1446) |
| `get_published_tournament_standings` | `loadPublishedTournamentStandings` | [src/features/torneos/api/tournamentWorkspaceService.js:1482](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1482) |
| `get_published_tournament_statistics` | `loadPublishedTournamentStatistics` | [src/features/torneos/api/tournamentWorkspaceService.js:1496](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1496) |
| `get_published_tournament_teams` | `loadPublishedTournamentTeams` | [src/features/torneos/api/tournamentWorkspaceService.js:1468](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1468) |
| `get_team_registration_context` | `loadTeamRegistrationContext` | [src/features/torneos/api/tournamentWorkspaceService.js:615](../../../src/features/torneos/api/tournamentWorkspaceService.js#L615) |
| `get_tournament_announcement` | `loadTournamentAnnouncement` | [src/features/torneos/api/tournamentWorkspaceService.js:1519](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1519) |
| `get_tournament_communications_admin_context` | `loadTournamentCommunicationsAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:1794](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1794) |
| `get_tournament_communications_inbox` | `loadTournamentCommunicationsInbox` | [src/features/torneos/api/tournamentWorkspaceService.js:1510](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1510) |
| `get_tournament_competition_context` | `loadTournamentCompetitionContext` | [src/features/torneos/api/tournamentWorkspaceService.js:320](../../../src/features/torneos/api/tournamentWorkspaceService.js#L320) |
| `get_tournament_creation_eligibility` | `loadTournamentCreationEligibility` | [src/features/torneos/api/tournamentWorkspaceService.js:76](../../../src/features/torneos/api/tournamentWorkspaceService.js#L76) |
| `get_tournament_fixture_context` | `loadTournamentFixtureContext` | [src/features/torneos/api/tournamentWorkspaceService.js:773](../../../src/features/torneos/api/tournamentWorkspaceService.js#L773) |
| `get_tournament_match_operation_context` | `loadTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1124](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1124) |
| `get_tournament_match_operations_context` | `loadTournamentMatchOperations` | [src/features/torneos/api/tournamentWorkspaceService.js:1116](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1116) |
| `get_tournament_participant_hub` | `loadTournamentParticipantHub` | [src/features/torneos/api/tournamentWorkspaceService.js:1409](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1409) |
| `get_tournament_participant_match` | `loadTournamentParticipantMatch` | [src/features/torneos/api/tournamentWorkspaceService.js:1457](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1457) |
| `get_tournament_public_page_settings` | `loadTournamentPublicPageSettings` | [src/features/torneos/api/tournamentWorkspaceService.js:185](../../../src/features/torneos/api/tournamentWorkspaceService.js#L185) |
| `get_tournament_schedule_context` | `loadTournamentScheduleContext` | [src/features/torneos/api/tournamentWorkspaceService.js:781](../../../src/features/torneos/api/tournamentWorkspaceService.js#L781) |
| `get_tournament_standings_context` | `loadTournamentStandings` | [src/features/torneos/api/tournamentWorkspaceService.js:1274](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1274) |
| `get_tournament_statistics_context` | `loadTournamentStatistics` | [src/features/torneos/api/tournamentWorkspaceService.js:1281](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1281) |
| `get_tournament_teams_context` | `loadTournamentTeamsContext` | [src/features/torneos/api/tournamentWorkspaceService.js:601](../../../src/features/torneos/api/tournamentWorkspaceService.js#L601) |
| `get_tournament_workspace_context` | `loadTournamentWorkspaceContext` | [src/features/torneos/api/tournamentWorkspaceService.js:44](../../../src/features/torneos/api/tournamentWorkspaceService.js#L44) |
| `invite_tournament_team_manager` | `inviteTournamentTeamManager` | [src/features/torneos/api/tournamentWorkspaceService.js:738](../../../src/features/torneos/api/tournamentWorkspaceService.js#L738) |
| `is_tournament_organization_slug_available` | `checkTournamentOrganizationSlugAvailability` | [src/features/torneos/api/tournamentWorkspaceService.js:269](../../../src/features/torneos/api/tournamentWorkspaceService.js#L269) |
| `list_tournament_season_member_assignments` | `listTournamentSeasonMemberAssignments` | [src/features/torneos/api/tournamentWorkspaceService.js:139](../../../src/features/torneos/api/tournamentWorkspaceService.js#L139) |
| `make_tournament_match_official` | `makeTournamentMatchOfficial` | [src/features/torneos/api/tournamentWorkspaceService.js:1234](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1234) |
| `mark_tournament_announcement_read` | `markTournamentAnnouncementRead` | [src/features/torneos/api/tournamentWorkspaceService.js:1528](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1528) |
| `open_tournament_match_operation` | `openTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1162](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1162) |
| `preview_tournament_announcement_audience` | `previewTournamentAnnouncementAudience` | [src/features/torneos/api/tournamentWorkspaceService.js:1907](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1907) |
| `publish_tournament_announcement` | `publishTournamentAnnouncement` | [src/features/torneos/api/tournamentWorkspaceService.js:1916](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1916) |
| `publish_tournament_document_version` | `publishTournamentDocumentVersion` | [src/features/torneos/api/tournamentWorkspaceService.js:1949](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1949) |
| `publish_tournament_fixture` | `publishTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:864](../../../src/features/torneos/api/tournamentWorkspaceService.js#L864) |
| `publish_tournament_standings_revision` | `publishTournamentStandings` | [src/features/torneos/api/tournamentWorkspaceService.js:1296](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1296) |
| `rebuild_tournament_standings` | `rebuildTournamentStandings` | [src/features/torneos/api/tournamentWorkspaceService.js:1288](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1288) |
| `remove_tournament_roster_player` | `removeTournamentRosterPlayer` | [src/features/torneos/api/tournamentWorkspaceService.js:689](../../../src/features/torneos/api/tournamentWorkspaceService.js#L689) |
| `remove_tournament_season_member_assignment` | `removeTournamentSeasonMemberAssignment` | [src/features/torneos/api/tournamentWorkspaceService.js:158](../../../src/features/torneos/api/tournamentWorkspaceService.js#L158) |
| `reopen_tournament_competition` | `reopenTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:544](../../../src/features/torneos/api/tournamentWorkspaceService.js#L544) |
| `reopen_tournament_participants` | `reopenTournamentParticipants` | [src/features/torneos/api/tournamentWorkspaceService.js:798](../../../src/features/torneos/api/tournamentWorkspaceService.js#L798) |
| `replace_tournament_announcement_audience` | `replaceTournamentAnnouncementAudience` | [src/features/torneos/api/tournamentWorkspaceService.js:1858](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1858) |
| `request_tournament_match_correction` | `requestTournamentMatchCorrection` | [src/features/torneos/api/tournamentWorkspaceService.js:1241](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1241) |
| `reschedule_tournament_match` | `rescheduleTournamentMatch` | [src/features/torneos/api/tournamentWorkspaceService.js:1026](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1026) |
| `resolve_tournament_qualification` | `resolveTournamentQualification` | [src/features/torneos/api/tournamentWorkspaceService.js:1303](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1303) |
| `respond_match_availability` | `respondTournamentMatchAvailability` | [src/features/torneos/api/tournamentWorkspaceService.js:1097](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1097) |
| `review_tournament_match_operation` | `reviewTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1218](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1218) |
| `review_tournament_team_entry` | `reviewTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:704](../../../src/features/torneos/api/tournamentWorkspaceService.js#L704) |
| `save_match_squad` | `saveTournamentMatchSquad` | [src/features/torneos/api/tournamentWorkspaceService.js:1145](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1145) |
| `save_tournament_category` | `saveTournamentCategory` | [src/features/torneos/api/tournamentWorkspaceService.js:468](../../../src/features/torneos/api/tournamentWorkspaceService.js#L468) |
| `save_tournament_draw_pots` | `saveTournamentDrawPots` | [src/features/torneos/api/tournamentWorkspaceService.js:807](../../../src/features/torneos/api/tournamentWorkspaceService.js#L807) |
| `save_tournament_schedule_windows` | `saveTournamentScheduleWindows` | [src/features/torneos/api/tournamentWorkspaceService.js:994](../../../src/features/torneos/api/tournamentWorkspaceService.js#L994) |
| `schedule_tournament_match` | `scheduleTournamentMatch` | [src/features/torneos/api/tournamentWorkspaceService.js:1013](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1013) |
| `search_tournament_arma2_teams` | `searchTournamentArma2Teams` | [src/features/torneos/api/tournamentWorkspaceService.js:764](../../../src/features/torneos/api/tournamentWorkspaceService.js#L764) |
| `search_tournament_players` | `searchTournamentPlayers` | [src/features/torneos/api/tournamentWorkspaceService.js:754](../../../src/features/torneos/api/tournamentWorkspaceService.js#L754) |
| `set_active_tournament_context` | `setActiveTournamentContext` | [src/features/torneos/api/tournamentWorkspaceService.js:586](../../../src/features/torneos/api/tournamentWorkspaceService.js#L586) |
| `set_my_tournament_hub_category` | `setTournamentHubCategory` | [src/features/torneos/api/tournamentWorkspaceService.js:1432](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1432) |
| `set_tournament_announcement_link` | `setTournamentAnnouncementLink` | [src/features/torneos/api/tournamentWorkspaceService.js:1876](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1876) |
| `set_tournament_match_outcome` | `setTournamentMatchOutcome` | [src/features/torneos/api/tournamentWorkspaceService.js:1179](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1179) |
| `set_tournament_match_score` | `setTournamentMatchScore` | [src/features/torneos/api/tournamentWorkspaceService.js:1187](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1187) |
| `set_tournament_public_page_published` | `setTournamentPublicPagePublished` | [src/features/torneos/api/tournamentWorkspaceService.js:218](../../../src/features/torneos/api/tournamentWorkspaceService.js#L218) |
| `set_tournament_workspace_preference` | `setTournamentWorkspacePreference` | [src/features/torneos/api/tournamentWorkspaceService.js:253](../../../src/features/torneos/api/tournamentWorkspaceService.js#L253) |
| `start_tournament_competition` | `startTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:512](../../../src/features/torneos/api/tournamentWorkspaceService.js#L512) |
| `submit_match_squad` | `submitTournamentMatchSquad` | [src/features/torneos/api/tournamentWorkspaceService.js:1154](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1154) |
| `submit_tournament_match_operation` | `submitTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1211](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1211) |
| `submit_tournament_team_entry` | `submitTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:697](../../../src/features/torneos/api/tournamentWorkspaceService.js#L697) |
| `supersede_tournament_fixture` | `supersedeTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:891](../../../src/features/torneos/api/tournamentWorkspaceService.js#L891) |
| `update_draft_fixture` | `updateDraftTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:848](../../../src/features/torneos/api/tournamentWorkspaceService.js#L848) |
| `update_my_tournament_notification_preferences` | `updateTournamentNotificationPreferences` | [src/features/torneos/api/tournamentWorkspaceService.js:1549](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1549) |
| `update_tournament_announcement_draft` | `updateTournamentAnnouncementDraft` | [src/features/torneos/api/tournamentWorkspaceService.js:1895](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1895) |
| `update_tournament_configuration` | `updateTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:439](../../../src/features/torneos/api/tournamentWorkspaceService.js#L439) |
| `update_tournament_organization` | `updateTournamentOrganization` | [src/features/torneos/api/tournamentWorkspaceService.js:290](../../../src/features/torneos/api/tournamentWorkspaceService.js#L290) |
| `update_tournament_roster_player` | `updateTournamentRosterPlayer` | [src/features/torneos/api/tournamentWorkspaceService.js:677](../../../src/features/torneos/api/tournamentWorkspaceService.js#L677) |
| `update_tournament_season` | `updateTournamentSeason` | [src/features/torneos/api/tournamentWorkspaceService.js:379](../../../src/features/torneos/api/tournamentWorkspaceService.js#L379) |
| `update_tournament_team_entry` | `updateTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:645](../../../src/features/torneos/api/tournamentWorkspaceService.js#L645) |
| `validate_tournament_fixture` | `validateTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:857](../../../src/features/torneos/api/tournamentWorkspaceService.js#L857) |
| `validate_tournament_match_operation` | `validateTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1227](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1227) |
| `validate_tournament_match_schedule` | `validateTournamentMatchSchedule` | [src/features/torneos/api/tournamentWorkspaceService.js:1002](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1002) |
| `void_tournament_match_event` | `voidTournamentMatchEvent` | [src/features/torneos/api/tournamentWorkspaceService.js:1203](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1203) |
| `withdraw_tournament_competition_participant` | `withdrawTournamentCompetitionParticipant` | [src/features/torneos/api/tournamentWorkspaceService.js:565](../../../src/features/torneos/api/tournamentWorkspaceService.js#L565) |
| `withdraw_tournament_team_entry` | `withdrawTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:714](../../../src/features/torneos/api/tournamentWorkspaceService.js#L714) |

## Permitidas por los contratos, sin llamada frontend (18)

- `accept_tournament_organization_invitation`
- `can_read_tournament_team_entry`
- `get_tournament_match_dual_control`
- `has_organization_consumed_free_tournament`
- `has_tournament_capability`
- `has_tournament_organization_capability`
- `has_tournament_season_access`
- `has_tournament_season_capability`
- `invite_tournament_organization_member`
- `is_tournament_organization_member`
- `is_tournament_team_manager`
- `list_tournament_organization_invitations`
- `list_tournament_organization_members`
- `remove_tournament_organization_member`
- `revoke_tournament_organization_invitation`
- `set_tournament_match_dual_control`
- `tournament_role_capabilities`
- `update_tournament_organization_member_role`

La foundation copia las 126 operaciones de los contratos aprobados (Phase 2D + COMPETITION-V1 + OFFICIALIZATION-V1) exactamente; no amplía la allowlist del backend. Además lee tres tablas del contrato certificado (`tournament_organization_members`, `tournament_venues`, `tournament_courts`, `foundation/stagingV1Tables.js`) y la página pública usa la ruta anónima de sólo lectura del gateway (`get_public_tournament_page`).

## Bloqueadas por scope (82)

`torneosClient.execute` devuelve `TORNEOS_OUTSIDE_STAGING_V1` antes de cualquier red. El adapter staging-v1 no tiene alias para ninguna; las pantallas las esconden o deshabilitan vía `TorneosFeaturesContext` (`stagingV1/stagingV1Features.js`).

| RPC | Función frontend | Sitio |
| --- | --- | --- |
| `archive_tournament_fixture` | `archiveTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:883](../../../src/features/torneos/api/tournamentWorkspaceService.js#L883) |
| `archive_tournament_organization_sponsor` | `archiveTournamentOrganizationSponsor` | [src/features/torneos/api/tournamentSponsorsService.js:94](../../../src/features/torneos/api/tournamentSponsorsService.js#L94) |
| `authorize_tournament_social_export` | `authorizeTournamentSocialExport` | [src/features/torneos/api/tournamentWorkspaceService.js:2192](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2192) |
| `authorize_tournament_social_sponsors` | `authorizeTournamentSocialSponsors` | [src/features/torneos/api/tournamentSponsorsService.js:109](../../../src/features/torneos/api/tournamentSponsorsService.js#L109) |
| `block_tournament_applicant` | `blockTournamentApplicant` | [src/features/torneos/api/tournamentWorkspaceService.js:1742](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1742) |
| `cancel_tournament_match` | `changeTournamentMatchPlan` | [src/features/torneos/api/tournamentWorkspaceService.js:1045](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1045) |
| `cancel_tournament_media_upload_session` | `cancelTournamentMediaUploadSession` | [src/features/torneos/api/tournamentWorkspaceService.js:2056](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2056) |
| `cancel_tournament_purchase` | `cancelTournamentPurchase` | [src/features/torneos/api/tournamentWorkspaceService.js:176](../../../src/features/torneos/api/tournamentWorkspaceService.js#L176) |
| `change_tournament_media_gallery_state` | `changeTournamentMediaGalleryState` | [src/features/torneos/api/tournamentWorkspaceService.js:2103](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2103) |
| `create_tournament_disciplinary_override` | `createTournamentDisciplinaryOverride` | [src/features/torneos/api/tournamentWorkspaceService.js:1330](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1330) |
| `create_tournament_media_gallery` | `createTournamentMediaGallery` | [src/features/torneos/api/tournamentWorkspaceService.js:2010](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2010) |
| `create_tournament_points_adjustment` | `createTournamentPointsAdjustment` | [src/features/torneos/api/tournamentWorkspaceService.js:1310](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1310) |
| `get_effective_tournament_entitlements` | `loadEffectiveTournamentEntitlements`, `loadTournamentMediaAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:59](../../../src/features/torneos/api/tournamentWorkspaceService.js#L59), [src/features/torneos/api/tournamentWorkspaceService.js:1982](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1982) |
| `get_effective_tournament_season_entitlements` | `loadEffectiveTournamentSeasonEntitlements` | [src/features/torneos/api/tournamentWorkspaceService.js:69](../../../src/features/torneos/api/tournamentWorkspaceService.js#L69) |
| `get_my_torneos_inbox_summary` | `loadTorneosInboxSummary` | [src/features/torneos/api/tournamentWorkspaceService.js:1588](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1588) |
| `get_my_torneos_notifications` | `loadTorneosNotifications` | [src/features/torneos/api/tournamentWorkspaceService.js:1574](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1574) |
| `get_my_torneos_profile` | `loadTorneosProfile` | [src/features/torneos/api/tournamentWorkspaceService.js:1563](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1563) |
| `get_my_tournament_communication_mutes` | `loadMyTournamentCommunicationMutes` | [src/features/torneos/api/tournamentWorkspaceService.js:1759](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1759) |
| `get_my_tournament_participations` | `loadMyTournamentParticipations` | [src/features/torneos/api/tournamentWorkspaceService.js:1706](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1706) |
| `get_my_tournament_registrations` | `loadMyTournamentRegistrations` | [src/features/torneos/api/tournamentWorkspaceService.js:1764](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1764) |
| `get_player_tournament_statistics` | `loadPlayerTournamentStatistics` | [src/features/torneos/api/tournamentWorkspaceService.js:1348](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1348) |
| `get_player_tournament_suspensions` | `loadPlayerTournamentSuspensions` | [src/features/torneos/api/tournamentWorkspaceService.js:1354](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1354) |
| `get_public_tournament_branding` | `loadPublicTournamentPage` | [src/features/torneos/api/publicTournamentService.js:16](../../../src/features/torneos/api/publicTournamentService.js#L16) |
| `get_public_tournament_page` | `loadPublicTournamentPage` | [src/features/torneos/api/publicTournamentService.js:12](../../../src/features/torneos/api/publicTournamentService.js#L12) |
| `get_published_tournament_media` | `loadPublishedTournamentMedia` | [src/features/torneos/api/tournamentWorkspaceService.js:2117](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2117) |
| `get_tournament_application_inbox` | `loadTournamentApplicationInbox` | [src/features/torneos/api/tournamentWorkspaceService.js:1662](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1662) |
| `get_tournament_branding_context` | `loadTournamentBrandingContext` | [src/features/torneos/api/tournamentBrandingService.js:38](../../../src/features/torneos/api/tournamentBrandingService.js#L38) |
| `get_tournament_catalog_entry` | `<callback>` | [src/features/torneos/api/publicCatalogService.js:52](../../../src/features/torneos/api/publicCatalogService.js#L52) |
| `get_tournament_catalog_facets` | `<callback>` | [src/features/torneos/api/publicCatalogService.js:48](../../../src/features/torneos/api/publicCatalogService.js#L48) |
| `get_tournament_catalog_listing_settings` | `loadTournamentCatalogListingSettings` | [src/features/torneos/api/tournamentWorkspaceService.js:1592](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1592) |
| `get_tournament_content_reports` | `loadTournamentContentReports` | [src/features/torneos/api/tournamentWorkspaceService.js:1730](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1730) |
| `get_tournament_media_admin_context` | `loadTournamentMediaAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:1962](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1962) |
| `get_tournament_media_asset_processing_tiers` | `loadTournamentMediaAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:1972](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1972) |
| `get_tournament_media_upload_capability` | `loadTournamentMediaAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:1969](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1969) |
| `get_tournament_organization_sponsors` | `loadTournamentOrganizationSponsors` | [src/features/torneos/api/tournamentSponsorsService.js:32](../../../src/features/torneos/api/tournamentSponsorsService.js#L32) |
| `get_tournament_purchase` | `loadTournamentPurchase` | [src/features/torneos/api/tournamentWorkspaceService.js:116](../../../src/features/torneos/api/tournamentWorkspaceService.js#L116) |
| `get_tournament_season_media_usage` | `loadTournamentSeasonMediaUsage` | [src/features/torneos/api/tournamentWorkspaceService.js:132](../../../src/features/torneos/api/tournamentWorkspaceService.js#L132) |
| `get_tournament_social_snapshot` | `loadTournamentSocialSnapshot` | [src/features/torneos/api/tournamentWorkspaceService.js:2174](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2174) |
| `get_tournament_social_studio_context` | `loadTournamentSocialStudioContext` | [src/features/torneos/api/tournamentWorkspaceService.js:2160](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2160) |
| `get_tournament_team_photo_state` | `loadTeamPhotoState` | [src/features/torneos/api/tournamentTeamPhotoService.js:153](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L153) |
| `get_tournament_team_visual_policy` | `loadTournamentTeamVisualPolicy` | [src/features/torneos/api/tournamentWorkspaceService.js:195](../../../src/features/torneos/api/tournamentWorkspaceService.js#L195) |
| `handle_tournament_content_report` | `handleTournamentContentReport` | [src/features/torneos/api/tournamentWorkspaceService.js:1737](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1737) |
| `handle_tournament_media_report` | `handleTournamentMediaReport` | [src/features/torneos/api/tournamentWorkspaceService.js:2226](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2226) |
| `list_my_core_teams_for_application` | `listMyCoreTeamsForApplication` | [src/features/torneos/api/tournamentWorkspaceService.js:1680](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1680) |
| `list_tournament_player_portrait_refs` | `loadRosterPortraits` | [src/features/torneos/api/tournamentPlayerPortraitService.js:135](../../../src/features/torneos/api/tournamentPlayerPortraitService.js#L135) |
| `lock_tournament_roster` | `lockTournamentRoster` | [src/features/torneos/api/tournamentWorkspaceService.js:730](../../../src/features/torneos/api/tournamentWorkspaceService.js#L730) |
| `mark_my_torneos_notifications_read` | `markTorneosNotificationsRead` | [src/features/torneos/api/tournamentWorkspaceService.js:1582](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1582) |
| `mark_tournament_suspension_served` | `markTournamentSuspensionServed` | [src/features/torneos/api/tournamentWorkspaceService.js:1340](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1340) |
| `postpone_tournament_match` | `changeTournamentMatchPlan` | [src/features/torneos/api/tournamentWorkspaceService.js:1045](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1045) |
| `publish_tournament_media_gallery` | `publishTournamentMediaGallery` | [src/features/torneos/api/tournamentWorkspaceService.js:2093](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2093) |
| `record_manual_match_availability` | `recordManualTournamentMatchAvailability` | [src/features/torneos/api/tournamentWorkspaceService.js:1105](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1105) |
| `reorder_tournament_media_item` | `reorderTournamentMediaItem` | [src/features/torneos/api/tournamentWorkspaceService.js:2085](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2085) |
| `report_tournament_content` | `reportTournamentContent` | [src/features/torneos/api/tournamentWorkspaceService.js:1725](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1725) |
| `report_tournament_media_asset` | `reportTournamentMediaAsset` | [src/features/torneos/api/tournamentWorkspaceService.js:2133](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2133) |
| `request_tournament_media_upload_session` | `requestTournamentMediaUploadSession` | [src/features/torneos/api/tournamentWorkspaceService.js:2046](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2046) |
| `restore_tournament_match_unscheduled` | `changeTournamentMatchPlan` | [src/features/torneos/api/tournamentWorkspaceService.js:1045](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1045) |
| `revoke_tournament_points_adjustment` | `revokeTournamentPointsAdjustment` | [src/features/torneos/api/tournamentWorkspaceService.js:1323](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1323) |
| `revoke_tournament_team_photo` | `revokeTeamPhoto` | [src/features/torneos/api/tournamentTeamPhotoService.js:252](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L252) |
| `save_tournament_catalog_listing` | `saveTournamentCatalogListing` | [src/features/torneos/api/tournamentWorkspaceService.js:1613](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1613) |
| `save_tournament_category_capacity` | `saveTournamentCategoryCapacity` | [src/features/torneos/api/tournamentWorkspaceService.js:1647](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1647) |
| `save_tournament_match_operation_draft` | `saveTournamentMatchOperationDraft` | [src/features/torneos/api/tournamentWorkspaceService.js:1170](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1170) |
| `search_my_applicable_core_teams` | `searchApplicableCoreTeams` | [src/features/torneos/api/tournamentWorkspaceService.js:1672](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1672) |
| `search_tournament_catalog` | `<callback>` | [src/features/torneos/api/publicCatalogService.js:44](../../../src/features/torneos/api/publicCatalogService.js#L44) |
| `set_tournament_announcement_audience` | `setTournamentAnnouncementAudience` | [src/features/torneos/api/tournamentWorkspaceService.js:1840](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1840) |
| `set_tournament_applications_state` | `setTournamentApplicationsState` | [src/features/torneos/api/tournamentWorkspaceService.js:1639](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1639) |
| `set_tournament_branding_reference` | `uploadTournamentBrandingAsset`, `removeTournamentBrandingAsset` | [src/features/torneos/api/tournamentBrandingService.js:71](../../../src/features/torneos/api/tournamentBrandingService.js#L71), [src/features/torneos/api/tournamentBrandingService.js:105](../../../src/features/torneos/api/tournamentBrandingService.js#L105) |
| `set_tournament_catalog_listing_status` | `setTournamentCatalogListingStatus` | [src/features/torneos/api/tournamentWorkspaceService.js:1631](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1631) |
| `set_tournament_communications_muted` | `setTournamentCommunicationsMuted` | [src/features/torneos/api/tournamentWorkspaceService.js:1754](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1754) |
| `set_tournament_media_cover` | `setTournamentMediaCover` | [src/features/torneos/api/tournamentWorkspaceService.js:2074](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2074) |
| `set_tournament_player_portrait_crop` | `setPlayerPortraitCrop` | [src/features/torneos/api/tournamentPlayerPortraitService.js:209](../../../src/features/torneos/api/tournamentPlayerPortraitService.js#L209) |
| `set_tournament_social_permission` | `setTournamentSocialPermission` | [src/features/torneos/api/tournamentWorkspaceService.js:2206](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2206) |
| `set_tournament_team_photo_editorial_status` | `setTeamPhotoEditorialStatus` | [src/features/torneos/api/tournamentTeamPhotoService.js:235](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L235) |
| `set_tournament_team_visual_policy` | `setTournamentTeamVisualPolicy` | [src/features/torneos/api/tournamentWorkspaceService.js:206](../../../src/features/torneos/api/tournamentWorkspaceService.js#L206) |
| `start_tournament_application` | `startTournamentApplication` | [src/features/torneos/api/tournamentWorkspaceService.js:1694](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1694) |
| `transition_tournament_media_asset` | `transitionTournamentMediaAsset` | [src/features/torneos/api/tournamentWorkspaceService.js:2066](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2066) |
| `unblock_tournament_applicant` | `unblockTournamentApplicant` | [src/features/torneos/api/tournamentWorkspaceService.js:1747](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1747) |
| `update_my_torneos_profile` | `updateTorneosProfile` | [src/features/torneos/api/tournamentWorkspaceService.js:1567](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1567) |
| `update_tournament_court` | `updateTournamentCourt` | [src/features/torneos/api/tournamentWorkspaceService.js:986](../../../src/features/torneos/api/tournamentWorkspaceService.js#L986) |
| `update_tournament_media_gallery` | `updateTournamentMediaGallery` | [src/features/torneos/api/tournamentWorkspaceService.js:2030](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2030) |
| `update_tournament_venue` | `updateTournamentVenue` | [src/features/torneos/api/tournamentWorkspaceService.js:968](../../../src/features/torneos/api/tournamentWorkspaceService.js#L968) |
| `upsert_tournament_organization_sponsor` | `saveTournamentOrganizationSponsor` | [src/features/torneos/api/tournamentSponsorsService.js:76](../../../src/features/torneos/api/tournamentSponsorsService.js#L76) |
| `void_tournament_match_operation` | `voidTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1256](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1256) |

## Accesos backend nuevos de B04 (23)

Los únicos sitios fuera del inventario legacy. El transporte habla sólo con el gateway; el puente de sesión sólo lee la sesión Core.

| Tipo | Llamada | Sitio |
| --- | --- | --- |
| rpc | `supabase.rpc` | [src/features/torneos/api/publicCatalogService.js:44](../../../src/features/torneos/api/publicCatalogService.js#L44) |
| rpc | `supabase.rpc` | [src/features/torneos/api/publicCatalogService.js:48](../../../src/features/torneos/api/publicCatalogService.js#L48) |
| rpc | `supabase.rpc` | [src/features/torneos/api/publicCatalogService.js:52](../../../src/features/torneos/api/publicCatalogService.js#L52) |
| storage | `supabase.storage.from.remove` | [src/features/torneos/api/tournamentSponsorsService.js:25](../../../src/features/torneos/api/tournamentSponsorsService.js#L25) |
| from | `supabase.storage.from` | [src/features/torneos/api/tournamentSponsorsService.js:25](../../../src/features/torneos/api/tournamentSponsorsService.js#L25) |
| rpc | `supabase.rpc` | [src/features/torneos/api/tournamentSponsorsService.js:32](../../../src/features/torneos/api/tournamentSponsorsService.js#L32) |
| storage | `supabase.storage.from.upload` | [src/features/torneos/api/tournamentSponsorsService.js:66](../../../src/features/torneos/api/tournamentSponsorsService.js#L66) |
| from | `supabase.storage.from` | [src/features/torneos/api/tournamentSponsorsService.js:66](../../../src/features/torneos/api/tournamentSponsorsService.js#L66) |
| rpc | `supabase.rpc` | [src/features/torneos/api/tournamentSponsorsService.js:76](../../../src/features/torneos/api/tournamentSponsorsService.js#L76) |
| rpc | `supabase.rpc` | [src/features/torneos/api/tournamentSponsorsService.js:94](../../../src/features/torneos/api/tournamentSponsorsService.js#L94) |
| rpc | `supabase.rpc` | [src/features/torneos/api/tournamentSponsorsService.js:109](../../../src/features/torneos/api/tournamentSponsorsService.js#L109) |
| persistence | `window.localStorage.getItem` | [src/features/torneos/components/TorneosLanding.jsx:50](../../../src/features/torneos/components/TorneosLanding.jsx#L50) |
| persistence | `window.localStorage.setItem` | [src/features/torneos/components/TorneosLanding.jsx:53](../../../src/features/torneos/components/TorneosLanding.jsx#L53) |
| rpc | `transport.rpc` | [src/features/torneos/foundation/torneosClient.js:61](../../../src/features/torneos/foundation/torneosClient.js#L61) |
| transport | `fetchImpl` | [src/features/torneos/foundation/torneosTransport.js:77](../../../src/features/torneos/foundation/torneosTransport.js#L77) |
| transport | `XMLHttpRequest` | [src/features/torneos/foundation/torneosTransport.js:80](../../../src/features/torneos/foundation/torneosTransport.js#L80) |
| transport | `window.fetch` | [src/features/torneos/foundation/torneosTransport.js:171](../../../src/features/torneos/foundation/torneosTransport.js#L171) |
| transport | `fetchImpl` | [src/features/torneos/foundation/torneosTransport.js:224](../../../src/features/torneos/foundation/torneosTransport.js#L224) |
| transport | `fetchImpl` | [src/features/torneos/foundation/torneosTransport.js:321](../../../src/features/torneos/foundation/torneosTransport.js#L321) |
| transport | `window.fetch` | [src/features/torneos/foundation/torneosTransport.js:450](../../../src/features/torneos/foundation/torneosTransport.js#L450) |
| transport | `fetchImpl` | [src/features/torneos/foundation/torneosTransport.js:466](../../../src/features/torneos/foundation/torneosTransport.js#L466) |
| auth | `client.auth.getSession` | [src/features/torneos/stagingV1/coreSessionBridge.js:21](../../../src/features/torneos/stagingV1/coreSessionBridge.js#L21) |
| auth | `client.auth.onAuthStateChange` | [src/features/torneos/stagingV1/coreSessionBridge.js:32](../../../src/features/torneos/stagingV1/coreSessionBridge.js#L32) |

## Tablas, Storage, Auth, red y persistencia legacy

Ninguna de estas superficies se habilita en la composición híbrida. `from` puede ser tabla o bucket: se muestra el receptor para distinguirlo.

| Tipo | Llamada | Destino literal | Sitio |
| --- | --- | --- | --- |
| storage | `supabase.storage.from.remove` | No literal / sin argumento | [src/features/torneos/api/tournamentBrandingService.js:27](../../../src/features/torneos/api/tournamentBrandingService.js#L27) |
| from | `supabase.storage.from` | No literal / sin argumento | [src/features/torneos/api/tournamentBrandingService.js:27](../../../src/features/torneos/api/tournamentBrandingService.js#L27) |
| storage | `supabase.storage.from.upload` | No literal / sin argumento | [src/features/torneos/api/tournamentBrandingService.js:62](../../../src/features/torneos/api/tournamentBrandingService.js#L62) |
| from | `supabase.storage.from` | No literal / sin argumento | [src/features/torneos/api/tournamentBrandingService.js:62](../../../src/features/torneos/api/tournamentBrandingService.js#L62) |
| auth | `supabase.auth.getSession` | No literal / sin argumento | [src/features/torneos/api/tournamentMediaUploadClient.js:56](../../../src/features/torneos/api/tournamentMediaUploadClient.js#L56) |
| transport | `fetch` | No literal / sin argumento | [src/features/torneos/api/tournamentMediaUploadClient.js:77](../../../src/features/torneos/api/tournamentMediaUploadClient.js#L77) |
| transport | `XMLHttpRequest` | No literal / sin argumento | [src/features/torneos/api/tournamentMediaUploadClient.js:111](../../../src/features/torneos/api/tournamentMediaUploadClient.js#L111) |
| auth | `supabase.auth.getSession` | No literal / sin argumento | [src/features/torneos/api/tournamentPlayerPortraitService.js:87](../../../src/features/torneos/api/tournamentPlayerPortraitService.js#L87) |
| transport | `fetch` | No literal / sin argumento | [src/features/torneos/api/tournamentPlayerPortraitService.js:107](../../../src/features/torneos/api/tournamentPlayerPortraitService.js#L107) |
| auth | `supabase.auth.getSession` | No literal / sin argumento | [src/features/torneos/api/tournamentTeamPhotoService.js:90](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L90) |
| transport | `fetch` | No literal / sin argumento | [src/features/torneos/api/tournamentTeamPhotoService.js:110](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L110) |
| function | `supabase.functions.invoke` | `tournament-checkout` | [src/features/torneos/api/tournamentWorkspaceService.js:86](../../../src/features/torneos/api/tournamentWorkspaceService.js#L86) |
| function | `supabase.functions.invoke` | `tournament-fake-payment` | [src/features/torneos/api/tournamentWorkspaceService.js:166](../../../src/features/torneos/api/tournamentWorkspaceService.js#L166) |
| from | `supabase.from` | `tournament_organization_members` | [src/features/torneos/api/tournamentWorkspaceService.js:305](../../../src/features/torneos/api/tournamentWorkspaceService.js#L305) |
| from | `supabase.from` | `tournament_venues` | [src/features/torneos/api/tournamentWorkspaceService.js:914](../../../src/features/torneos/api/tournamentWorkspaceService.js#L914) |
| from | `supabase.from` | `tournament_courts` | [src/features/torneos/api/tournamentWorkspaceService.js:920](../../../src/features/torneos/api/tournamentWorkspaceService.js#L920) |
| persistence | `window.localStorage.getItem` | No literal / sin argumento | [src/features/torneos/components/MobileAppCallout.jsx:21](../../../src/features/torneos/components/MobileAppCallout.jsx#L21) |
| persistence | `window.localStorage.setItem` | No literal / sin argumento | [src/features/torneos/components/MobileAppCallout.jsx:26](../../../src/features/torneos/components/MobileAppCallout.jsx#L26) |
| persistence | `window.localStorage.getItem` | No literal / sin argumento | [src/features/torneos/context/TorneosWorkspaceContext.jsx:32](../../../src/features/torneos/context/TorneosWorkspaceContext.jsx#L32) |
| persistence | `window.localStorage.setItem` | No literal / sin argumento | [src/features/torneos/context/TorneosWorkspaceContext.jsx:33](../../../src/features/torneos/context/TorneosWorkspaceContext.jsx#L33) |
| storage | `client.storage.from.getPublicUrl` | No literal / sin argumento | [src/features/torneos/domain/brandingAssets.js:30](../../../src/features/torneos/domain/brandingAssets.js#L30) |
| from | `client.storage.from` | No literal / sin argumento | [src/features/torneos/domain/brandingAssets.js:30](../../../src/features/torneos/domain/brandingAssets.js#L30) |
| persistence | `window.sessionStorage.setItem` | No literal / sin argumento | [src/features/torneos/domain/premiumIntent.js:13](../../../src/features/torneos/domain/premiumIntent.js#L13) |
| persistence | `window.sessionStorage.getItem` | No literal / sin argumento | [src/features/torneos/domain/premiumIntent.js:23](../../../src/features/torneos/domain/premiumIntent.js#L23) |
| persistence | `window.sessionStorage.removeItem` | No literal / sin argumento | [src/features/torneos/domain/premiumIntent.js:31](../../../src/features/torneos/domain/premiumIntent.js#L31) |
| from | `clientRef.current.supabaseTorneos.from` | `sso_probe` | [src/features/torneos/isolated/IsolatedTorneosPage.jsx:26](../../../src/features/torneos/isolated/IsolatedTorneosPage.jsx#L26) |
| auth | `supabaseCore.auth.onAuthStateChange` | No literal / sin argumento | [src/features/torneos/isolated/createTorneosClient.js:13](../../../src/features/torneos/isolated/createTorneosClient.js#L13) |
| auth | `supabaseCore.auth.getSession` | No literal / sin argumento | [src/features/torneos/isolated/createTorneosClient.js:19](../../../src/features/torneos/isolated/createTorneosClient.js#L19) |
| transport | `fetchImpl` | No literal / sin argumento | [src/features/torneos/isolated/createTorneosClient.js:31](../../../src/features/torneos/isolated/createTorneosClient.js#L31) |
| transport | `fetchImpl` | No literal / sin argumento | [src/features/torneos/isolated/createTorneosClient.js:50](../../../src/features/torneos/isolated/createTorneosClient.js#L50) |
| transport | `createClient` | No literal / sin argumento | [src/features/torneos/isolated/createTorneosClient.js:58](../../../src/features/torneos/isolated/createTorneosClient.js#L58) |
| transport | `fetch` | No literal / sin argumento | [src/features/torneos/social/socialStudio.js:69](../../../src/features/torneos/social/socialStudio.js#L69) |

## Imports directos del singleton Core (38)

| Archivo | Import |
| --- | --- |
| [src/api/supabaseWrapper.js:1](../../../src/api/supabaseWrapper.js#L1) | `../lib/supabaseClient` |
| [src/components/jugar/AvailabilityOpportunityCard.jsx:27](../../../src/components/jugar/AvailabilityOpportunityCard.jsx#L27) | `../../lib/supabaseClient` |
| [src/features/onboarding/storage.js:6](../../../src/features/onboarding/storage.js#L6) | `../../lib/supabaseClient` |
| [src/features/torneos/isolated/IsolatedTorneosPage.jsx:4](../../../src/features/torneos/isolated/IsolatedTorneosPage.jsx#L4) | `../../../lib/supabaseClient` |
| [src/hooks/useSurveyFinalizationRecovery.js:2](../../../src/hooks/useSurveyFinalizationRecovery.js#L2) | `../lib/supabaseClient` |
| [src/lib/coreSupabaseClient.js:3](../../../src/lib/coreSupabaseClient.js#L3) | `./supabaseClient` |
| [src/services/api/supabase.js:10](../../../src/services/api/supabase.js#L10) | `../../lib/supabaseClient` |
| [src/services/autoMatchPushService.js:2](../../../src/services/autoMatchPushService.js#L2) | `../lib/supabaseClient` |
| [src/services/clientBuildReport.js:4](../../../src/services/clientBuildReport.js#L4) | `../lib/supabaseClient` |
| [src/services/db/availability.js:1](../../../src/services/db/availability.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/awards.js:2](../../../src/services/db/awards.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/dbErrors.js:1](../../../src/services/db/dbErrors.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/frequentMatches.js:2](../../../src/services/db/frequentMatches.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/friends.js:2](../../../src/services/db/friends.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/importedMatchPlayers.js:1](../../../src/services/db/importedMatchPlayers.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/matchAccessCode.js:1](../../../src/services/db/matchAccessCode.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/matchScheduling.js:1](../../../src/services/db/matchScheduling.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/matches.js:2](../../../src/services/db/matches.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/notifications.js:2](../../../src/services/db/notifications.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/openMatches.js:1](../../../src/services/db/openMatches.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/payments.js:2](../../../src/services/db/payments.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/penalties.js:2](../../../src/services/db/penalties.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/privateFriendGroups.js:1](../../../src/services/db/privateFriendGroups.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/profiles.js:1](../../../src/services/db/profiles.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/publicProfiles.js:1](../../../src/services/db/publicProfiles.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/realtime.js:2](../../../src/services/db/realtime.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/surveys.js:2](../../../src/services/db/surveys.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/teamChallenges.js:2](../../../src/services/db/teamChallenges.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/teamRankings.js:1](../../../src/services/db/teamRankings.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/teams.js:2](../../../src/services/db/teams.js#L2) | `../../lib/supabaseClient` |
| [src/services/db/templateMatchLink.js:1](../../../src/services/db/templateMatchLink.js#L1) | `../../lib/supabaseClient` |
| [src/services/db/userIdentity.js:1](../../../src/services/db/userIdentity.js#L1) | `../../lib/supabaseClient` |
| [src/services/pushDispatchService.js:2](../../../src/services/pushDispatchService.js#L2) | `../lib/supabaseClient` |
| [src/services/storage/teamCrests.js:1](../../../src/services/storage/teamCrests.js#L1) | `../../lib/supabaseClient` |
| [src/services/votingPhotoUpload.js:1](../../../src/services/votingPhotoUpload.js#L1) | `../lib/supabaseClient` |
| [src/supabase.js:2](../../../src/supabase.js#L2) | `./lib/supabaseClient` |
| [src/supabase.js:16](../../../src/supabase.js#L16) | `./lib/supabaseClient` |
| [src/utils/checkView.js:2](../../../src/utils/checkView.js#L2) | `../lib/supabaseClient` |

## Dependencias Core transitivas dentro de Torneos (191 aristas)

Cada fila es un import que alcanza el singleton por el grafo estático, no una consulta de datos ni una llamada en tiempo de ejecución. La única arista nueva de B04 es `stagingV1/coreSessionBridge.js → lib/coreSupabaseClient.js` (lectura de sesión y eventos de auth; nunca `rpc`/`from`/`storage`).

| Archivo | Import que alcanza Core |
| --- | --- |
| [src/features/torneos/TorneosApp.jsx:2](../../../src/features/torneos/TorneosApp.jsx#L2) | `./context/TorneosWorkspaceContext` |
| [src/features/torneos/TorneosApp.jsx:3](../../../src/features/torneos/TorneosApp.jsx#L3) | `./components/TorneosShell` |
| [src/features/torneos/TorneosApp.jsx:4](../../../src/features/torneos/TorneosApp.jsx#L4) | `./api/localReviewWorkspaceService` |
| [src/features/torneos/TorneosFeatureGate.jsx:16](../../../src/features/torneos/TorneosFeatureGate.jsx#L16) | `./TorneosApp` |
| [src/features/torneos/TorneosFeatureGate.jsx:17](../../../src/features/torneos/TorneosFeatureGate.jsx#L17) | `./stagingV1/StagingV1TorneosApp` |
| [src/features/torneos/api/legacyCommerceAdapter.js:1](../../../src/features/torneos/api/legacyCommerceAdapter.js#L1) | `./tournamentWorkspaceService` |
| [src/features/torneos/api/localReviewWorkspaceService.js:1](../../../src/features/torneos/api/localReviewWorkspaceService.js#L1) | `./tournamentWorkspaceService` |
| [src/features/torneos/api/publicCatalogService.js:1](../../../src/features/torneos/api/publicCatalogService.js#L1) | `../../../services/api/supabase` |
| [src/features/torneos/api/publicTournamentService.js:1](../../../src/features/torneos/api/publicTournamentService.js#L1) | `../../../services/api/supabase` |
| [src/features/torneos/api/publicTournamentService.js:2](../../../src/features/torneos/api/publicTournamentService.js#L2) | `../domain/brandingAssets` |
| [src/features/torneos/api/tournamentBrandingService.js:1](../../../src/features/torneos/api/tournamentBrandingService.js#L1) | `../../../services/api/supabase` |
| [src/features/torneos/api/tournamentBrandingService.js:2](../../../src/features/torneos/api/tournamentBrandingService.js#L2) | `../domain/brandingAssets` |
| [src/features/torneos/api/tournamentMediaUploadClient.js:19](../../../src/features/torneos/api/tournamentMediaUploadClient.js#L19) | `../../../services/api/supabase` |
| [src/features/torneos/api/tournamentPlayerPortraitService.js:10](../../../src/features/torneos/api/tournamentPlayerPortraitService.js#L10) | `../../../services/api/supabase` |
| [src/features/torneos/api/tournamentSponsorsService.js:7](../../../src/features/torneos/api/tournamentSponsorsService.js#L7) | `../../../services/api/supabase` |
| [src/features/torneos/api/tournamentSponsorsService.js:8](../../../src/features/torneos/api/tournamentSponsorsService.js#L8) | `../domain/brandingAssets` |
| [src/features/torneos/api/tournamentTeamPhotoService.js:13](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L13) | `../../../services/api/supabase` |
| [src/features/torneos/api/tournamentWorkspaceService.js:7](../../../src/features/torneos/api/tournamentWorkspaceService.js#L7) | `../../../services/api/supabase` |
| [src/features/torneos/api/tournamentWorkspaceService.js:9](../../../src/features/torneos/api/tournamentWorkspaceService.js#L9) | `../domain/brandingAssets` |
| [src/features/torneos/api/tournamentWorkspaceService.js:10](../../../src/features/torneos/api/tournamentWorkspaceService.js#L10) | `./tournamentBrandingService` |
| [src/features/torneos/api/tournamentWorkspaceService.js:11](../../../src/features/torneos/api/tournamentWorkspaceService.js#L11) | `./tournamentSponsorsService` |
| [src/features/torneos/api/tournamentWorkspaceService.js:20](../../../src/features/torneos/api/tournamentWorkspaceService.js#L20) | `./tournamentMediaUploadClient` |
| [src/features/torneos/components/BrandingAssetField.jsx:3](../../../src/features/torneos/components/BrandingAssetField.jsx#L3) | `../api/tournamentBrandingService` |
| [src/features/torneos/components/BrandingAssetField.jsx:7](../../../src/features/torneos/components/BrandingAssetField.jsx#L7) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/BrandingAssetField.jsx:9](../../../src/features/torneos/components/BrandingAssetField.jsx#L9) | `./BrandingImage` |
| [src/features/torneos/components/BrandingImage.jsx:2](../../../src/features/torneos/components/BrandingImage.jsx#L2) | `../domain/brandingAssets` |
| [src/features/torneos/components/CaptainMatchSquadPage.jsx:4](../../../src/features/torneos/components/CaptainMatchSquadPage.jsx#L4) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/CaptainMatchSquadPage.jsx:6](../../../src/features/torneos/components/CaptainMatchSquadPage.jsx#L6) | `./MatchOperationsPage` |
| [src/features/torneos/components/CommunicationsAdminPage.jsx:24](../../../src/features/torneos/components/CommunicationsAdminPage.jsx#L24) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/CompetitionCenterPage.jsx:25](../../../src/features/torneos/components/CompetitionCenterPage.jsx#L25) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/CompetitionCenterPage.jsx:33](../../../src/features/torneos/components/CompetitionCenterPage.jsx#L33) | `./BrandingImage` |
| [src/features/torneos/components/CompetitionOverviewPage.jsx:27](../../../src/features/torneos/components/CompetitionOverviewPage.jsx#L27) | `./BrandingImage` |
| [src/features/torneos/components/CreateOrganizationPage.jsx:8](../../../src/features/torneos/components/CreateOrganizationPage.jsx#L8) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/FixtureWorkspacePage.jsx:45](../../../src/features/torneos/components/FixtureWorkspacePage.jsx#L45) | `./BrandingImage` |
| [src/features/torneos/components/MatchOperationsPage.jsx:44](../../../src/features/torneos/components/MatchOperationsPage.jsx#L44) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/MediaAdminPage.jsx:36](../../../src/features/torneos/components/MediaAdminPage.jsx#L36) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/MyCommunicationsPage.jsx:15](../../../src/features/torneos/components/MyCommunicationsPage.jsx#L15) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/MyTournamentMatchesPage.jsx:20](../../../src/features/torneos/components/MyTournamentMatchesPage.jsx#L20) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/MyTournamentsPage.jsx:16](../../../src/features/torneos/components/MyTournamentsPage.jsx#L16) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/MyTournamentsPage.jsx:20](../../../src/features/torneos/components/MyTournamentsPage.jsx#L20) | `./connected/MyRegistrationsSection` |
| [src/features/torneos/components/NewTeamEntryPage.jsx:14](../../../src/features/torneos/components/NewTeamEntryPage.jsx#L14) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/OrganizationInvitationPage.jsx:4](../../../src/features/torneos/components/OrganizationInvitationPage.jsx#L4) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/OrganizationMembersPage.jsx:24](../../../src/features/torneos/components/OrganizationMembersPage.jsx#L24) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/OrganizationRouteGuard.jsx:6](../../../src/features/torneos/components/OrganizationRouteGuard.jsx#L6) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/OrganizationSettingsPage.jsx:12](../../../src/features/torneos/components/OrganizationSettingsPage.jsx#L12) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/OrganizationSettingsPage.jsx:15](../../../src/features/torneos/components/OrganizationSettingsPage.jsx#L15) | `./BrandingAssetField` |
| [src/features/torneos/components/OrganizationSponsorsPage.jsx:15](../../../src/features/torneos/components/OrganizationSponsorsPage.jsx#L15) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/OrganizationVenuesPage.jsx:4](../../../src/features/torneos/components/OrganizationVenuesPage.jsx#L4) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/PersonalWorkspaceSwitcher.jsx:12](../../../src/features/torneos/components/PersonalWorkspaceSwitcher.jsx#L12) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/PlanExperiencePage.jsx:8](../../../src/features/torneos/components/PlanExperiencePage.jsx#L8) | `../context/TorneosCommerceContext` |
| [src/features/torneos/components/PlanExperiencePage.jsx:13](../../../src/features/torneos/components/PlanExperiencePage.jsx#L13) | `./PremiumPurchasePanel` |
| [src/features/torneos/components/PlayerPortraitActions.jsx:4](../../../src/features/torneos/components/PlayerPortraitActions.jsx#L4) | `../api/tournamentPlayerPortraitService` |
| [src/features/torneos/components/PlayerPortraitActions.jsx:9](../../../src/features/torneos/components/PlayerPortraitActions.jsx#L9) | `./usePlayerPortraitUrl` |
| [src/features/torneos/components/PlayerPortraitActions.jsx:10](../../../src/features/torneos/components/PlayerPortraitActions.jsx#L10) | `./PlayerPortraitDialog` |
| [src/features/torneos/components/PlayerPortraitDialog.jsx:10](../../../src/features/torneos/components/PlayerPortraitDialog.jsx#L10) | `./usePlayerPortraitUrl` |
| [src/features/torneos/components/PremiumPurchasePanel.jsx:5](../../../src/features/torneos/components/PremiumPurchasePanel.jsx#L5) | `../context/TorneosCommerceContext` |
| [src/features/torneos/components/PublicTournamentPage.jsx:14](../../../src/features/torneos/components/PublicTournamentPage.jsx#L14) | `../api/publicTournamentService` |
| [src/features/torneos/components/PublicTournamentPage.jsx:22](../../../src/features/torneos/components/PublicTournamentPage.jsx#L22) | `./BrandingImage` |
| [src/features/torneos/components/PublicTournamentRoute.jsx:2](../../../src/features/torneos/components/PublicTournamentRoute.jsx#L2) | `./PublicTournamentPage` |
| [src/features/torneos/components/PublicTournamentRoute.jsx:3](../../../src/features/torneos/components/PublicTournamentRoute.jsx#L3) | `../api/publicTournamentService` |
| [src/features/torneos/components/PublicTournamentRoute.jsx:5](../../../src/features/torneos/components/PublicTournamentRoute.jsx#L5) | `../stagingV1/publicTournamentComposition` |
| [src/features/torneos/components/PublicTournamentRoute.jsx:6](../../../src/features/torneos/components/PublicTournamentRoute.jsx#L6) | `../api/publicCatalogService` |
| [src/features/torneos/components/PublicTournamentRoute.jsx:7](../../../src/features/torneos/components/PublicTournamentRoute.jsx#L7) | `../stagingV1/contentReportService` |
| [src/features/torneos/components/PurchaseStatusPage.jsx:11](../../../src/features/torneos/components/PurchaseStatusPage.jsx#L11) | `../context/TorneosCommerceContext` |
| [src/features/torneos/components/RosterPlayerPortrait.jsx:7](../../../src/features/torneos/components/RosterPlayerPortrait.jsx#L7) | `./usePlayerPortraitUrl` |
| [src/features/torneos/components/SocialStudioPage.jsx:30](../../../src/features/torneos/components/SocialStudioPage.jsx#L30) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/TeamInvitationPage.jsx:4](../../../src/features/torneos/components/TeamInvitationPage.jsx#L4) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/TeamPhotoPanel.jsx:11](../../../src/features/torneos/components/TeamPhotoPanel.jsx#L11) | `../api/tournamentTeamPhotoService` |
| [src/features/torneos/components/TeamPhotoPanel.jsx:17](../../../src/features/torneos/components/TeamPhotoPanel.jsx#L17) | `./useTeamPhotoUrl` |
| [src/features/torneos/components/TeamPhotoPanel.jsx:18](../../../src/features/torneos/components/TeamPhotoPanel.jsx#L18) | `./BrandingImage` |
| [src/features/torneos/components/TeamRegistrationPage.jsx:20](../../../src/features/torneos/components/TeamRegistrationPage.jsx#L20) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/TeamRegistrationPage.jsx:33](../../../src/features/torneos/components/TeamRegistrationPage.jsx#L33) | `./BrandingAssetField` |
| [src/features/torneos/components/TeamRegistrationPage.jsx:34](../../../src/features/torneos/components/TeamRegistrationPage.jsx#L34) | `./BrandingImage` |
| [src/features/torneos/components/TeamRegistrationPage.jsx:35](../../../src/features/torneos/components/TeamRegistrationPage.jsx#L35) | `./PlayerPortraitActions` |
| [src/features/torneos/components/TeamRegistrationPage.jsx:36](../../../src/features/torneos/components/TeamRegistrationPage.jsx#L36) | `./RosterPlayerPortrait` |
| [src/features/torneos/components/TeamRegistrationPage.jsx:37](../../../src/features/torneos/components/TeamRegistrationPage.jsx#L37) | `./TeamPhotoPanel` |
| [src/features/torneos/components/TeamRegistrationPage.jsx:38](../../../src/features/torneos/components/TeamRegistrationPage.jsx#L38) | `../api/tournamentPlayerPortraitService` |
| [src/features/torneos/components/TeamRegistrationPage.jsx:39](../../../src/features/torneos/components/TeamRegistrationPage.jsx#L39) | `../api/tournamentTeamPhotoService` |
| [src/features/torneos/components/TeamVisualPolicySettings.jsx:3](../../../src/features/torneos/components/TeamVisualPolicySettings.jsx#L3) | `../api/tournamentWorkspaceService` |
| [src/features/torneos/components/TeamsPage.jsx:22](../../../src/features/torneos/components/TeamsPage.jsx#L22) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/TeamsPage.jsx:33](../../../src/features/torneos/components/TeamsPage.jsx#L33) | `./BrandingImage` |
| [src/features/torneos/components/TeamsPage.jsx:34](../../../src/features/torneos/components/TeamsPage.jsx#L34) | `./connected/CatalogEntryStrip` |
| [src/features/torneos/components/TorneosDashboard.jsx:24](../../../src/features/torneos/components/TorneosDashboard.jsx#L24) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/TorneosDashboard.jsx:41](../../../src/features/torneos/components/TorneosDashboard.jsx#L41) | `./BrandingImage` |
| [src/features/torneos/components/TorneosLanding.jsx:27](../../../src/features/torneos/components/TorneosLanding.jsx#L27) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/TorneosLanding.jsx:34](../../../src/features/torneos/components/TorneosLanding.jsx#L34) | `./connected/MyRegistrationsSection` |
| [src/features/torneos/components/TorneosLanding.jsx:35](../../../src/features/torneos/components/TorneosLanding.jsx#L35) | `./connected/useTorneosProfile` |
| [src/features/torneos/components/TorneosShell.jsx:28](../../../src/features/torneos/components/TorneosShell.jsx#L28) | `../../../components/global-header/GlobalHeader` |
| [src/features/torneos/components/TorneosShell.jsx:37](../../../src/features/torneos/components/TorneosShell.jsx#L37) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/TorneosShell.jsx:40](../../../src/features/torneos/components/TorneosShell.jsx#L40) | `./CreateOrganizationPage` |
| [src/features/torneos/components/TorneosShell.jsx:41](../../../src/features/torneos/components/TorneosShell.jsx#L41) | `./CompetitionOverviewPage` |
| [src/features/torneos/components/TorneosShell.jsx:42](../../../src/features/torneos/components/TorneosShell.jsx#L42) | `./OrganizationMembersPage` |
| [src/features/torneos/components/TorneosShell.jsx:43](../../../src/features/torneos/components/TorneosShell.jsx#L43) | `./moderation/OrganizationModerationPage` |
| [src/features/torneos/components/TorneosShell.jsx:45](../../../src/features/torneos/components/TorneosShell.jsx#L45) | `./OrganizationRouteGuard` |
| [src/features/torneos/components/TorneosShell.jsx:46](../../../src/features/torneos/components/TorneosShell.jsx#L46) | `./OrganizationVenuesPage` |
| [src/features/torneos/components/TorneosShell.jsx:48](../../../src/features/torneos/components/TorneosShell.jsx#L48) | `./OrganizationSettingsPage` |
| [src/features/torneos/components/TorneosShell.jsx:49](../../../src/features/torneos/components/TorneosShell.jsx#L49) | `./OrganizationSponsorsPage` |
| [src/features/torneos/components/TorneosShell.jsx:50](../../../src/features/torneos/components/TorneosShell.jsx#L50) | `./PlanExperiencePage` |
| [src/features/torneos/components/TorneosShell.jsx:51](../../../src/features/torneos/components/TorneosShell.jsx#L51) | `./PurchaseStatusPage` |
| [src/features/torneos/components/TorneosShell.jsx:53](../../../src/features/torneos/components/TorneosShell.jsx#L53) | `./TorneosDashboard` |
| [src/features/torneos/components/TorneosShell.jsx:54](../../../src/features/torneos/components/TorneosShell.jsx#L54) | `./TorneosLanding` |
| [src/features/torneos/components/TorneosShell.jsx:56](../../../src/features/torneos/components/TorneosShell.jsx#L56) | `./TournamentWizardPage` |
| [src/features/torneos/components/TorneosShell.jsx:57](../../../src/features/torneos/components/TorneosShell.jsx#L57) | `./TeamsPage` |
| [src/features/torneos/components/TorneosShell.jsx:58](../../../src/features/torneos/components/TorneosShell.jsx#L58) | `./NewTeamEntryPage` |
| [src/features/torneos/components/TorneosShell.jsx:59](../../../src/features/torneos/components/TorneosShell.jsx#L59) | `./TeamRegistrationPage` |
| [src/features/torneos/components/TorneosShell.jsx:60](../../../src/features/torneos/components/TorneosShell.jsx#L60) | `./TeamInvitationPage` |
| [src/features/torneos/components/TorneosShell.jsx:61](../../../src/features/torneos/components/TorneosShell.jsx#L61) | `./OrganizationInvitationPage` |
| [src/features/torneos/components/TorneosShell.jsx:62](../../../src/features/torneos/components/TorneosShell.jsx#L62) | `./WorkspaceSwitcher` |
| [src/features/torneos/components/TorneosShell.jsx:63](../../../src/features/torneos/components/TorneosShell.jsx#L63) | `./FixtureWorkspacePage` |
| [src/features/torneos/components/TorneosShell.jsx:64](../../../src/features/torneos/components/TorneosShell.jsx#L64) | `./MatchOperationsPage` |
| [src/features/torneos/components/TorneosShell.jsx:65](../../../src/features/torneos/components/TorneosShell.jsx#L65) | `./MyTournamentMatchesPage` |
| [src/features/torneos/components/TorneosShell.jsx:66](../../../src/features/torneos/components/TorneosShell.jsx#L66) | `./CaptainMatchSquadPage` |
| [src/features/torneos/components/TorneosShell.jsx:67](../../../src/features/torneos/components/TorneosShell.jsx#L67) | `./CompetitionCenterPage` |
| [src/features/torneos/components/TorneosShell.jsx:68](../../../src/features/torneos/components/TorneosShell.jsx#L68) | `./MyTournamentsPage` |
| [src/features/torneos/components/TorneosShell.jsx:69](../../../src/features/torneos/components/TorneosShell.jsx#L69) | `./TournamentHubPage` |
| [src/features/torneos/components/TorneosShell.jsx:70](../../../src/features/torneos/components/TorneosShell.jsx#L70) | `./CommunicationsAdminPage` |
| [src/features/torneos/components/TorneosShell.jsx:71](../../../src/features/torneos/components/TorneosShell.jsx#L71) | `./MediaAdminPage` |
| [src/features/torneos/components/TorneosShell.jsx:72](../../../src/features/torneos/components/TorneosShell.jsx#L72) | `./SocialStudioPage` |
| [src/features/torneos/components/TorneosShell.jsx:73](../../../src/features/torneos/components/TorneosShell.jsx#L73) | `./connected/TorneosAccountMenu` |
| [src/features/torneos/components/TorneosShell.jsx:74](../../../src/features/torneos/components/TorneosShell.jsx#L74) | `./connected/TorneosInboxBell` |
| [src/features/torneos/components/TorneosShell.jsx:75](../../../src/features/torneos/components/TorneosShell.jsx#L75) | `./connected/useTorneosInboxSummary` |
| [src/features/torneos/components/TorneosShell.jsx:76](../../../src/features/torneos/components/TorneosShell.jsx#L76) | `./connected/PersonalNavigation` |
| [src/features/torneos/components/TorneosShell.jsx:77](../../../src/features/torneos/components/TorneosShell.jsx#L77) | `./connected/ExplorePage` |
| [src/features/torneos/components/TorneosShell.jsx:78](../../../src/features/torneos/components/TorneosShell.jsx#L78) | `./connected/CatalogCallPage` |
| [src/features/torneos/components/TorneosShell.jsx:79](../../../src/features/torneos/components/TorneosShell.jsx#L79) | `./connected/TournamentApplicationPage` |
| [src/features/torneos/components/TorneosShell.jsx:80](../../../src/features/torneos/components/TorneosShell.jsx#L80) | `./connected/TorneosInboxPage` |
| [src/features/torneos/components/TorneosShell.jsx:81](../../../src/features/torneos/components/TorneosShell.jsx#L81) | `./connected/TorneosProfilePage` |
| [src/features/torneos/components/TorneosShell.jsx:82](../../../src/features/torneos/components/TorneosShell.jsx#L82) | `./connected/ParticipantTeamRoute` |
| [src/features/torneos/components/TorneosShell.jsx:83](../../../src/features/torneos/components/TorneosShell.jsx#L83) | `./connected/CatalogListingPage` |
| [src/features/torneos/components/TorneosShell.jsx:84](../../../src/features/torneos/components/TorneosShell.jsx#L84) | `./connected/ApplicationInboxPage` |
| [src/features/torneos/components/TournamentHubPage.jsx:36](../../../src/features/torneos/components/TournamentHubPage.jsx#L36) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/TournamentHubPage.jsx:42](../../../src/features/torneos/components/TournamentHubPage.jsx#L42) | `./BrandingImage` |
| [src/features/torneos/components/TournamentPublicPageSettings.jsx:11](../../../src/features/torneos/components/TournamentPublicPageSettings.jsx#L11) | `../api/tournamentWorkspaceService` |
| [src/features/torneos/components/TournamentWizardPage.jsx:35](../../../src/features/torneos/components/TournamentWizardPage.jsx#L35) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/TournamentWizardPage.jsx:61](../../../src/features/torneos/components/TournamentWizardPage.jsx#L61) | `./TournamentPublicPageSettings` |
| [src/features/torneos/components/TournamentWizardPage.jsx:63](../../../src/features/torneos/components/TournamentWizardPage.jsx#L63) | `./TeamVisualPolicySettings` |
| [src/features/torneos/components/TournamentWizardPage.jsx:64](../../../src/features/torneos/components/TournamentWizardPage.jsx#L64) | `./BrandingAssetField` |
| [src/features/torneos/components/WorkspaceSwitcher.jsx:12](../../../src/features/torneos/components/WorkspaceSwitcher.jsx#L12) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/WorkspaceSwitcher.jsx:15](../../../src/features/torneos/components/WorkspaceSwitcher.jsx#L15) | `./BrandingImage` |
| [src/features/torneos/components/connected/ApplicationInboxPage.jsx:21](../../../src/features/torneos/components/connected/ApplicationInboxPage.jsx#L21) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/connected/CatalogCallPage.jsx:11](../../../src/features/torneos/components/connected/CatalogCallPage.jsx#L11) | `../BrandingImage` |
| [src/features/torneos/components/connected/CatalogCallPage.jsx:12](../../../src/features/torneos/components/connected/CatalogCallPage.jsx#L12) | `./useCatalogService` |
| [src/features/torneos/components/connected/CatalogEntryStrip.jsx:4](../../../src/features/torneos/components/connected/CatalogEntryStrip.jsx#L4) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/connected/CatalogListingPage.jsx:19](../../../src/features/torneos/components/connected/CatalogListingPage.jsx#L19) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/connected/CatalogListingPage.jsx:22](../../../src/features/torneos/components/connected/CatalogListingPage.jsx#L22) | `../TournamentPublicPageSettings` |
| [src/features/torneos/components/connected/ExplorePage.jsx:3](../../../src/features/torneos/components/connected/ExplorePage.jsx#L3) | `./TournamentCatalog` |
| [src/features/torneos/components/connected/ExplorePage.jsx:4](../../../src/features/torneos/components/connected/ExplorePage.jsx#L4) | `./useCatalogService` |
| [src/features/torneos/components/connected/MyRegistrationsSection.jsx:4](../../../src/features/torneos/components/connected/MyRegistrationsSection.jsx#L4) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/connected/ParticipantTeamRoute.jsx:10](../../../src/features/torneos/components/connected/ParticipantTeamRoute.jsx#L10) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/connected/PersonalNavigation.jsx:11](../../../src/features/torneos/components/connected/PersonalNavigation.jsx#L11) | `./useTorneosInboxSummary` |
| [src/features/torneos/components/connected/PublicCatalogRoute.jsx:5](../../../src/features/torneos/components/connected/PublicCatalogRoute.jsx#L5) | `./TournamentCatalog` |
| [src/features/torneos/components/connected/PublicCatalogRoute.jsx:6](../../../src/features/torneos/components/connected/PublicCatalogRoute.jsx#L6) | `./useCatalogService` |
| [src/features/torneos/components/connected/TorneosAccountMenu.jsx:6](../../../src/features/torneos/components/connected/TorneosAccountMenu.jsx#L6) | `./useTorneosProfile` |
| [src/features/torneos/components/connected/TorneosInboxBell.jsx:3](../../../src/features/torneos/components/connected/TorneosInboxBell.jsx#L3) | `./useTorneosInboxSummary` |
| [src/features/torneos/components/connected/TorneosInboxPage.jsx:15](../../../src/features/torneos/components/connected/TorneosInboxPage.jsx#L15) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/connected/TorneosInboxPage.jsx:18](../../../src/features/torneos/components/connected/TorneosInboxPage.jsx#L18) | `../MyCommunicationsPage` |
| [src/features/torneos/components/connected/TorneosInboxPage.jsx:20](../../../src/features/torneos/components/connected/TorneosInboxPage.jsx#L20) | `./useTorneosInboxSummary` |
| [src/features/torneos/components/connected/TorneosProfilePage.jsx:15](../../../src/features/torneos/components/connected/TorneosProfilePage.jsx#L15) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/connected/TorneosProfilePage.jsx:18](../../../src/features/torneos/components/connected/TorneosProfilePage.jsx#L18) | `./useTorneosProfile` |
| [src/features/torneos/components/connected/TorneosProfilePage.jsx:28](../../../src/features/torneos/components/connected/TorneosProfilePage.jsx#L28) | `../../../../services/corePushPreferenceService` |
| [src/features/torneos/components/connected/TorneosProfilePage.jsx:41](../../../src/features/torneos/components/connected/TorneosProfilePage.jsx#L41) | `../../../../services/corePushPreferenceService` |
| [src/features/torneos/components/connected/TorneosProfilePage.jsx:189](../../../src/features/torneos/components/connected/TorneosProfilePage.jsx#L189) | `../../../../services/authLogoutService` |
| [src/features/torneos/components/connected/TournamentApplicationPage.jsx:20](../../../src/features/torneos/components/connected/TournamentApplicationPage.jsx#L20) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/connected/TournamentApplicationPage.jsx:29](../../../src/features/torneos/components/connected/TournamentApplicationPage.jsx#L29) | `./CatalogCallPage` |
| [src/features/torneos/components/connected/TournamentApplicationPage.jsx:30](../../../src/features/torneos/components/connected/TournamentApplicationPage.jsx#L30) | `./useCatalogService` |
| [src/features/torneos/components/connected/TournamentApplicationPage.jsx:31](../../../src/features/torneos/components/connected/TournamentApplicationPage.jsx#L31) | `./useTorneosProfile` |
| [src/features/torneos/components/connected/TournamentApplicationPage.jsx:32](../../../src/features/torneos/components/connected/TournamentApplicationPage.jsx#L32) | `../BrandingImage` |
| [src/features/torneos/components/connected/TournamentCatalog.jsx:31](../../../src/features/torneos/components/connected/TournamentCatalog.jsx#L31) | `../BrandingImage` |
| [src/features/torneos/components/connected/useCatalogService.js:3](../../../src/features/torneos/components/connected/useCatalogService.js#L3) | `../../api/publicCatalogService` |
| [src/features/torneos/components/connected/useCatalogService.js:4](../../../src/features/torneos/components/connected/useCatalogService.js#L4) | `../../stagingV1/publicTournamentComposition` |
| [src/features/torneos/components/connected/useTorneosInboxSummary.jsx:10](../../../src/features/torneos/components/connected/useTorneosInboxSummary.jsx#L10) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/connected/useTorneosProfile.js:3](../../../src/features/torneos/components/connected/useTorneosProfile.js#L3) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/moderation/OrganizationModerationPage.jsx:4](../../../src/features/torneos/components/moderation/OrganizationModerationPage.jsx#L4) | `../../context/TorneosWorkspaceContext` |
| [src/features/torneos/components/usePlayerPortraitUrl.js:11](../../../src/features/torneos/components/usePlayerPortraitUrl.js#L11) | `../api/tournamentPlayerPortraitService` |
| [src/features/torneos/components/useTeamPhotoUrl.js:8](../../../src/features/torneos/components/useTeamPhotoUrl.js#L8) | `../api/tournamentTeamPhotoService` |
| [src/features/torneos/context/TorneosCommerceContext.jsx:2](../../../src/features/torneos/context/TorneosCommerceContext.jsx#L2) | `../api/legacyCommerceAdapter` |
| [src/features/torneos/context/TorneosWorkspaceContext.jsx:10](../../../src/features/torneos/context/TorneosWorkspaceContext.jsx#L10) | `../api/tournamentWorkspaceService` |
| [src/features/torneos/domain/brandingAssets.js:1](../../../src/features/torneos/domain/brandingAssets.js#L1) | `../../../services/api/supabase` |
| [src/features/torneos/isolated/IsolatedTorneosPage.jsx:3](../../../src/features/torneos/isolated/IsolatedTorneosPage.jsx#L3) | `../../../components/AuthProvider` |
| [src/features/torneos/isolated/IsolatedTorneosPage.jsx:4](../../../src/features/torneos/isolated/IsolatedTorneosPage.jsx#L4) | `../../../lib/supabaseClient` |
| [src/features/torneos/isolated/IsolatedTorneosPage.jsx:5](../../../src/features/torneos/isolated/IsolatedTorneosPage.jsx#L5) | `../../../services/authLogoutService` |
| [src/features/torneos/stagingV1/StagingV1TorneosApp.jsx:3](../../../src/features/torneos/stagingV1/StagingV1TorneosApp.jsx#L3) | `../context/TorneosWorkspaceContext` |
| [src/features/torneos/stagingV1/StagingV1TorneosApp.jsx:5](../../../src/features/torneos/stagingV1/StagingV1TorneosApp.jsx#L5) | `../context/TorneosCommerceContext` |
| [src/features/torneos/stagingV1/StagingV1TorneosApp.jsx:6](../../../src/features/torneos/stagingV1/StagingV1TorneosApp.jsx#L6) | `../components/TorneosShell` |
| [src/features/torneos/stagingV1/StagingV1TorneosApp.jsx:8](../../../src/features/torneos/stagingV1/StagingV1TorneosApp.jsx#L8) | `./coreSessionBridge` |
| [src/features/torneos/stagingV1/contentReportService.js:9](../../../src/features/torneos/stagingV1/contentReportService.js#L9) | `../api/tournamentWorkspaceService` |
| [src/features/torneos/stagingV1/contentReportService.js:11](../../../src/features/torneos/stagingV1/contentReportService.js#L11) | `./coreSessionBridge` |
| [src/features/torneos/stagingV1/coreSessionBridge.js:4](../../../src/features/torneos/stagingV1/coreSessionBridge.js#L4) | `../../../lib/coreSupabaseClient` |
| [src/features/torneos/stagingV1/publicTournamentComposition.js:13](../../../src/features/torneos/stagingV1/publicTournamentComposition.js#L13) | `../api/publicCatalogService` |
| [src/features/torneos/stagingV1/torneosInboxProbe.js:8](../../../src/features/torneos/stagingV1/torneosInboxProbe.js#L8) | `../api/tournamentWorkspaceService` |
| [src/features/torneos/stagingV1/torneosInboxProbe.js:9](../../../src/features/torneos/stagingV1/torneosInboxProbe.js#L9) | `./coreSessionBridge` |

## Límites

AST estático JS/JSX/TS: imports relativos, reexports, require/import literales y miembros por nombre. No es análisis semántico general de código ofuscado, eval, aliases de métodos extraídos o imports calculados. Los módulos de foundation sólo pueden importar otros módulos de foundation; los guards congelan accesos backend transitivos. La autorización real sigue en gateway/ACL/RLS. Inventarios verificables: [legacy-audit.json](legacy-audit.json) (legacy congelado) y [b04-audit.json](b04-audit.json) (árbol integrado).
