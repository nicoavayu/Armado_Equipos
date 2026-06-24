const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260624214947_player_registered_invites_opt_in.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim();
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

describe('player registered invites opt-in migration', () => {
  test('agrega player_invites_enabled con default false', () => {
    expect(normalized).toContain('ADD COLUMN IF NOT EXISTS player_invites_enabled boolean NOT NULL DEFAULT false');
    expect(normalized).toContain('COMMENT ON COLUMN public.partidos.player_invites_enabled');
  });

  test('reemplaza y endurece send_match_invite preservando la firma actual', () => {
    expect(normalized).toContain('CREATE OR REPLACE FUNCTION public.send_match_invite( p_user_id uuid, p_partido_id bigint, p_title text, p_message text, p_invite_mode text DEFAULT');
    expect(normalized).toContain('RETURNS jsonb');
    expect(normalized).toContain('SECURITY DEFINER');
    expect(normalized).toContain('SET search_path = public');
  });

  test('revoca PUBLIC y anon, y concede sólo a authenticated', () => {
    expect(normalized).toContain('REVOKE ALL ON FUNCTION public.send_match_invite(uuid, bigint, text, text, text) FROM PUBLIC');
    expect(normalized).toContain('REVOKE ALL ON FUNCTION public.send_match_invite(uuid, bigint, text, text, text) FROM anon');
    expect(normalized).toContain('GRANT EXECUTE ON FUNCTION public.send_match_invite(uuid, bigint, text, text, text) TO authenticated');
    expect(code).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.send_match_invite\([^)]*\)\s+TO\s+anon/i);
  });

  test('usa auth.uid y valida admin o jugador confirmado con flag activo', () => {
    expect(normalized).toContain('v_actor_id uuid := auth.uid()');
    expect(normalized).toContain('j.partido_id = p_partido_id AND j.usuario_id = v_actor_id');
    expect(normalized).toContain('IF v_actor_id <> v_match_admin_id THEN');
    expect(normalized).toContain("RAISE EXCEPTION 'actor_not_in_match'");
    expect(normalized).toContain("RAISE EXCEPTION 'player_invites_disabled'");
    expect(normalized).toContain('v_player_invites_enabled');
  });

  test('mantiene request_join separado de invitacion directa', () => {
    expect(normalized).toContain("IF v_invite_mode = 'request_join' THEN");
    expect(normalized).toContain("RAISE EXCEPTION 'invitations_closed'");
    expect(normalized).toContain("ELSIF NOT v_player_invites_enabled THEN RAISE EXCEPTION 'player_invites_disabled'");
  });

  test('valida partido no cerrado, destinatario registrado, pertenencia previa y cupos', () => {
    expect(normalized).toContain('public.normalize_partido_estado(p.estado)');
    expect(normalized).toContain("RAISE EXCEPTION 'match_not_open_for_invites'");
    expect(normalized).toContain('FROM public.usuarios u WHERE u.id = p_user_id');
    expect(normalized).toContain("RAISE EXCEPTION 'recipient_not_found'");
    expect(normalized).toContain("RETURN jsonb_build_object('status', 'already_in_match')");
    expect(normalized).toContain("RETURN jsonb_build_object('status', 'roster_full')");
  });

  test('bloquea estados raw legacy cerrados o finalizados', () => {
    const rawStatusGuard = normalized.match(/lower\(trim\(COALESCE\(v_match_estado_raw, ''\)\)\) IN \(([^)]*)\)/);

    expect(rawStatusGuard?.[1]).toBeTruthy();
    [
      'cerrado',
      'closed',
      'cancelado',
      'finalizado',
      'completed',
      'deleted',
    ].forEach((status) => {
      expect(rawStatusGuard[1]).toContain(`'${status}'`);
    });
  });

  test('evita invitaciones pendientes duplicadas y conserva upsert seguro', () => {
    expect(normalized).toContain("v_existing_invite_status = 'pending'");
    expect(normalized).toContain("RETURN jsonb_build_object('status', 'already_pending')");
    expect(normalized).toContain("ON CONFLICT (user_id, (data ->> 'match_id'), type)");
  });

  test('no toca guest invite, public voting, storage ni RLS amplia', () => {
    [
      'create_guest_match_invite',
      'consume_guest_match_invite',
      'validate_guest_match_invite',
      'public_get_or_create_voter',
      'public_submit_player_rating',
      'public_mark_voter_completed',
      'storage.objects',
      'CREATE POLICY',
      'ALTER POLICY',
      'DROP POLICY',
    ].forEach((term) => expect(code).not.toContain(term));
  });
});
