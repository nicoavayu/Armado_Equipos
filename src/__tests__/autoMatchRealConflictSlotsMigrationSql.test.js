import fs from 'fs';
import path from 'path';

const migration = path.join(
  process.cwd(),
  'supabase/migrations/20260716120000_auto_match_real_conflict_slots_and_invite_capacity_race.sql',
);
const sql = fs.readFileSync(migration, 'utf8');

const functionBody = (name) => sql.match(
  new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'),
)?.[0] || '';

describe('auto-match real-conflict slots + invite capacity race migration', () => {
  test('is additive: no destructive DDL, no RLS, no cron changes', () => {
    expect(sql).not.toMatch(/drop\s+(table|column|index|constraint|policy)/i);
    expect(sql).not.toMatch(/alter\s+table/i);
    expect(sql).not.toMatch(/truncate\s+(?!tmp_)/i);
    expect(sql).not.toMatch(/(enable|disable)\s+row level security|create\s+policy|alter\s+policy/i);
    expect(sql).not.toMatch(/cron\.(schedule|unschedule|alter_job)/i);
    // The 5-minute job keeps calling auto_match_scheduled_sweep by name; this
    // migration must not redefine (nor reschedule) it.
    expect(sql).not.toMatch(/create or replace function public\.auto_match_scheduled_sweep/i);
    expect(sql.trim().startsWith('begin;')).toBe(true);
    expect(sql.trim().endsWith('commit;')).toBe(true);
  });

  test('every redefined function keeps an explicit search_path', () => {
    const defs = sql.match(/create or replace function[\s\S]*?\$\$;/gi) || [];
    expect(defs.length).toBeGreaterThan(0);
    for (const def of defs) {
      expect(def).toMatch(/set search_path = public/i);
    }
  });

  test('A2 candidate-slot helper reuses the materialization rules', () => {
    const window = functionBody('auto_match_window_has_free_slot');
    // Same 15-minute grid and ±120-minute span as finalize_auto_match_proposal.
    expect(window).toMatch(/generate_series\([\s\S]*interval '15 minutes'/i);
    expect(window).toMatch(/interval '120 minutes'/i);
    // Same local date restriction (Buenos Aires) and 60-minute remainder rule.
    expect(window).toMatch(/America\/Argentina\/Buenos_Aires/i);
    expect(window).toMatch(/interval '60 minutes'/i);
    // Reuses the shared half-open 120-minute overlap check against real matches.
    const conflict = functionBody('auto_match_user_real_match_conflict');
    expect(conflict).toMatch(/auto_match_play_range\([\s\S]*&&[\s\S]*auto_match_play_range/i);
    expect(conflict).toMatch(/partido_kickoff_at/i);
    expect(conflict).toMatch(/not in \('deleted', 'cancelado', 'cancelled', 'canceled', 'finalizado', 'finished', 'completed'\)/i);
    // A materialized opportunity has a single fixed candidate: its real time.
    expect(window).toMatch(/p_fixed_time/i);
  });

  test('A2 does not restore the global #621 overlap helpers', () => {
    // The neutralized shims stay `select false`; this migration must not redefine
    // them back to a global schedule block.
    expect(sql).not.toMatch(/create or replace function public\.user_has_overlapping_auto_match/i);
    expect(sql).not.toMatch(/create or replace function public\.user_declined_auto_match_slot/i);
    expect(functionBody('sync_my_auto_match_gestations'))
      .not.toMatch(/user_has_overlapping_auto_match|user_declined_auto_match_slot/i);
  });

  test('A2 gates invitation, cohorts and acceptance on a free candidate slot', () => {
    expect(functionBody('auto_match_availability_fits_proposal'))
      .toMatch(/auto_match_availability_has_free_slot/i);
    expect(functionBody('spawn_next_auto_match_cohort'))
      .toMatch(/auto_match_window_has_free_slot/i);
    const respond = functionBody('respond_to_auto_match_proposal');
    expect(respond).toMatch(/auto_match_member_has_free_slot/i);
    // Terminal, safe state + reuse of an error the 1.1.15 client already maps.
    expect(respond).toMatch(/response = 'expired'[\s\S]*response_reason = 'schedule_conflict'/i);
    expect(respond).toMatch(/backfill_auto_match_proposal_members/i);
  });

  test('A2 keeps the search active: sync continues per day/format', () => {
    const sync = functionBody('sync_my_auto_match_gestations');
    // A blocked slot uses `continue`, never cancels the whole availability.
    expect(sync).toMatch(/auto_match_window_has_free_slot\([\s\S]*then continue/i);
    expect(sync).not.toMatch(/update public\.player_availability[\s\S]*status = 'cancelled'/i);
  });

  test('A3 recounts invited members after acquiring the proposal lock', () => {
    const sync = functionBody('sync_my_auto_match_gestations');
    // Phase A still uses the deterministic skip-locked row lock...
    expect(sync).toMatch(/for update skip locked/i);
    // ...and now revalidates capacity/compatibility on a fresh count post-lock.
    expect(sync).toMatch(/A3:[\s\S]*select count\(\*\) into v_member_count[\s\S]*if v_member_count >= v_capacity/i);
    expect(sync).toMatch(/v_proposal := null/i);
    // Overbooking formula unchanged (defined elsewhere); F5 capacity stays 15.
    expect(sync).not.toMatch(/\* 1\.5|ceil\(/i);
  });

  test('reconciliation expires pending members with no free slot but keeps the room', () => {
    const reconcile = functionBody('reconcile_auto_match_proposal_members');
    expect(reconcile).toMatch(/auto_match_member_has_free_slot/i);
    expect(reconcile).toMatch(/v_reason := 'schedule_conflict'/i);
    expect(reconcile).toMatch(/backfill_auto_match_proposal_members/i);
    // Never cancels the proposal for a single conflicted member.
    expect(reconcile).not.toMatch(/status = 'cancelled'/i);
  });

  test('internal helpers stay privilege-revoked; public RPCs stay authenticated-only', () => {
    expect(sql).toMatch(/revoke all on function public\.auto_match_window_has_free_slot\([^)]*\) from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function public\.auto_match_user_real_match_conflict\([^)]*\) from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function public\.sync_my_auto_match_gestations\(\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.sync_my_auto_match_gestations\(\) to authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.respond_to_auto_match_proposal\([^)]*\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.respond_to_auto_match_proposal\([^)]*\) to authenticated/i);
    // No broadened grants to anon/public/service_role.
    expect(sql).not.toMatch(/grant execute on function[\s\S]*to (anon|public|service_role)/i);
  });
});
