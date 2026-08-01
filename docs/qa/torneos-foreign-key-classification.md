# Clasificación de foreign keys sin índice · Torneos

Catálogo: Supabase local efímero, esquema canónico del branch. Inventario solicitado: **197** FKs (tablas `tournament_*` más `user_tournament_context_preferences`).

El advisor local actual reporta **244** FKs sin índice en todo `public`. Además del inventario de 197, detecta 3 FKs en la tabla raíz `tournaments` y 44 FKs ajenas al módulo. Esa deriva se informa; no se agrega ningún índice en esta etapa.

## Resumen

| Clasificación | Cantidad | Criterio |
| --- | ---: | --- |
| Crítica para flujos QA | 91 | Tabla materializada/limpiada por el seed, grupos canónicos, o preferencia de contexto del workspace. |
| Probablemente necesaria a corto plazo | 87 | Comunicaciones, hub, convocatoria, scheduling, media publicada o configuración operativa ya expuesta por flujos/RPCs. |
| Sin evidencia de necesidad actual | 19 | Relación opcional/administrativa no recorrida por el dataset ni por las nueve lecturas auditadas. |
| **Total** | **197** | |

## Inventario clasificado

| Clasificación | Tabla | Foreign key | Columnas | Referencia |
| --- | --- | --- | --- | --- |
| Probablemente necesaria a corto plazo | `tournament_announcement_audiences` | `tournament_announcement_audiences_announcement_fk` | `organization_id, announcement_id` | `tournament_announcements` |
| Probablemente necesaria a corto plazo | `tournament_announcement_audiences` | `tournament_announcement_audiences_category_fk` | `organization_id, category_id` | `tournament_categories` |
| Probablemente necesaria a corto plazo | `tournament_announcement_audiences` | `tournament_announcement_audiences_created_by_fkey` | `created_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_announcement_audiences` | `tournament_announcement_audiences_match_fk` | `organization_id, match_id` | `tournament_matches` |
| Probablemente necesaria a corto plazo | `tournament_announcement_audiences` | `tournament_announcement_audiences_specific_user_id_fkey` | `specific_user_id` | `users` |
| Probablemente necesaria a corto plazo | `tournament_announcement_audiences` | `tournament_announcement_audiences_team_fk` | `organization_id, team_entry_id` | `tournament_team_entries` |
| Probablemente necesaria a corto plazo | `tournament_announcement_deliveries` | `tournament_announcement_deliveries_announcement_fk` | `organization_id, announcement_id` | `tournament_announcements` |
| Probablemente necesaria a corto plazo | `tournament_announcement_links` | `tournament_announcement_links_announcement_fk` | `organization_id, announcement_id` | `tournament_announcements` |
| Probablemente necesaria a corto plazo | `tournament_announcements` | `tournament_announcements_author_user_id_fkey` | `author_user_id` | `users` |
| Probablemente necesaria a corto plazo | `tournament_announcements` | `tournament_announcements_category_fk` | `organization_id, tournament_id, category_id` | `tournament_categories` |
| Probablemente necesaria a corto plazo | `tournament_announcements` | `tournament_announcements_supersedes_fk` | `supersedes_id` | `tournament_announcements` |
| Probablemente necesaria a corto plazo | `tournament_announcements` | `tournament_announcements_tournament_fk` | `organization_id, tournament_id, season_id` | `tournaments` |
| Crítica para flujos QA | `tournament_audit_log` | `tournament_audit_log_actor_user_id_fkey` | `actor_user_id` | `users` |
| Crítica para flujos QA | `tournament_audit_log` | `tournament_audit_log_entry_fk` | `organization_id, tournament_id, team_entry_id` | `tournament_team_entries` |
| Crítica para flujos QA | `tournament_audit_log` | `tournament_audit_log_tournament_fk` | `organization_id, tournament_id` | `tournaments` |
| Crítica para flujos QA | `tournament_categories` | `tournament_categories_sport_modality_fkey` | `sport_modality` | `tournament_sport_modalities` |
| Crítica para flujos QA | `tournament_competition_participants` | `tournament_competition_participants_entry_fk` | `organization_id, tournament_id, team_entry_id` | `tournament_team_entries` |
| Probablemente necesaria a corto plazo | `tournament_courts` | `tournament_courts_sport_modality_fkey` | `sport_modality` | `tournament_sport_modalities` |
| Probablemente necesaria a corto plazo | `tournament_courts` | `tournament_courts_venue_fk` | `organization_id, venue_id` | `tournament_venues` |
| Probablemente necesaria a corto plazo | `tournament_disciplinary_overrides` | `tournament_disciplinary_overrides_actor_user_id_fkey` | `actor_user_id` | `users` |
| Probablemente necesaria a corto plazo | `tournament_disciplinary_overrides` | `tournament_disciplinary_overrides_suspension_fk` | `suspension_id` | `tournament_player_suspensions` |
| Crítica para flujos QA | `tournament_discipline_ledgers` | `tournament_discipline_ledgers_player_fk` | `organization_id, team_entry_id, roster_player_id` | `tournament_roster_players` |
| Crítica para flujos QA | `tournament_discipline_ledgers` | `tournament_discipline_ledgers_revision_fk` | `organization_id, revision_id` | `tournament_standings_revisions` |
| Crítica para flujos QA | `tournament_discipline_rules` | `tournament_discipline_rules_tournament_fk` | `organization_id, tournament_id` | `tournaments` |
| Probablemente necesaria a corto plazo | `tournament_document_acknowledgements` | `tournament_document_acknowledgements_document_fk` | `organization_id, document_id` | `tournament_documents` |
| Probablemente necesaria a corto plazo | `tournament_document_acknowledgements` | `tournament_document_acknowledgements_version_fk` | `organization_id, version_id` | `tournament_document_versions` |
| Probablemente necesaria a corto plazo | `tournament_document_versions` | `tournament_document_versions_created_by_fkey` | `created_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_document_versions` | `tournament_document_versions_document_fk` | `organization_id, document_id` | `tournament_documents` |
| Probablemente necesaria a corto plazo | `tournament_document_versions` | `tournament_document_versions_published_by_fkey` | `published_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_document_versions` | `tournament_document_versions_source_fk` | `source_version_id` | `tournament_document_versions` |
| Probablemente necesaria a corto plazo | `tournament_documents` | `tournament_documents_active_version_fk` | `active_version_id` | `tournament_document_versions` |
| Probablemente necesaria a corto plazo | `tournament_documents` | `tournament_documents_category_fk` | `organization_id, tournament_id, category_id` | `tournament_categories` |
| Probablemente necesaria a corto plazo | `tournament_documents` | `tournament_documents_created_by_fkey` | `created_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_documents` | `tournament_documents_tournament_fk` | `organization_id, tournament_id, season_id` | `tournaments` |
| Crítica para flujos QA | `tournament_fixture_versions` | `tournament_fixture_versions_created_by_fkey` | `created_by` | `users` |
| Crítica para flujos QA | `tournament_fixture_versions` | `tournament_fixture_versions_set_fk` | `organization_id, tournament_id, category_id, participant_set_id` | `tournament_participant_sets` |
| Crítica para flujos QA | `tournament_fixture_versions` | `tournament_fixture_versions_tournament_fk` | `organization_id, tournament_id, season_id` | `tournaments` |
| Crítica para flujos QA | `tournament_group_members` | `tournament_group_members_participant_fk` | `participant_id` | `tournament_competition_participants` |
| Probablemente necesaria a corto plazo | `tournament_match_availability_responses` | `tournament_match_availability_entry_fk` | `organization_id, team_entry_id` | `tournament_team_entries` |
| Probablemente necesaria a corto plazo | `tournament_match_availability_responses` | `tournament_match_availability_match_fk` | `organization_id, match_id` | `tournament_matches` |
| Probablemente necesaria a corto plazo | `tournament_match_availability_responses` | `tournament_match_availability_player_fk` | `organization_id, team_entry_id, roster_player_id` | `tournament_roster_players` |
| Probablemente necesaria a corto plazo | `tournament_match_availability_responses` | `tournament_match_availability_responses_recorded_by_fkey` | `recorded_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_match_availability_responses` | `tournament_match_availability_responses_user_id_fkey` | `user_id` | `users` |
| Crítica para flujos QA | `tournament_match_events` | `tournament_match_events_created_by_fkey` | `created_by` | `users` |
| Crítica para flujos QA | `tournament_match_events` | `tournament_match_events_entry_fk` | `organization_id, team_entry_id` | `tournament_team_entries` |
| Crítica para flujos QA | `tournament_match_events` | `tournament_match_events_operation_fk` | `organization_id, match_id, match_operation_id` | `tournament_match_operations` |
| Crítica para flujos QA | `tournament_match_events` | `tournament_match_events_player_fk` | `organization_id, roster_player_id` | `tournament_roster_players` |
| Crítica para flujos QA | `tournament_match_events` | `tournament_match_events_related_event_fk` | `related_event_id` | `tournament_match_events` |
| Crítica para flujos QA | `tournament_match_events` | `tournament_match_events_related_player_fk` | `organization_id, related_roster_player_id` | `tournament_roster_players` |
| Crítica para flujos QA | `tournament_match_events` | `tournament_match_events_voided_by_fkey` | `voided_by` | `users` |
| Crítica para flujos QA | `tournament_match_operation_players` | `tournament_match_operation_players_entry_fk` | `organization_id, team_entry_id` | `tournament_team_entries` |
| Crítica para flujos QA | `tournament_match_operation_players` | `tournament_match_operation_players_operation_fk` | `organization_id, match_id, match_operation_id` | `tournament_match_operations` |
| Crítica para flujos QA | `tournament_match_operation_players` | `tournament_match_operation_players_roster_player_fk` | `organization_id, team_entry_id, roster_player_id` | `tournament_roster_players` |
| Crítica para flujos QA | `tournament_match_operations` | `tournament_match_operations_away_entry_fk` | `organization_id, tournament_id, away_team_entry_id` | `tournament_team_entries` |
| Crítica para flujos QA | `tournament_match_operations` | `tournament_match_operations_home_entry_fk` | `organization_id, tournament_id, home_team_entry_id` | `tournament_team_entries` |
| Crítica para flujos QA | `tournament_match_operations` | `tournament_match_operations_match_fk` | `organization_id, tournament_id, category_id, fixture_version_id, match_id` | `tournament_matches` |
| Crítica para flujos QA | `tournament_match_operations` | `tournament_match_operations_official_by_fkey` | `official_by` | `users` |
| Crítica para flujos QA | `tournament_match_operations` | `tournament_match_operations_opened_by_fkey` | `opened_by` | `users` |
| Crítica para flujos QA | `tournament_match_operations` | `tournament_match_operations_reopened_by_fkey` | `reopened_by` | `users` |
| Crítica para flujos QA | `tournament_match_operations` | `tournament_match_operations_source_fk` | `source_operation_id` | `tournament_match_operations` |
| Crítica para flujos QA | `tournament_match_operations` | `tournament_match_operations_submitted_by_fkey` | `submitted_by` | `users` |
| Crítica para flujos QA | `tournament_match_operations` | `tournament_match_operations_validated_by_fkey` | `validated_by` | `users` |
| Crítica para flujos QA | `tournament_match_outcomes` | `tournament_match_outcomes_operation_fk` | `organization_id, match_id, match_operation_id` | `tournament_match_operations` |
| Crítica para flujos QA | `tournament_match_outcomes` | `tournament_match_outcomes_resolved_by_fkey` | `resolved_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_match_reschedules` | `tournament_match_reschedules_actor_user_id_fkey` | `actor_user_id` | `users` |
| Probablemente necesaria a corto plazo | `tournament_match_reschedules` | `tournament_match_reschedules_match_fk` | `organization_id, tournament_id, category_id, fixture_version_id, match_id` | `tournament_matches` |
| Probablemente necesaria a corto plazo | `tournament_match_reschedules` | `tournament_match_reschedules_new_court_fk` | `organization_id, new_court_id` | `tournament_courts` |
| Probablemente necesaria a corto plazo | `tournament_match_reschedules` | `tournament_match_reschedules_new_venue_fk` | `organization_id, new_venue_id` | `tournament_venues` |
| Probablemente necesaria a corto plazo | `tournament_match_reschedules` | `tournament_match_reschedules_previous_court_fk` | `organization_id, previous_court_id` | `tournament_courts` |
| Probablemente necesaria a corto plazo | `tournament_match_reschedules` | `tournament_match_reschedules_previous_venue_fk` | `organization_id, previous_venue_id` | `tournament_venues` |
| Probablemente necesaria a corto plazo | `tournament_match_resumptions` | `tournament_match_resumptions_court_fk` | `organization_id, court_id` | `tournament_courts` |
| Probablemente necesaria a corto plazo | `tournament_match_resumptions` | `tournament_match_resumptions_created_by_fkey` | `created_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_match_resumptions` | `tournament_match_resumptions_operation_fk` | `organization_id, match_operation_id` | `tournament_match_operations` |
| Probablemente necesaria a corto plazo | `tournament_match_resumptions` | `tournament_match_resumptions_venue_fk` | `organization_id, venue_id` | `tournament_venues` |
| Crítica para flujos QA | `tournament_match_reviews` | `tournament_match_reviews_operation_fk` | `organization_id, match_operation_id` | `tournament_match_operations` |
| Crítica para flujos QA | `tournament_match_reviews` | `tournament_match_reviews_requested_by_fkey` | `requested_by` | `users` |
| Crítica para flujos QA | `tournament_match_reviews` | `tournament_match_reviews_resolved_by_fkey` | `resolved_by` | `users` |
| Crítica para flujos QA | `tournament_match_scores` | `tournament_match_scores_operation_fk` | `organization_id, match_id, match_operation_id` | `tournament_match_operations` |
| Probablemente necesaria a corto plazo | `tournament_match_sources` | `tournament_match_sources_group_fk` | `group_id` | `tournament_groups` |
| Probablemente necesaria a corto plazo | `tournament_match_sources` | `tournament_match_sources_match_fk` | `organization_id, tournament_id, category_id, fixture_version_id, match_id` | `tournament_matches` |
| Probablemente necesaria a corto plazo | `tournament_match_sources` | `tournament_match_sources_participant_fk` | `participant_id` | `tournament_competition_participants` |
| Probablemente necesaria a corto plazo | `tournament_match_sources` | `tournament_match_sources_phase_fk` | `organization_id, tournament_id, category_id, fixture_version_id, source_phase_id` | `tournament_phases` |
| Probablemente necesaria a corto plazo | `tournament_match_sources` | `tournament_match_sources_source_match_fk` | `organization_id, tournament_id, category_id, fixture_version_id, source_match_id` | `tournament_matches` |
| Probablemente necesaria a corto plazo | `tournament_match_squad_players` | `tournament_match_squad_players_roster_player_fk` | `organization_id, team_entry_id, roster_player_id` | `tournament_roster_players` |
| Probablemente necesaria a corto plazo | `tournament_match_squad_players` | `tournament_match_squad_players_squad_fk` | `organization_id, match_id, team_entry_id, match_squad_id` | `tournament_match_squads` |
| Probablemente necesaria a corto plazo | `tournament_match_squads` | `tournament_match_squads_created_by_fkey` | `created_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_match_squads` | `tournament_match_squads_entry_fk` | `organization_id, team_entry_id` | `tournament_team_entries` |
| Probablemente necesaria a corto plazo | `tournament_match_squads` | `tournament_match_squads_locked_by_fkey` | `locked_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_match_squads` | `tournament_match_squads_roster_fk` | `organization_id, team_entry_id, roster_id` | `tournament_rosters` |
| Probablemente necesaria a corto plazo | `tournament_match_squads` | `tournament_match_squads_submitted_by_fkey` | `submitted_by` | `users` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_away_participant_fk` | `organization_id, tournament_id, category_id, participant_set_id, away_participant_id` | `tournament_competition_participants` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_court_fk` | `organization_id, court_id` | `tournament_courts` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_created_by_fkey` | `created_by` | `users` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_group_fk` | `organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id` | `tournament_groups` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_home_participant_fk` | `organization_id, tournament_id, category_id, participant_set_id, home_participant_id` | `tournament_competition_participants` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_participant_set_fk` | `organization_id, tournament_id, category_id, participant_set_id` | `tournament_participant_sets` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_phase_fk` | `organization_id, tournament_id, category_id, fixture_version_id, phase_id` | `tournament_phases` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_round_fk` | `organization_id, tournament_id, category_id, fixture_version_id, round_id` | `tournament_rounds` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_tournament_fk` | `organization_id, tournament_id, season_id` | `tournaments` |
| Crítica para flujos QA | `tournament_matches` | `tournament_matches_venue_fk` | `organization_id, venue_id` | `tournament_venues` |
| Probablemente necesaria a corto plazo | `tournament_media_assets` | `tournament_media_assets_approved_by_fkey` | `approved_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_media_assets` | `tournament_media_assets_gallery_fk` | `organization_id, tournament_id, gallery_id` | `tournament_media_galleries` |
| Probablemente necesaria a corto plazo | `tournament_media_assets` | `tournament_media_assets_uploaded_by_fkey` | `uploaded_by` | `users` |
| Sin evidencia de necesidad actual | `tournament_media_assignments` | `tournament_media_assignments_assigned_by_fkey` | `assigned_by` | `users` |
| Sin evidencia de necesidad actual | `tournament_media_assignments` | `tournament_media_assignments_gallery_fk` | `organization_id, tournament_id, gallery_id` | `tournament_media_galleries` |
| Sin evidencia de necesidad actual | `tournament_media_consent_events` | `tournament_media_consent_events_actor_user_id_fkey` | `actor_user_id` | `users` |
| Sin evidencia de necesidad actual | `tournament_media_consent_events` | `tournament_media_consent_events_asset_id_fkey` | `asset_id` | `tournament_media_assets` |
| Sin evidencia de necesidad actual | `tournament_media_consent_events` | `tournament_media_consent_events_roster_player_id_fkey` | `roster_player_id` | `tournament_roster_players` |
| Sin evidencia de necesidad actual | `tournament_media_consent_events` | `tournament_media_consent_events_subject_user_id_fkey` | `subject_user_id` | `users` |
| Sin evidencia de necesidad actual | `tournament_media_consents` | `tournament_media_consents_managed_by_fkey` | `managed_by` | `users` |
| Sin evidencia de necesidad actual | `tournament_media_consents` | `tournament_media_consents_roster_player_id_fkey` | `roster_player_id` | `tournament_roster_players` |
| Sin evidencia de necesidad actual | `tournament_media_consents` | `tournament_media_consents_subject_user_id_fkey` | `subject_user_id` | `users` |
| Probablemente necesaria a corto plazo | `tournament_media_galleries` | `tournament_media_galleries_category_id_fkey` | `category_id` | `tournament_categories` |
| Probablemente necesaria a corto plazo | `tournament_media_galleries` | `tournament_media_galleries_cover_fk` | `cover_asset_id` | `tournament_media_assets` |
| Probablemente necesaria a corto plazo | `tournament_media_galleries` | `tournament_media_galleries_created_by_fkey` | `created_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_media_galleries` | `tournament_media_galleries_published_by_fkey` | `published_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_media_galleries` | `tournament_media_galleries_round_id_fkey` | `round_id` | `tournament_rounds` |
| Probablemente necesaria a corto plazo | `tournament_media_galleries` | `tournament_media_galleries_season_id_fkey` | `season_id` | `tournament_seasons` |
| Probablemente necesaria a corto plazo | `tournament_media_galleries` | `tournament_media_galleries_tournament_fk` | `organization_id, tournament_id, season_id` | `tournaments` |
| Probablemente necesaria a corto plazo | `tournament_media_gallery_items` | `tournament_media_gallery_items_added_by_fkey` | `added_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_media_gallery_items` | `tournament_media_gallery_items_gallery_fk` | `organization_id, tournament_id, gallery_id` | `tournament_media_galleries` |
| Sin evidencia de necesidad actual | `tournament_media_moderation_actions` | `tournament_media_moderation_actions_actor_user_id_fkey` | `actor_user_id` | `users` |
| Sin evidencia de necesidad actual | `tournament_media_moderation_actions` | `tournament_media_moderation_actions_asset_fk` | `gallery_id, asset_id` | `tournament_media_assets` |
| Sin evidencia de necesidad actual | `tournament_media_relations` | `tournament_media_relations_created_by_fkey` | `created_by` | `users` |
| Sin evidencia de necesidad actual | `tournament_media_relations` | `tournament_media_relations_match_id_fkey` | `match_id` | `tournament_matches` |
| Sin evidencia de necesidad actual | `tournament_media_relations` | `tournament_media_relations_roster_player_id_fkey` | `roster_player_id` | `tournament_roster_players` |
| Sin evidencia de necesidad actual | `tournament_media_relations` | `tournament_media_relations_team_entry_id_fkey` | `team_entry_id` | `tournament_team_entries` |
| Sin evidencia de necesidad actual | `tournament_media_reports` | `tournament_media_reports_asset_fk` | `gallery_id, asset_id` | `tournament_media_assets` |
| Sin evidencia de necesidad actual | `tournament_media_reports` | `tournament_media_reports_handled_by_fkey` | `handled_by` | `users` |
| Sin evidencia de necesidad actual | `tournament_media_upload_sessions` | `tournament_media_upload_sessions_asset_id_fkey` | `asset_id` | `tournament_media_assets` |
| Sin evidencia de necesidad actual | `tournament_media_upload_sessions` | `tournament_media_upload_sessions_gallery_fk` | `organization_id, tournament_id, gallery_id` | `tournament_media_galleries` |
| Probablemente necesaria a corto plazo | `tournament_notification_preferences` | `tournament_notification_preferences_tournament_fk` | `organization_id, tournament_id` | `tournaments` |
| Crítica para flujos QA | `tournament_organization_members` | `tournament_organization_members_invited_by_fkey` | `invited_by` | `users` |
| Crítica para flujos QA | `tournament_participant_sets` | `tournament_participant_sets_frozen_by_fkey` | `frozen_by` | `users` |
| Crítica para flujos QA | `tournament_participant_sets` | `tournament_participant_sets_reopened_by_fkey` | `reopened_by` | `users` |
| Crítica para flujos QA | `tournament_participant_sets` | `tournament_participant_sets_tournament_fk` | `organization_id, tournament_id, season_id` | `tournaments` |
| Crítica para flujos QA | `tournament_player_statistics` | `tournament_player_statistics_entry_fk` | `organization_id, tournament_id, team_entry_id` | `tournament_team_entries` |
| Crítica para flujos QA | `tournament_player_statistics` | `tournament_player_statistics_player_fk` | `organization_id, team_entry_id, roster_player_id` | `tournament_roster_players` |
| Crítica para flujos QA | `tournament_player_statistics` | `tournament_player_statistics_revision_fk` | `organization_id, revision_id` | `tournament_standings_revisions` |
| Crítica para flujos QA | `tournament_player_suspensions` | `tournament_player_suspensions_event_fk` | `source_event_id` | `tournament_match_events` |
| Crítica para flujos QA | `tournament_player_suspensions` | `tournament_player_suspensions_match_fk` | `organization_id, source_match_id` | `tournament_matches` |
| Crítica para flujos QA | `tournament_player_suspensions` | `tournament_player_suspensions_player_fk` | `organization_id, team_entry_id, roster_player_id` | `tournament_roster_players` |
| Crítica para flujos QA | `tournament_player_suspensions` | `tournament_player_suspensions_revision_fk` | `organization_id, revision_id` | `tournament_standings_revisions` |
| Probablemente necesaria a corto plazo | `tournament_points_adjustments` | `tournament_points_adjustments_actor_user_id_fkey` | `actor_user_id` | `users` |
| Probablemente necesaria a corto plazo | `tournament_points_adjustments` | `tournament_points_adjustments_group_fk` | `organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id` | `tournament_groups` |
| Probablemente necesaria a corto plazo | `tournament_points_adjustments` | `tournament_points_adjustments_participant_fk` | `organization_id, tournament_id, category_id, participant_set_id, participant_id` | `tournament_competition_participants` |
| Probablemente necesaria a corto plazo | `tournament_points_adjustments` | `tournament_points_adjustments_phase_fk` | `organization_id, tournament_id, category_id, fixture_version_id, phase_id` | `tournament_phases` |
| Crítica para flujos QA | `tournament_projection_sources` | `tournament_projection_sources_operation_fk` | `organization_id, match_id, match_operation_id` | `tournament_match_operations` |
| Crítica para flujos QA | `tournament_projection_sources` | `tournament_projection_sources_revision_fk` | `organization_id, revision_id` | `tournament_standings_revisions` |
| Crítica para flujos QA | `tournament_provisional_players` | `tournament_provisional_players_created_by_fkey` | `created_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_qualification_resolutions` | `tournament_qualification_resolutions_match_fk` | `organization_id, tournament_id, category_id, fixture_version_id, target_match_id` | `tournament_matches` |
| Probablemente necesaria a corto plazo | `tournament_qualification_resolutions` | `tournament_qualification_resolutions_participant_fk` | `participant_id` | `tournament_competition_participants` |
| Probablemente necesaria a corto plazo | `tournament_qualification_resolutions` | `tournament_qualification_resolutions_resolved_by_fkey` | `resolved_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_qualification_resolutions` | `tournament_qualification_resolutions_revision_fk` | `organization_id, standings_revision_id` | `tournament_standings_revisions` |
| Crítica para flujos QA | `tournament_roster_players` | `tournament_roster_players_added_by_fkey` | `added_by` | `users` |
| Crítica para flujos QA | `tournament_roster_players` | `tournament_roster_players_provisional_fk` | `organization_id, provisional_player_id` | `tournament_provisional_players` |
| Crítica para flujos QA | `tournament_roster_players` | `tournament_roster_players_roster_fk` | `organization_id, team_entry_id, roster_id` | `tournament_rosters` |
| Probablemente necesaria a corto plazo | `tournament_roster_settings` | `tournament_roster_settings_tournament_fk` | `organization_id, tournament_id` | `tournaments` |
| Crítica para flujos QA | `tournament_rosters` | `tournament_rosters_created_by_fkey` | `created_by` | `users` |
| Crítica para flujos QA | `tournament_rounds` | `tournament_rounds_group_fk` | `organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id` | `tournament_groups` |
| Crítica para flujos QA | `tournament_rounds` | `tournament_rounds_phase_fk` | `organization_id, tournament_id, category_id, fixture_version_id, phase_id` | `tournament_phases` |
| Probablemente necesaria a corto plazo | `tournament_schedule_windows` | `tournament_schedule_windows_category_fk` | `organization_id, tournament_id, category_id` | `tournament_categories` |
| Probablemente necesaria a corto plazo | `tournament_schedule_windows` | `tournament_schedule_windows_court_fk` | `organization_id, court_id` | `tournament_courts` |
| Probablemente necesaria a corto plazo | `tournament_schedule_windows` | `tournament_schedule_windows_venue_fk` | `organization_id, venue_id` | `tournament_venues` |
| Probablemente necesaria a corto plazo | `tournament_scoring_rules` | `tournament_scoring_rules_tournament_fk` | `organization_id, tournament_id` | `tournaments` |
| Crítica para flujos QA | `tournament_seasons` | `tournament_seasons_created_by_fkey` | `created_by` | `users` |
| Crítica para flujos QA | `tournament_standings_revisions` | `tournament_standings_revisions_calculated_by_fkey` | `calculated_by` | `users` |
| Crítica para flujos QA | `tournament_standings_revisions` | `tournament_standings_revisions_discarded_by_fkey` | `discarded_by` | `users` |
| Crítica para flujos QA | `tournament_standings_revisions` | `tournament_standings_revisions_group_fk` | `organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id` | `tournament_groups` |
| Crítica para flujos QA | `tournament_standings_revisions` | `tournament_standings_revisions_phase_fk` | `organization_id, tournament_id, category_id, fixture_version_id, phase_id` | `tournament_phases` |
| Crítica para flujos QA | `tournament_standings_revisions` | `tournament_standings_revisions_published_by_fkey` | `published_by` | `users` |
| Crítica para flujos QA | `tournament_standings_revisions` | `tournament_standings_revisions_tournament_fk` | `organization_id, tournament_id, season_id` | `tournaments` |
| Crítica para flujos QA | `tournament_suspension_served_matches` | `tournament_suspension_served_matches_marked_by_fkey` | `marked_by` | `users` |
| Crítica para flujos QA | `tournament_suspension_served_matches` | `tournament_suspension_served_matches_match_fk` | `organization_id, match_id` | `tournament_matches` |
| Crítica para flujos QA | `tournament_team_entries` | `tournament_team_entries_arma2_team_id_fkey` | `arma2_team_id` | `teams` |
| Crítica para flujos QA | `tournament_team_entries` | `tournament_team_entries_category_fk` | `organization_id, tournament_id, category_id` | `tournament_categories` |
| Crítica para flujos QA | `tournament_team_entries` | `tournament_team_entries_created_by_fkey` | `created_by` | `users` |
| Crítica para flujos QA | `tournament_team_entries` | `tournament_team_entries_reviewed_by_fkey` | `reviewed_by` | `users` |
| Crítica para flujos QA | `tournament_team_entries` | `tournament_team_entries_submitted_by_fkey` | `submitted_by` | `users` |
| Crítica para flujos QA | `tournament_team_entries` | `tournament_team_entries_tournament_fk` | `organization_id, tournament_id, season_id` | `tournaments` |
| Probablemente necesaria a corto plazo | `tournament_team_invitations` | `tournament_team_invitations_created_by_fkey` | `created_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_team_invitations` | `tournament_team_invitations_entry_fk` | `organization_id, tournament_id, team_entry_id` | `tournament_team_entries` |
| Probablemente necesaria a corto plazo | `tournament_team_invitations` | `tournament_team_invitations_manager_fk` | `organization_id, team_entry_id, manager_id` | `tournament_team_managers` |
| Probablemente necesaria a corto plazo | `tournament_team_invitations` | `tournament_team_invitations_tournament_fk` | `organization_id, tournament_id` | `tournaments` |
| Crítica para flujos QA | `tournament_team_managers` | `tournament_team_managers_invited_by_fkey` | `invited_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_team_reviews` | `tournament_team_reviews_created_by_fkey` | `created_by` | `users` |
| Probablemente necesaria a corto plazo | `tournament_team_reviews` | `tournament_team_reviews_entry_fk` | `organization_id, team_entry_id` | `tournament_team_entries` |
| Probablemente necesaria a corto plazo | `tournament_team_reviews` | `tournament_team_reviews_roster_fk` | `organization_id, team_entry_id, roster_id` | `tournament_rosters` |
| Crítica para flujos QA | `tournament_team_standings` | `tournament_team_standings_entry_fk` | `organization_id, tournament_id, team_entry_id` | `tournament_team_entries` |
| Crítica para flujos QA | `tournament_team_standings` | `tournament_team_standings_participant_fk` | `participant_id` | `tournament_competition_participants` |
| Crítica para flujos QA | `tournament_team_standings` | `tournament_team_standings_revision_fk` | `organization_id, revision_id` | `tournament_standings_revisions` |
| Crítica para flujos QA | `tournament_team_statistics` | `tournament_team_statistics_participant_fk` | `participant_id` | `tournament_competition_participants` |
| Crítica para flujos QA | `tournament_team_statistics` | `tournament_team_statistics_revision_fk` | `organization_id, revision_id` | `tournament_standings_revisions` |
| Probablemente necesaria a corto plazo | `tournament_tiebreak_rules` | `tournament_tiebreak_rules_tournament_fk` | `organization_id, tournament_id` | `tournaments` |
| Crítica para flujos QA | `user_tournament_context_preferences` | `user_tournament_context_preferences_organization_id_fkey` | `organization_id` | `tournament_organizations` |
| Crítica para flujos QA | `user_tournament_context_preferences` | `user_tournament_context_season_fk` | `organization_id, active_season_id` | `tournament_seasons` |
| Crítica para flujos QA | `user_tournament_context_preferences` | `user_tournament_context_tournament_fk` | `organization_id, active_tournament_id, active_season_id` | `tournaments` |

## Deriva fuera del inventario de 197

- `tournaments.tournaments_competition_format_fkey` (`competition_format` → `tournament_competition_formats`): crítica para el flujo QA, pero no formaba parte del conjunto reportado de 197.
- `tournaments.tournaments_created_by_fkey` (`created_by` → `users`): crítica para el flujo QA, pero no formaba parte del conjunto reportado de 197.
- `tournaments.tournaments_sport_modality_fkey` (`sport_modality` → `tournament_sport_modalities`): crítica para el flujo QA, pero no formaba parte del conjunto reportado de 197.

## Recomendación

No crear índices por conteo. Antes de una etapa específica de performance: capturar `EXPLAIN (ANALYZE, BUFFERS)` de fixture, partido, standings, roster y cleanup; priorizar las FKs críticas que participan en DELETE/UPDATE de padres o joins de las RPCs; estimar costo de escritura; y crear índices de a uno con pruebas de regresión.
