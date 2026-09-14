# Phase 2A executable inventory

Complete inventory. `acl:*` tests validate effective privileges, owner and fixed search path for every function. The semantic disposition of every SECURITY DEFINER function is in `evidence/security-definer-review.json` (Phase 2B); this table only points to it.

Owner `supabase_admin` bypasses RLS in this local lab. DEFINER functions therefore require explicit authorization in their bodies/callees. `service_role` grants are server privileges, never evidence of end-user authorization.

| Function (exact signature) | Mode | Owner | EXECUTE roles | Review / reason | Test |
|---|---|---|---|---|---|
| `accept_tournament_team_invitation(text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CORE_CONTRACT_BOUND (evidence/security-definer-review.json) | `acl:1` PASS |
| `acknowledge_tournament_document(uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:2` PASS |
| `activate_verified_fake_tournament_purchase(uuid,text,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:3` PASS |
| `activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:4` PASS |
| `add_tournament_match_event(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:5` PASS |
| `add_tournament_roster_player(uuid,uuid,uuid,uuid,uuid,text,text,smallint,text,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:6` PASS |
| `append_tournament_audit(uuid,text,text,uuid,uuid,uuid,jsonb)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:7` PASS |
| `append_tournament_playoff_phase(uuid,uuid,uuid,uuid,integer,boolean,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:8` PASS |
| `apply_fake_tournament_payment_status(uuid,text,text,text,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:9` PASS |
| `apply_tournament_purchase_reversal(uuid,text,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:10` PASS |
| `approve_tournament_team_entry(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:11` PASS |
| `archive_tournament_announcement(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:12` PASS |
| `archive_tournament_document(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:13` PASS |
| `archive_tournament_fixture(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:14` PASS |
| `archive_tournament_team_entry(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:15` PASS |
| `assert_tournament_fixture_scope(uuid,uuid,uuid,text,text[])` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:16` PASS |
| `assign_first_free_plan_on_tournament_insert()` | DEFINER | supabase_admin | owner only | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:17` PASS |
| `assign_tournament_media_photographer(uuid,uuid,boolean)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:18` PASS |
| `assign_tournament_season_member(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:19` PASS |
| `attest_tournament_media_service(text,text,jsonb,integer)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:20` PASS |
| `authorize_tournament_media_read(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:21` PASS |
| `authorize_tournament_media_upload_target(uuid,text,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:22` PASS |
| `authorize_tournament_player_portrait_read(uuid,uuid,text,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:23` PASS |
| `authorize_tournament_social_export(uuid,uuid,text,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:24` PASS |
| `authorize_tournament_team_photo_read(uuid,uuid,text,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:25` PASS |
| `auto_schedule_tournament_matches(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:26` PASS |
| `begin_tournament_media_asset_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:27` PASS |
| `begin_tournament_player_portrait_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:28` PASS |
| `begin_tournament_team_photo_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:29` PASS |
| `build_tournament_knockout(uuid,uuid,jsonb,boolean,boolean)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:30` PASS |
| `build_tournament_round_robin(uuid,uuid,uuid,uuid[],boolean)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:31` PASS |
| `bulk_schedule_tournament_matches(uuid,jsonb)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:32` PASS |
| `can_access_tournament_communications(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:33` PASS |
| `can_current_user_access_tournament_announcement(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:34` PASS |
| `can_current_user_read_media_gallery(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:35` PASS |
| `can_edit_tournament_team_entry(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:36` PASS |
| `can_manage_tournament_match_squad(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:37` PASS |
| `can_manage_tournament_player_portrait_as(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:38` PASS |
| `can_manage_tournament_player_portrait(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:39` PASS |
| `can_manage_tournament_team_visual_assets_as(uuid,uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:40` PASS |
| `can_moderate_tournament_team_visual_assets_as(uuid,uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:41` PASS |
| `can_read_tournament_fixture_scope(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:42` PASS |
| `can_read_tournament_match_operation(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:43` PASS |
| `can_read_tournament_match(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:44` PASS |
| `can_read_tournament_participant_hub(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:45` PASS |
| `can_read_tournament_player_portrait_as(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:46` PASS |
| `can_read_tournament_player_portrait(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:47` PASS |
| `can_read_tournament_projection_scope(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:48` PASS |
| `can_read_tournament_team_entry(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:49` PASS |
| `can_read_tournament_team_photo_as(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:50` PASS |
| `can_update_tournament_team_branding(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:51` PASS |
| `can_write_tournament_branding_object(text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:52` PASS |
| `cancel_tournament_match(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:53` PASS |
| `cancel_tournament_media_upload_session(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:54` PASS |
| `cancel_tournament_purchase(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:55` PASS |
| `change_tournament_media_gallery_state(uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:56` PASS |
| `change_tournament_status(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:57` PASS |
| `cleanup_tournament_media_processing_jobs(integer)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:58` PASS |
| `cleanup_tournament_media_upload_sessions(integer)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:59` PASS |
| `clear_tournament_entitlement_override(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:60` PASS |
| `complete_tournament_media_asset_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:61` PASS |
| `complete_tournament_media_processing_job(uuid,text,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:62` PASS |
| `complete_tournament_media_simple_upload(uuid,uuid,text,text,bigint,integer,integer,text,boolean)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:63` PASS |
| `complete_tournament_media_upload_for_actor(uuid,uuid,text,text,bigint,integer,integer,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:64` PASS |
| `complete_tournament_media_upload_for_job(uuid,text,text,bigint,integer,integer,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:65` PASS |
| `complete_tournament_media_upload(uuid,text,text,bigint,integer,integer,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:66` PASS |
| `complete_tournament_player_portrait_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:67` PASS |
| `complete_tournament_team_photo_delete(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:68` PASS |
| `create_fake_tournament_purchase(uuid,uuid,text,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:69` PASS |
| `create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_DELEGATED (evidence/security-definer-review.json) | `acl:70` PASS |
| `create_manual_fixture_version(uuid,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:71` PASS |
| `create_tournament_announcement_draft(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:72` PASS |
| `create_tournament_court(uuid,uuid,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:73` PASS |
| `create_tournament_disciplinary_override(uuid,text,integer,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:74` PASS |
| `create_tournament_document_version(uuid,text,text,timestamp with time zone,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:75` PASS |
| `create_tournament_document(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:76` PASS |
| `create_tournament_match_correction(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:77` PASS |
| `create_tournament_media_gallery(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:78` PASS |
| `create_tournament_organization(text,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:79` PASS |
| `create_tournament_points_adjustment(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:80` PASS |
| `create_tournament_provisional_player(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:81` PASS |
| `create_tournament_season_purchase(uuid,uuid,text,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:82` PASS |
| `create_tournament_season(uuid,text,text,date,date,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:83` PASS |
| `create_tournament_team_entry(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,text,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CORE_CONTRACT_BOUND (evidence/security-definer-review.json) | `acl:84` PASS |
| `create_tournament_venue(uuid,text,text,text,double precision,double precision,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:85` PASS |
| `create_tournament_with_defaults(uuid,uuid,text,text,text,text,text,text,date,date,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:86` PASS |
| `current_user_has_media_team_relation(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:87` PASS |
| `current_user_tournament_social_capabilities(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:88` PASS |
| `digest(text,text)` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:89` PASS |
| `enforce_tournament_media_gallery_limit()` | DEFINER | supabase_admin | owner only | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:90` PASS |
| `enforce_tournament_media_matchday_limit()` | DEFINER | supabase_admin | owner only | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:91` PASS |
| `enforce_tournament_premium_gate()` | DEFINER | supabase_admin | owner only | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:92` PASS |
| `enforce_tournament_purchase_transition()` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:93` PASS |
| `enforce_tournament_season_purchase_scope()` | DEFINER | supabase_admin | owner only | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:94` PASS |
| `enforce_tournament_season_root_write_scope()` | DEFINER | supabase_admin | owner only | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:95` PASS |
| `enforce_tournament_status_premium_gate()` | DEFINER | supabase_admin | owner only | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:96` PASS |
| `enqueue_tournament_media_processing_job(uuid,text,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:97` PASS |
| `execute_tournament_group_draw(uuid,uuid,uuid,integer,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:98` PASS |
| `fail_tournament_media_processing_job(uuid,text,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:99` PASS |
| `fail_tournament_media_upload_session(uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:100` PASS |
| `fail_tournament_player_portrait_upload(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:101` PASS |
| `fail_tournament_team_photo_upload(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:102` PASS |
| `finalize_tournament_media_variants(uuid,jsonb)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:103` PASS |
| `finalize_tournament_player_portrait_upload(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:104` PASS |
| `finalize_tournament_team_photo_upload(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:105` PASS |
| `finish_tournament_competition(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:106` PASS |
| `freeze_tournament_participants(uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:107` PASS |
| `gen_random_bytes(integer)` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:108` PASS |
| `generate_tournament_fixture(uuid,uuid,uuid,text,jsonb,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:109` PASS |
| `get_effective_tournament_entitlements(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:110` PASS |
| `get_effective_tournament_season_entitlements(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:111` PASS |
| `get_managed_tournament_matches()` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:112` PASS |
| `get_match_squad_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:113` PASS |
| `get_my_current_tournament_roster_players()` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:114` PASS |
| `get_my_managed_match_squad_context(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:115` PASS |
| `get_my_tournament_memberships(integer,integer)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:116` PASS |
| `get_my_tournament_notification_preferences(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:117` PASS |
| `get_player_tournament_matches()` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:118` PASS |
| `get_player_tournament_statistics(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:119` PASS |
| `get_player_tournament_suspensions(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:120` PASS |
| `get_public_tournament_branding(text)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: PUBLIC_READ (evidence/security-definer-review.json) | `acl:121` PASS |
| `get_public_tournament_commercial_catalog(integer)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: PUBLIC_READ (evidence/security-definer-review.json) | `acl:122` PASS |
| `get_public_tournament_page(text,text)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: PUBLIC_READ (evidence/security-definer-review.json) | `acl:123` PASS |
| `get_published_tournament_documents(uuid,uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: IDENTITY_GATED_READ (evidence/security-definer-review.json) | `acl:124` PASS |
| `get_published_tournament_matches(uuid,uuid,text,uuid,integer,integer)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: IDENTITY_GATED_READ (evidence/security-definer-review.json) | `acl:125` PASS |
| `get_published_tournament_media(uuid,uuid,uuid,integer,integer)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: IDENTITY_GATED_READ (evidence/security-definer-review.json) | `acl:126` PASS |
| `get_published_tournament_standings(uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: IDENTITY_GATED_READ (evidence/security-definer-review.json) | `acl:127` PASS |
| `get_published_tournament_statistics(uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: IDENTITY_GATED_READ (evidence/security-definer-review.json) | `acl:128` PASS |
| `get_published_tournament_teams(uuid,uuid,integer,integer)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: IDENTITY_GATED_READ (evidence/security-definer-review.json) | `acl:129` PASS |
| `get_team_registration_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:130` PASS |
| `get_tournament_announcement(uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: IDENTITY_GATED_READ (evidence/security-definer-review.json) | `acl:131` PASS |
| `get_tournament_branding_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:132` PASS |
| `get_tournament_communications_admin_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:133` PASS |
| `get_tournament_communications_inbox(uuid,text,integer,integer)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:134` PASS |
| `get_tournament_competition_context_organization_legacy(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:135` PASS |
| `get_tournament_competition_context(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:136` PASS |
| `get_tournament_creation_eligibility(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:137` PASS |
| `get_tournament_fixture_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:138` PASS |
| `get_tournament_match_operation_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:139` PASS |
| `get_tournament_match_operations_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:140` PASS |
| `get_tournament_media_admin_context(uuid,uuid,text,integer,integer)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:141` PASS |
| `get_tournament_media_asset_processing_tiers(uuid)` | DEFINER | supabase_admin | authenticated | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:142` PASS |
| `get_tournament_media_upload_capability(uuid)` | DEFINER | supabase_admin | authenticated | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:143` PASS |
| `get_tournament_participant_hub(uuid,uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: IDENTITY_GATED_READ (evidence/security-definer-review.json) | `acl:144` PASS |
| `get_tournament_participant_match(uuid)` | DEFINER | supabase_admin | anon, authenticated, service_role | DISPOSED: IDENTITY_GATED_READ (evidence/security-definer-review.json) | `acl:145` PASS |
| `get_tournament_player_portrait_ref(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:146` PASS |
| `get_tournament_public_page_settings(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:147` PASS |
| `get_tournament_purchase(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:148` PASS |
| `get_tournament_schedule_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:149` PASS |
| `get_tournament_season_media_usage(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:150` PASS |
| `get_tournament_social_snapshot_plan_legacy(uuid,uuid,uuid,uuid,text,uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:151` PASS |
| `get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:152` PASS |
| `get_tournament_social_studio_context_organization_legacy(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:153` PASS |
| `get_tournament_social_studio_context(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:154` PASS |
| `get_tournament_standings_context(uuid,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:155` PASS |
| `get_tournament_statistics_context(uuid,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:156` PASS |
| `get_tournament_team_photo_state(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:157` PASS |
| `get_tournament_team_visual_policy(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:158` PASS |
| `get_tournament_teams_context(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:159` PASS |
| `get_tournament_workspace_context()` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:160` PASS |
| `grant_tournament_premium(uuid,uuid,text,text)` | DEFINER | supabase_admin | owner only | DISPOSED: INTERNAL (evidence/security-definer-review.json) | `acl:161` PASS |
| `grant_tournament_season_premium(uuid,uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:162` PASS |
| `handle_tournament_media_report(uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:163` PASS |
| `has_organization_consumed_free_tournament(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:164` PASS |
| `has_tournament_capability(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:165` PASS |
| `has_tournament_communications_capability(uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:166` PASS |
| `has_tournament_entitlement(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_DELEGATED (evidence/security-definer-review.json) | `acl:167` PASS |
| `has_tournament_media_assignment(uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:168` PASS |
| `has_tournament_media_capability(uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:169` PASS |
| `has_tournament_organization_capability(uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:170` PASS |
| `has_tournament_season_access(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:171` PASS |
| `has_tournament_season_capability(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:172` PASS |
| `has_tournament_social_capability(uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:173` PASS |
| `insert_tournament_match_source(uuid,text,jsonb)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:174` PASS |
| `invite_tournament_team_manager(uuid,uuid,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:175` PASS |
| `is_tournament_branding_path(text,text)` | INVOKER | supabase_admin | authenticated, service_role | INVOKER: caller privileges and RLS apply | `acl:176` PASS |
| `is_tournament_organization_member(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:177` PASS |
| `is_tournament_organization_slug_available(text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:178` PASS |
| `is_tournament_plan_grant_effective(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:179` PASS |
| `is_tournament_season_plan_grant_effective(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:180` PASS |
| `is_tournament_team_manager(uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_PREDICATE (evidence/security-definer-review.json) | `acl:181` PASS |
| `is_tournament_team_roster_member_as(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:182` PASS |
| `is_valid_tournament_format_settings(text,jsonb)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:183` PASS |
| `lease_tournament_media_processing_jobs(text,integer,integer)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:184` PASS |
| `list_tournament_media_retention_candidates(uuid,uuid,timestamp with time zone)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:185` PASS |
| `list_tournament_player_portrait_refs(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:186` PASS |
| `list_tournament_season_member_assignments(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:187` PASS |
| `lock_tournament_roster(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:188` PASS |
| `make_tournament_match_official(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:189` PASS |
| `manage_tournament_media_consent(uuid,uuid,uuid,text,text,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:190` PASS |
| `mark_tournament_announcement_read(uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:191` PASS |
| `mark_tournament_suspension_served(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:192` PASS |
| `normalize_tournament_competition_slug(text)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:193` PASS |
| `normalize_tournament_organization_slug(text)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:194` PASS |
| `normalize_tournament_person_name(text)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:195` PASS |
| `open_tournament_match_operation(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:196` PASS |
| `postpone_tournament_match(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:197` PASS |
| `preview_tournament_announcement_audience(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:198` PASS |
| `private.authorize_core_contract(text,jsonb)` | DEFINER | supabase_admin | owner only | DISPOSED: ADAPTER_ONLY (evidence/security-definer-review.json) | `acl:199` PASS |
| `private.check_token()` | INVOKER | supabase_admin | anon, authenticated, service_role | INVOKER: caller privileges and RLS apply | `acl:200` PASS |
| `private.consume_core_attestation(text,jsonb)` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:201` PASS |
| `private.core_contract_request_hash(text,jsonb)` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:202` PASS |
| `private.current_identity_id()` | INVOKER | supabase_admin | anon, authenticated, service_role | INVOKER: caller privileges and RLS apply | `acl:203` PASS |
| `private.has_tournament_season_access_as(uuid,uuid,uuid)` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:204` PASS |
| `private.prevent_identity_reassignment()` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:205` PASS |
| `protect_active_tournament_fixture_draft()` | DEFINER | supabase_admin | owner only | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:206` PASS |
| `protect_published_tournament_communication()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:207` PASS |
| `protect_published_tournament_document_version()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:208` PASS |
| `protect_referenced_tournament_offer()` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:209` PASS |
| `protect_tournament_competition_scope()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:210` PASS |
| `protect_tournament_completed_competition()` | DEFINER | supabase_admin | service_role | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:211` PASS |
| `protect_tournament_match_child_history()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:212` PASS |
| `protect_tournament_match_operation_history()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:213` PASS |
| `protect_tournament_match_planning_transition()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:214` PASS |
| `protect_tournament_match_squad_players()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:215` PASS |
| `protect_tournament_organization_owner()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:216` PASS |
| `protect_tournament_purchase_snapshots()` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:217` PASS |
| `protect_tournament_registration_scope()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:218` PASS |
| `public.gen_random_uuid()` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:219` PASS |
| `publish_tournament_announcement(uuid,integer)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:220` PASS |
| `publish_tournament_document_version(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:221` PASS |
| `publish_tournament_fixture(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:222` PASS |
| `publish_tournament_media_gallery(uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:223` PASS |
| `publish_tournament_standings_revision(uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:224` PASS |
| `raise_tournament_match_error(text)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:225` PASS |
| `rank_tournament_standings(uuid)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply; pre-existing temp relation ownership requires adversarial test | `acl:226` PASS |
| `ready_tournament_match(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:227` PASS |
| `rebuild_tournament_discipline(uuid,uuid,uuid,uuid,uuid,text,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:228` PASS |
| `rebuild_tournament_standings(uuid,uuid,uuid,uuid,uuid,text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json); pre-existing temp relation ownership requires adversarial test | `acl:229` PASS |
| `record_manual_match_availability(uuid,uuid,uuid,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:230` PASS |
| `record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:231` PASS |
| `reject_append_only_tournament_commercial_mutation()` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:232` PASS |
| `reject_suspended_tournament_operation_player()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:233` PASS |
| `reject_suspended_tournament_squad_player()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:234` PASS |
| `reject_suspended_tournament_squad_submission()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:235` PASS |
| `reject_tournament_audit_mutation()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:236` PASS |
| `reject_tournament_match_child_delete()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:237` PASS |
| `reject_tournament_projection_mutation()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:238` PASS |
| `reject_tournament_team_entry(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:239` PASS |
| `remove_tournament_roster_player(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:240` PASS |
| `remove_tournament_season_member_assignment(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:241` PASS |
| `reopen_tournament_competition(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:242` PASS |
| `reopen_tournament_participants(uuid,uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:243` PASS |
| `reorder_tournament_media_item(uuid,uuid,integer)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:244` PASS |
| `replace_tournament_announcement_audience(uuid,text,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:245` PASS |
| `report_tournament_media_asset(uuid,text,text,boolean,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:246` PASS |
| `request_tournament_match_correction(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:247` PASS |
| `request_tournament_media_upload_session(uuid,text,text,bigint,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:248` PASS |
| `request_tournament_player_portrait_upload(uuid,uuid,uuid,text,bigint,integer,integer)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:249` PASS |
| `request_tournament_team_photo_upload(uuid,uuid,uuid,text,bigint,integer,integer)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:250` PASS |
| `reschedule_tournament_match(uuid,uuid,timestamp with time zone,uuid,uuid,integer,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:251` PASS |
| `resolve_effective_tournament_entitlements_at(uuid,uuid,timestamp with time zone,boolean)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:252` PASS |
| `resolve_effective_tournament_season_entitlements_at(uuid,uuid,timestamp with time zone,boolean,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:253` PASS |
| `resolve_tournament_announcement_recipients(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:254` PASS |
| `resolve_tournament_qualification(uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:255` PASS |
| `resolve_tournament_subscription_plan(text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:256` PASS |
| `respond_match_availability(uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:257` PASS |
| `restore_tournament_match_unscheduled(uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:258` PASS |
| `review_tournament_match_operation(uuid,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:259` PASS |
| `review_tournament_team_entry(uuid,uuid,text,text,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:260` PASS |
| `revoke_tournament_announcement(uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:261` PASS |
| `revoke_tournament_media_service_attestation(text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:262` PASS |
| `revoke_tournament_player_portrait_publication(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:263` PASS |
| `revoke_tournament_points_adjustment(uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:264` PASS |
| `revoke_tournament_team_invitation(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:265` PASS |
| `revoke_tournament_team_photo(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:266` PASS |
| `save_match_squad(uuid,uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:267` PASS |
| `save_tournament_category(uuid,uuid,uuid,text,text,text,integer,smallint,smallint,text,text,smallint,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:268` PASS |
| `save_tournament_draw_pots(uuid,uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:269` PASS |
| `save_tournament_match_operation_draft(uuid,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:270` PASS |
| `save_tournament_schedule_windows(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:271` PASS |
| `schedule_tournament_match_resumption(uuid,uuid,timestamp with time zone,uuid,uuid,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:272` PASS |
| `schedule_tournament_match(uuid,uuid,timestamp with time zone,uuid,uuid,integer,boolean,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:273` PASS |
| `search_tournament_arma2_teams(uuid,uuid,text,integer)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CORE_CONTRACT_BOUND (evidence/security-definer-review.json) | `acl:274` PASS |
| `search_tournament_players(uuid,uuid,text,integer,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CORE_CONTRACT_BOUND (evidence/security-definer-review.json) | `acl:275` PASS |
| `set_active_tournament_context(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:276` PASS |
| `set_my_tournament_hub_category(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:277` PASS |
| `set_tournament_announcement_audience(uuid,text,uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:278` PASS |
| `set_tournament_announcement_link(uuid,text,uuid,text,text,integer)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:279` PASS |
| `set_tournament_branding_reference(uuid,text,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:280` PASS |
| `set_tournament_entitlement_override(uuid,uuid,text,boolean,timestamp with time zone,text)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:281` PASS |
| `set_tournament_match_outcome(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:282` PASS |
| `set_tournament_match_score(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:283` PASS |
| `set_tournament_media_cover(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:284` PASS |
| `set_tournament_organization_subscription(uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer)` | DEFINER | supabase_admin | owner only | DISPOSED: INTERNAL (evidence/security-definer-review.json) | `acl:285` PASS |
| `set_tournament_player_portrait_crop(uuid,uuid,numeric,numeric,numeric)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:286` PASS |
| `set_tournament_player_portrait_editorial_status(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:287` PASS |
| `set_tournament_public_page_published(uuid,uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:288` PASS |
| `set_tournament_social_permission(uuid,uuid,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:289` PASS |
| `set_tournament_team_photo_editorial_status(uuid,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:290` PASS |
| `set_tournament_team_visual_policy(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:291` PASS |
| `set_tournament_workspace_preference(text,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:292` PASS |
| `start_tournament_competition(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:293` PASS |
| `submit_match_squad(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:294` PASS |
| `submit_tournament_match_operation(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:295` PASS |
| `submit_tournament_team_entry(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:296` PASS |
| `supersede_tournament_fixture(uuid,uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:297` PASS |
| `tag_tournament_media_asset(uuid,text,uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:298` PASS |
| `touch_tournament_communications_updated_at()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:299` PASS |
| `touch_tournament_media_updated_at()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:300` PASS |
| `touch_tournament_workspace_updated_at()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:301` PASS |
| `tournament_communications_role_capabilities(text)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:302` PASS |
| `tournament_competition_open_commitments(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:303` PASS |
| `tournament_match_team_entries(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:304` PASS |
| `tournament_media_asset_has_internal_consent(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:305` PASS |
| `tournament_media_asset_publication_ready(uuid)` | DEFINER | supabase_admin | owner only | DISPOSED: INTERNAL (evidence/security-definer-review.json) | `acl:306` PASS |
| `tournament_media_attestation_rejection(text,jsonb,integer)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:307` PASS |
| `tournament_media_backend_fingerprint()` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:308` PASS |
| `tournament_media_capability_allowlist(text)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:309` PASS |
| `tournament_media_current_pipeline_mode()` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:310` PASS |
| `tournament_media_effective_readiness()` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:311` PASS |
| `tournament_media_gallery_sports_round(uuid)` | DEFINER | supabase_admin | owner only | DISPOSED: INTERNAL (evidence/security-definer-review.json) | `acl:312` PASS |
| `tournament_media_known_object_names(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:313` PASS |
| `tournament_media_mvp_user_can_upload(uuid,uuid)` | DEFINER | supabase_admin | owner only | DISPOSED: INTERNAL (evidence/security-definer-review.json) | `acl:314` PASS |
| `tournament_media_pipeline_readiness()` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:315` PASS |
| `tournament_media_require_pipeline_ready()` | DEFINER | supabase_admin | owner only | DISPOSED: INTERNAL (evidence/security-definer-review.json) | `acl:316` PASS |
| `tournament_media_require_upload_tier(text)` | DEFINER | supabase_admin | owner only | DISPOSED: INTERNAL (evidence/security-definer-review.json) | `acl:317` PASS |
| `tournament_media_role_capabilities(text)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:318` PASS |
| `tournament_media_storage_contract_status()` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:319` PASS |
| `tournament_media_user_can_upload(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:320` PASS |
| `tournament_media_variant_box(text)` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:321` PASS |
| `tournament_media_variant_geometry(text,integer,integer)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:322` PASS |
| `tournament_media_variant_plan(integer,integer)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:323` PASS |
| `tournament_media_worker_type_allowlist()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:324` PASS |
| `tournament_projection_source_fingerprint(uuid,uuid,uuid)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:325` PASS |
| `tournament_purchase_projection(tournament_purchases)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:326` PASS |
| `tournament_registration_checklist(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:327` PASS |
| `tournament_requires_premium(uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:328` PASS |
| `tournament_role_capabilities(text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CATALOG_READ (evidence/security-definer-review.json) | `acl:329` PASS |
| `tournament_season_member_assignment_limit()` | DEFINER | supabase_admin | owner only | DISPOSED: TRIGGER (evidence/security-definer-review.json) | `acl:330` PASS |
| `tournament_social_match_rows(uuid,uuid,uuid,boolean)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:331` PASS |
| `tournament_social_next_fixture(uuid,uuid,uuid)` | DEFINER | supabase_admin | owner only | DISPOSED: INTERNAL (evidence/security-definer-review.json) | `acl:332` PASS |
| `tournament_social_player_candidates(uuid,jsonb)` | DEFINER | supabase_admin | owner only | DISPOSED: INTERNAL (evidence/security-definer-review.json) | `acl:333` PASS |
| `tournament_social_published_scope(uuid,uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:334` PASS |
| `tournament_social_role_capabilities(text)` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:335` PASS |
| `tournament_subscription_is_consistent(text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:336` PASS |
| `tournament_subscription_pro_access_ended_at(text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)` | INVOKER | supabase_admin | owner only | INVOKER: caller privileges and RLS apply | `acl:337` PASS |
| `transition_tournament_media_asset(uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:338` PASS |
| `update_draft_fixture(uuid,uuid,text,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:339` PASS |
| `update_my_tournament_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:340` PASS |
| `update_tournament_announcement_draft(uuid,text,text,text,text,text,timestamp with time zone)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:341` PASS |
| `update_tournament_configuration(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:342` PASS |
| `update_tournament_court(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:343` PASS |
| `update_tournament_document_draft(uuid,text,text,timestamp with time zone)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:344` PASS |
| `update_tournament_media_gallery(uuid,text,text,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:345` PASS |
| `update_tournament_organization(uuid,text,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:346` PASS |
| `update_tournament_roster_player(uuid,uuid,uuid,smallint,text,text,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:347` PASS |
| `update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:348` PASS |
| `update_tournament_team_entry(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:349` PASS |
| `update_tournament_venue(uuid,uuid,jsonb)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:350` PASS |
| `validate_tournament_fixture_member_scope()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:351` PASS |
| `validate_tournament_fixture(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:352` PASS |
| `validate_tournament_group_scope()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:353` PASS |
| `validate_tournament_match_operation_payload(uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:354` PASS |
| `validate_tournament_match_operation_source()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:355` PASS |
| `validate_tournament_match_operation(uuid,uuid)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:356` PASS |
| `validate_tournament_match_player_scope()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:357` PASS |
| `validate_tournament_match_schedule(uuid,uuid,timestamp with time zone,uuid,uuid,integer)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:358` PASS |
| `validate_tournament_match_scope()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:359` PASS |
| `validate_tournament_match_source_scope()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:360` PASS |
| `validate_tournament_match_squad_scope()` | INVOKER | supabase_admin | service_role | INVOKER: caller privileges and RLS apply | `acl:361` PASS |
| `validate_tournament_roster(uuid,uuid,uuid)` | DEFINER | supabase_admin | service_role | DISPOSED: SERVICE_ONLY (evidence/security-definer-review.json) | `acl:362` PASS |
| `void_tournament_match_event(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:363` PASS |
| `void_tournament_match_operation(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:364` PASS |
| `withdraw_tournament_competition_participant(uuid,uuid,uuid,text,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:365` PASS |
| `withdraw_tournament_team_entry(uuid,uuid,text)` | DEFINER | supabase_admin | authenticated, service_role | DISPOSED: CLIENT_RPC_GUARDED (evidence/security-definer-review.json) | `acl:366` PASS |
