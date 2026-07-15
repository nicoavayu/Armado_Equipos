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

  test('makes retries idempotent without treating gestations as reservations', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('auto_match_response:' \|\| auth\.uid\(\)::text\)\)/i);
    expect(sql).toMatch(/p_response = 'accepted' and v_member\.response = 'accepted'/i);
  });

  test('stores typed immutable snapshots and keeps the source FK non-destructive', () => {
    expect(sql).toMatch(/source_availability_id bigint/i);
    expect(sql).toMatch(/snapshot_latitude double precision/i);
    expect(sql).toMatch(/snapshot_days_of_week smallint\[\]/i);
    expect(sql).toMatch(/snapshot_time_start time/i);
    expect(sql).toMatch(/snapshot_formats text\[\]/i);
    expect(sql).toMatch(/snapshot_complete boolean/i);
    expect(sql).toMatch(/snapshot_taken_at timestamptz/i);
    expect(sql).toMatch(/on delete set null/i);
    expect(sql).toMatch(/prevent_auto_match_member_snapshot_update/i);
    expect(sql).not.toMatch(/set availability_id = new\.id/i);
  });

  test('reconciles accepted-first and expires incompatible pending members', () => {
    expect(sql).toMatch(/reconcile_auto_match_proposal_members/i);
    expect(sql).toMatch(/m\.confirmed_at is not null/i);
    expect(sql).toMatch(/response_reason = 'geographic_incompatibility'/i);
    expect(sql).toMatch(/backfill_auto_match_proposal_members\(p_proposal_id\)/i);
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

  test('locks every crossed proposal in ascending order before responses or exits', () => {
    expect(sql).toMatch(/tmp_auto_match_response_proposal_locks/i);
    expect(sql).toMatch(/order by p\.id\s+for update of p/i);
    expect(sql).toMatch(/for v_overlap in[\s\S]*order by p\.id/i);
  });
});
