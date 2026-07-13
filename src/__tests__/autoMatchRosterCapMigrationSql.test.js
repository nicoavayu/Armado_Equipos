import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260713120000_auto_match_roster_cap_and_promotion.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('auto match roster cap + promotion migration (§3/§4/§5/§6)', () => {
  test('§3 centralises final_roster_capacity = required + 4 in one place', () => {
    expect(sql).toMatch(/create or replace function public\.auto_match_max_substitutes\(\)/i);
    expect(sql).toMatch(/create or replace function public\.auto_match_final_roster_capacity\(p_format text\)/i);
    expect(sql).toMatch(/auto_match_required_players\(p_format\) \+ public\.auto_match_max_substitutes\(\)/i);
  });

  test('§3 adds the waitlisted state and keeps it out of chat / broadcast', () => {
    expect(sql).toMatch(/check \(response in \('pending', 'accepted', 'declined', 'expired', 'waitlisted'\)\)/i);
    // El helper de chat excluye waitlisted (no accede al chat del partido).
    expect(sql).toMatch(/response not in \('declined', 'expired', 'waitlisted'\)/i);
    // Tipos de notificación nuevos.
    expect(sql).toMatch(/'auto_match_waitlisted'/);
    expect(sql).toMatch(/'auto_match_starter_invite'/);
    expect(sql).toMatch(/'auto_match_promoted'/);
  });

  test('§3 finalize caps the roster and waitlists the surplus confirmed players', () => {
    expect(sql).toMatch(/v_final_cap := public\.auto_match_final_roster_capacity\(v_proposal\.format\)/i);
    // Solo entran los primeros final_cap por confirmed_at.
    expect(sql).toMatch(/where ordered\.rn <= v_final_cap/i);
    // Los excedentes quedan waitlisted (no rechazados) y reciben "el plantel se completó".
    expect(sql).toMatch(/set response = 'waitlisted', responded_at = now\(\)/i);
    expect(sql).toMatch(/'auto_match_waitlisted'[\s\S]*El plantel se completó/i);
  });

  test('§6 substitute accept uses the centralised cap; invites differentiate titular vs suplente', () => {
    expect(sql).toMatch(/v_count >= public\.auto_match_final_roster_capacity\(v_proposal\.format\)/i);
    // Vacante de titular vs banco de suplente => distinto tipo/CTA (slot_kind).
    expect(sql).toMatch(/if v_jugadores < v_cupo then[\s\S]*'auto_match_starter_invite'/i);
    expect(sql).toMatch(/Hay un lugar disponible/i);
    expect(sql).toMatch(/Los titulares ya están completos/i);
    // La invitación abre la vista de invitación asociada al partido (?invite=).
    expect(sql).toMatch(/\/quiero-jugar\?auto=1&invite=/i);
    // Prioriza la lista de espera antes que compatibles nuevos.
    expect(sql).toMatch(/and m\.response = 'waitlisted'[\s\S]*order by m\.confirmed_at asc nulls last/i);
  });

  test('§5 an AFTER DELETE trigger on jugadores notifies the promoted starter and the organizer', () => {
    expect(sql).toMatch(/create or replace function public\.auto_match_notify_promotion\(\)/i);
    expect(sql).toMatch(/after delete on public\.jugadores\s*\n\s*for each row/i);
    expect(sql).toMatch(/'auto_match_promoted'/);
    // Solo promueve si el borrado estaba delante del nuevo titular #cupo.
    expect(sql).toMatch(/if OLD\.created_at >= v_promoted\.created_at then return null; end if;/i);
    // Idempotente por partido+usuario.
    expect(sql).toMatch(/format\('promoted:%s:%s', v_partido\.id, v_promoted\.usuario_id\)/i);
  });

  test('§4 sync no longer throttles new rooms per format (guard removed)', () => {
    expect(sql).toMatch(/create or replace function public\.sync_my_auto_match_gestations\(\)/i);
    // Se eliminó el guard de "una sala nueva por formato por corrida": ya no hay
    // ni la declaración ni el `if ... then continue` que lo aplicaba.
    expect(sql).not.toMatch(/if v_created_this_format then/i);
    expect(sql).not.toMatch(/v_created_this_format\s+boolean/i);
    expect(sql).not.toMatch(/v_created_this_format\s*:=/i);
  });

  test('get_my_auto_match_proposals excludes waitlisted and exposes roster_slot_kind', () => {
    expect(sql).toMatch(/roster_slot_kind text/i);
    expect(sql).toMatch(/final_roster_capacity integer/i);
    expect(sql).toMatch(/and mine\.response not in \('declined', 'expired', 'waitlisted'\)/i);
  });

  test('is a later incremental migration wrapped in one transaction', () => {
    expect(migrationPath).toMatch(/20260713120000_auto_match_roster_cap_and_promotion\.sql$/);
    expect(20260713120000).toBeGreaterThan(20260712230000);
    expect(sql).toMatch(/^begin;/im);
    expect(sql).toMatch(/commit;\s*$/im);
    expect(sql.search(/^begin;/im)).toBeLessThan(sql.search(/commit;\s*$/im));
  });
});
