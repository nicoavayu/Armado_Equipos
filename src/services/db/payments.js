import { supabase } from '../../lib/supabaseClient';

// Internal notification types for post-match payments.
export const PAYMENT_NOTIFICATION_REPORTED = 'payment_reported';
export const PAYMENT_NOTIFICATION_REMINDER = 'payment_reminder';

const toMatchId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const paymentsLink = (matchId) => `/pagos/${matchId}`;

/**
 * Loads the full payments state for a match. Lazily ensures settings + per-player
 * rows exist (idempotent RPC any match member can call), then reads everything.
 * @param {number|string} partidoId
 */
export const getMatchPaymentsState = async (partidoId) => {
  const matchId = toMatchId(partidoId);
  if (!matchId) throw new Error('invalid_match_id');

  const { error: ensureError } = await supabase.rpc('ensure_match_payments', { p_partido_id: matchId });
  if (ensureError) {
    // Non-fatal: existing rows (if any) can still be read below.
    console.warn('[PAYMENTS] ensure_match_payments failed', { matchId, message: ensureError.message });
  }

  const [partidoRes, settingsRes, rowsRes, authRes] = await Promise.all([
    supabase
      .from('partidos')
      .select('id, nombre, fecha, hora, creado_por, precio_cancha_por_persona')
      .eq('id', matchId)
      .maybeSingle(),
    supabase
      .from('match_payment_settings')
      .select('*')
      .eq('partido_id', matchId)
      .maybeSingle(),
    supabase
      .from('match_player_payments')
      .select('*')
      .eq('partido_id', matchId)
      .order('id', { ascending: true }),
    supabase.auth.getUser(),
  ]);

  if (rowsRes.error) throw rowsRes.error;

  const partido = partidoRes.data || null;
  const settings = settingsRes.data || null;
  const rows = rowsRes.data || [];
  const myUserId = String(authRes?.data?.user?.id || '');
  const isAdmin = Boolean(partido?.creado_por && myUserId && partido.creado_por === myUserId);
  const myRow = rows.find((row) => String(row.user_id || '') === myUserId) || null;

  return { partido, settings, rows, isAdmin, myUserId, myRow };
};

/**
 * Current user reports their own payment ("Ya pagué") -> status reported_paid.
 * Best-effort internal notification to the admin (never blocks the action).
 */
export const reportMyPayment = async (partidoId, { matchName = '', reporterName = '', adminUserId = null } = {}) => {
  const matchId = toMatchId(partidoId);
  if (!matchId) throw new Error('invalid_match_id');

  const { error } = await supabase.rpc('report_my_payment', { p_partido_id: matchId });
  if (error) throw error;

  try {
    let admin = adminUserId;
    let name = matchName;
    if (!admin || !name) {
      const { data } = await supabase
        .from('partidos')
        .select('creado_por, nombre')
        .eq('id', matchId)
        .maybeSingle();
      admin = admin || data?.creado_por || null;
      name = name || data?.nombre || 'el partido';
    }
    const { data: authData } = await supabase.auth.getUser();
    const me = String(authData?.user?.id || '');
    if (admin && admin !== me) {
      await supabase.from('notifications').insert({
        user_id: admin,
        partido_id: matchId,
        type: PAYMENT_NOTIFICATION_REPORTED,
        title: 'Pago a confirmar',
        message: `${reporterName || 'Un jugador'} avisó que pagó "${name}".`,
        data: { match_id: String(matchId), link: paymentsLink(matchId), route: paymentsLink(matchId) },
        read: false,
        created_at: new Date().toISOString(),
      });
    }
  } catch (notifyError) {
    console.warn('[PAYMENTS] reportMyPayment notify admin failed', {
      matchId,
      message: notifyError?.message || String(notifyError),
    });
  }

  return { ok: true };
};

/** Admin sets a player's payment status (pending | reported_paid | paid | exempt). */
export const adminSetPaymentStatus = async (partidoId, jugadorId, status) => {
  const matchId = toMatchId(partidoId);
  const jId = Number(jugadorId);
  if (!matchId || !Number.isFinite(jId)) throw new Error('invalid_args');
  const { error } = await supabase.rpc('admin_set_payment_status', {
    p_partido_id: matchId,
    p_jugador_id: jId,
    p_status: status,
  });
  if (error) throw error;
  return { ok: true };
};

/** Admin updates the collector configuration (amount / alias / link / who collects). */
export const adminUpdatePaymentSettings = async (partidoId, {
  amount = null,
  collectorUserId = null,
  collectorName = null,
  collectorAlias = null,
  collectorLink = null,
} = {}) => {
  const matchId = toMatchId(partidoId);
  if (!matchId) throw new Error('invalid_match_id');
  const numericAmount = (amount === '' || amount === null || amount === undefined) ? null : Number(amount);
  const { error } = await supabase.rpc('admin_update_payment_settings', {
    p_partido_id: matchId,
    p_amount: Number.isFinite(numericAmount) ? numericAmount : null,
    p_collector_user_id: collectorUserId || null,
    p_collector_name: collectorName || null,
    p_collector_alias: collectorAlias || null,
    p_collector_link: collectorLink || null,
  });
  if (error) throw error;
  return { ok: true };
};

/** Admin closes payments. Pass { force: true } to close while pending remain. */
export const adminClosePayments = async (partidoId, { force = false } = {}) => {
  const matchId = toMatchId(partidoId);
  if (!matchId) throw new Error('invalid_match_id');
  const { error } = await supabase.rpc('admin_close_payments', {
    p_partido_id: matchId,
    p_force: Boolean(force),
  });
  if (error) throw error;
  return { ok: true };
};

/**
 * Admin reminds pending players: stamps last_reminder_at (in the RPC) and
 * inserts an internal notification per pending recipient (copy kept in JS).
 */
export const adminRemindPending = async (partidoId, { matchName = '' } = {}) => {
  const matchId = toMatchId(partidoId);
  if (!matchId) throw new Error('invalid_match_id');

  const { data, error } = await supabase.rpc('admin_remind_pending_payments', { p_partido_id: matchId });
  if (error) throw error;

  // No self-reminder: el admin que ejecuta la acción nunca se notifica/pushea a
  // sí mismo, aunque figure como pendiente (puede deber legítimamente). El push
  // se encola al insertar la notificación 'payment_reminder', así que excluirlo
  // de los destinatarios evita tanto el push como la notificación interna propia.
  const { data: authData } = await supabase.auth.getUser();
  const me = String(authData?.user?.id || '').trim();

  const recipients = [...new Set((data || [])
    .map((row) => String(row?.user_id || '').trim())
    .filter(Boolean))]
    .filter((uid) => !me || uid !== me);
  if (recipients.length === 0) return { ok: true, notified: 0 };

  let name = matchName;
  if (!name) {
    const { data: partido } = await supabase
      .from('partidos')
      .select('nombre')
      .eq('id', matchId)
      .maybeSingle();
    name = partido?.nombre || 'tu partido';
  }

  const nowIso = new Date().toISOString();
  const notifications = recipients.map((uid) => ({
    user_id: uid,
    partido_id: matchId,
    type: PAYMENT_NOTIFICATION_REMINDER,
    title: 'Pago pendiente',
    message: `Tenés pendiente el pago de "${name}".`,
    data: { match_id: String(matchId), link: paymentsLink(matchId), route: paymentsLink(matchId) },
    read: false,
    created_at: nowIso,
  }));

  const { error: insertError } = await supabase.from('notifications').insert(notifications);
  if (insertError) {
    console.warn('[PAYMENTS] reminder notifications insert failed', { matchId, message: insertError.message });
    return { ok: true, notified: 0, notifyError: insertError.message };
  }

  return { ok: true, notified: recipients.length };
};

/**
 * Batch: current user's own payment status keyed by match id.
 * Used by Mis partidos to render the player's post-match card cheaply.
 * @returns {Promise<Object<string,string>>} { [partidoId]: status }
 */
export const getMyPaymentRowsForMatches = async (userId, partidoIds = []) => {
  const uid = String(userId || '').trim();
  const ids = [...new Set((partidoIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))];
  if (!uid || ids.length === 0) return {};

  const { data, error } = await supabase
    .from('match_player_payments')
    .select('partido_id, status')
    .eq('user_id', uid)
    .in('partido_id', ids);

  if (error) {
    console.warn('[PAYMENTS] getMyPaymentRowsForMatches failed', { message: error.message });
    return {};
  }

  const byMatch = {};
  (data || []).forEach((row) => { byMatch[String(row.partido_id)] = row.status; });
  return byMatch;
};

/**
 * Batch: payment settings keyed by match id (amount + closed flag) for the
 * Mis partidos post-match cards. RLS returns only matches the user belongs to.
 * @returns {Promise<Object<string, Object>>}
 */
export const getPaymentSettingsForMatches = async (partidoIds = []) => {
  const ids = [...new Set((partidoIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))];
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from('match_payment_settings')
    .select('partido_id, amount_per_player, is_closed')
    .in('partido_id', ids);

  if (error) {
    console.warn('[PAYMENTS] getPaymentSettingsForMatches failed', { message: error.message });
    return {};
  }

  const byMatch = {};
  (data || []).forEach((row) => { byMatch[String(row.partido_id)] = row; });
  return byMatch;
};

/**
 * Batch: payment rows grouped by match id (for admin post-match counts).
 * Caller runs summarizePayments() on each list.
 * @returns {Promise<Object<string,Array<{status:string}>>>}
 */
export const getPaymentSummariesForMatches = async (partidoIds = []) => {
  const ids = [...new Set((partidoIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))];
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from('match_player_payments')
    .select('partido_id, status')
    .in('partido_id', ids);

  if (error) {
    console.warn('[PAYMENTS] getPaymentSummariesForMatches failed', { message: error.message });
    return {};
  }

  const byMatch = {};
  (data || []).forEach((row) => {
    const key = String(row.partido_id);
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push({ status: row.status });
  });
  return byMatch;
};
