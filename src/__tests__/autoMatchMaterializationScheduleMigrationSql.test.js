import fs from 'fs';
import path from 'path';

const migration = path.join(
  process.cwd(),
  'supabase/migrations/20260715003000_auto_match_materialization_schedule_fix.sql',
);
const sql = fs.readFileSync(migration, 'utf8');

const functionBody = (name) => sql.match(
  new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'),
)?.[0] || '';

describe('auto-match final materialization schedule migration', () => {
  test('response mutates only its addressed proposal and has no schedule conflict path', () => {
    const response = functionBody('respond_to_auto_match_proposal');
    expect(response).not.toMatch(/proposal_schedule_conflict|schedule_conflict/i);
    expect(response).not.toMatch(/auto_match_play_range|user_has_overlapping/i);
    expect(response).not.toMatch(/tmp_auto_match_response_proposal_locks|v_overlap/i);
    expect(response).toMatch(/where id = p_proposal_id\s+for update/i);
  });

  test('legacy overlap helpers cannot consume availability during gestation', () => {
    expect(functionBody('user_has_overlapping_auto_match')).toMatch(/select false/i);
    expect(functionBody('user_declined_auto_match_slot')).toMatch(/select false/i);
    expect(functionBody('backfill_auto_match_proposal_members')).not.toMatch(/overlapping|declined_auto_match_slot/i);
  });

  test('materialization derives alternatives from immutable snapshots', () => {
    const finalize = functionBody('finalize_auto_match_proposal');
    expect(finalize).toMatch(/tmp_auto_match_final_roster/i);
    expect(finalize).toMatch(/generate_series\([\s\S]*interval '15 minutes'/i);
    expect(finalize).toMatch(/snapshot_days_of_week/i);
    expect(finalize).toMatch(/snapshot_time_start/i);
    expect(finalize).toMatch(/snapshot_time_end/i);
    expect(finalize).toMatch(/snapshot_timezone/i);
    expect(finalize).toMatch(/order by c\.requested desc/i);
  });

  test('120-minute half-open ranges compare only candidate real matches', () => {
    const finalize = functionBody('finalize_auto_match_proposal');
    expect(finalize).toMatch(/join public\.partidos pa/i);
    expect(finalize).toMatch(/auto_match_play_range\([\s\S]*&&[\s\S]*auto_match_play_range/i);
    expect(sql).toMatch(/interval '120 minutes'/i);
    expect(functionBody('respond_to_auto_match_proposal')).not.toMatch(/120 minutes|auto_match_play_range/i);
    expect(functionBody('backfill_auto_match_proposal_members')).not.toMatch(/120 minutes|auto_match_play_range/i);
  });

  test('no compatible time leaves the ready proposal untouched', () => {
    const finalize = functionBody('finalize_auto_match_proposal');
    expect(finalize).toMatch(/if v_final_start is null then\s+raise exception 'no_compatible_final_time'/i);
    expect(finalize.indexOf("raise exception 'no_compatible_final_time'"))
      .toBeLessThan(finalize.indexOf('insert into public.partidos'));
    expect(finalize).not.toMatch(/auto_match_cancelled|status = 'cancelled'/i);
  });

  test('materializations serialize players and persist the chosen start atomically', () => {
    const finalize = functionBody('finalize_auto_match_proposal');
    expect(finalize).toMatch(/order by r\.user_id/i);
    expect(finalize).toMatch(/pg_advisory_xact_lock\([\s\S]*auto_match_materialize_user/i);
    expect(finalize).toMatch(/insert into public\.partidos/i);
    expect(finalize).toMatch(/proposed_starts_at = v_final_start/i);
  });

  test('automatic schedule exits and availability-resave expiries are repaired', () => {
    const reconcile = functionBody('reconcile_auto_match_proposal_members');
    expect(reconcile).toMatch(/response_reason = 'schedule_conflict'/i);
    expect(reconcile).toMatch(/set response = 'pending'/i);
    expect(reconcile).toMatch(/'availability_ineligible'/i);
    expect(reconcile).not.toMatch(/user_has_overlapping_auto_match/i);
    expect(reconcile).toMatch(/auto_match_member_snapshots_are_compatible/i);
  });
});
