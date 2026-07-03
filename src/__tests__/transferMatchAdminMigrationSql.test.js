import fs from 'fs';
import path from 'path';

const migrationPath = path.resolve(
  process.cwd(),
  'supabase/migrations/20260703150623_transfer_match_admin.sql',
);

describe('transfer_match_admin migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const normalized = sql.replace(/\s+/g, ' ');

  test('authenticates and authorizes the current match admin', () => {
    expect(normalized).toContain('v_actor_id uuid := auth.uid()');
    expect(normalized).toContain('IF v_current_admin_id IS DISTINCT FROM v_actor_id THEN');
    expect(normalized).toContain("'not_match_admin'");
  });

  test('only transfers to a registered player in the same match', () => {
    expect(normalized).toContain('FROM public.jugadores j');
    expect(normalized).toContain('j.partido_id = p_partido_id');
    expect(normalized).toContain('j.usuario_id = p_new_admin_user_id');
    expect(normalized).toContain("'target_not_eligible'");
  });

  test('updates ownership and exposes the RPC only to authenticated callers', () => {
    expect(normalized).toContain('SET creado_por = p_new_admin_user_id');
    expect(normalized).toContain(
      'REVOKE ALL ON FUNCTION public.transfer_match_admin(bigint, uuid) FROM PUBLIC, anon',
    );
    expect(normalized).toContain(
      'GRANT EXECUTE ON FUNCTION public.transfer_match_admin(bigint, uuid) TO authenticated',
    );
  });
});
