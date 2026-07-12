import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260712120000_auto_match_proposal_chat.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('auto match proposal chat migration', () => {
  test('adds a proposal_id scope column with cascade + partial index', () => {
    expect(sql).toMatch(/alter table public\.mensajes_partido\s+add column if not exists proposal_id bigint null\s+references public\.auto_match_proposals\(id\) on delete cascade/i);
    expect(sql).toMatch(/create index if not exists mensajes_partido_proposal_timestamp_idx[\s\S]*where proposal_id is not null/i);
  });

  test('membership helper only counts non-declined members and is locked down', () => {
    expect(sql).toMatch(/create or replace function public\.auto_match_user_in_proposal\(\s*p_proposal_id bigint,\s*p_user_id uuid\s*\)/i);
    expect(sql).toMatch(/m\.user_id = p_user_id\s+and m\.response <> 'declined'/i);
    expect(sql).toMatch(/revoke all on function public\.auto_match_user_in_proposal\(bigint, uuid\) from public, anon;/i);
    expect(sql).toMatch(/grant execute on function public\.auto_match_user_in_proposal\(bigint, uuid\) to authenticated, service_role;/i);
  });

  test('the select policy stops proposal rows from leaking through the public branch', () => {
    // La rama "pública" del partido regular ahora exige AMBOS scopes en NULL:
    // sin esto, los mensajes de gestación (team_match_id NULL) quedarían
    // visibles para cualquier usuario autenticado.
    expect(sql).toMatch(/team_match_id is null\s+and proposal_id is null/i);
    // Y hay una rama propia restringida a los miembros de la propuesta.
    expect(sql).toMatch(/proposal_id is not null\s+and public\.auto_match_user_in_proposal\(mensajes_partido\.proposal_id, auth\.uid\(\)\)/i);
    // La rama de equipos se conserva.
    expect(sql).toMatch(/team_match_id is not null\s+and exists/i);
  });

  test('the send RPC checks membership before inserting and is locked down', () => {
    expect(sql).toMatch(/create or replace function public\.send_auto_match_proposal_chat_message\(\s*p_proposal_id bigint,\s*p_autor text,\s*p_mensaje text\s*\)/i);
    expect(sql).toMatch(/if not public\.auto_match_user_in_proposal\(p_proposal_id, v_uid\) then/i);
    expect(sql).toMatch(/insert into public\.mensajes_partido \(partido_id, team_match_id, proposal_id, autor, mensaje, user_id\)/i);
    expect(sql).toMatch(/revoke all on function public\.send_auto_match_proposal_chat_message\(bigint, text, text\) from public, anon;/i);
    expect(sql).toMatch(/grant execute on function public\.send_auto_match_proposal_chat_message\(bigint, text, text\) to authenticated, service_role;/i);
  });

  test('the send RPC keeps closed proposals read-only (cancelled/expired/created)', () => {
    // El historial se conserva vía la policy SELECT (por membresía, sin mirar
    // el estado), pero el envío exige una gestación viva: collecting|ready y
    // todavía dentro de expires_at.
    expect(sql).toMatch(/status in \('collecting', 'ready'\)\s+and p\.expires_at > now\(\)/i);
    expect(sql).toMatch(/ya no admite mensajes nuevos/i);
    // La liveness se comprueba DESPUÉS de la membresía: un no-miembro recibe
    // "sin permiso" y nunca se entera del estado de la propuesta.
    expect(sql.search(/if not public\.auto_match_user_in_proposal\(p_proposal_id, v_uid\)/i))
      .toBeLessThan(sql.search(/ya no admite mensajes nuevos/i));
  });

  test('runs inside a single transaction', () => {
    expect(sql).toMatch(/\bBEGIN;/i);
    expect(sql).toMatch(/\bCOMMIT;/i);
    // BEGIN antes que COMMIT.
    expect(sql.search(/\bBEGIN;/i)).toBeLessThan(sql.search(/\bCOMMIT;/i));
  });
});
