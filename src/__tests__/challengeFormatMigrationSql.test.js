const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260614000629_allow_challenge_format_edit_with_existing_team_matches.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('challenge/team_match format migration', () => {
  test('does not require team_matches.format to match challenges.format', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.validate_team_match_payload()');
    expect(normalizedSql).not.toContain('NEW.format <> v_challenge.format');
    expect(normalizedSql).not.toContain('team_matches.format debe coincidir con challenges.format');
  });

  test('keeps standalone team_matches format validation intact', () => {
    expect(normalizedSql).toContain('IF NEW.challenge_id IS NULL THEN IF NEW.format <> v_team_a_format OR NEW.format <> v_team_b_format THEN');
    expect(normalizedSql).toContain('team_matches.format debe coincidir con formato de ambos equipos');
  });

  test('syncs the active challenge to the edited match format', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_update_team_match_details(');
    expect(normalizedSql).toContain('UPDATE public.challenges c SET format = p_format, match_format = p_format');
    expect(normalizedSql).toContain('UPDATE public.team_matches tm SET scheduled_at = p_scheduled_at');
    expect(normalizedSql.indexOf('UPDATE public.challenges c SET format = p_format')).toBeLessThan(
      normalizedSql.indexOf('UPDATE public.team_matches tm SET scheduled_at = p_scheduled_at'),
    );
  });

  test('creates new challenge-origin team_matches from the current challenge format', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_accept_challenge(');
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_confirm_challenge(');
    expect(normalizedSql).toContain('v_challenge.format, v_challenge.mode, v_challenge.scheduled_at');
    expect(normalizedSql).not.toContain('Formato invalido para aceptar challenge: ambos equipos deben ser del mismo formato');
    expect(normalizedSql).not.toContain('No se puede confirmar: ambos equipos deben compartir formato');
  });
});
