# TORNEOS-CALL-MAP — auditoría B04

Inventario legacy congelado en `2058da039a2a5eaaed22d87d01946bc596ae5f50` (Phase 2D); árbol integrado auditado en `b4fb150a12fcc521f227e935f23dab5cbcee6c22`. Reconstruido del código. No representa resultados de R2/R3/R4/R5.

187 sitios RPC legacy; 186 nombres distintos; 108 nombres dentro de scope; 78 fuera. La selección dinámica de `changeTournamentMatchPlan` se resuelve a sus tres nombres literales. No quedan RPC dinámicas sin resolver.

## Encaminadas por el adapter híbrido — staging v1 + COMPETITION-V1 (108)

`src/features/torneos/stagingV1/stagingV1WorkspaceService.js` expone la misma interfaz de aliases que `tournamentWorkspaceService` para estas 108 RPC (mismo nombre, mismo payload `p_*`, verificado alias por alias contra el servicio legacy en `scripts/torneos-frontend/adapter.test.mjs` y `competition-adapter.test.mjs`) sobre `foundation/torneosClient.execute` → `foundation/torneosTransport` → `POST {gateway}/torneos/rest/v1/rpc/<name>`. Los sitios legacy siguen existiendo para la composición single-project LOCAL; la composición híbrida nunca los alcanza.

| RPC | Función frontend legacy | Sitio legacy |
| --- | --- | --- |
| `accept_tournament_team_invitation` | `acceptTournamentTeamInvitation` | [src/features/torneos/api/tournamentWorkspaceService.js:742](../../../src/features/torneos/api/tournamentWorkspaceService.js#L742) |
| `acknowledge_tournament_document` | `acknowledgeTournamentDocument` | [src/features/torneos/api/tournamentWorkspaceService.js:1778](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1778) |
| `add_tournament_match_event` | `addTournamentMatchEvent` | [src/features/torneos/api/tournamentWorkspaceService.js:1189](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1189) |
| `add_tournament_roster_player` | `addTournamentRosterPlayer` | [src/features/torneos/api/tournamentWorkspaceService.js:655](../../../src/features/torneos/api/tournamentWorkspaceService.js#L655) |
| `append_tournament_playoff_phase` | `appendTournamentPlayoffPhase` | [src/features/torneos/api/tournamentWorkspaceService.js:865](../../../src/features/torneos/api/tournamentWorkspaceService.js#L865) |
| `archive_tournament_team_entry` | `archiveTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:716](../../../src/features/torneos/api/tournamentWorkspaceService.js#L716) |
| `assign_tournament_season_member` | `assignTournamentSeasonMember` | [src/features/torneos/api/tournamentWorkspaceService.js:140](../../../src/features/torneos/api/tournamentWorkspaceService.js#L140) |
| `auto_schedule_tournament_matches` | `autoScheduleTournamentMatches` | [src/features/torneos/api/tournamentWorkspaceService.js:1047](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1047) |
| `change_tournament_status` | `changeTournamentCompetitionStatus` | [src/features/torneos/api/tournamentWorkspaceService.js:491](../../../src/features/torneos/api/tournamentWorkspaceService.js#L491) |
| `create_manual_fixture_version` | `createManualTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:832](../../../src/features/torneos/api/tournamentWorkspaceService.js#L832) |
| `create_tournament_announcement_draft` | `createTournamentAnnouncementDraft` | [src/features/torneos/api/tournamentWorkspaceService.js:1809](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1809) |
| `create_tournament_court` | `createTournamentCourt` | [src/features/torneos/api/tournamentWorkspaceService.js:970](../../../src/features/torneos/api/tournamentWorkspaceService.js#L970) |
| `create_tournament_document` | `createTournamentDocument` | [src/features/torneos/api/tournamentWorkspaceService.js:1928](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1928) |
| `create_tournament_match_correction` | `createTournamentMatchCorrection` | [src/features/torneos/api/tournamentWorkspaceService.js:1243](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1243) |
| `create_tournament_organization` | `createTournamentOrganization` | [src/features/torneos/api/tournamentWorkspaceService.js:226](../../../src/features/torneos/api/tournamentWorkspaceService.js#L226) |
| `create_tournament_provisional_player` | `createTournamentProvisionalPlayer` | [src/features/torneos/api/tournamentWorkspaceService.js:647](../../../src/features/torneos/api/tournamentWorkspaceService.js#L647) |
| `create_tournament_season` | `createTournamentSeason` | [src/features/torneos/api/tournamentWorkspaceService.js:347](../../../src/features/torneos/api/tournamentWorkspaceService.js#L347) |
| `create_tournament_team_entry` | `createTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:621](../../../src/features/torneos/api/tournamentWorkspaceService.js#L621) |
| `create_tournament_venue` | `createTournamentVenue` | [src/features/torneos/api/tournamentWorkspaceService.js:948](../../../src/features/torneos/api/tournamentWorkspaceService.js#L948) |
| `create_tournament_with_defaults` | `createTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:406](../../../src/features/torneos/api/tournamentWorkspaceService.js#L406) |
| `execute_tournament_group_draw` | `executeTournamentGroupDraw` | [src/features/torneos/api/tournamentWorkspaceService.js:810](../../../src/features/torneos/api/tournamentWorkspaceService.js#L810) |
| `finish_tournament_competition` | `finishTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:520](../../../src/features/torneos/api/tournamentWorkspaceService.js#L520) |
| `freeze_tournament_participants` | `freezeTournamentParticipants` | [src/features/torneos/api/tournamentWorkspaceService.js:783](../../../src/features/torneos/api/tournamentWorkspaceService.js#L783) |
| `generate_tournament_fixture` | `generateTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:821](../../../src/features/torneos/api/tournamentWorkspaceService.js#L821) |
| `get_managed_tournament_matches` | `loadPlayerTournamentMatches` | [src/features/torneos/api/tournamentWorkspaceService.js:1072](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1072) |
| `get_match_squad_context` | `loadTournamentMatchSquad` | [src/features/torneos/api/tournamentWorkspaceService.js:1125](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1125) |
| `get_my_managed_match_squad_context` | `loadMyManagedTournamentMatchSquad` | [src/features/torneos/api/tournamentWorkspaceService.js:1133](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1133) |
| `get_my_tournament_memberships` | `loadMyTournamentMemberships` | [src/features/torneos/api/tournamentWorkspaceService.js:1357](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1357) |
| `get_my_tournament_notification_preferences` | `loadTournamentNotificationPreferences` | [src/features/torneos/api/tournamentWorkspaceService.js:1529](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1529) |
| `get_player_tournament_matches` | `loadPlayerTournamentMatches` | [src/features/torneos/api/tournamentWorkspaceService.js:1071](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1071) |
| `get_published_tournament_documents` | `loadPublishedTournamentDocuments` | [src/features/torneos/api/tournamentWorkspaceService.js:1768](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1768) |
| `get_published_tournament_matches` | `loadPublishedTournamentMatches` | [src/features/torneos/api/tournamentWorkspaceService.js:1440](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1440) |
| `get_published_tournament_standings` | `loadPublishedTournamentStandings` | [src/features/torneos/api/tournamentWorkspaceService.js:1476](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1476) |
| `get_published_tournament_statistics` | `loadPublishedTournamentStatistics` | [src/features/torneos/api/tournamentWorkspaceService.js:1490](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1490) |
| `get_published_tournament_teams` | `loadPublishedTournamentTeams` | [src/features/torneos/api/tournamentWorkspaceService.js:1462](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1462) |
| `get_team_registration_context` | `loadTeamRegistrationContext` | [src/features/torneos/api/tournamentWorkspaceService.js:609](../../../src/features/torneos/api/tournamentWorkspaceService.js#L609) |
| `get_tournament_announcement` | `loadTournamentAnnouncement` | [src/features/torneos/api/tournamentWorkspaceService.js:1513](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1513) |
| `get_tournament_communications_admin_context` | `loadTournamentCommunicationsAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:1788](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1788) |
| `get_tournament_communications_inbox` | `loadTournamentCommunicationsInbox` | [src/features/torneos/api/tournamentWorkspaceService.js:1504](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1504) |
| `get_tournament_competition_context` | `loadTournamentCompetitionContext` | [src/features/torneos/api/tournamentWorkspaceService.js:314](../../../src/features/torneos/api/tournamentWorkspaceService.js#L314) |
| `get_tournament_creation_eligibility` | `loadTournamentCreationEligibility` | [src/features/torneos/api/tournamentWorkspaceService.js:70](../../../src/features/torneos/api/tournamentWorkspaceService.js#L70) |
| `get_tournament_fixture_context` | `loadTournamentFixtureContext` | [src/features/torneos/api/tournamentWorkspaceService.js:767](../../../src/features/torneos/api/tournamentWorkspaceService.js#L767) |
| `get_tournament_match_operation_context` | `loadTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1118](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1118) |
| `get_tournament_match_operations_context` | `loadTournamentMatchOperations` | [src/features/torneos/api/tournamentWorkspaceService.js:1110](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1110) |
| `get_tournament_participant_hub` | `loadTournamentParticipantHub` | [src/features/torneos/api/tournamentWorkspaceService.js:1403](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1403) |
| `get_tournament_participant_match` | `loadTournamentParticipantMatch` | [src/features/torneos/api/tournamentWorkspaceService.js:1451](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1451) |
| `get_tournament_public_page_settings` | `loadTournamentPublicPageSettings` | [src/features/torneos/api/tournamentWorkspaceService.js:179](../../../src/features/torneos/api/tournamentWorkspaceService.js#L179) |
| `get_tournament_schedule_context` | `loadTournamentScheduleContext` | [src/features/torneos/api/tournamentWorkspaceService.js:775](../../../src/features/torneos/api/tournamentWorkspaceService.js#L775) |
| `get_tournament_standings_context` | `loadTournamentStandings` | [src/features/torneos/api/tournamentWorkspaceService.js:1268](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1268) |
| `get_tournament_statistics_context` | `loadTournamentStatistics` | [src/features/torneos/api/tournamentWorkspaceService.js:1275](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1275) |
| `get_tournament_teams_context` | `loadTournamentTeamsContext` | [src/features/torneos/api/tournamentWorkspaceService.js:595](../../../src/features/torneos/api/tournamentWorkspaceService.js#L595) |
| `get_tournament_workspace_context` | `loadTournamentWorkspaceContext` | [src/features/torneos/api/tournamentWorkspaceService.js:38](../../../src/features/torneos/api/tournamentWorkspaceService.js#L38) |
| `invite_tournament_team_manager` | `inviteTournamentTeamManager` | [src/features/torneos/api/tournamentWorkspaceService.js:732](../../../src/features/torneos/api/tournamentWorkspaceService.js#L732) |
| `is_tournament_organization_slug_available` | `checkTournamentOrganizationSlugAvailability` | [src/features/torneos/api/tournamentWorkspaceService.js:263](../../../src/features/torneos/api/tournamentWorkspaceService.js#L263) |
| `list_tournament_season_member_assignments` | `listTournamentSeasonMemberAssignments` | [src/features/torneos/api/tournamentWorkspaceService.js:133](../../../src/features/torneos/api/tournamentWorkspaceService.js#L133) |
| `make_tournament_match_official` | `makeTournamentMatchOfficial` | [src/features/torneos/api/tournamentWorkspaceService.js:1228](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1228) |
| `mark_tournament_announcement_read` | `markTournamentAnnouncementRead` | [src/features/torneos/api/tournamentWorkspaceService.js:1522](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1522) |
| `open_tournament_match_operation` | `openTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1156](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1156) |
| `preview_tournament_announcement_audience` | `previewTournamentAnnouncementAudience` | [src/features/torneos/api/tournamentWorkspaceService.js:1901](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1901) |
| `publish_tournament_announcement` | `publishTournamentAnnouncement` | [src/features/torneos/api/tournamentWorkspaceService.js:1910](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1910) |
| `publish_tournament_document_version` | `publishTournamentDocumentVersion` | [src/features/torneos/api/tournamentWorkspaceService.js:1943](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1943) |
| `publish_tournament_fixture` | `publishTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:858](../../../src/features/torneos/api/tournamentWorkspaceService.js#L858) |
| `publish_tournament_standings_revision` | `publishTournamentStandings` | [src/features/torneos/api/tournamentWorkspaceService.js:1290](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1290) |
| `rebuild_tournament_standings` | `rebuildTournamentStandings` | [src/features/torneos/api/tournamentWorkspaceService.js:1282](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1282) |
| `remove_tournament_roster_player` | `removeTournamentRosterPlayer` | [src/features/torneos/api/tournamentWorkspaceService.js:683](../../../src/features/torneos/api/tournamentWorkspaceService.js#L683) |
| `remove_tournament_season_member_assignment` | `removeTournamentSeasonMemberAssignment` | [src/features/torneos/api/tournamentWorkspaceService.js:152](../../../src/features/torneos/api/tournamentWorkspaceService.js#L152) |
| `reopen_tournament_competition` | `reopenTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:538](../../../src/features/torneos/api/tournamentWorkspaceService.js#L538) |
| `reopen_tournament_participants` | `reopenTournamentParticipants` | [src/features/torneos/api/tournamentWorkspaceService.js:792](../../../src/features/torneos/api/tournamentWorkspaceService.js#L792) |
| `replace_tournament_announcement_audience` | `replaceTournamentAnnouncementAudience` | [src/features/torneos/api/tournamentWorkspaceService.js:1852](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1852) |
| `request_tournament_match_correction` | `requestTournamentMatchCorrection` | [src/features/torneos/api/tournamentWorkspaceService.js:1235](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1235) |
| `reschedule_tournament_match` | `rescheduleTournamentMatch` | [src/features/torneos/api/tournamentWorkspaceService.js:1020](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1020) |
| `resolve_tournament_qualification` | `resolveTournamentQualification` | [src/features/torneos/api/tournamentWorkspaceService.js:1297](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1297) |
| `respond_match_availability` | `respondTournamentMatchAvailability` | [src/features/torneos/api/tournamentWorkspaceService.js:1091](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1091) |
| `review_tournament_match_operation` | `reviewTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1212](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1212) |
| `review_tournament_team_entry` | `reviewTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:698](../../../src/features/torneos/api/tournamentWorkspaceService.js#L698) |
| `save_match_squad` | `saveTournamentMatchSquad` | [src/features/torneos/api/tournamentWorkspaceService.js:1139](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1139) |
| `save_tournament_category` | `saveTournamentCategory` | [src/features/torneos/api/tournamentWorkspaceService.js:462](../../../src/features/torneos/api/tournamentWorkspaceService.js#L462) |
| `save_tournament_draw_pots` | `saveTournamentDrawPots` | [src/features/torneos/api/tournamentWorkspaceService.js:801](../../../src/features/torneos/api/tournamentWorkspaceService.js#L801) |
| `save_tournament_schedule_windows` | `saveTournamentScheduleWindows` | [src/features/torneos/api/tournamentWorkspaceService.js:988](../../../src/features/torneos/api/tournamentWorkspaceService.js#L988) |
| `schedule_tournament_match` | `scheduleTournamentMatch` | [src/features/torneos/api/tournamentWorkspaceService.js:1007](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1007) |
| `search_tournament_arma2_teams` | `searchTournamentArma2Teams` | [src/features/torneos/api/tournamentWorkspaceService.js:758](../../../src/features/torneos/api/tournamentWorkspaceService.js#L758) |
| `search_tournament_players` | `searchTournamentPlayers` | [src/features/torneos/api/tournamentWorkspaceService.js:748](../../../src/features/torneos/api/tournamentWorkspaceService.js#L748) |
| `set_active_tournament_context` | `setActiveTournamentContext` | [src/features/torneos/api/tournamentWorkspaceService.js:580](../../../src/features/torneos/api/tournamentWorkspaceService.js#L580) |
| `set_my_tournament_hub_category` | `setTournamentHubCategory` | [src/features/torneos/api/tournamentWorkspaceService.js:1426](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1426) |
| `set_tournament_announcement_link` | `setTournamentAnnouncementLink` | [src/features/torneos/api/tournamentWorkspaceService.js:1870](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1870) |
| `set_tournament_match_outcome` | `setTournamentMatchOutcome` | [src/features/torneos/api/tournamentWorkspaceService.js:1173](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1173) |
| `set_tournament_match_score` | `setTournamentMatchScore` | [src/features/torneos/api/tournamentWorkspaceService.js:1181](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1181) |
| `set_tournament_public_page_published` | `setTournamentPublicPagePublished` | [src/features/torneos/api/tournamentWorkspaceService.js:212](../../../src/features/torneos/api/tournamentWorkspaceService.js#L212) |
| `set_tournament_workspace_preference` | `setTournamentWorkspacePreference` | [src/features/torneos/api/tournamentWorkspaceService.js:247](../../../src/features/torneos/api/tournamentWorkspaceService.js#L247) |
| `start_tournament_competition` | `startTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:506](../../../src/features/torneos/api/tournamentWorkspaceService.js#L506) |
| `submit_match_squad` | `submitTournamentMatchSquad` | [src/features/torneos/api/tournamentWorkspaceService.js:1148](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1148) |
| `submit_tournament_match_operation` | `submitTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1205](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1205) |
| `submit_tournament_team_entry` | `submitTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:691](../../../src/features/torneos/api/tournamentWorkspaceService.js#L691) |
| `supersede_tournament_fixture` | `supersedeTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:885](../../../src/features/torneos/api/tournamentWorkspaceService.js#L885) |
| `update_draft_fixture` | `updateDraftTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:842](../../../src/features/torneos/api/tournamentWorkspaceService.js#L842) |
| `update_my_tournament_notification_preferences` | `updateTournamentNotificationPreferences` | [src/features/torneos/api/tournamentWorkspaceService.js:1543](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1543) |
| `update_tournament_announcement_draft` | `updateTournamentAnnouncementDraft` | [src/features/torneos/api/tournamentWorkspaceService.js:1889](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1889) |
| `update_tournament_configuration` | `updateTournamentCompetition` | [src/features/torneos/api/tournamentWorkspaceService.js:433](../../../src/features/torneos/api/tournamentWorkspaceService.js#L433) |
| `update_tournament_organization` | `updateTournamentOrganization` | [src/features/torneos/api/tournamentWorkspaceService.js:284](../../../src/features/torneos/api/tournamentWorkspaceService.js#L284) |
| `update_tournament_roster_player` | `updateTournamentRosterPlayer` | [src/features/torneos/api/tournamentWorkspaceService.js:671](../../../src/features/torneos/api/tournamentWorkspaceService.js#L671) |
| `update_tournament_season` | `updateTournamentSeason` | [src/features/torneos/api/tournamentWorkspaceService.js:373](../../../src/features/torneos/api/tournamentWorkspaceService.js#L373) |
| `update_tournament_team_entry` | `updateTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:639](../../../src/features/torneos/api/tournamentWorkspaceService.js#L639) |
| `validate_tournament_fixture` | `validateTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:851](../../../src/features/torneos/api/tournamentWorkspaceService.js#L851) |
| `validate_tournament_match_operation` | `validateTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1221](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1221) |
| `validate_tournament_match_schedule` | `validateTournamentMatchSchedule` | [src/features/torneos/api/tournamentWorkspaceService.js:996](../../../src/features/torneos/api/tournamentWorkspaceService.js#L996) |
| `void_tournament_match_event` | `voidTournamentMatchEvent` | [src/features/torneos/api/tournamentWorkspaceService.js:1197](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1197) |
| `withdraw_tournament_competition_participant` | `withdrawTournamentCompetitionParticipant` | [src/features/torneos/api/tournamentWorkspaceService.js:559](../../../src/features/torneos/api/tournamentWorkspaceService.js#L559) |
| `withdraw_tournament_team_entry` | `withdrawTournamentTeamEntry` | [src/features/torneos/api/tournamentWorkspaceService.js:708](../../../src/features/torneos/api/tournamentWorkspaceService.js#L708) |

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

## Bloqueadas por scope (78)

`torneosClient.execute` devuelve `TORNEOS_OUTSIDE_STAGING_V1` antes de cualquier red. El adapter staging-v1 no tiene alias para ninguna; las pantallas las esconden o deshabilitan vía `TorneosFeaturesContext` (`stagingV1/stagingV1Features.js`).

| RPC | Función frontend | Sitio |
| --- | --- | --- |
| `archive_tournament_fixture` | `archiveTournamentFixture` | [src/features/torneos/api/tournamentWorkspaceService.js:877](../../../src/features/torneos/api/tournamentWorkspaceService.js#L877) |
| `authorize_tournament_social_export` | `authorizeTournamentSocialExport` | [src/features/torneos/api/tournamentWorkspaceService.js:2186](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2186) |
| `block_tournament_applicant` | `blockTournamentApplicant` | [src/features/torneos/api/tournamentWorkspaceService.js:1736](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1736) |
| `cancel_tournament_match` | `changeTournamentMatchPlan` | [src/features/torneos/api/tournamentWorkspaceService.js:1039](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1039) |
| `cancel_tournament_media_upload_session` | `cancelTournamentMediaUploadSession` | [src/features/torneos/api/tournamentWorkspaceService.js:2050](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2050) |
| `cancel_tournament_purchase` | `cancelTournamentPurchase` | [src/features/torneos/api/tournamentWorkspaceService.js:170](../../../src/features/torneos/api/tournamentWorkspaceService.js#L170) |
| `change_tournament_media_gallery_state` | `changeTournamentMediaGalleryState` | [src/features/torneos/api/tournamentWorkspaceService.js:2097](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2097) |
| `create_tournament_disciplinary_override` | `createTournamentDisciplinaryOverride` | [src/features/torneos/api/tournamentWorkspaceService.js:1324](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1324) |
| `create_tournament_media_gallery` | `createTournamentMediaGallery` | [src/features/torneos/api/tournamentWorkspaceService.js:2004](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2004) |
| `create_tournament_points_adjustment` | `createTournamentPointsAdjustment` | [src/features/torneos/api/tournamentWorkspaceService.js:1304](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1304) |
| `get_effective_tournament_entitlements` | `loadEffectiveTournamentEntitlements`, `loadTournamentMediaAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:53](../../../src/features/torneos/api/tournamentWorkspaceService.js#L53), [src/features/torneos/api/tournamentWorkspaceService.js:1976](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1976) |
| `get_effective_tournament_season_entitlements` | `loadEffectiveTournamentSeasonEntitlements` | [src/features/torneos/api/tournamentWorkspaceService.js:63](../../../src/features/torneos/api/tournamentWorkspaceService.js#L63) |
| `get_my_torneos_inbox_summary` | `loadTorneosInboxSummary` | [src/features/torneos/api/tournamentWorkspaceService.js:1582](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1582) |
| `get_my_torneos_notifications` | `loadTorneosNotifications` | [src/features/torneos/api/tournamentWorkspaceService.js:1568](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1568) |
| `get_my_torneos_profile` | `loadTorneosProfile` | [src/features/torneos/api/tournamentWorkspaceService.js:1557](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1557) |
| `get_my_tournament_communication_mutes` | `loadMyTournamentCommunicationMutes` | [src/features/torneos/api/tournamentWorkspaceService.js:1753](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1753) |
| `get_my_tournament_participations` | `loadMyTournamentParticipations` | [src/features/torneos/api/tournamentWorkspaceService.js:1700](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1700) |
| `get_my_tournament_registrations` | `loadMyTournamentRegistrations` | [src/features/torneos/api/tournamentWorkspaceService.js:1758](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1758) |
| `get_player_tournament_statistics` | `loadPlayerTournamentStatistics` | [src/features/torneos/api/tournamentWorkspaceService.js:1342](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1342) |
| `get_player_tournament_suspensions` | `loadPlayerTournamentSuspensions` | [src/features/torneos/api/tournamentWorkspaceService.js:1348](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1348) |
| `get_public_tournament_branding` | `loadPublicTournamentPage` | [src/features/torneos/api/publicTournamentService.js:16](../../../src/features/torneos/api/publicTournamentService.js#L16) |
| `get_public_tournament_page` | `loadPublicTournamentPage` | [src/features/torneos/api/publicTournamentService.js:12](../../../src/features/torneos/api/publicTournamentService.js#L12) |
| `get_published_tournament_media` | `loadPublishedTournamentMedia` | [src/features/torneos/api/tournamentWorkspaceService.js:2111](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2111) |
| `get_tournament_application_inbox` | `loadTournamentApplicationInbox` | [src/features/torneos/api/tournamentWorkspaceService.js:1656](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1656) |
| `get_tournament_branding_context` | `loadTournamentBrandingContext` | [src/features/torneos/api/tournamentBrandingService.js:38](../../../src/features/torneos/api/tournamentBrandingService.js#L38) |
| `get_tournament_catalog_entry` | `<callback>` | [src/features/torneos/api/publicCatalogService.js:52](../../../src/features/torneos/api/publicCatalogService.js#L52) |
| `get_tournament_catalog_facets` | `<callback>` | [src/features/torneos/api/publicCatalogService.js:48](../../../src/features/torneos/api/publicCatalogService.js#L48) |
| `get_tournament_catalog_listing_settings` | `loadTournamentCatalogListingSettings` | [src/features/torneos/api/tournamentWorkspaceService.js:1586](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1586) |
| `get_tournament_content_reports` | `loadTournamentContentReports` | [src/features/torneos/api/tournamentWorkspaceService.js:1724](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1724) |
| `get_tournament_media_admin_context` | `loadTournamentMediaAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:1956](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1956) |
| `get_tournament_media_asset_processing_tiers` | `loadTournamentMediaAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:1966](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1966) |
| `get_tournament_media_upload_capability` | `loadTournamentMediaAdminContext` | [src/features/torneos/api/tournamentWorkspaceService.js:1963](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1963) |
| `get_tournament_purchase` | `loadTournamentPurchase` | [src/features/torneos/api/tournamentWorkspaceService.js:110](../../../src/features/torneos/api/tournamentWorkspaceService.js#L110) |
| `get_tournament_season_media_usage` | `loadTournamentSeasonMediaUsage` | [src/features/torneos/api/tournamentWorkspaceService.js:126](../../../src/features/torneos/api/tournamentWorkspaceService.js#L126) |
| `get_tournament_social_snapshot` | `loadTournamentSocialSnapshot` | [src/features/torneos/api/tournamentWorkspaceService.js:2168](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2168) |
| `get_tournament_social_studio_context` | `loadTournamentSocialStudioContext` | [src/features/torneos/api/tournamentWorkspaceService.js:2154](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2154) |
| `get_tournament_team_photo_state` | `loadTeamPhotoState` | [src/features/torneos/api/tournamentTeamPhotoService.js:153](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L153) |
| `get_tournament_team_visual_policy` | `loadTournamentTeamVisualPolicy` | [src/features/torneos/api/tournamentWorkspaceService.js:189](../../../src/features/torneos/api/tournamentWorkspaceService.js#L189) |
| `handle_tournament_content_report` | `handleTournamentContentReport` | [src/features/torneos/api/tournamentWorkspaceService.js:1731](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1731) |
| `handle_tournament_media_report` | `handleTournamentMediaReport` | [src/features/torneos/api/tournamentWorkspaceService.js:2220](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2220) |
| `list_my_core_teams_for_application` | `listMyCoreTeamsForApplication` | [src/features/torneos/api/tournamentWorkspaceService.js:1674](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1674) |
| `list_tournament_player_portrait_refs` | `loadRosterPortraits` | [src/features/torneos/api/tournamentPlayerPortraitService.js:135](../../../src/features/torneos/api/tournamentPlayerPortraitService.js#L135) |
| `lock_tournament_roster` | `lockTournamentRoster` | [src/features/torneos/api/tournamentWorkspaceService.js:724](../../../src/features/torneos/api/tournamentWorkspaceService.js#L724) |
| `mark_my_torneos_notifications_read` | `markTorneosNotificationsRead` | [src/features/torneos/api/tournamentWorkspaceService.js:1576](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1576) |
| `mark_tournament_suspension_served` | `markTournamentSuspensionServed` | [src/features/torneos/api/tournamentWorkspaceService.js:1334](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1334) |
| `postpone_tournament_match` | `changeTournamentMatchPlan` | [src/features/torneos/api/tournamentWorkspaceService.js:1039](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1039) |
| `publish_tournament_media_gallery` | `publishTournamentMediaGallery` | [src/features/torneos/api/tournamentWorkspaceService.js:2087](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2087) |
| `record_manual_match_availability` | `recordManualTournamentMatchAvailability` | [src/features/torneos/api/tournamentWorkspaceService.js:1099](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1099) |
| `reorder_tournament_media_item` | `reorderTournamentMediaItem` | [src/features/torneos/api/tournamentWorkspaceService.js:2079](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2079) |
| `report_tournament_content` | `reportTournamentContent` | [src/features/torneos/api/tournamentWorkspaceService.js:1719](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1719) |
| `report_tournament_media_asset` | `reportTournamentMediaAsset` | [src/features/torneos/api/tournamentWorkspaceService.js:2127](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2127) |
| `request_tournament_media_upload_session` | `requestTournamentMediaUploadSession` | [src/features/torneos/api/tournamentWorkspaceService.js:2040](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2040) |
| `restore_tournament_match_unscheduled` | `changeTournamentMatchPlan` | [src/features/torneos/api/tournamentWorkspaceService.js:1039](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1039) |
| `revoke_tournament_points_adjustment` | `revokeTournamentPointsAdjustment` | [src/features/torneos/api/tournamentWorkspaceService.js:1317](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1317) |
| `revoke_tournament_team_photo` | `revokeTeamPhoto` | [src/features/torneos/api/tournamentTeamPhotoService.js:252](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L252) |
| `save_tournament_catalog_listing` | `saveTournamentCatalogListing` | [src/features/torneos/api/tournamentWorkspaceService.js:1607](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1607) |
| `save_tournament_category_capacity` | `saveTournamentCategoryCapacity` | [src/features/torneos/api/tournamentWorkspaceService.js:1641](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1641) |
| `save_tournament_match_operation_draft` | `saveTournamentMatchOperationDraft` | [src/features/torneos/api/tournamentWorkspaceService.js:1164](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1164) |
| `search_my_applicable_core_teams` | `searchApplicableCoreTeams` | [src/features/torneos/api/tournamentWorkspaceService.js:1666](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1666) |
| `search_tournament_catalog` | `<callback>` | [src/features/torneos/api/publicCatalogService.js:44](../../../src/features/torneos/api/publicCatalogService.js#L44) |
| `set_tournament_announcement_audience` | `setTournamentAnnouncementAudience` | [src/features/torneos/api/tournamentWorkspaceService.js:1834](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1834) |
| `set_tournament_applications_state` | `setTournamentApplicationsState` | [src/features/torneos/api/tournamentWorkspaceService.js:1633](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1633) |
| `set_tournament_branding_reference` | `uploadTournamentBrandingAsset`, `removeTournamentBrandingAsset` | [src/features/torneos/api/tournamentBrandingService.js:71](../../../src/features/torneos/api/tournamentBrandingService.js#L71), [src/features/torneos/api/tournamentBrandingService.js:105](../../../src/features/torneos/api/tournamentBrandingService.js#L105) |
| `set_tournament_catalog_listing_status` | `setTournamentCatalogListingStatus` | [src/features/torneos/api/tournamentWorkspaceService.js:1625](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1625) |
| `set_tournament_communications_muted` | `setTournamentCommunicationsMuted` | [src/features/torneos/api/tournamentWorkspaceService.js:1748](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1748) |
| `set_tournament_media_cover` | `setTournamentMediaCover` | [src/features/torneos/api/tournamentWorkspaceService.js:2068](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2068) |
| `set_tournament_player_portrait_crop` | `setPlayerPortraitCrop` | [src/features/torneos/api/tournamentPlayerPortraitService.js:209](../../../src/features/torneos/api/tournamentPlayerPortraitService.js#L209) |
| `set_tournament_social_permission` | `setTournamentSocialPermission` | [src/features/torneos/api/tournamentWorkspaceService.js:2200](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2200) |
| `set_tournament_team_photo_editorial_status` | `setTeamPhotoEditorialStatus` | [src/features/torneos/api/tournamentTeamPhotoService.js:235](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L235) |
| `set_tournament_team_visual_policy` | `setTournamentTeamVisualPolicy` | [src/features/torneos/api/tournamentWorkspaceService.js:200](../../../src/features/torneos/api/tournamentWorkspaceService.js#L200) |
| `start_tournament_application` | `startTournamentApplication` | [src/features/torneos/api/tournamentWorkspaceService.js:1688](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1688) |
| `transition_tournament_media_asset` | `transitionTournamentMediaAsset` | [src/features/torneos/api/tournamentWorkspaceService.js:2060](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2060) |
| `unblock_tournament_applicant` | `unblockTournamentApplicant` | [src/features/torneos/api/tournamentWorkspaceService.js:1741](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1741) |
| `update_my_torneos_profile` | `updateTorneosProfile` | [src/features/torneos/api/tournamentWorkspaceService.js:1561](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1561) |
| `update_tournament_court` | `updateTournamentCourt` | [src/features/torneos/api/tournamentWorkspaceService.js:980](../../../src/features/torneos/api/tournamentWorkspaceService.js#L980) |
| `update_tournament_media_gallery` | `updateTournamentMediaGallery` | [src/features/torneos/api/tournamentWorkspaceService.js:2024](../../../src/features/torneos/api/tournamentWorkspaceService.js#L2024) |
| `update_tournament_venue` | `updateTournamentVenue` | [src/features/torneos/api/tournamentWorkspaceService.js:962](../../../src/features/torneos/api/tournamentWorkspaceService.js#L962) |
| `void_tournament_match_operation` | `voidTournamentMatchOperation` | [src/features/torneos/api/tournamentWorkspaceService.js:1250](../../../src/features/torneos/api/tournamentWorkspaceService.js#L1250) |

## Accesos backend nuevos de B04 (15)

Los únicos sitios fuera del inventario legacy. El transporte habla sólo con el gateway; el puente de sesión sólo lee la sesión Core.

| Tipo | Llamada | Sitio |
| --- | --- | --- |
| rpc | `supabase.rpc` | [src/features/torneos/api/publicCatalogService.js:44](../../../src/features/torneos/api/publicCatalogService.js#L44) |
| rpc | `supabase.rpc` | [src/features/torneos/api/publicCatalogService.js:48](../../../src/features/torneos/api/publicCatalogService.js#L48) |
| rpc | `supabase.rpc` | [src/features/torneos/api/publicCatalogService.js:52](../../../src/features/torneos/api/publicCatalogService.js#L52) |
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
| function | `supabase.functions.invoke` | `tournament-checkout` | [src/features/torneos/api/tournamentWorkspaceService.js:80](../../../src/features/torneos/api/tournamentWorkspaceService.js#L80) |
| function | `supabase.functions.invoke` | `tournament-fake-payment` | [src/features/torneos/api/tournamentWorkspaceService.js:160](../../../src/features/torneos/api/tournamentWorkspaceService.js#L160) |
| from | `supabase.from` | `tournament_organization_members` | [src/features/torneos/api/tournamentWorkspaceService.js:299](../../../src/features/torneos/api/tournamentWorkspaceService.js#L299) |
| from | `supabase.from` | `tournament_venues` | [src/features/torneos/api/tournamentWorkspaceService.js:908](../../../src/features/torneos/api/tournamentWorkspaceService.js#L908) |
| from | `supabase.from` | `tournament_courts` | [src/features/torneos/api/tournamentWorkspaceService.js:914](../../../src/features/torneos/api/tournamentWorkspaceService.js#L914) |
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

## Dependencias Core transitivas dentro de Torneos (186 aristas)

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
| [src/features/torneos/api/tournamentTeamPhotoService.js:13](../../../src/features/torneos/api/tournamentTeamPhotoService.js#L13) | `../../../services/api/supabase` |
| [src/features/torneos/api/tournamentWorkspaceService.js:7](../../../src/features/torneos/api/tournamentWorkspaceService.js#L7) | `../../../services/api/supabase` |
| [src/features/torneos/api/tournamentWorkspaceService.js:9](../../../src/features/torneos/api/tournamentWorkspaceService.js#L9) | `../domain/brandingAssets` |
| [src/features/torneos/api/tournamentWorkspaceService.js:10](../../../src/features/torneos/api/tournamentWorkspaceService.js#L10) | `./tournamentBrandingService` |
| [src/features/torneos/api/tournamentWorkspaceService.js:14](../../../src/features/torneos/api/tournamentWorkspaceService.js#L14) | `./tournamentMediaUploadClient` |
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
| [src/features/torneos/components/SocialStudioPage.jsx:29](../../../src/features/torneos/components/SocialStudioPage.jsx#L29) | `../context/TorneosWorkspaceContext` |
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
| [src/features/torneos/components/TorneosShell.jsx:49](../../../src/features/torneos/components/TorneosShell.jsx#L49) | `./PlanExperiencePage` |
| [src/features/torneos/components/TorneosShell.jsx:50](../../../src/features/torneos/components/TorneosShell.jsx#L50) | `./PurchaseStatusPage` |
| [src/features/torneos/components/TorneosShell.jsx:52](../../../src/features/torneos/components/TorneosShell.jsx#L52) | `./TorneosDashboard` |
| [src/features/torneos/components/TorneosShell.jsx:53](../../../src/features/torneos/components/TorneosShell.jsx#L53) | `./TorneosLanding` |
| [src/features/torneos/components/TorneosShell.jsx:55](../../../src/features/torneos/components/TorneosShell.jsx#L55) | `./TournamentWizardPage` |
| [src/features/torneos/components/TorneosShell.jsx:56](../../../src/features/torneos/components/TorneosShell.jsx#L56) | `./TeamsPage` |
| [src/features/torneos/components/TorneosShell.jsx:57](../../../src/features/torneos/components/TorneosShell.jsx#L57) | `./NewTeamEntryPage` |
| [src/features/torneos/components/TorneosShell.jsx:58](../../../src/features/torneos/components/TorneosShell.jsx#L58) | `./TeamRegistrationPage` |
| [src/features/torneos/components/TorneosShell.jsx:59](../../../src/features/torneos/components/TorneosShell.jsx#L59) | `./TeamInvitationPage` |
| [src/features/torneos/components/TorneosShell.jsx:60](../../../src/features/torneos/components/TorneosShell.jsx#L60) | `./OrganizationInvitationPage` |
| [src/features/torneos/components/TorneosShell.jsx:61](../../../src/features/torneos/components/TorneosShell.jsx#L61) | `./WorkspaceSwitcher` |
| [src/features/torneos/components/TorneosShell.jsx:62](../../../src/features/torneos/components/TorneosShell.jsx#L62) | `./FixtureWorkspacePage` |
| [src/features/torneos/components/TorneosShell.jsx:63](../../../src/features/torneos/components/TorneosShell.jsx#L63) | `./MatchOperationsPage` |
| [src/features/torneos/components/TorneosShell.jsx:64](../../../src/features/torneos/components/TorneosShell.jsx#L64) | `./MyTournamentMatchesPage` |
| [src/features/torneos/components/TorneosShell.jsx:65](../../../src/features/torneos/components/TorneosShell.jsx#L65) | `./CaptainMatchSquadPage` |
| [src/features/torneos/components/TorneosShell.jsx:66](../../../src/features/torneos/components/TorneosShell.jsx#L66) | `./CompetitionCenterPage` |
| [src/features/torneos/components/TorneosShell.jsx:67](../../../src/features/torneos/components/TorneosShell.jsx#L67) | `./MyTournamentsPage` |
| [src/features/torneos/components/TorneosShell.jsx:68](../../../src/features/torneos/components/TorneosShell.jsx#L68) | `./TournamentHubPage` |
| [src/features/torneos/components/TorneosShell.jsx:69](../../../src/features/torneos/components/TorneosShell.jsx#L69) | `./CommunicationsAdminPage` |
| [src/features/torneos/components/TorneosShell.jsx:70](../../../src/features/torneos/components/TorneosShell.jsx#L70) | `./MediaAdminPage` |
| [src/features/torneos/components/TorneosShell.jsx:71](../../../src/features/torneos/components/TorneosShell.jsx#L71) | `./SocialStudioPage` |
| [src/features/torneos/components/TorneosShell.jsx:72](../../../src/features/torneos/components/TorneosShell.jsx#L72) | `./connected/TorneosAccountMenu` |
| [src/features/torneos/components/TorneosShell.jsx:73](../../../src/features/torneos/components/TorneosShell.jsx#L73) | `./connected/TorneosInboxBell` |
| [src/features/torneos/components/TorneosShell.jsx:74](../../../src/features/torneos/components/TorneosShell.jsx#L74) | `./connected/useTorneosInboxSummary` |
| [src/features/torneos/components/TorneosShell.jsx:75](../../../src/features/torneos/components/TorneosShell.jsx#L75) | `./connected/PersonalNavigation` |
| [src/features/torneos/components/TorneosShell.jsx:76](../../../src/features/torneos/components/TorneosShell.jsx#L76) | `./connected/ExplorePage` |
| [src/features/torneos/components/TorneosShell.jsx:77](../../../src/features/torneos/components/TorneosShell.jsx#L77) | `./connected/CatalogCallPage` |
| [src/features/torneos/components/TorneosShell.jsx:78](../../../src/features/torneos/components/TorneosShell.jsx#L78) | `./connected/TournamentApplicationPage` |
| [src/features/torneos/components/TorneosShell.jsx:79](../../../src/features/torneos/components/TorneosShell.jsx#L79) | `./connected/TorneosInboxPage` |
| [src/features/torneos/components/TorneosShell.jsx:80](../../../src/features/torneos/components/TorneosShell.jsx#L80) | `./connected/TorneosProfilePage` |
| [src/features/torneos/components/TorneosShell.jsx:81](../../../src/features/torneos/components/TorneosShell.jsx#L81) | `./connected/ParticipantTeamRoute` |
| [src/features/torneos/components/TorneosShell.jsx:82](../../../src/features/torneos/components/TorneosShell.jsx#L82) | `./connected/CatalogListingPage` |
| [src/features/torneos/components/TorneosShell.jsx:83](../../../src/features/torneos/components/TorneosShell.jsx#L83) | `./connected/ApplicationInboxPage` |
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
