# COMPETITION-V1 — reconciliación 43 → 117 (+1 pública)

Generado por [`reconcile.mjs`](reconcile.mjs) desde fuentes primarias (ACL del baseline en la imagen real + gate 0001 +
delta MP-A2; alias del adapter → componente; evidencia de laboratorio de **ambos** gateways). `node reconcile.mjs --check`
verifica todos los invariantes (lo corre `reconcile.test.mjs`). Datos completos: [`RECONCILIATION.json`](RECONCILIATION.json).

## Aritmética

| conjunto | RPC |
|---|---|
| staging v1 (sin cambios) | 43 |
| COMPETITION-V1 ruta autenticada | **74** = A 15 + B 59 |
| total ruta autenticada | 117 |
| ruta pública anónima (C) | 1 |
| lecturas / escrituras (de las 75) | 26 / 49 |
| ADMIN_OWNER / PRIVATE_AUTHENTICATED / PUBLIC_READ_ONLY | 53 / 21 / 1 |
| quitadas de la allowlist por no tener journey | **0** (las 75 tienen un llamador de UI real) |

- **A (15)**: 0001 les quitó EXECUTE a `authenticated`; 0004 lo devuelve. Sin 0004 el gateway las serviría y la DB las negaría.
- **B (59)**: `authenticated` ya tenía EXECUTE en Production desde el baseline (0001 no las tocó). Sólo el gateway las
  bloqueaba, porque su feature estaba OFF en `stagingV1Features`. **Ojo:** un bridge token válido ya podía llamarlas
  directo en Torneos PostgREST (C5 de GATEWAY_AUTH_CERTIFIED). La allowlist no era la frontera de estas 59: lo son el ACL
  de la DB y el guard de cada función. Abrirlas en el gateway no agrega privilegio de DB.
- **C (1)**: `get_public_tournament_page` ya era ejecutable por `anon` desde el baseline. La clave publicable de Torneos
  la entrega `/config` del gateway, así que ya era llamable directo en PostgREST. La ruta pública no agrega privilegio.

Por qué estaban fuera antes: las 74 pertenecen a features que en `main` estaban OFF en `stagingV1Features` (fixtures,
match_operations, standings, lifecycle_actions, participant_withdrawal, communications, notifications, participant_hub,
public_pages). Por qué hacen falta ahora: son exactamente las que llaman las pantallas de esas features (columna
"pantalla"). Ninguna RPC de la allowlist queda sin llamador.

Columnas: **+** = ejercida con 200 por un actor legítimo en el journey B del lab (gateway Node y Edge). **−** = filas de la
matriz negativa (otro workspace, membresía removida, admin de otra temporada, collaborator escribiendo, jugador/capitán
en RPC de staff, aislamiento de RPC self-scoped) con su resultado. Además, las 74 sin bearer → 401 (C3); las 15 de A
directas en PostgREST como anon → negadas por ACL (C4).

## A — 15 RPC que necesitan el GRANT de 0004

| # | RPC | feature | pantalla / journey | rol | EXECUTE antes de 0004 (auth) | guard | + | − |
|---|---|---|---|---|---|---|---|---|
| 1 | `reopen_tournament_participants` | fixtures | FixtureWorkspacePage.jsx (actions.reopen) | owner/admin | no (cerrada por 0001) | participants.reopen + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 2 | `save_tournament_draw_pots` | fixtures | FixtureWorkspacePage.jsx (actions.savePots) | owner/admin | no (cerrada por 0001) | draw.manage + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 3 | `update_draft_fixture` | fixtures | FixtureWorkspacePage.jsx (actions.updateDraft) | owner/admin | no (cerrada por 0001) | fixture.update_draft | rounds.manage | matches.create (+ season access, COMPETITION-V1 fix) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 4 | `publish_tournament_fixture` | fixtures | FixtureWorkspacePage.jsx (actions.publish) | owner/admin | no (cerrada por 0001) | fixture.publish (fixture.supersede when replacing) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 5 | `supersede_tournament_fixture` | fixtures | FixtureWorkspacePage.jsx (actions.supersede) | owner/admin | no (cerrada por 0001) | fixture.supersede + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 6 | `schedule_tournament_match` | fixtures | FixtureWorkspacePage.jsx (actions.schedule) | owner/admin | no (cerrada por 0001) | matches.schedule (schedule_conflicts.override to force) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 7 | `auto_schedule_tournament_matches` | fixtures | FixtureWorkspacePage.jsx (actions.autoSchedule) | owner/admin | no (cerrada por 0001) | matches.schedule + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 8 | `submit_match_squad` | match_operations | CaptainMatchSquadPage.jsx<br>MatchOperationsPage.jsx | staff o capitán/delegado del equipo | no (cerrada por 0001) | match_squads.manage + season, or the team's active manager | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 9 | `void_tournament_match_event` | match_operations | MatchOperationsPage.jsx | owner/admin | no (cerrada por 0001) | match_events.void + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 10 | `review_tournament_match_operation` | match_operations | MatchOperationsPage.jsx | owner/admin | no (cerrada por 0001) | match_operations.review + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 11 | `validate_tournament_match_operation` | match_operations | MatchOperationsPage.jsx | owner/admin | no (cerrada por 0001) | match_operations.validate (dual control: never the submitter) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 12 | `make_tournament_match_official` | match_operations | MatchOperationsPage.jsx | owner/admin | no (cerrada por 0001) | match_operations.make_official + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 13 | `request_tournament_match_correction` | match_operations | MatchOperationsPage.jsx | owner/admin | no (cerrada por 0001) | match_operations.request_correction + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 14 | `create_tournament_match_correction` | match_operations | MatchOperationsPage.jsx | owner/admin | no (cerrada por 0001) | match_operations.correct + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 15 | `resolve_tournament_qualification` | standings | CompetitionCenterPage.jsx | owner/admin | no (cerrada por 0001) | qualification.resolve + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |

## B — 59 RPC que ya tenían GRANT y estaban bloqueadas sólo por el gateway

| # | RPC | feature | pantalla / journey | rol | EXECUTE antes de 0004 (auth) | guard | + | − |
|---|---|---|---|---|---|---|---|---|
| 1 | `get_tournament_fixture_context` | fixtures | TorneosFixtureContext.jsx (provider load of the fixture / programación routes) | owner/admin/collaborator (lectura) | sí | fixture.read (or the entry's team manager) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 2 | `get_tournament_schedule_context` | fixtures | TorneosFixtureContext.jsx (provider load of the fixture / programación routes) | owner/admin/collaborator (lectura) | sí | fixture.read + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 3 | `freeze_tournament_participants` | fixtures | FixtureWorkspacePage.jsx (actions.freeze) | owner/admin | sí | participants.freeze + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 4 | `execute_tournament_group_draw` | fixtures | FixtureWorkspacePage.jsx (actions.draw) | owner/admin | sí | draw.execute / draw.publish + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 5 | `generate_tournament_fixture` | fixtures | FixtureWorkspacePage.jsx (actions.generate) | owner/admin | sí | fixture.generate + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 6 | `create_manual_fixture_version` | fixtures | FixtureWorkspacePage.jsx (actions.createManual) | owner/admin | sí | fixture.create_manual + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 7 | `validate_tournament_fixture` | fixtures | FixtureWorkspacePage.jsx<br>FixtureWorkspacePage.jsx (actions.validateFixture) | owner/admin/collaborator (lectura) | sí | fixture.read + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 8 | `append_tournament_playoff_phase` | fixtures | FixtureWorkspacePage.jsx (actions.appendPlayoffs) | owner/admin | sí | fixture.publish + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 9 | `create_tournament_venue` | fixtures | OrganizationVenuesPage.jsx | owner/admin | sí | venues.create (organización activa) | Node ✔ Edge ✔ | cross-workspace, inactive-membership, collaborator-write, participant, captain → 403 42501 |
| 10 | `create_tournament_court` | fixtures | OrganizationVenuesPage.jsx | owner/admin | sí | courts.create (organización activa) | Node ✔ Edge ✔ | cross-workspace, inactive-membership, collaborator-write, participant, captain → 403 42501 |
| 11 | `save_tournament_schedule_windows` | fixtures | FixtureWorkspacePage.jsx (actions.saveWindows) | owner/admin | sí | schedule_windows.manage + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 12 | `validate_tournament_match_schedule` | fixtures | FixtureWorkspacePage.jsx (actions.validateSchedule) | owner/admin/collaborator (lectura) | sí | fixture read scope + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 13 | `reschedule_tournament_match` | fixtures | FixtureWorkspacePage.jsx (actions.reschedule) | owner/admin | sí | matches.reschedule (schedule_conflicts.override to force) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 14 | `get_player_tournament_matches` | match_operations | MyTournamentMatchesPage.jsx | cualquier identidad, sólo sus filas | sí | own active roster rows | Node ✔ Edge ✔ | self-scope-isolation → 200 |
| 15 | `get_managed_tournament_matches` | match_operations | MyTournamentMatchesPage.jsx | cualquier identidad, sólo sus filas | sí | own active team-manager rows | Node ✔ Edge ✔ | self-scope-isolation → 200 |
| 16 | `respond_match_availability` | match_operations | MyTournamentMatchesPage.jsx<br>TournamentHubPage.jsx | participante/destinatario del recurso | sí | the caller's own roster player in the match | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 17 | `get_tournament_match_operations_context` | match_operations | MatchOperationsPage.jsx | owner/admin/collaborator (lectura) | sí | match_operations.read + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 18 | `get_tournament_match_operation_context` | match_operations | MatchOperationsPage.jsx | owner/admin/collaborator (lectura) | sí | match_operations.read + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 19 | `get_match_squad_context` | match_operations | MatchOperationsPage.jsx | staff o capitán/delegado del equipo | sí | match_squads.read + season, or the team's active manager | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 20 | `get_my_managed_match_squad_context` | match_operations | CaptainMatchSquadPage.jsx | staff o capitán/delegado del equipo | sí | own active team-manager row | Node ✔ Edge ✔ | self-scope-isolation → 200 |
| 21 | `save_match_squad` | match_operations | CaptainMatchSquadPage.jsx<br>MatchOperationsPage.jsx | staff o capitán/delegado del equipo | sí | match_squads.manage + season, or the team's active manager | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 22 | `open_tournament_match_operation` | match_operations | MatchOperationsPage.jsx | owner/admin | sí | match_operations.open + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 23 | `set_tournament_match_outcome` | match_operations | MatchOperationsPage.jsx | owner/admin | sí | match_outcomes.manage (administrative results: match_administrative_results.manage) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 24 | `set_tournament_match_score` | match_operations | MatchOperationsPage.jsx | owner/admin | sí | match_scores.manage + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 25 | `add_tournament_match_event` | match_operations | MatchOperationsPage.jsx | owner/admin | sí | match_events.create + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 26 | `submit_tournament_match_operation` | match_operations | MatchOperationsPage.jsx | owner/admin | sí | match_operations.submit + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 27 | `get_tournament_standings_context` | standings | CompetitionCenterPage.jsx | owner/admin/collaborator (lectura) | sí | standings.read + season (or a manager/player of the tournament) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 28 | `get_tournament_statistics_context` | standings | CompetitionCenterPage.jsx | owner/admin/collaborator (lectura) | sí | statistics.read + season (or a manager/player of the tournament) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 29 | `rebuild_tournament_standings` | standings | CompetitionCenterPage.jsx | owner/admin | sí | standings.rebuild + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 30 | `publish_tournament_standings_revision` | standings | CompetitionCenterPage.jsx | owner/admin | sí | standings.publish + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 31 | `start_tournament_competition` | lifecycle_actions | CompetitionLifecycleActions.jsx | owner/admin | sí | tournaments.start + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 32 | `finish_tournament_competition` | lifecycle_actions | CompetitionLifecycleActions.jsx | owner/admin | sí | tournaments.finish + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 33 | `reopen_tournament_competition` | lifecycle_actions | CompetitionLifecycleActions.jsx | owner/admin | sí | tournaments.reopen (owner only) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 34 | `withdraw_tournament_competition_participant` | participant_withdrawal | TeamWithdrawalDialog.jsx | owner/admin | sí | participants.withdraw + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 35 | `get_tournament_participant_hub` | participant_hub | TournamentHubPage.jsx | participante/destinatario del recurso | sí; anon sí | season staff, or an active captain/delegate/player of an approved entry | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 36 | `set_my_tournament_hub_category` | participant_hub | TournamentHubPage.jsx | participante/destinatario del recurso | sí | own preference, hub access required | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 37 | `get_published_tournament_matches` | participant_hub | TournamentHubPage.jsx | participante/destinatario del recurso | sí; anon sí | hub access; published data only | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 38 | `get_tournament_participant_match` | participant_hub | TournamentHubPage.jsx | participante/destinatario del recurso | sí; anon sí | hub access; published data only | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 39 | `get_published_tournament_teams` | participant_hub | TournamentHubPage.jsx | participante/destinatario del recurso | sí; anon sí | hub access; published data only | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 40 | `get_published_tournament_standings` | participant_hub | TournamentHubPage.jsx | participante/destinatario del recurso | sí; anon sí | hub access; published revision only | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 41 | `get_published_tournament_statistics` | participant_hub | TournamentHubPage.jsx | participante/destinatario del recurso | sí; anon sí | hub access; published revision only | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 42 | `get_tournament_communications_inbox` | communications | MyCommunicationsPage.jsx<br>TournamentCommunicationsPanel.jsx | cualquier identidad, sólo sus filas | sí | own recipient rows | Node ✔ Edge ✔ | self-scope-isolation → 200 |
| 43 | `get_tournament_announcement` | communications | MyCommunicationsPage.jsx<br>TournamentCommunicationsPanel.jsx | participante/destinatario del recurso | sí; anon sí | recipient of the announcement, or announcements.read staff | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 44 | `mark_tournament_announcement_read` | communications | MyCommunicationsPage.jsx<br>TournamentCommunicationsPanel.jsx | participante/destinatario del recurso | sí | recipient of the announcement | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 45 | `get_published_tournament_documents` | communications | TournamentCommunicationsPanel.jsx | participante/destinatario del recurso | sí; anon sí | tournament communications access | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 46 | `acknowledge_tournament_document` | communications | TournamentCommunicationsPanel.jsx | participante/destinatario del recurso | sí | tournament communications access | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 47 | `get_tournament_communications_admin_context` | communications | CommunicationsAdminPage.jsx | owner/admin/collaborator (lectura) | sí | announcements.read + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 48 | `create_tournament_announcement_draft` | communications | CommunicationsAdminPage.jsx | owner/admin; collaborator sólo borrador | sí | announcements.create + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, participant, captain → 403 42501 |
| 49 | `update_tournament_announcement_draft` | communications | CommunicationsAdminPage.jsx | owner/admin; collaborator sólo borrador | sí | announcements.update_draft + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, participant, captain → 403 42501 |
| 50 | `replace_tournament_announcement_audience` | communications | CommunicationsAdminPage.jsx | owner/admin; collaborator sólo borrador | sí | announcements.update_draft (via set_tournament_announcement_audience) + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, participant, captain → 403 42501 |
| 51 | `set_tournament_announcement_link` | communications | CommunicationsAdminPage.jsx | owner/admin; collaborator sólo borrador | sí | announcements.update_draft + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, participant, captain → 403 42501 |
| 52 | `preview_tournament_announcement_audience` | communications | CommunicationsAdminPage.jsx | owner/admin/collaborator (lectura) | sí | audiences.preview + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 53 | `publish_tournament_announcement` | communications | CommunicationsAdminPage.jsx | owner/admin | sí | announcements.publish + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 54 | `create_tournament_document` | communications | CommunicationsAdminPage.jsx | owner/admin; collaborator sólo borrador | sí | documents.create + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, participant, captain → 403 42501 |
| 55 | `publish_tournament_document_version` | communications | CommunicationsAdminPage.jsx | owner/admin | sí | documents.publish + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |
| 56 | `get_my_tournament_notification_preferences` | notifications | TournamentCommunicationsPanel.jsx | participante/destinatario del recurso | sí | own preferences, tournament communications access | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 57 | `update_my_tournament_notification_preferences` | notifications | TournamentCommunicationsPanel.jsx | participante/destinatario del recurso | sí | own preferences, tournament communications access | Node ✔ Edge ✔ | cross-workspace → 403 42501 |
| 58 | `get_tournament_public_page_settings` | public_pages | TournamentPublicPageSettings.jsx<br>TournamentWizardPage.jsx | owner/admin/collaborator (lectura) | sí | tournaments.read + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season → 403 42501 |
| 59 | `set_tournament_public_page_published` | public_pages | TournamentPublicPageSettings.jsx | owner/admin | sí | tournaments.update + acceso a la temporada | Node ✔ Edge ✔ | cross-workspace, inactive-membership, cross-season, collaborator-write, participant, captain → 403 42501 |

## C — ruta pública anónima

| # | RPC | feature | pantalla / journey | rol | EXECUTE antes de 0004 (auth) | guard | + | − |
|---|---|---|---|---|---|---|---|---|
| 1 | `get_public_tournament_page` | public_pages | PublicTournamentPage.jsx (via publicTournamentComposition.js) | anónimo (ruta pública) | sí; anon sí | anon: published page, active tournament only (visibility predicates in the function) | Node ✔ Edge ✔ | D2/D5b (credenciales, nombre, forma, tamaño, cota) |
