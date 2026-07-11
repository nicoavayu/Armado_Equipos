import fs from 'fs';
import path from 'path';

const fixMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260711150000_fix_auto_match_gestation_sync.sql',
);
const sql = fs.readFileSync(fixMigrationPath, 'utf8');

describe('auto match gestation sync corrective migration', () => {
  test('candidate ordering runs over declared aliases in a subquery', () => {
    // The original migration ordered by overlap_end/overlap_start/distance_km
    // without ever declaring those aliases (42703 in prod).
    expect(sql).toMatch(/least\(v_mine\.time_end, other\.time_end\) as overlap_end/i);
    expect(sql).toMatch(/greatest\(v_mine\.time_start, other\.time_start\) as overlap_start/i);
    expect(sql).toMatch(/end as distance_km/i);
    expect(sql).toMatch(/\) c\s*order by c\.overlap_end - c\.overlap_start desc, c\.distance_km asc nulls last/i);
  });

  test('member count query cannot collide with the proposal_id OUT parameter', () => {
    // Unqualified "where proposal_id = ..." is ambiguous (42702) because the
    // function declares proposal_id as an OUT column.
    expect(sql).toMatch(/from public\.auto_match_proposal_members m\s*where m\.proposal_id = v_proposal\.id and m\.response <> 'declined';/i);
    expect(sql).not.toMatch(/where proposal_id = v_proposal\.id/i);
  });

  test('proposal fit check subtracts times instead of adding an interval', () => {
    // time + interval wraps at 24:00 (see 20260710101500), so the fit check
    // must be expressed as time_end - start_time >= interval.
    expect(sql).toMatch(/v_mine\.time_end - \(p\.proposed_starts_at at time zone v_mine\.timezone\)::time >= interval '60 minutes'/i);
    expect(sql).not.toMatch(/::time \+ interval '60 minutes'/i);
  });

  test('declined players are paused for the same slot to stop recreate loops', () => {
    expect(sql).toMatch(/create or replace function public\.user_declined_auto_match_slot/i);
    expect(sql).toMatch(/dm\.response = 'declined'/i);
    expect(sql).toMatch(/dm\.responded_at > now\(\) - interval '24 hours'/i);
    // Applied on join, on create, and per invited candidate.
    const usages = sql.match(/user_declined_auto_match_slot\(/gi) || [];
    expect(usages.length).toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/not public\.user_declined_auto_match_slot\(v_candidate\.user_id, v_format, v_proposed\)/i);
  });

  test('internal helper stays unavailable to clients', () => {
    expect(sql).toMatch(/revoke all on function public\.user_declined_auto_match_slot\(uuid,text,timestamptz\) from public, anon, authenticated;/i);
    expect(sql).toMatch(/grant execute on function public\.sync_my_auto_match_gestations\(\) to authenticated;/i);
  });
});
