// Decision helper for the public match screen's post-approval "sincronizando…"
// (approved_pending_sync) state.
//
// approved_pending_sync only bridges the brief window between approve_join_request
// (which inserts the roster row in the same transaction as it sets
// status='approved') and that row becoming visible to the requester's client. If
// membership never appears within the bounded recheck window we must settle to a
// FINAL state instead of spinning forever — the "Aprobado - sincronizando…" bug
// from the PR #87 smoke was exactly this state looping after an admin ejected a
// player (roster row gone, request left stale as 'approved').
//
// The backend fix (trg_demote_join_request_on_player_removal) atomically demotes an
// approved request to a terminal status when the player is removed, so the "removed"
// branch below is reached with real server truth — this helper does not mask a DB
// inconsistency, it reflects it.

export const normalizeJoinRequestStatus = (value) => String(value || '').trim().toLowerCase();

/**
 * Given the result of the bounded post-approval sync recheck, decide the final
 * public join state. NEVER returns approved_pending_sync, so the sync state can't
 * loop.
 *
 * @param {{ isMember: boolean, latestStatus: (string|null|undefined) }} params
 * @returns {{ status: ('approved'|'none'), outcome: ('joined'|'removed'|'unresolved') }}
 *   - joined:     membership finally became visible → keep them in.
 *   - removed:    the request already left 'approved' on the server (ejected /
 *                 rejected / cancelled) → settle to 'none', tell them they're out.
 *   - unresolved: request STILL 'approved' but no membership — a genuine, rare
 *                 inconsistency → settle to 'none' and surface it (do not retry
 *                 endlessly).
 */
export const resolvePostSyncJoinState = ({ isMember, latestStatus }) => {
  if (isMember) return { status: 'approved', outcome: 'joined' };
  const normalized = normalizeJoinRequestStatus(latestStatus);
  if (normalized && normalized !== 'approved') {
    return { status: 'none', outcome: 'removed' };
  }
  return { status: 'none', outcome: 'unresolved' };
};
