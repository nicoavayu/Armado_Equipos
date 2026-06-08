const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260608044450_harden_survey_closure_rpc.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('finalize_match_survey_closure SQL hardening', () => {
  test('rejects a direct close before the last eligible vote and before deadline', () => {
    expect(normalizedSql).toContain("v_closure_allowed := v_all_eligible_voted OR v_deadline_reached");
    expect(normalizedSql).toContain("IF NOT v_closure_allowed THEN RETURN jsonb_build_object");
    expect(normalizedSql).toContain("'reason', 'closure_not_ready'");
    expect(normalizedSql).toContain("'closed_by_this_call', false");
  });

  test('allows the last eligible voter path using DB-counted eligible responses', () => {
    expect(normalizedSql).toContain("public.resolve_partido_survey_notification_recipients(p_partido_id)");
    expect(normalizedSql).toContain("j.usuario_id = ANY(v_eligible_user_ids)");
    expect(normalizedSql).toContain(
      "v_all_eligible_voted := v_effective_expected_voters > 0 AND v_submitted_voters >= v_effective_expected_voters",
    );
  });

  test('allows deadline closure only from DB-derived deadline state', () => {
    expect(normalizedSql).toContain("v_stored_closes_at := v_match.survey_closes_at");
    expect(normalizedSql).toContain("AT TIME ZONE 'America/Argentina/Buenos_Aires'");
    expect(normalizedSql).toContain("v_canonical_closes_at := v_canonical_opened_at + interval '24 hours'");
    expect(normalizedSql).toContain("v_deadline_reached := v_effective_closes_at IS NOT NULL AND now() >= v_effective_closes_at");
  });

  test('keeps already closed calls idempotent before the readiness guard', () => {
    const alreadyClosedIndex = normalizedSql.indexOf("IF v_survey_status = 'closed' THEN");
    const closureNotReadyIndex = normalizedSql.indexOf("'reason', 'closure_not_ready'");

    expect(alreadyClosedIndex).toBeGreaterThan(-1);
    expect(closureNotReadyIndex).toBeGreaterThan(-1);
    expect(alreadyClosedIndex).toBeLessThan(closureNotReadyIndex);
    expect(normalizedSql).toContain("'already_closed', true");
  });

  test('does not let RPC input lower the expected voter quorum', () => {
    expect(normalizedSql).toContain(
      "v_effective_expected_voters := GREATEST( v_stored_expected_voters, v_expected_voters, v_eligible_user_count )",
    );
    expect(normalizedSql).toContain(
      "survey_expected_voters = GREATEST(COALESCE(p.survey_expected_voters, 0), v_effective_expected_voters)",
    );
  });
});
