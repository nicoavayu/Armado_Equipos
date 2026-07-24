const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');

// Executable SQL only (strip `--` comment lines so rollback SQL / prose in
// comments does not trip the assertions), and the raw text for transaction checks.
const load = (file) => {
  const raw = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
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

const fileFor = (suffix) =>
  fs.readdirSync(migrationsDir).find((f) => f.endsWith(suffix));

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
    const { code } = load(fileFor(B1));
    expect(code).toContain('DROP POLICY IF EXISTS rating_adjustments_insert_authenticated');
    expect(code).toContain('REVOKE INSERT, UPDATE, DELETE ON public.rating_adjustments FROM authenticated');
    expect(code).toContain('REVOKE INSERT, UPDATE, DELETE ON public.no_show_recovery_state FROM authenticated');
  });

  test('B2 leaves notifications insert as self-only', () => {
    const { code } = load(fileFor(B2));
    expect(code).toContain('DROP POLICY IF EXISTS notifications_insert_related_or_self');
    expect(code).toContain('CREATE POLICY notifications_insert_self_only');
    expect(code).toContain('WITH CHECK (user_id = auth.uid())');
  });

  test('B3 drops the anon INSERT on the bucket (no anon write remains)', () => {
    const { code } = load(fileFor(B3));
    expect(code).toContain('DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_insert ON storage.objects');
  });
});
