import fs from 'fs';
import path from 'path';

const migration = path.join(
  process.cwd(),
  'supabase/migrations/20260714223000_auto_match_response_and_real_overlap_fix.sql',
);
const sql = fs.readFileSync(migration, 'utf8');

describe('auto-match response and real-overlap migration', () => {
  test('uses concrete 120-minute half-open match intervals', () => {
    expect(sql).toMatch(/interval '120 minutes'/i);
    expect(sql).toMatch(/tstzrange\([\s\S]*'\[\)'/i);
    expect(sql).not.toMatch(/proposed_starts_at - interval '30 minutes'/i);
    expect(sql).not.toMatch(/proposed_starts_at \+ interval '150 minutes'/i);
  });

  test('makes retries idempotent and schedule conflicts explicit', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('auto_match_response:' \|\| auth\.uid\(\)::text\)\)/i);
    expect(sql).toMatch(/p_response = 'accepted' and v_member\.response = 'accepted'/i);
    expect(sql).toMatch(/raise exception 'proposal_schedule_conflict'/i);
    expect(sql).toMatch(/response_reason = 'schedule_conflict'/i);
  });

  test('keeps accepted snapshots while preserving account eligibility', () => {
    expect(sql).toMatch(/m\.response = 'pending' and not public\.auto_match_availability_is_eligible/i);
    expect(sql).toMatch(/m\.response = 'accepted' and not public\.auto_match_account_is_eligible/i);
    expect(sql).toMatch(/rebind_auto_match_memberships_after_availability_insert/i);
  });

  test('does not cancel a whole gestation or enqueue cancellation on one exit', () => {
    const exitFunction = sql.match(/create or replace function public\.process_auto_match_member_exit[\s\S]*?\$\$;/i)?.[0] || '';
    expect(exitFunction).toMatch(/backfill_auto_match_proposal_members/i);
    expect(exitFunction).not.toMatch(/status = 'cancelled'/i);
    expect(exitFunction).not.toMatch(/auto_match_cancelled/i);
  });

  test('keeps RPC permissions scoped to authenticated users', () => {
    expect(sql).toMatch(/revoke all on function public\.respond_to_auto_match_proposal\(bigint,text,boolean\) from public, anon;/i);
    expect(sql).toMatch(/grant execute on function public\.respond_to_auto_match_proposal\(bigint,text,boolean\) to authenticated;/i);
  });
});
