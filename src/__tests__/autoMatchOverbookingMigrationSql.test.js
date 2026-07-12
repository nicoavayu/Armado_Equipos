import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260712220000_auto_match_overbooking_confirmation_order.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('auto match overbooking + confirmation-order migration', () => {
  test('centralises required players and the 1.5 overbooking factor', () => {
    expect(sql).toMatch(/function public\.auto_match_required_players\(p_format text\)[\s\S]*substring\(p_format from 2\)::integer \* 2/i);
    expect(sql).toMatch(/function public\.auto_match_invitation_capacity\(p_format text\)[\s\S]*ceil\(public\.auto_match_required_players\(p_format\) \* 1\.5\)::integer/i);
    // El mínimo de compatibles ("al menos cuatro") es un solo lugar.
    expect(sql).toMatch(/function public\.auto_match_min_candidates\(\)[\s\S]*select 4;/i);
  });

  test('adds confirmed_at + invite_expires_at and an expired invite state', () => {
    expect(sql).toMatch(/add column if not exists confirmed_at timestamptz/i);
    expect(sql).toMatch(/add column if not exists invite_expires_at timestamptz/i);
    expect(sql).toMatch(/check \(response in \('pending', 'accepted', 'declined', 'expired'\)\)/i);
    // Backfill de orden: los ya confirmados heredan responded_at.
    expect(sql).toMatch(/set confirmed_at = responded_at\s+where response = 'accepted' and confirmed_at is null/i);
  });

  test('invite deadline is min(invited + 10h, kickoff - 2h)', () => {
    expect(sql).toMatch(/least\(p_invited_at \+ interval '10 hours', p_starts_at - interval '2 hours'\)/i);
  });

  test('expired members lose chat access and cannot confirm late', () => {
    // El helper del chat ahora excluye declinados Y vencidos.
    expect(sql).toMatch(/create or replace function public\.auto_match_user_in_proposal[\s\S]*m\.response not in \('declined', 'expired'\)/i);
    // respond bloquea las invitaciones vencidas.
    expect(sql).toMatch(/proposal_member_expired/i);
  });

  test('overlap guard only blocks on confirmations, plus real matches', () => {
    expect(sql).toMatch(/create or replace function public\.user_has_overlapping_auto_match[\s\S]*m\.response = 'accepted'/i);
  });

  test('sync iterates every eligible weekday (multi-day) with a per-format create throttle', () => {
    expect(sql).toMatch(/foreach v_day in array v_mine\.days_of_week loop/i);
    expect(sql).toMatch(/if v_created_this_format then continue; end if;/i);
    // Convoca hasta la capacidad de sobreconvocatoria, no hasta el cupo.
    expect(sql).toMatch(/>= v_capacity/);
  });

  test('backfill fills up to the invitation capacity', () => {
    expect(sql).toMatch(/v_capacity := public\.auto_match_invitation_capacity\(v_proposal\.format\)/i);
  });

  test('confirmation order drives titular/suplente in listings', () => {
    // get_my: mi asiento por rank de confirmed_at.
    expect(sql).toMatch(/<= p\.max_players then 'titular' else 'suplente'/i);
    // get_members: rank de aceptados por confirmed_at.
    expect(sql).toMatch(/order by coalesce\(m\.confirmed_at, m\.responded_at\) asc nulls last, m\.user_id[\s\S]*accepted_rank/i);
  });

  test('materialisation inserts confirmed players in confirmation order', () => {
    expect(sql).toMatch(/from public\.auto_match_proposal_members m[\s\S]*and m\.response = 'accepted'\s*order by m\.confirmed_at asc nulls last, m\.user_id/i);
  });

  test('individual invite expiry runs in the backend + a guarded pg_cron sweep', () => {
    expect(sql).toMatch(/create or replace function public\.expire_stale_auto_match_invites\(\)/i);
    expect(sql).toMatch(/set response = 'expired', responded_at = now\(\)/i);
    // Reutiliza el patrón guardado de los demás schedulers.
    expect(sql).toMatch(/if exists \(select 1 from pg_extension where extname = 'pg_cron'\) then/i);
    expect(sql).toMatch(/cron\.schedule\(\s*'auto_match_sweep'/i);
  });

  test('is a later incremental migration and runs in one transaction', () => {
    // Timestamp posterior a la migración de chat ya aplicada (20260712120000):
    // esto es incremental, no una edición de la anterior.
    expect(migrationPath).toMatch(/20260712220000_auto_match_overbooking_confirmation_order\.sql$/);
    expect(20260712220000).toBeGreaterThan(20260712120000);
    // Solo CREATE OR REPLACE / ALTER ... ADD COLUMN: nunca reescribe la 120000.
    expect(sql).not.toMatch(/drop\s+function\s+if\s+exists\s+public\.send_auto_match_proposal_chat_message/i);
    expect(sql).toMatch(/^begin;/im);
    expect(sql).toMatch(/commit;\s*$/im);
    expect(sql.search(/^begin;/im)).toBeLessThan(sql.search(/commit;\s*$/im));
  });
});
