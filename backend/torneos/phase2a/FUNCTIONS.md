# Phase 2A executable inventory

Complete inventory; **not a completed semantic certification**. `acl:*` tests validate effective privileges, owner and fixed search path for every function. They do not prove input validation, delegated authorization, or cross-workspace correctness.

Owner `supabase_admin` bypasses RLS in this local lab. DEFINER functions therefore require explicit authorization in their bodies/callees. `service_role` grants are server privileges, never evidence of end-user authorization.

| Function (exact signature) | Mode | Owner | EXECUTE roles | Review / reason | Test |
|---|---|---|---|---|---|
| `accept_tournament_team_invitation(text)` | DEFINER | supabase_admin | authenticated, service_role | BLOCKED: Core adapter absent; denial tested by tools/test.py | `acl:1` PASS |
| `acknowledge_tournament_document(uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:2` PASS |
| `activate_verified_fake_tournament_purchase(uuid,text,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:3` PASS |
| `activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:4` PASS |
| `add_tournament_match_event(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:5` PASS |
| `add_tournament_roster_player(uuid,uuid,uuid,uuid,uuid,text,text,smallint,text,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:6` PASS |
| `append_tournament_audit(uuid,text,text,uuid,uuid,uuid,jsonb)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:7` PASS |
| `append_tournament_playoff_phase(uuid,uuid,uuid,uuid,integer,boolean,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:8` PASS |
| `apply_fake_tournament_payment_status(uuid,text,text,text,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:9` PASS |
| `apply_tournament_purchase_reversal(uuid,text,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:10` PASS |
| `approve_tournament_team_entry(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:11` PASS |
| `archive_tournament_announcement(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:12` PASS |
| `archive_tournament_document(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:13` PASS |
| `archive_tournament_fixture(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:14` PASS |
| `archive_tournament_team_entry(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:15` PASS |
| `assert_tournament_fixture_scope(uuid,uuid,uuid,text,text[])` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:16` PASS |
| `assign_first_free_plan_on_tournament_insert()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:17` PASS |
| `assign_tournament_media_photographer(uuid,uuid,boolean)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:18` PASS |
| `assign_tournament_season_member(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:19` PASS |
| `attest_tournament_media_service(text,text,jsonb,integer)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:20` PASS |
| `authorize_tournament_media_read(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:21` PASS |
| `authorize_tournament_media_upload_target(uuid,text,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:22` PASS |
| `authorize_tournament_player_portrait_read(uuid,uuid,text,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:23` PASS |
| `authorize_tournament_social_export(uuid,uuid,text,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:24` PASS |
| `authorize_tournament_team_photo_read(uuid,uuid,text,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:25` PASS |
| `auto_schedule_tournament_matches(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:26` PASS |
| `begin_tournament_media_asset_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:27` PASS |
| `begin_tournament_player_portrait_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:28` PASS |
| `begin_tournament_team_photo_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:29` PASS |
| `build_tournament_knockout(uuid,uuid,jsonb,boolean,boolean)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:30` PASS |
| `build_tournament_round_robin(uuid,uuid,uuid,uuid[],boolean)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:31` PASS |
| `bulk_schedule_tournament_matches(uuid,jsonb)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:32` PASS |
| `can_access_tournament_communications(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:33` PASS |
| `can_current_user_access_tournament_announcement(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:34` PASS |
| `can_current_user_read_media_gallery(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:35` PASS |
| `can_edit_tournament_team_entry(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:36` PASS |
| `can_manage_tournament_match_squad(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:37` PASS |
| `can_manage_tournament_player_portrait_as(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:38` PASS |
| `can_manage_tournament_player_portrait(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:39` PASS |
| `can_manage_tournament_team_visual_assets_as(uuid,uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:40` PASS |
| `can_moderate_tournament_team_visual_assets_as(uuid,uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:41` PASS |
| `can_read_tournament_fixture_scope(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:42` PASS |
| `can_read_tournament_match_operation(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:43` PASS |
| `can_read_tournament_match(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:44` PASS |
| `can_read_tournament_participant_hub(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:45` PASS |
| `can_read_tournament_player_portrait_as(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:46` PASS |
| `can_read_tournament_player_portrait(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:47` PASS |
| `can_read_tournament_projection_scope(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:48` PASS |
| `can_read_tournament_team_entry(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:49` PASS |
| `can_read_tournament_team_photo_as(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:50` PASS |
| `can_update_tournament_team_branding(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:51` PASS |
| `can_write_tournament_branding_object(text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:52` PASS |
| `cancel_tournament_match(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:53` PASS |
| `cancel_tournament_media_upload_session(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:54` PASS |
| `cancel_tournament_purchase(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:55` PASS |
| `change_tournament_media_gallery_state(uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:56` PASS |
| `change_tournament_status(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:57` PASS |
| `cleanup_tournament_media_processing_jobs(integer)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:58` PASS |
| `cleanup_tournament_media_upload_sessions(integer)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:59` PASS |
| `clear_tournament_entitlement_override(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:60` PASS |
| `complete_tournament_media_asset_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:61` PASS |
| `complete_tournament_media_processing_job(uuid,text,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:62` PASS |
| `complete_tournament_media_simple_upload(uuid,uuid,text,text,bigint,integer,integer,text,boolean)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:63` PASS |
| `complete_tournament_media_upload_for_actor(uuid,uuid,text,text,bigint,integer,integer,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:64` PASS |
| `complete_tournament_media_upload_for_job(uuid,text,text,bigint,integer,integer,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:65` PASS |
| `complete_tournament_media_upload(uuid,text,text,bigint,integer,integer,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:66` PASS |
| `complete_tournament_player_portrait_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:67` PASS |
| `complete_tournament_team_photo_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:68` PASS |
| `create_fake_tournament_purchase(uuid,uuid,text,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:69` PASS |
| `create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:70` PASS |
| `create_manual_fixture_version(uuid,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:71` PASS |
| `create_tournament_announcement_draft(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:72` PASS |
| `create_tournament_court(uuid,uuid,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:73` PASS |
| `create_tournament_disciplinary_override(uuid,text,integer,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:74` PASS |
| `create_tournament_document_version(uuid,text,text,timestamp with time zone,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:75` PASS |
| `create_tournament_document(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:76` PASS |
| `create_tournament_match_correction(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:77` PASS |
| `create_tournament_media_gallery(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:78` PASS |
| `create_tournament_organization(text,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:79` PASS |
| `create_tournament_points_adjustment(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:80` PASS |
| `create_tournament_provisional_player(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:81` PASS |
| `create_tournament_season_purchase(uuid,uuid,text,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:82` PASS |
| `create_tournament_season(uuid,text,text,date,date,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:83` PASS |
| `create_tournament_team_entry(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,text,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PARTIAL: cross-season create fixed/tested; Core import remains closed | `acl:84` PASS |
| `create_tournament_venue(uuid,text,text,text,double precision,double precision,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:85` PASS |
| `create_tournament_with_defaults(uuid,uuid,text,text,text,text,text,text,date,date,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:86` PASS |
| `current_user_has_media_team_relation(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:87` PASS |
| `current_user_tournament_social_capabilities(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:88` PASS |
| `digest(text,text)` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:89` PASS |
| `enforce_tournament_media_gallery_limit()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:90` PASS |
| `enforce_tournament_media_matchday_limit()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:91` PASS |
| `enforce_tournament_premium_gate()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:92` PASS |
| `enforce_tournament_purchase_transition()` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:93` PASS |
| `enforce_tournament_season_purchase_scope()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:94` PASS |
| `enforce_tournament_season_root_write_scope()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:95` PASS |
| `enforce_tournament_status_premium_gate()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:96` PASS |
| `enqueue_tournament_media_processing_job(uuid,text,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:97` PASS |
| `execute_tournament_group_draw(uuid,uuid,uuid,integer,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:98` PASS |
| `fail_tournament_media_processing_job(uuid,text,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:99` PASS |
| `fail_tournament_media_upload_session(uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:100` PASS |
| `fail_tournament_player_portrait_upload(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:101` PASS |
| `fail_tournament_team_photo_upload(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:102` PASS |
| `finalize_tournament_media_variants(uuid,jsonb)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:103` PASS |
| `finalize_tournament_player_portrait_upload(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:104` PASS |
| `finalize_tournament_team_photo_upload(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:105` PASS |
| `finish_tournament_competition(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:106` PASS |
| `freeze_tournament_participants(uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:107` PASS |
| `gen_random_bytes(integer)` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:108` PASS |
| `generate_tournament_fixture(uuid,uuid,uuid,text,jsonb,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:109` PASS |
| `get_effective_tournament_entitlements(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:110` PASS |
| `get_effective_tournament_season_entitlements(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:111` PASS |
| `get_managed_tournament_matches()` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:112` PASS |
| `get_match_squad_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:113` PASS |
| `get_my_current_tournament_roster_players()` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:114` PASS |
| `get_my_managed_match_squad_context(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:115` PASS |
| `get_my_tournament_memberships(integer,integer)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:116` PASS |
| `get_my_tournament_notification_preferences(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:117` PASS |
| `get_player_tournament_matches()` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:118` PASS |
| `get_player_tournament_statistics(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:119` PASS |
| `get_player_tournament_suspensions(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:120` PASS |
| `get_public_tournament_branding(text)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:121` PASS |
| `get_public_tournament_commercial_catalog(integer)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:122` PASS |
| `get_public_tournament_page(text,text)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:123` PASS |
| `get_published_tournament_documents(uuid,uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:124` PASS |
| `get_published_tournament_matches(uuid,uuid,text,uuid,integer,integer)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:125` PASS |
| `get_published_tournament_media(uuid,uuid,uuid,integer,integer)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:126` PASS |
| `get_published_tournament_standings(uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:127` PASS |
| `get_published_tournament_statistics(uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:128` PASS |
| `get_published_tournament_teams(uuid,uuid,integer,integer)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:129` PASS |
| `get_team_registration_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:130` PASS |
| `get_tournament_announcement(uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:131` PASS |
| `get_tournament_branding_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:132` PASS |
| `get_tournament_communications_admin_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:133` PASS |
| `get_tournament_communications_inbox(uuid,text,integer,integer)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:134` PASS |
| `get_tournament_competition_context_organization_legacy(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:135` PASS |
| `get_tournament_competition_context(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:136` PASS |
| `get_tournament_creation_eligibility(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:137` PASS |
| `get_tournament_fixture_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:138` PASS |
| `get_tournament_match_operation_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:139` PASS |
| `get_tournament_match_operations_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:140` PASS |
| `get_tournament_media_admin_context(uuid,uuid,text,integer,integer)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:141` PASS |
| `get_tournament_media_asset_processing_tiers(uuid)` | DEFINER | supabase_admin | authenticated | PENDING: per-function functional authorization and necessity review | `acl:142` PASS |
| `get_tournament_media_upload_capability(uuid)` | DEFINER | supabase_admin | authenticated | PENDING: per-function functional authorization and necessity review | `acl:143` PASS |
| `get_tournament_participant_hub(uuid,uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:144` PASS |
| `get_tournament_participant_match(uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:145` PASS |
| `get_tournament_player_portrait_ref(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:146` PASS |
| `get_tournament_public_page_settings(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:147` PASS |
| `get_tournament_purchase(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:148` PASS |
| `get_tournament_schedule_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:149` PASS |
| `get_tournament_season_media_usage(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:150` PASS |
| `get_tournament_social_snapshot_plan_legacy(uuid,uuid,uuid,uuid,text,uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:151` PASS |
| `get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:152` PASS |
| `get_tournament_social_studio_context_organization_legacy(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:153` PASS |
| `get_tournament_social_studio_context(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:154` PASS |
| `get_tournament_standings_context(uuid,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:155` PASS |
| `get_tournament_statistics_context(uuid,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:156` PASS |
| `get_tournament_team_photo_state(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:157` PASS |
| `get_tournament_team_visual_policy(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:158` PASS |
| `get_tournament_teams_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:159` PASS |
| `get_tournament_workspace_context()` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:160` PASS |
| `grant_tournament_premium(uuid,uuid,text,text)` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:161` PASS |
| `grant_tournament_season_premium(uuid,uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:162` PASS |
| `handle_tournament_media_report(uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:163` PASS |
| `has_organization_consumed_free_tournament(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:164` PASS |
| `has_tournament_capability(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:165` PASS |
| `has_tournament_communications_capability(uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:166` PASS |
| `has_tournament_entitlement(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:167` PASS |
| `has_tournament_media_assignment(uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:168` PASS |
| `has_tournament_media_capability(uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:169` PASS |
| `has_tournament_organization_capability(uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:170` PASS |
| `has_tournament_season_access(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:171` PASS |
| `has_tournament_season_capability(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:172` PASS |
| `has_tournament_social_capability(uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:173` PASS |
| `insert_tournament_match_source(uuid,text,jsonb)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:174` PASS |
| `invite_tournament_team_manager(uuid,uuid,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:175` PASS |
| `is_tournament_branding_path(text,text)` | INVOKER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:176` PASS |
| `is_tournament_organization_member(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:177` PASS |
| `is_tournament_organization_slug_available(text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:178` PASS |
| `is_tournament_plan_grant_effective(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:179` PASS |
| `is_tournament_season_plan_grant_effective(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:180` PASS |
| `is_tournament_team_manager(uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:181` PASS |
| `is_tournament_team_roster_member_as(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:182` PASS |
| `is_valid_tournament_format_settings(text,jsonb)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:183` PASS |
| `lease_tournament_media_processing_jobs(text,integer,integer)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:184` PASS |
| `list_tournament_media_retention_candidates(uuid,uuid,timestamp with time zone)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:185` PASS |
| `list_tournament_player_portrait_refs(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:186` PASS |
| `list_tournament_season_member_assignments(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:187` PASS |
| `lock_tournament_roster(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:188` PASS |
| `make_tournament_match_official(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:189` PASS |
| `manage_tournament_media_consent(uuid,uuid,uuid,text,text,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:190` PASS |
| `mark_tournament_announcement_read(uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:191` PASS |
| `mark_tournament_suspension_served(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:192` PASS |
| `normalize_tournament_competition_slug(text)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:193` PASS |
| `normalize_tournament_organization_slug(text)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:194` PASS |
| `normalize_tournament_person_name(text)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:195` PASS |
| `open_tournament_match_operation(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:196` PASS |
| `postpone_tournament_match(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:197` PASS |
| `preview_tournament_announcement_audience(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:198` PASS |
| `private.check_token()` | INVOKER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:199` PASS |
| `private.current_identity_id()` | INVOKER | supabase_admin | anon, authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:200` PASS |
| `private.prevent_identity_reassignment()` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:201` PASS |
| `protect_active_tournament_fixture_draft()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:202` PASS |
| `protect_published_tournament_communication()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:203` PASS |
| `protect_published_tournament_document_version()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:204` PASS |
| `protect_referenced_tournament_offer()` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:205` PASS |
| `protect_tournament_competition_scope()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:206` PASS |
| `protect_tournament_completed_competition()` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:207` PASS |
| `protect_tournament_match_child_history()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:208` PASS |
| `protect_tournament_match_operation_history()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:209` PASS |
| `protect_tournament_match_planning_transition()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:210` PASS |
| `protect_tournament_match_squad_players()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:211` PASS |
| `protect_tournament_organization_owner()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:212` PASS |
| `protect_tournament_purchase_snapshots()` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:213` PASS |
| `protect_tournament_registration_scope()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:214` PASS |
| `public.gen_random_uuid()` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:215` PASS |
| `publish_tournament_announcement(uuid,integer)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:216` PASS |
| `publish_tournament_document_version(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:217` PASS |
| `publish_tournament_fixture(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:218` PASS |
| `publish_tournament_media_gallery(uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:219` PASS |
| `publish_tournament_standings_revision(uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:220` PASS |
| `raise_tournament_match_error(text)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:221` PASS |
| `rank_tournament_standings(uuid)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review; pre-existing temp relation ownership requires adversarial test | `acl:222` PASS |
| `ready_tournament_match(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:223` PASS |
| `rebuild_tournament_discipline(uuid,uuid,uuid,uuid,uuid,text,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:224` PASS |
| `rebuild_tournament_standings(uuid,uuid,uuid,uuid,uuid,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review; pre-existing temp relation ownership requires adversarial test | `acl:225` PASS |
| `record_manual_match_availability(uuid,uuid,uuid,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:226` PASS |
| `record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:227` PASS |
| `reject_append_only_tournament_commercial_mutation()` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:228` PASS |
| `reject_suspended_tournament_operation_player()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:229` PASS |
| `reject_suspended_tournament_squad_player()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:230` PASS |
| `reject_suspended_tournament_squad_submission()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:231` PASS |
| `reject_tournament_audit_mutation()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:232` PASS |
| `reject_tournament_match_child_delete()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:233` PASS |
| `reject_tournament_projection_mutation()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:234` PASS |
| `reject_tournament_team_entry(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:235` PASS |
| `remove_tournament_roster_player(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:236` PASS |
| `remove_tournament_season_member_assignment(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:237` PASS |
| `reopen_tournament_competition(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:238` PASS |
| `reopen_tournament_participants(uuid,uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:239` PASS |
| `reorder_tournament_media_item(uuid,uuid,integer)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:240` PASS |
| `replace_tournament_announcement_audience(uuid,text,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:241` PASS |
| `report_tournament_media_asset(uuid,text,text,boolean,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:242` PASS |
| `request_tournament_match_correction(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:243` PASS |
| `request_tournament_media_upload_session(uuid,text,text,bigint,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:244` PASS |
| `request_tournament_player_portrait_upload(uuid,uuid,uuid,text,bigint,integer,integer)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:245` PASS |
| `request_tournament_team_photo_upload(uuid,uuid,uuid,text,bigint,integer,integer)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:246` PASS |
| `reschedule_tournament_match(uuid,uuid,timestamp with time zone,uuid,uuid,integer,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:247` PASS |
| `resolve_effective_tournament_entitlements_at(uuid,uuid,timestamp with time zone,boolean)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:248` PASS |
| `resolve_effective_tournament_season_entitlements_at(uuid,uuid,timestamp with time zone,boolean,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:249` PASS |
| `resolve_tournament_announcement_recipients(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:250` PASS |
| `resolve_tournament_qualification(uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:251` PASS |
| `resolve_tournament_subscription_plan(text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:252` PASS |
| `respond_match_availability(uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:253` PASS |
| `restore_tournament_match_unscheduled(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:254` PASS |
| `review_tournament_match_operation(uuid,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:255` PASS |
| `review_tournament_team_entry(uuid,uuid,text,text,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:256` PASS |
| `revoke_tournament_announcement(uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:257` PASS |
| `revoke_tournament_media_service_attestation(text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:258` PASS |
| `revoke_tournament_player_portrait_publication(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:259` PASS |
| `revoke_tournament_points_adjustment(uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:260` PASS |
| `revoke_tournament_team_invitation(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:261` PASS |
| `revoke_tournament_team_photo(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:262` PASS |
| `save_match_squad(uuid,uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:263` PASS |
| `save_tournament_category(uuid,uuid,uuid,text,text,text,integer,smallint,smallint,text,text,smallint,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:264` PASS |
| `save_tournament_draw_pots(uuid,uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:265` PASS |
| `save_tournament_match_operation_draft(uuid,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:266` PASS |
| `save_tournament_schedule_windows(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:267` PASS |
| `schedule_tournament_match_resumption(uuid,uuid,timestamp with time zone,uuid,uuid,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:268` PASS |
| `schedule_tournament_match(uuid,uuid,timestamp with time zone,uuid,uuid,integer,boolean,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:269` PASS |
| `search_tournament_arma2_teams(uuid,uuid,text,integer)` | DEFINER | supabase_admin | authenticated, service_role | BLOCKED: Core adapter absent; denial tested by tools/test.py | `acl:270` PASS |
| `search_tournament_players(uuid,uuid,text,integer,uuid)` | DEFINER | supabase_admin | authenticated, service_role | BLOCKED: Core adapter absent; denial tested by tools/test.py | `acl:271` PASS |
| `set_active_tournament_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:272` PASS |
| `set_my_tournament_hub_category(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:273` PASS |
| `set_tournament_announcement_audience(uuid,text,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:274` PASS |
| `set_tournament_announcement_link(uuid,text,uuid,text,text,integer)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:275` PASS |
| `set_tournament_branding_reference(uuid,text,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:276` PASS |
| `set_tournament_entitlement_override(uuid,uuid,text,boolean,timestamp with time zone,text)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:277` PASS |
| `set_tournament_match_outcome(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:278` PASS |
| `set_tournament_match_score(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:279` PASS |
| `set_tournament_media_cover(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:280` PASS |
| `set_tournament_organization_subscription(uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer)` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:281` PASS |
| `set_tournament_player_portrait_crop(uuid,uuid,numeric,numeric,numeric)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:282` PASS |
| `set_tournament_player_portrait_editorial_status(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:283` PASS |
| `set_tournament_public_page_published(uuid,uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:284` PASS |
| `set_tournament_social_permission(uuid,uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:285` PASS |
| `set_tournament_team_photo_editorial_status(uuid,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:286` PASS |
| `set_tournament_team_visual_policy(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:287` PASS |
| `set_tournament_workspace_preference(text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:288` PASS |
| `start_tournament_competition(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:289` PASS |
| `submit_match_squad(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:290` PASS |
| `submit_tournament_match_operation(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:291` PASS |
| `submit_tournament_team_entry(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:292` PASS |
| `supersede_tournament_fixture(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:293` PASS |
| `tag_tournament_media_asset(uuid,text,uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:294` PASS |
| `touch_tournament_communications_updated_at()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:295` PASS |
| `touch_tournament_media_updated_at()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:296` PASS |
| `touch_tournament_workspace_updated_at()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:297` PASS |
| `tournament_communications_role_capabilities(text)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:298` PASS |
| `tournament_competition_open_commitments(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:299` PASS |
| `tournament_match_team_entries(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:300` PASS |
| `tournament_media_asset_has_internal_consent(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:301` PASS |
| `tournament_media_asset_publication_ready(uuid)` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:302` PASS |
| `tournament_media_attestation_rejection(text,jsonb,integer)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:303` PASS |
| `tournament_media_backend_fingerprint()` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:304` PASS |
| `tournament_media_capability_allowlist(text)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:305` PASS |
| `tournament_media_current_pipeline_mode()` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:306` PASS |
| `tournament_media_effective_readiness()` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:307` PASS |
| `tournament_media_gallery_sports_round(uuid)` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:308` PASS |
| `tournament_media_known_object_names(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:309` PASS |
| `tournament_media_mvp_user_can_upload(uuid,uuid)` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:310` PASS |
| `tournament_media_pipeline_readiness()` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:311` PASS |
| `tournament_media_require_pipeline_ready()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:312` PASS |
| `tournament_media_require_upload_tier(text)` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:313` PASS |
| `tournament_media_role_capabilities(text)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:314` PASS |
| `tournament_media_storage_contract_status()` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:315` PASS |
| `tournament_media_user_can_upload(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:316` PASS |
| `tournament_media_variant_box(text)` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:317` PASS |
| `tournament_media_variant_geometry(text,integer,integer)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:318` PASS |
| `tournament_media_variant_plan(integer,integer)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:319` PASS |
| `tournament_media_worker_type_allowlist()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:320` PASS |
| `tournament_projection_source_fingerprint(uuid,uuid,uuid)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:321` PASS |
| `tournament_purchase_projection(tournament_purchases)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:322` PASS |
| `tournament_registration_checklist(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:323` PASS |
| `tournament_requires_premium(uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:324` PASS |
| `tournament_role_capabilities(text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:325` PASS |
| `tournament_season_member_assignment_limit()` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:326` PASS |
| `tournament_social_match_rows(uuid,uuid,uuid,boolean)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:327` PASS |
| `tournament_social_next_fixture(uuid,uuid,uuid)` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:328` PASS |
| `tournament_social_player_candidates(uuid,jsonb)` | DEFINER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:329` PASS |
| `tournament_social_published_scope(uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:330` PASS |
| `tournament_social_role_capabilities(text)` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:331` PASS |
| `tournament_subscription_is_consistent(text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:332` PASS |
| `tournament_subscription_pro_access_ended_at(text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)` | INVOKER | supabase_admin | owner only | PENDING: per-function functional authorization and necessity review | `acl:333` PASS |
| `transition_tournament_media_asset(uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:334` PASS |
| `update_draft_fixture(uuid,uuid,text,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:335` PASS |
| `update_my_tournament_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:336` PASS |
| `update_tournament_announcement_draft(uuid,text,text,text,text,text,timestamp with time zone)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:337` PASS |
| `update_tournament_configuration(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:338` PASS |
| `update_tournament_court(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:339` PASS |
| `update_tournament_document_draft(uuid,text,text,timestamp with time zone)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:340` PASS |
| `update_tournament_media_gallery(uuid,text,text,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:341` PASS |
| `update_tournament_organization(uuid,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:342` PASS |
| `update_tournament_roster_player(uuid,uuid,uuid,smallint,text,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:343` PASS |
| `update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:344` PASS |
| `update_tournament_team_entry(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:345` PASS |
| `update_tournament_venue(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:346` PASS |
| `validate_tournament_fixture_member_scope()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:347` PASS |
| `validate_tournament_fixture(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:348` PASS |
| `validate_tournament_group_scope()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:349` PASS |
| `validate_tournament_match_operation_payload(uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:350` PASS |
| `validate_tournament_match_operation_source()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:351` PASS |
| `validate_tournament_match_operation(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:352` PASS |
| `validate_tournament_match_player_scope()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:353` PASS |
| `validate_tournament_match_schedule(uuid,uuid,timestamp with time zone,uuid,uuid,integer)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:354` PASS |
| `validate_tournament_match_scope()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:355` PASS |
| `validate_tournament_match_source_scope()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:356` PASS |
| `validate_tournament_match_squad_scope()` | INVOKER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:357` PASS |
| `validate_tournament_roster(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | PENDING: per-function functional authorization and necessity review | `acl:358` PASS |
| `void_tournament_match_event(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:359` PASS |
| `void_tournament_match_operation(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:360` PASS |
| `withdraw_tournament_competition_participant(uuid,uuid,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:361` PASS |
| `withdraw_tournament_team_entry(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | PENDING: per-function functional authorization and necessity review | `acl:362` PASS |
