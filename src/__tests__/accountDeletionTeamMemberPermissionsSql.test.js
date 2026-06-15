const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260615201614_fix_team_member_permissions_for_account_deletion.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('account deletion team_members permission trigger migration', () => {
  test('checks team existence separately from nullable owner_user_id', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.enforce_team_member_permissions()');
    expect(normalizedSql).toContain('v_team_exists boolean := false');
    expect(normalizedSql).toContain('SELECT true, t.owner_user_id INTO v_team_exists, v_team_owner');
    expect(normalizedSql).toContain('IF NOT COALESCE(v_team_exists, false) THEN');
    expect(normalizedSql).toContain("RAISE EXCEPTION 'Equipo no encontrado para team_member'");
    expect(normalizedSql).not.toContain('IF v_team_owner IS NULL THEN RAISE EXCEPTION');
  });

  test('allows account deletion to detach user_id before jugador backfill runs', () => {
    const detachIndex = normalizedSql.indexOf("AND OLD.user_id IS NOT NULL AND NEW.user_id IS NULL");
    const jugadorBackfillIndex = normalizedSql.indexOf('SELECT j.usuario_id INTO NEW.user_id');

    expect(detachIndex).toBeGreaterThan(-1);
    expect(jugadorBackfillIndex).toBeGreaterThan(-1);
    expect(detachIndex).toBeLessThan(jugadorBackfillIndex);
    expect(normalizedSql.indexOf('RETURN NEW; END IF; IF NEW.user_id IS NULL THEN')).toBeGreaterThan(detachIndex);
  });

  test('keeps normal role validation and admin-transfer permission checks', () => {
    expect(normalizedSql).toContain("NEW.permissions_role NOT IN ('owner', 'admin', 'member')");
    expect(normalizedSql).toContain("RAISE EXCEPTION 'Solo el owner real del equipo puede tener permissions_role owner'");
    expect(normalizedSql).toContain("COALESCE(v_role, '') = 'service_role'");
    expect(normalizedSql).toContain('public.team_user_is_admin_or_owner(NEW.team_id, v_uid)');
    expect(normalizedSql).toContain("RAISE EXCEPTION 'Solo admin puede asignar roles administrativos'");
    expect(normalizedSql).toContain("RAISE EXCEPTION 'Solo admin puede cambiar roles administrativos'");
  });

  test('runs as one transaction and only replaces the trigger function', () => {
    expect(normalizedSql).toContain('BEGIN;');
    expect(normalizedSql).toContain('COMMIT;');
    expect(normalizedSql).not.toContain('DROP TRIGGER');
    expect(normalizedSql).not.toContain('DROP TABLE');
    expect(normalizedSql).not.toContain('DELETE FROM');
  });
});
