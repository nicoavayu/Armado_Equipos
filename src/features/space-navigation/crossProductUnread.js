// Whether the OTHER product has unread notices, for the space selector's discreet signal. Each product keeps its own
// inbox: nothing here lists, merges or marks notifications, and nothing of Core is mounted inside Torneos (or the
// reverse). Reads are aggregated and bounded:
//
//   • Core, while the person is in Torneos: Core's own exact total from this session (its notifications context
//     publishes it here whenever it recomputes) plus a HEAD count of the unread rows created after it. Without that
//     snapshot (the app opened straight into Torneos) it is a HEAD count of the unread rows Core's inbox window would
//     show (same window and send time); Core's inbox may still hide a stale row, so it is never shown as a number.
//   • Torneos, while the person is in Core: Torneos' own inbox summary (communications + activity), through the
//     mounted composition's rule (LOCAL service or the gateway), loaded only once Torneos was used on this device.
//
// A failed read is `error`, never «no notices». Everything is keyed by the account: another user's state is dropped.
import { supabase } from '../../supabase';
import { getNotificationsUiCutoffIso } from '../../utils/notificationRetentionPolicy';

export const UNREAD_UNKNOWN = Object.freeze({ status: 'unknown', hasUnread: false });

const coreSnapshots = new Map();

/** Core's notifications context reports its exact unread total for this account (in memory, this session only). */
export function publishCoreUnreadSnapshot(userId, total, at = Date.now()) {
  if (!userId) return;
  coreSnapshots.set(String(userId), { total: Math.max(0, Number(total) || 0), at });
}

export function forgetCoreUnreadSnapshots(exceptUserId = null) {
  for (const key of [...coreSnapshots.keys()]) {
    if (key !== String(exceptUserId || '')) coreSnapshots.delete(key);
  }
}

async function countCoreUnread(userId, { since = null, client = supabase, now = () => new Date() } = {}) {
  const nowIso = now().toISOString();
  let query = client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false)
    .gte('created_at', getNotificationsUiCutoffIso())
    .or(`send_at.is.null,send_at.lte.${nowIso}`);
  if (since) query = query.gt('created_at', since);
  const { count, error } = await query;
  if (error) throw error;
  return Number(count) || 0;
}

export async function loadCoreUnread(userId, options = {}) {
  const snapshot = coreSnapshots.get(String(userId));
  if (snapshot) {
    const newer = await countCoreUnread(userId, { ...options, since: new Date(snapshot.at).toISOString() });
    return { status: 'ready', hasUnread: snapshot.total + newer > 0, exact: true };
  }
  const total = await countCoreUnread(userId, options);
  return { status: 'ready', hasUnread: total > 0, exact: false };
}

let torneosProbePromise = null;

/** Torneos' inbox summary from outside Torneos, through the composition's own rule (lazy: no Torneos code otherwise). */
export async function loadTorneosUnread() {
  if (!torneosProbePromise) {
    torneosProbePromise = import('../torneos/stagingV1/torneosInboxProbe')
      .then(({ createTorneosInboxProbe }) => createTorneosInboxProbe())
      .catch((error) => {
        torneosProbePromise = null;
        throw error;
      });
  }
  const probe = await torneosProbePromise;
  if (!probe) return { status: 'unavailable', hasUnread: false };
  const summary = await probe.load();
  return { status: 'ready', hasUnread: (Number(summary?.total) || 0) > 0, exact: true };
}
