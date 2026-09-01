# Matriz de compatibilidad de objetos Arma2

Generado: 2026-07-27.

La clasificación es conservadora: “no aparece como llamada directa” no equivale a “se puede borrar”. Todo objeto incierto se retiene hasta contar con evidencia ejecutable de desuso.

## Resumen

- Relaciones públicas: **136**.
- Funciones públicas (nombres únicos): **456**.
- RPCs estáticas observadas: **213**.
- Funciones conectadas a triggers: **65**.
- Jobs canónicos: **8**.
- Buckets activos: **2**.

## Excepciones deliberadas

| Objeto | Clasificación | Decisión |
| --- | --- | --- |
| `public.exec_sql` | legacy inseguro | No se crea. Sólo aparece en scripts de reparación/build; exponer SQL arbitrario contradice privilegio mínimo. |
| `public.compute_awards_for_match` | compatibilidad opcional | No se crea. El cliente trata explícitamente su ausencia como opcional y ejecuta el cálculo/persistencia canónicos. |
| `tournament-media` (bucket) | futuro apagado | No se crea; Multimedia Upload permanece fail-closed. Se conservan metadata/RPCs y policies de preparación. |
| Estudio Social | no iniciado | No se agregan objetos ni permisos. |

## Relaciones

| Objeto | Tipo | Clasificación | Evidencia/decisión |
| --- | --- | --- | --- |
| `public.amigos` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.auto_match_proposal_events` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.auto_match_proposal_members` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.auto_match_proposals` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.challenge_result_reports` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.challenge_team_squad` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.challenges` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.cleared_matches` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.device_tokens` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.guest_join_attempt_log` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.guest_match_invites` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.invites` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.jugadores` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.lesiones` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.match_join_requests` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.match_payment_settings` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.match_player_payments` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.mensajes_partido` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.no_show_recovery_state` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.notification_delivery_log` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.notifications` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.notifications_ext` | `vista` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.partido_team_confirmations` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.partidos` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.partidos_abiertos_operativos` | `vista` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.partidos_abiertos_operativos_v2` | `vista` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.partidos_frecuentes` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.partidos_jugadores` | `vista` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.partidos_manuales` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.partidos_view` | `vista` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.player_absences` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.player_availability` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.player_awards` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.post_match_surveys` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.private_friend_group_members` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.private_friend_groups` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.profiles` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.public_voters` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.push_queue_event_summary` | `vista` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.push_queue_processing_health` | `vista` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.push_queue_status_summary` | `vista` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.push_sender_scheduler_health` | `vista` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.push_sender_scheduler_runs` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.push_sender_scheduler_state` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.rating_adjustments` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.survey_progress` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.survey_results` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.team_chat_messages` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.team_invitations` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.team_matches` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.team_members` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.teams` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.tournament_announcement_audiences` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_announcement_deliveries` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_announcement_links` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_announcements` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_audit_log` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_categories` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_competition_formats` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_competition_participants` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_courts` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_disciplinary_overrides` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_discipline_ledgers` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_discipline_rules` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_document_acknowledgements` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_document_versions` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_documents` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_draw_pot_members` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_draw_pots` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_fixture_versions` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_group_members` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_groups` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_availability_responses` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_events` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_operation_players` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_operations` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_outcomes` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_reschedules` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_resumptions` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_reviews` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_scores` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_sources` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_squad_players` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_match_squads` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_matches` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_assets` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_assignments` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_consent_events` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_consents` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_galleries` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_gallery_items` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_moderation_actions` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_relations` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_reports` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_upload_sessions` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_media_variants` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_notification_preferences` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_organization_members` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.tournament_organizations` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_participant_hub_preferences` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_participant_sets` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_phases` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_player_statistics` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_player_suspensions` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_points_adjustments` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_projection_sources` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_provisional_players` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_qualification_resolutions` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_qualification_slots` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_roster_players` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_roster_settings` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_rosters` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_rounds` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_schedule_windows` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_scoring_rules` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_seasons` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_sport_modalities` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_standings_revisions` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_suspension_served_matches` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_team_entries` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_team_invitations` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_team_managers` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_team_reviews` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_team_standings` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_team_statistics` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_tiebreak_rules` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournament_venues` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.tournaments` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.user_onboarding_state` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.user_tournament_context_preferences` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.user_workspace_preferences` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.usuarios` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.voting_photo_slot_claims` | `tabla` | `compatibilidad necesaria / indirecta` | `Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.` |
| `public.voting_photo_upload_tokens` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.votos` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |
| `public.votos_publicos` | `tabla` | `usado` | `Lectura o escritura estática detectada en cliente/Edge Function.` |

## Funciones y RPCs

| Objeto | Tipo | Clasificación | Evidencia/decisión |
| --- | --- | --- | --- |
| `public._clamp_player_rating` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public._derive_no_show_streak` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public._match_no_show_eligible` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public._no_show_confirmed_absent_player_ids` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public._normalize_award_type` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public._notify_goalkeepers_for_match` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.accept_invite_for_user` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.accept_tournament_team_invitation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.acknowledge_tournament_document` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.add_tournament_match_event` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.add_tournament_roster_player` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.admin_close_payments` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.admin_remind_pending_payments` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.admin_set_payment_status` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.admin_update_payment_settings` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.append_tournament_audit` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.apply_challenge_squad_defaults` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.apply_team_roster_defaults` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.approve_join_request` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.approve_tournament_team_entry` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.archive_tournament_announcement` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.archive_tournament_document` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.archive_tournament_fixture` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.archive_tournament_team_entry` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.assert_tournament_fixture_scope` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.assign_substitute_slot` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.assign_tournament_media_photographer` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_account_is_eligible` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_availabilities_are_compatible` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_availability_fits_proposal` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_availability_has_free_slot` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_availability_is_eligible` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_distance_km` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_duration` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_final_roster_capacity` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_has_valid_coordinates` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_invitation_capacity` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_invite_deadline` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_max_substitutes` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_member_has_free_slot` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_member_snapshot_fits_proposal` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_member_snapshot_is_valid_for_proposal` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_member_snapshots_are_compatible` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_min_candidates` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_notify_promotion` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.auto_match_play_range` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_required_players` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_scheduled_sweep` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_slot_bucket_range` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_snapshots_are_compatible` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_threshold` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_user_in_proposal` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_user_real_match_conflict` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_match_window_has_free_slot` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.auto_schedule_tournament_matches` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.availability_days_mask` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.backfill_auto_match_proposal_members` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.bind_voting_photo_slot` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.build_tournament_knockout` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.build_tournament_round_robin` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.bulk_schedule_tournament_matches` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_access_tournament_communications` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_current_user_access_tournament_announcement` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_current_user_read_media_gallery` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_edit_tournament_team_entry` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_manage_tournament_match_squad` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_read_tournament_fixture_scope` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_read_tournament_match` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_read_tournament_match_operation` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_read_tournament_participant_hub` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_read_tournament_projection_scope` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.can_read_tournament_team_entry` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.cancel_my_availability` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.cancel_own_match_join_request` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.cancel_partido_with_notification` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.cancel_tournament_match` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.cancel_tournament_media_upload_session` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.capture_auto_match_member_snapshot` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.challenge_user_is_owner_or_captain` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.change_tournament_media_gallery_state` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.change_tournament_status` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.check_survey_completion` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.check_survey_completion_from_post_match_surveys` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.check_survey_timeouts` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.claim_auto_match_organizer` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.claim_push_delivery_batch` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.claim_targeted_push_delivery_batch` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.clamp_usuario_player_rating` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.cleanup_invalid_device_tokens` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.cleanup_voting_access_state` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.collect_notification_refs_from_team_payload` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.complete_tournament_media_upload` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.consume_guest_match_invite` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.coordinates_are_valid` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.create_friend_request_notification_from_amigos` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.create_guest_match_invite` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_invite` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.create_manual_fixture_version` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_my_auto_match_proposal` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_notification` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_push_test_notification` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_announcement_draft` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_court` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_disciplinary_override` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_document` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_document_version` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.create_tournament_match_correction` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_media_gallery` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_organization` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_points_adjustment` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_provisional_player` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_season` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_team_entry` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_venue` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.create_tournament_with_defaults` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.current_user_has_media_team_relation` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.deactivate_device_token` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.debug_quiero_jugar_match_audit` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.debug_quiero_jugar_match_audit_v2` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.delete_my_notifications` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.digest` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.enforce_auto_match_member_eligibility` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.enforce_challenge_team_squad_limits` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.enforce_team_format_roster_compatibility` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.enforce_team_member_permissions` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.enforce_team_member_roster_limit` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.enforce_voting_open_before_vote_insert` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.enqueue_auto_match_notification` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.enqueue_match_participant_notification` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.enqueue_partido_notification` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.enqueue_remote_push_from_notification` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.ensure_match_payments` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.execute_tournament_group_draw` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.expire_stale_auto_match_invites` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.expire_stale_auto_match_proposals` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.expire_stale_directed_challenges` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.fanout_survey_start_notifications` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.finalize_auto_match_proposal` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.finalize_match_survey_closure` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.finalize_push_delivery_attempt` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.find_my_availability_matches` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.freeze_tournament_participants` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.gen_random_bytes` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.gen_random_uuid` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.generate_tournament_fixture` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_auto_match_proposal_members` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_invite_landing` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_managed_tournament_matches` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_match_invite_states` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.get_match_post_match_gate` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.get_match_squad_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_my_auto_match_proposals` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_my_current_tournament_roster_players` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.get_my_managed_match_squad_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_my_tournament_memberships` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_my_tournament_notification_preferences` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_open_matches_for_quiero_jugar` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.get_open_matches_for_quiero_jugar_v2` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.get_partido_by_invite` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_player_tournament_matches` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_player_tournament_statistics` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_player_tournament_suspensions` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_published_tournament_documents` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_published_tournament_matches` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_published_tournament_media` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_published_tournament_standings` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_published_tournament_statistics` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_published_tournament_teams` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_survey_scheduler_health` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_team_registration_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_announcement` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_communications_admin_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_communications_inbox` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_competition_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_fixture_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_match_operation_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_match_operations_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_media_admin_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_participant_hub` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_participant_match` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_schedule_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_standings_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_statistics_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_teams_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.get_tournament_workspace_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.handle_tournament_media_report` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.has_tournament_communications_capability` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.has_tournament_media_assignment` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.has_tournament_media_capability` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.has_tournament_organization_capability` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.haversine_km` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.inc_numeric` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.increment_matches_abandoned` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.increment_matches_played` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.insert_tournament_match_source` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.invite_auto_match_substitutes` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.invite_tournament_team_manager` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.is_pending_challenge_team_match_for_post_match` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.is_public_voting_open` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.is_team_match_partido` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.is_tournament_organization_member` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.is_tournament_organization_slug_available` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.is_tournament_team_manager` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.is_valid_tournament_format_settings` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.join_guest_match_with_invite` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.leave_owned_match_with_transfer` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.lock_match_history_snapshots` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.lock_tournament_roster` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.make_tournament_match_official` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.manage_tournament_media_consent` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.mark_match_assumed_not_played` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.mark_tournament_announcement_read` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.mark_tournament_suspension_served` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.match_update_push_decision` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.normalize_notification_identity_ref` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.normalize_partido_estado` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.normalize_posicion_token` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.normalize_push_platform` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.normalize_push_provider` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.normalize_request_scoped_notification_keys` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.normalize_tournament_competition_slug` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.normalize_tournament_organization_slug` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.normalize_tournament_person_name` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.notification_channel_allows_push` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.notification_event_channel` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.notification_is_retention_exempt` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.notification_push_dedupe_key` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.notification_resolve_partido_id` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.notify_admin_join_request` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.notify_available_goalkeepers` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.open_tournament_match_operation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.partido_is_operationally_open` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.partido_kickoff_at` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.payments_is_match_admin` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.payments_is_match_member` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.postpone_tournament_match` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.prepare_challenge_team_squad` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.prepare_pending_challenge_partido_for_post_match` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.prevent_auto_match_member_snapshot_update` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.prevent_challenge_post_match_survey_rows` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.prevent_challenge_survey_awards_rows` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.prevent_challenge_survey_notifications` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.prevent_challenge_survey_results_rows` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.preview_tournament_announcement_audience` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.private_friend_group_is_active_owner` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.private_friend_group_is_owner` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.private_friend_group_users_are_friends` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.process_auto_match_member_exit` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.process_challenge_result_survey_notifications_backend` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.process_match_no_show_ranking` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.process_match_reminder_notifications_backend` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.process_survey_reminder_notifications_backend` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.process_survey_start_notifications_backend` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.promote_substitute_after_player_leave` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.protect_published_tournament_communication` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.protect_published_tournament_document_version` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.protect_tournament_competition_scope` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.protect_tournament_match_child_history` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.protect_tournament_match_operation_history` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.protect_tournament_match_planning_transition` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.protect_tournament_match_squad_players` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.protect_tournament_organization_owner` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.protect_tournament_registration_scope` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.prune_ineligible_auto_match_members` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.public_get_or_create_voter` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.public_has_voter_already_voted` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.public_mark_voter_completed` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.public_normalize_voter_name` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.public_submit_no_lo_conozco` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.public_submit_player_rating` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.publish_tournament_announcement` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.publish_tournament_document_version` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.publish_tournament_fixture` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.publish_tournament_media_gallery` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.publish_tournament_standings_revision` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.purge_old_notification_delivery_logs` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.purge_old_notifications` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.raise_tournament_match_error` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.rank_tournament_standings` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.ready_tournament_match` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.rebuild_tournament_discipline` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.rebuild_tournament_standings` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.reconcile_auto_match_proposal_members` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.record_manual_match_availability` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.refresh_device_token` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.register_device_token` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.reject_suspended_tournament_operation_player` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.reject_suspended_tournament_squad_player` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.reject_suspended_tournament_squad_submission` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.reject_tournament_audit_mutation` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.reject_tournament_match_child_delete` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.reject_tournament_projection_mutation` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.reject_tournament_team_entry` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.remove_tournament_roster_player` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.reopen_auto_match_vacancies` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.reopen_own_match_join_request` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.reopen_tournament_participants` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.reorder_tournament_media_item` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.replace_tournament_announcement_audience` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.report_my_payment` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.report_tournament_media_asset` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.request_tournament_match_correction` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.request_tournament_media_upload_session` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.reschedule_tournament_match` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.reset_votacion` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.resolve_auto_match_full_cupo` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_challenge_post_match_gate` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_challenge_squad_limits` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_match_by_code` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.resolve_partido_notification_recipients_from_refs` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_partido_starter_slots` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_partido_survey_notification_recipients` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_post_match_required_players` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_survey_notification_match_name` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_team_roster_limit` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_tournament_announcement_recipients` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.resolve_tournament_qualification` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.respond_match_availability` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.respond_to_auto_match_proposal` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.respond_to_auto_match_substitute` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.restore_tournament_match_unscheduled` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.review_tournament_match_operation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.review_tournament_team_entry` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.revoke_tournament_announcement` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.revoke_tournament_points_adjustment` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.revoke_tournament_team_invitation` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.rpc_accept_challenge` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_accept_team_invitation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_can_manage_team_match` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_cancel_team_match` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_complete_challenge` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_confirm_challenge` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_create_directed_challenge` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_get_challenge_head_to_head_stats` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_get_team_challenge_rankings` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_list_incoming_team_invitations` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_list_team_match_members` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_reject_directed_challenge` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_reject_team_invitation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_report_challenge_result` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_resolve_challenge_result` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_revoke_team_invitation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_search_challengeable_teams` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_send_team_invitation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_set_challenge_availability` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_set_challenge_squad_status` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_team_history_by_rival` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_transfer_team_captaincy` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_update_team_match_details` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_update_team_member_shirt_number` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.rpc_upsert_challenge_team_selection` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.run_notifications_retention_cleanup` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.run_push_sender_scheduler_tick` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.save_match_final_teams` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.save_match_squad` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.save_tournament_category` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.save_tournament_draw_pots` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.save_tournament_match_operation_draft` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.save_tournament_schedule_windows` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.schedule_tournament_match` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.schedule_tournament_match_resumption` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.search_tournament_arma2_teams` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.search_tournament_players` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.send_auto_match_proposal_chat_message` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.send_call_to_vote` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.send_match_chat_message` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.send_match_invite` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.send_match_kicked_notification` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.send_team_chat_message` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.send_team_match_chat_message` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.set_active_tournament_context` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.set_challenge_team_squad_updated_at` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.set_my_tournament_hub_category` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.set_notification_presence` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.set_private_friend_group_updated_at` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.set_teams_module_updated_at` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.set_tournament_announcement_audience` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.set_tournament_announcement_link` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.set_tournament_match_outcome` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.set_tournament_match_score` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.set_tournament_media_cover` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.set_tournament_workspace_preference` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.set_user_onboarding_state_updated_at` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.spawn_next_auto_match_cohort` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.submit_match_squad` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.submit_tournament_match_operation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.submit_tournament_team_entry` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.supersede_tournament_fixture` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.sync_active_auto_match_gestations` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.sync_my_auto_match_gestations` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.sync_my_auto_match_location_from_profile` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.sync_team_match_to_partido` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.sync_usuarios_from_auth_users` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.tag_tournament_media_asset` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.team_challenge_confirmed_team_stats` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.team_match_user_is_admin_or_owner` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.team_user_is_admin_or_owner` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.team_user_is_captain_or_owner` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.team_user_is_member` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.team_user_is_owner` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.tg_demote_join_request_on_player_removal` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.tg_match_join_request_role_guard` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.tg_normalize_usuario_posiciones` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.tg_partido_goalkeeper_search_fanout` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.touch_private_friend_group_updated_at_from_members` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.touch_tournament_communications_updated_at` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.touch_tournament_media_updated_at` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.touch_tournament_workspace_updated_at` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.tournament_communications_role_capabilities` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.tournament_match_team_entries` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.tournament_media_asset_has_internal_consent` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.tournament_media_role_capabilities` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.tournament_media_user_can_upload` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.tournament_projection_source_fingerprint` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.tournament_registration_checklist` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.tournament_role_capabilities` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.transfer_match_admin` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.transition_tournament_media_asset` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.trg_reset_survey_window_on_schedule_change` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.trg_sync_team_match_to_partido_bridge` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.update_draft_fixture` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_my_tournament_notification_preferences` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_tournament_announcement_draft` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_tournament_configuration` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_tournament_court` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_tournament_document_draft` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.update_tournament_media_gallery` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_tournament_organization` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_tournament_roster_player` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_tournament_season` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_tournament_team_entry` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.update_tournament_venue` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.upsert_my_availability` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.user_declined_auto_match_slot` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.user_has_overlapping_auto_match` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.validate_challenge_payload` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_guest_match_invite` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.validate_private_friend_group_member` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_team_match_payload` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_tournament_fixture` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.validate_tournament_fixture_member_scope` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_tournament_group_scope` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_tournament_match_operation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.validate_tournament_match_operation_payload` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.validate_tournament_match_operation_source` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_tournament_match_player_scope` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_tournament_match_schedule` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.validate_tournament_match_scope` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_tournament_match_source_scope` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_tournament_match_squad_scope` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.validate_tournament_roster` | `función interna/compat` | `compatibilidad necesaria / indirecta` | `Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.` |
| `public.void_tournament_match_event` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.void_tournament_match_operation` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |
| `public.votos_publicos_sync_target_identity` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.votos_sync_target_identity` | `función trigger` | `compatibilidad necesaria` | `Vinculada a un trigger activo.` |
| `public.withdraw_tournament_team_entry` | `función/RPC` | `usado` | `RPC estática consumida por cliente o Edge Function.` |

## Jobs pg_cron

| Job | Schedule | Comando |
| --- | --- | --- |
| `auto_match_sweep` | `*/5 * * * *` | `select public.auto_match_scheduled_sweep();` |
| `challenge_result_survey_backend_fanout` | `* * * * *` | `select public.process_challenge_result_survey_notifications_backend(200);` |
| `directed_challenge_expiry_scheduler` | `*/10 * * * *` | `select public.expire_stale_directed_challenges();` |
| `match_reminder_1h_scheduler` | `*/5 * * * *` | `select public.process_match_reminder_notifications_backend();` |
| `notifications_retention_cleanup_scheduler` | `17 3 * * *` | `select public.run_notifications_retention_cleanup();` |
| `push_sender_dispatch_scheduler` | `* * * * *` | `select public.run_push_sender_scheduler_tick();` |
| `survey_reminder_backend_scheduler` | `* * * * *` | `select public.process_survey_reminder_notifications_backend(60, 1, 200);` |
| `survey_start_backend_scheduler` | `* * * * *` | `select public.process_survey_start_notifications_backend();` |

## Storage

| Bucket | Público | Estado |
| --- | --- | --- |
| `jugadores-fotos` | `true` | activo y cubierto por golden test |
| `team-crests` | `true` | activo y cubierto por golden test |

## Archivo SQL

- `supabase/migrations/`: fuente ejecutable canónica; contiene sólo baseline + contratos.
- `supabase/migrations_history/`: historial preservado, no ejecutable por Supabase CLI.
- `migrations/`, `migrations/legacy/` y `db/migrations/`: evidencia legacy; no son fuente de verdad.
