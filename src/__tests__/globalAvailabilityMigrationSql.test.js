import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260831200904_global_availability_atomic_contract.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('global availability atomic migration', () => {
  test('defines one self-scoped boolean RPC with a hardened definer contract', () => {
    expect(sql).toMatch(/function public\.set_my_global_availability\(p_enabled boolean\)/i);
    expect(sql).toMatch(/security definer\s+set search_path = ''/i);
    expect(sql).toMatch(/v_uid uuid := auth\.uid\(\)/i);
    expect(sql).not.toMatch(/set_my_global_availability\([^)]*user_id/i);
  });

  test('serializes first and composes the certified Auto-Match cancellation', () => {
    expect(sql).toMatch(/perform public\.auto_match_lock_user\(v_uid\)/i);
    expect(sql).toMatch(/from public\.cancel_my_availability_detailed\(\)/i);
    expect(sql).not.toMatch(/update public\.player_availability/i);
    expect(sql).not.toMatch(/insert into public\.player_availability/i);
  });

  test('enables invitations and one free-player row without starting Auto-Match', () => {
    expect(sql).toMatch(/set acepta_invitaciones = p_enabled/i);
    expect(sql).toMatch(/insert into public\.jugadores_sin_partido/i);
    expect(sql).toMatch(/set disponible = \(free_player\.id = v_free_player_id\)/i);
    expect(sql).toMatch(/'autoMatchStarted', false/i);
  });

  test('exposes EXECUTE only to authenticated', () => {
    expect(sql).toMatch(/revoke all on function public\.set_my_global_availability\(boolean\)\s+from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.set_my_global_availability\(boolean\)\s+to authenticated/i);
    expect(sql).toMatch(/^begin;[\s\S]*commit;\s*$/i);
  });
});
