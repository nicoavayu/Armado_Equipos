const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
// Stage B migrations are intentionally kept OUT of supabase/migrations (so they
// cannot enter a `supabase db push` of the Stage A rollout) and live in a
// test-only fixtures dir. Content is byte-identical to the separate Stage B PR.
const stageBDir = path.join(__dirname, '..', '..', 'scripts', 'db-integration', 'fixtures', 'stage-b');

// Executable SQL only (strip `--` comment lines so rollback SQL / prose in
// comments does not trip the assertions), and the raw text for transaction checks.
const load = (file, dir = migrationsDir) => {
  const raw = fs.readFileSync(path.join(dir, file), 'utf8');
  const code = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return { raw, code, normalized: code.replace(/\s+/g, ' ').trim() };
};

const A1 = 'secure_no_show_ranking_stage_a.sql';
const A2 = 'secure_notifications_stage_a.sql';
const A3 = 'secure_survey_progress_stage_a.sql';
const A4 = 'secure_jugadores_fotos_stage_a.sql';
const B1 = 'revoke_direct_rating_writes_stage_b.sql';
const B2 = 'notifications_rpc_only_stage_b.sql';
const B3 = 'drop_anon_insert_jugadores_fotos_stage_b.sql';

const fileFor = (suffix, dir = migrationsDir) =>
  fs.readdirSync(dir).find((f) => f.endsWith(suffix));

describe('security patch — Stage A: no-show ranking (M1)', () => {
  const { code, normalized } = load(fileFor(A1));

  test('wrapped in a transaction', () => {
    expect(normalized).toContain('BEGIN;');
    expect(normalized).toContain('COMMIT;');
  });

  test('defines the authoritative RPC as SECURITY DEFINER with fixed search_path', () => {
    expect(code).toContain('CREATE OR REPLACE FUNCTION public.process_match_no_show_ranking');
    expect(code).toContain('SECURITY DEFINER');
    expect(code).toContain('SET search_path = public');
  });

  test('penalty amount is a server constant (-0.5) and inserts are idempotent', () => {
    expect(code).toContain("'no_show_penalty', -0.5");
    expect(code).toContain('ON CONFLICT (user_id, partido_id, type) DO NOTHING');
  });

  test('tightens SELECT to own rows / shared match and own streak', () => {
    expect(code).toContain('DROP POLICY IF EXISTS rating_adjustments_select_authenticated');
    expect(code).toContain('CREATE POLICY rating_adjustments_select_scoped');
    expect(code).toContain('user_id = auth.uid()');
    expect(code).toContain('CREATE POLICY no_show_recovery_state_select_own');
  });

  test('RPC executable only by authenticated + service_role (never anon)', () => {
    expect(code).toContain('GRANT EXECUTE ON FUNCTION public.process_match_no_show_ranking(bigint, boolean) TO authenticated, service_role');
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.process_match_no_show_ranking\(bigint, boolean\) FROM PUBLIC, anon/);
  });

  test('internal helpers are not exposed to anon/authenticated', () => {
    expect(code).toContain('REVOKE ALL ON FUNCTION public._no_show_confirmed_absent_player_ids(bigint) FROM PUBLIC, anon, authenticated');
    expect(code).toContain('REVOKE ALL ON FUNCTION public._derive_no_show_streak(uuid) FROM PUBLIC, anon, authenticated');
  });

  test('Stage A does NOT revoke direct writes yet (that is Stage B)', () => {
    expect(code).not.toContain('REVOKE INSERT');
  });

  test('adds a bounded domain CHECK as immediate mitigation (NOT VALID)', () => {
    expect(code).toContain('rating_adjustments_amount_domain_check');
    expect(code).toContain('NOT VALID');
  });

  test('rejects premature calls: requires survey closed AND results_ready', () => {
    expect(code).toContain('survey_not_closed');
    expect(code).toContain('results_ready IS TRUE');
    expect(code).toMatch(/survey_status[^\n]*=\s*'closed'/);
  });
});

describe('security patch — Stage A: notifications (M3)', () => {
  const { code, normalized } = load(fileFor(A2));

  test('wrapped in a transaction', () => {
    expect(normalized).toContain('BEGIN;');
    expect(normalized).toContain('COMMIT;');
  });

  test('adds strict SECURITY DEFINER create_notification RPC', () => {
    expect(code).toContain('CREATE OR REPLACE FUNCTION public.create_notification');
    expect(code).toContain('SECURITY DEFINER');
    expect(code).toContain('SET search_path = public');
    expect(code).toContain('GRANT EXECUTE ON FUNCTION public.create_notification(text, uuid, jsonb) TO authenticated, service_role');
  });

  test('removes the WITH CHECK(true) any-user insert policy', () => {
    expect(code).toContain('DROP POLICY IF EXISTS notifications_insert_authenticated_any_user');
  });

  test('replaces it with a related-or-self interim policy (no arbitrary recipient)', () => {
    expect(code).toContain('CREATE POLICY notifications_insert_related_or_self');
    expect(code).toContain('user_id = auth.uid()');
    expect(code).toContain('public.amigos');
    expect(code).toContain('public.team_members');
    expect(code).toContain('public.jugadores');
  });

  test('does NOT keep a blanket WITH CHECK (true)', () => {
    expect(code).not.toMatch(/WITH CHECK \(true\)/);
  });

  test('friendship types require a real amigos relationship (not just recipient != actor)', () => {
    // friend_request -> pending, friend_accepted -> accepted, friend_rejected -> rejected
    expect(code).toMatch(/'pending'/);
    expect(code).toMatch(/'accepted'/);
    expect(code).toMatch(/'rejected'/);
    expect(code).toContain('public.amigos');
    // the weak "p_recipient_id <> v_actor" gate must be gone for friend_rejected
    expect(code).not.toContain('v_authorized := (p_recipient_id <> v_actor)');
  });

  test('covers the cross-user domains routed from the client', () => {
    ['payment_reported', 'payment_reminder', 'award_won', 'team_challenge_accepted',
      'match_join_request', 'survey_finished'].forEach((t) => expect(code).toContain(t));
  });

  test('admin-only match events require the emitter to be the match creator', () => {
    // match_kicked / match_cancelled / falta_jugadores / call_to_vote are grouped
    // together and gated on v_is_admin (not merely shared-match membership).
    expect(code).toContain("WHEN 'match_kicked', 'match_cancelled', 'falta_jugadores', 'call_to_vote' THEN");
    expect(code).toContain('v_authorized := v_is_admin AND v_recipient_in_match');
    expect(code).toContain('creado_por = v_actor');
  });

  test('match_cancelled requires a real cancellation and call_to_vote requires open voting', () => {
    expect(code).toMatch(/IN \('cancelado', 'cancelled', 'canceled'\)/);
    expect(code).toContain('public.is_public_voting_open(v_match_id)');
  });

  test('survey lifecycle types are gated on the real survey state', () => {
    expect(code).toContain("WHEN 'survey_start', 'survey_reminder', 'survey_finished', 'survey_results_ready' THEN");
    expect(code).toContain("IN ('closed', 'finished', 'completed')");
    expect(code).toContain('sr.results_ready = true');
  });

  test('awards / mvp / award_won validate against really-persisted player_awards', () => {
    expect(code).toContain('public.player_awards');
    expect(code).toMatch(/award_type, ''\)\) = 'mvp'/);
  });

  test('a canonical award-type normalizer maps historic aliases and rejects the unknown', () => {
    expect(code).toContain('CREATE OR REPLACE FUNCTION public._normalize_award_type');
    // canonical set
    expect(code).toMatch(/WHEN 'mvp' THEN 'mvp'/);
    expect(code).toMatch(/WHEN 'golden_glove' THEN 'best_gk'/);
    expect(code).toMatch(/WHEN 'tarjeta_roja' THEN 'red_card'/);
    // unknown / empty -> NULL so create_notification can reject it
    expect(code).toMatch(/ELSE NULL\s+END/);
    // not exposed to anon
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\._normalize_award_type\(text\) FROM PUBLIC, anon/);
  });

  test('award_won requires a MANDATORY canonical award_type (rejects missing/unknown)', () => {
    // award_type is normalized server-side; a NULL result raises invalid_award
    expect(code).toContain('v_award_type := public._normalize_award_type(v_award_type)');
    expect(code).toMatch(/IF v_award_type IS NULL THEN\s+RAISE EXCEPTION 'invalid_award'/);
  });

  test('award_won validates the award BELONGS to the recipient (no notice to a non-winner)', () => {
    // matching award_type persisted AND the jugador_id resolves to the recipient:
    // either the normalized user id, or a historic jugadores.uuid / id via the roster.
    expect(code).toContain('public._normalize_award_type(pa.award_type) = v_award_type');
    expect(code).toContain('pa.jugador_id::text = p_recipient_id::text');
    expect(code).toContain('j.usuario_id = p_recipient_id');
    expect(code).toContain('pa.jugador_id::text IN (j.usuario_id::text, j.uuid::text, j.id::text)');
  });

  test('award_won is idempotent (no duplicate "Ganaste un premio")', () => {
    expect(code).toMatch(/IF v_type = 'award_won' THEN[\s\S]*RETURN jsonb_build_object\('success', true, 'id', v_notif_id, 'duplicate', true\)/);
  });

  test('match_join_request requires a real pending request from the actor', () => {
    expect(code).toContain('public.match_join_requests');
    expect(code).toContain('r.user_id = v_actor');
    expect(code).toMatch(/status, ''\)\) = 'pending'/);
  });

  test('payments validate real payment rows and correct direction', () => {
    expect(code).toContain('public.match_player_payments');
    expect(code).toMatch(/IN \('reported_paid', 'paid'\)/); // payment_reported
    expect(code).toContain('v_is_admin'); // payment_reminder/admin
  });

  test('team challenge events verify BOTH parties of the SAME concrete challenge', () => {
    expect(code).toContain('challenge_id_required');
    expect(code).toContain('public.challenges');
    expect(code).toContain('v_actor IN (c.created_by_user_id, c.accepted_by_user_id)');
    expect(code).toContain('p_recipient_id IN (c.created_by_user_id, c.accepted_by_user_id)');
    // the old coarse "member of any team" gate must be gone
    expect(code).not.toContain('JOIN public.jugadores j ON j.id = tm.jugador_id');
  });
});

describe('security patch — Stage A: harden existing notification RPCs (M3)', () => {
  const { code, normalized } = load(fileFor('harden_notification_rpc_content_stage_a.sql'));

  test('wrapped in a transaction', () => {
    expect(normalized).toContain('BEGIN;');
    expect(normalized).toContain('COMMIT;');
  });

  test('neutralises the send_match_invite title/message passthrough', () => {
    expect(code).toContain('pg_get_functiondef');
    expect(code).toContain('regexp_replace');
    expect(code).toContain('p_title');
    expect(code).toContain("'coalesce(NULL::text,'");
  });

  test('send_call_to_vote hardcodes content and adds a safe search_path', () => {
    expect(code).toContain('CREATE OR REPLACE FUNCTION public.send_call_to_vote');
    expect(code).toContain('SET search_path = public');
    expect(code).toContain("'¡Hora de votar!'");
    expect(code).toContain('SECURITY DEFINER');
  });

  test('send_call_to_vote authorizes only the match creator/admin (rejects anon + outsiders)', () => {
    expect(code).toContain("RAISE EXCEPTION 'not_authenticated'"); // anon rejected
    expect(code).toContain('p.creado_por = v_actor'); // must be the admin
    expect(code).toContain("RAISE EXCEPTION 'forbidden'"); // outsiders rejected
  });

  test('a verification gate fails the deploy if the send_match_invite passthrough survives', () => {
    // inspects the effective definition after the regex rewrite and raises when
    // a coalesce(p_title|p_message, …) passthrough is still present.
    expect(code).toContain('v_def := pg_get_functiondef');
    expect(code).toContain('still passes client p_title into inserted content');
    expect(code).toContain('still passes client p_message into inserted content');
    expect(code).toContain('passthrough not neutralised');
  });
});

describe('security patch — Stage A: survey_progress (M1 observability)', () => {
  const { code, normalized } = load(fileFor(A3));

  test('wrapped in a transaction', () => {
    expect(normalized).toContain('BEGIN;');
    expect(normalized).toContain('COMMIT;');
  });

  test('converts both trigger functions to SECURITY DEFINER + search_path', () => {
    expect(code).toContain('CREATE OR REPLACE FUNCTION public.check_survey_completion_from_post_match_surveys()');
    expect(code).toContain('CREATE OR REPLACE FUNCTION public.check_survey_completion()');
    expect((code.match(/SECURITY DEFINER/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((code.match(/SET search_path = public/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('revokes direct access for authenticated and anon', () => {
    expect(code).toContain('DROP POLICY IF EXISTS survey_progress_authenticated_all');
    expect(code).toContain('REVOKE ALL ON public.survey_progress FROM authenticated, anon');
    expect(code).toContain('GRANT ALL ON public.survey_progress TO service_role');
  });
});

describe('security patch — Stage A: jugadores-fotos storage (M4)', () => {
  const { code, normalized } = load(fileFor(A4));

  test('wrapped in a transaction', () => {
    expect(normalized).toContain('BEGIN;');
    expect(normalized).toContain('COMMIT;');
  });

  test('creates the single-use capability token table (service_role only)', () => {
    expect(code).toContain('CREATE TABLE IF NOT EXISTS public.voting_photo_upload_tokens');
    expect(code).toContain('ENABLE ROW LEVEL SECURITY');
    expect(code).toContain('REVOKE ALL ON public.voting_photo_upload_tokens FROM anon, authenticated');
  });

  test('creates a durable slot-claim table (PK match_id,guest_session_id) + bind RPC', () => {
    expect(code).toContain('CREATE TABLE IF NOT EXISTS public.voting_photo_slot_claims');
    expect(code).toContain('PRIMARY KEY (match_id, guest_session_id)');
    expect(code).toContain('CREATE OR REPLACE FUNCTION public.bind_voting_photo_slot');
    expect(code).toContain('ON CONFLICT (match_id, guest_session_id) DO NOTHING');
    expect(code).toContain('GRANT EXECUTE ON FUNCTION public.bind_voting_photo_slot(bigint, text, bigint) TO service_role');
  });

  test('drops anon/authenticated UPDATE (overwrite-anyone hole)', () => {
    expect(code).toContain('DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_update ON storage.objects');
  });

  test('adds owner-scoped INSERT/UPDATE compatible with legacy + new names', () => {
    expect(code).toContain('CREATE POLICY jugadores_fotos_owner_insert');
    expect(code).toContain('CREATE POLICY jugadores_fotos_owner_update');
    expect(code).toContain("name LIKE (auth.uid()::text || '%')");
  });

  test('constrains bucket MIME types (no SVG) and file size', () => {
    expect(code).toContain("allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']");
    expect(code).toContain('file_size_limit = 15728640');
    expect(code).not.toContain('image/svg');
  });

  test('Stage A keeps anon INSERT and does NOT flip bucket to private', () => {
    expect(code).not.toContain('DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_insert');
    expect(code).not.toMatch(/SET\s+public\s*=\s*false/);
  });
});

describe('security patch — Stage B: full closure', () => {
  test('B1 revokes direct rating writes from authenticated', () => {
    const { code } = load(fileFor(B1, stageBDir), stageBDir);
    expect(code).toContain('DROP POLICY IF EXISTS rating_adjustments_insert_authenticated');
    expect(code).toContain('REVOKE INSERT, UPDATE, DELETE ON public.rating_adjustments FROM authenticated');
    expect(code).toContain('REVOKE INSERT, UPDATE, DELETE ON public.no_show_recovery_state FROM authenticated');
  });

  test('B2 leaves notifications insert as self-only', () => {
    const { code } = load(fileFor(B2, stageBDir), stageBDir);
    expect(code).toContain('DROP POLICY IF EXISTS notifications_insert_related_or_self');
    expect(code).toContain('CREATE POLICY notifications_insert_self_only');
    expect(code).toContain('WITH CHECK (user_id = auth.uid())');
  });

  test('B3 drops the anon INSERT on the bucket (no anon write remains)', () => {
    const { code } = load(fileFor(B3, stageBDir), stageBDir);
    expect(code).toContain('DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_insert ON storage.objects');
  });
});
