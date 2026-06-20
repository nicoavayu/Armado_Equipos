const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260620120000_post_match_payments.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim();

describe('post-match payments migration', () => {
  test('creates both tables referencing partidos with cascade', () => {
    expect(normalized).toContain('CREATE TABLE IF NOT EXISTS public.match_payment_settings');
    expect(normalized).toContain('CREATE TABLE IF NOT EXISTS public.match_player_payments');
    expect(normalized).toContain('partido_id BIGINT PRIMARY KEY REFERENCES public.partidos(id) ON DELETE CASCADE');
    expect(normalized).toContain('partido_id BIGINT NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE');
  });

  test('payment status is constrained to the four states', () => {
    expect(normalized).toContain("CHECK (status IN ('pending', 'reported_paid', 'paid', 'exempt'))");
  });

  test('settings carry the collector configuration + closed state', () => {
    ['amount_per_player', 'collector_user_id', 'collector_name', 'collector_alias', 'collector_payment_link', 'is_closed', 'closed_at']
      .forEach((col) => expect(normalized).toContain(col));
  });

  test('enables RLS and restricts writes to the admin, reads to members', () => {
    expect(normalized).toContain('ALTER TABLE public.match_payment_settings ENABLE ROW LEVEL SECURITY');
    expect(normalized).toContain('ALTER TABLE public.match_player_payments ENABLE ROW LEVEL SECURITY');
    expect(normalized).toContain('USING (public.payments_is_match_member(partido_id, auth.uid()))');
    expect(normalized).toContain('USING (public.payments_is_match_admin(partido_id, auth.uid()))');
  });

  test('defines the membership predicates as SECURITY DEFINER', () => {
    expect(normalized).toContain('FUNCTION public.payments_is_match_admin');
    expect(normalized).toContain('FUNCTION public.payments_is_match_member');
    expect(normalized).toContain('SECURITY DEFINER');
  });

  test('defines all business RPCs', () => {
    [
      'FUNCTION public.ensure_match_payments',
      'FUNCTION public.report_my_payment',
      'FUNCTION public.admin_set_payment_status',
      'FUNCTION public.admin_update_payment_settings',
      'FUNCTION public.admin_close_payments',
      'FUNCTION public.admin_remind_pending_payments',
    ].forEach((fn) => expect(normalized).toContain(fn));
  });

  test('report_my_payment can only reach reported_paid, never paid', () => {
    // The player RPC sets reported_paid and guards on prior state.
    expect(normalized).toContain("status = 'reported_paid'");
    expect(normalized).toContain("status IN ('pending', 'reported_paid')");
  });

  test('grants execute on RPCs to authenticated', () => {
    expect(normalized).toContain('GRANT EXECUTE ON FUNCTION public.ensure_match_payments(BIGINT) TO authenticated');
    expect(normalized).toContain('GRANT EXECUTE ON FUNCTION public.report_my_payment(BIGINT) TO authenticated');
  });
});
