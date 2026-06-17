const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260617120000_directed_team_challenges.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('directed team challenges migration', () => {
  test('adds challenged_team_id + expires_at with FK and indexes', () => {
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS challenged_team_id uuid NULL');
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL');
    expect(normalizedSql).toContain('challenges_challenged_team_id_fkey');
    expect(normalizedSql).toContain('REFERENCES public.teams(id)');
    expect(normalizedSql).toContain('ON DELETE SET NULL');
    expect(normalizedSql).toContain('challenges_challenged_team_id_idx');
  });

  test('widens the status check with rejected + expired', () => {
    expect(normalizedSql).toContain('DROP CONSTRAINT IF EXISTS challenges_status_check');
    expect(normalizedSql).toContain(
      "CHECK (status IN ('open', 'accepted', 'confirmed', 'completed', 'canceled', 'rejected', 'expired'))",
    );
  });

  test('validate_challenge_payload keeps prior rules and adds directed guards', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.validate_challenge_payload()');
    // prior rules preserved (verbatim)
    expect(normalizedSql).toContain('solo owner/capitan del challenger_team puede crear el challenge');
    expect(normalizedSql).toContain('solo owner/admin del accepted_team puede aceptar');
    // directed additions
    expect(normalizedSql).toContain('no podes desafiar a tu propio equipo');
    expect(normalizedSql).toContain('desafio dirigido: solo el equipo desafiado puede aceptar');
    expect(normalizedSql).toContain('solo el equipo desafiado puede rechazar');
    // new terminal states are immutable
    expect(normalizedSql).toContain(
      "IF OLD.status IN ('completed', 'canceled', 'rejected', 'expired') AND NEW.status <> OLD.status THEN",
    );
    // new transitions
    expect(normalizedSql).toContain("ELSIF OLD.status = 'open' AND NEW.status = 'rejected' THEN");
    expect(normalizedSql).toContain("ELSIF OLD.status = 'open' AND NEW.status = 'expired' THEN");
  });

  test('expiry: function + guarded pg_cron schedule', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.expire_stale_directed_challenges()');
    expect(normalizedSql).toContain("SET status = 'expired'");
    expect(normalizedSql).toContain('c.expires_at < now()');
    expect(normalizedSql).toContain("WHERE extname = 'pg_cron'");
    expect(normalizedSql).toContain("'directed_challenge_expiry_scheduler'");
    expect(normalizedSql).toContain('SELECT public.expire_stale_directed_challenges();');
  });

  test('rpc_create_directed_challenge enforces all MVP rules in backend', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_create_directed_challenge(');
    expect(normalizedSql).toContain('SECURITY DEFINER');
    // sweep stale first so limits count fresh state
    expect(normalizedSql).toContain('PERFORM public.expire_stale_directed_challenges();');
    // 2-open limit
    expect(normalizedSql).toContain('IF v_open_count >= 2 THEN');
    expect(normalizedSql).toContain('Ya tenés 2 desafíos abiertos. Cerrá uno pendiente para crear otro.');
    // 1 per day
    expect(normalizedSql).toContain("(p_scheduled_at AT TIME ZONE v_tz)::date");
    expect(normalizedSql).toContain('Ya tenés un desafío abierto para ese día.');
    // duplicate vs same rival
    expect(normalizedSql).toContain('Ya existe un desafío pendiente para ese equipo');
    // same format requirement + self-challenge guard
    expect(normalizedSql).toContain('Ambos equipos deben tener el mismo formato');
    expect(normalizedSql).toContain('No podes desafiar a tu propio equipo');
    // 48h expiry stored
    expect(normalizedSql).toContain("now() + interval '48 hours'");
    // received notification
    expect(normalizedSql).toContain("'team_challenge_received'");
    expect(normalizedSql).toContain('GRANT EXECUTE ON FUNCTION public.rpc_create_directed_challenge(uuid, uuid, timestamptz, text, text) TO authenticated, service_role');
  });

  test('rpc_reject_directed_challenge: only challenged team rejects + notifies creator', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_reject_directed_challenge(');
    expect(normalizedSql).toContain('Solo el equipo desafiado puede rechazar');
    expect(normalizedSql).toContain("SET status = 'rejected'");
    expect(normalizedSql).toContain("'team_challenge_rejected'");
    expect(normalizedSql).toContain('GRANT EXECUTE ON FUNCTION public.rpc_reject_directed_challenge(uuid) TO authenticated, service_role');
  });
});
