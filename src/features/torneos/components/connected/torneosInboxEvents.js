// The Torneos inbox counter refreshes when something it counts may have changed (an item read, a communication
// confirmed). A DOM event keeps the bell and the pages decoupled; it carries no data.
export const TORNEOS_INBOX_CHANGED = 'arma2:torneos-inbox-changed';

export function announceTorneosInboxChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(TORNEOS_INBOX_CHANGED));
}
