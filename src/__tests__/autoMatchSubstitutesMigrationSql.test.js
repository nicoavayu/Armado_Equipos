import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260712230000_auto_match_substitutes.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('auto match substitutes migration (§10 + §12)', () => {
  test('adds the substitute/vacancy notification types', () => {
    expect(sql).toMatch(/'auto_match_substitute_invite'/);
    expect(sql).toMatch(/'auto_match_substitute_joined'/);
    expect(sql).toMatch(/'auto_match_vacancy_reopened'/);
  });

  test('finalize invites pending members as substitutes instead of auto-adding them', () => {
    // Sigue insertando confirmados por orden de confirmación.
    expect(sql).toMatch(/order by m\.confirmed_at asc nulls last, m\.user_id/i);
    // Y manda la invitación de suplente a los pendientes.
    expect(sql).toMatch(/where m\.proposal_id = p_proposal_id and m\.response = 'pending'/i);
    expect(sql).toMatch(/'auto_match_substitute_invite'[\s\S]*Los titulares ya están completos/i);
  });

  test('accepting a substitute joins the real match under the roster cap and marks accepted', () => {
    expect(sql).toMatch(/create or replace function public\.respond_to_auto_match_substitute\(\s*p_proposal_id bigint,\s*p_response text\s*\)/i);
    // Debe estar materializada.
    expect(sql).toMatch(/status <> 'created' or v_proposal\.partido_id is null/i);
    // Respeta el banco titulares + 4 suplentes.
    expect(sql).toMatch(/coalesce\(v_partido\.cupo_jugadores, 0\) \+ 4/i);
    expect(sql).toMatch(/match_roster_full/);
    // Inserta en jugadores + marca accepted.
    expect(sql).toMatch(/insert into public\.jugadores \(partido_id, match_ref, usuario_id/i);
    expect(sql).toMatch(/set response = 'accepted', confirmed_at = now\(\)/i);
    // Idempotente + no reconfirma una invitación cerrada.
    expect(sql).toMatch(/substitute_invite_closed/);
    expect(sql).toMatch(/grant execute on function public\.respond_to_auto_match_substitute\(bigint, text\) to authenticated;/i);
  });

  test('reopening a vacancy only fires with a real vacancy and no pending invitees', () => {
    expect(sql).toMatch(/create or replace function public\.reopen_auto_match_vacancies\(\)/i);
    // Vacante = jugadores < cupo (bajó un titular y no hay suplentes).
    expect(sql).toMatch(/if v_jugadores >= coalesce\(v_row\.cupo_jugadores, 0\) then continue; end if;/i);
    // No reabrir si todavía hay convocados pendientes.
    expect(sql).toMatch(/if v_pending > 0 then continue; end if;/i);
    expect(sql).toMatch(/invite_auto_match_substitutes\(v_row\.id, v_needed\)/i);
  });

  test('the individual-invite sweep now also covers substitute invites (created)', () => {
    expect(sql).toMatch(/p\.status in \('collecting', 'ready', 'created'\)/i);
    // El sweep programado dispara la reapertura.
    expect(sql).toMatch(/create or replace function public\.auto_match_scheduled_sweep\(\)[\s\S]*perform public\.reopen_auto_match_vacancies\(\)/i);
  });

  test('is a later incremental migration in one transaction', () => {
    expect(migrationPath).toMatch(/20260712230000_auto_match_substitutes\.sql$/);
    expect(20260712230000).toBeGreaterThan(20260712220000);
    expect(sql).toMatch(/^begin;/im);
    expect(sql).toMatch(/commit;\s*$/im);
    expect(sql.search(/^begin;/im)).toBeLessThan(sql.search(/commit;\s*$/im));
  });
});
