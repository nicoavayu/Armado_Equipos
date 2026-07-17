// Onboarding state persistence: Supabase (cross-device, RLS-protected) with a
// local fallback (localStorage) for offline/first-paint. Reads reconcile the
// two idempotently; writes are optimistic-local then best-effort remote, so a
// failed network call never blocks the UI or loses progress.

import { supabase } from '../../lib/supabaseClient';
import logger from '../../utils/logger';
import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_STATUS,
  isValidOnboardingPath,
} from './content';

const LOCAL_KEY_PREFIX = 'arma2:onboarding:v1:';
const TABLE = 'user_onboarding_state';

const STATUS_RANK = {
  [ONBOARDING_STATUS.NOT_STARTED]: 0,
  [ONBOARDING_STATUS.IN_PROGRESS]: 1,
  [ONBOARDING_STATUS.SKIPPED]: 2,
  [ONBOARDING_STATUS.COMPLETED]: 3,
};

const localKey = (userId) => `${LOCAL_KEY_PREFIX}${String(userId || '').trim()}`;

const asPlainObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export function createDefaultOnboardingState(overrides = {}) {
  return {
    completedVersion: 0,
    status: ONBOARDING_STATUS.NOT_STARTED,
    chosenPath: null,
    coachMarks: {},
    checklist: {},
    welcomeCardDismissed: false,
    firstSeenAt: null,
    completedAt: null,
    skippedAt: null,
    ...overrides,
  };
}

// Normalize any shape (DB row, local blob, partial patch) into a canonical
// camelCase state. Unknown/invalid fields are coerced to safe defaults.
export function normalizeOnboardingState(input) {
  const src = asPlainObject(input);
  const rawStatus = String(src.status || src.status === 0 ? src.status : '').trim();
  const status = Object.prototype.hasOwnProperty.call(STATUS_RANK, rawStatus)
    ? rawStatus
    : ONBOARDING_STATUS.NOT_STARTED;
  const chosenPathRaw = src.chosenPath ?? src.chosen_path ?? null;
  const chosenPath = isValidOnboardingPath(chosenPathRaw) ? chosenPathRaw : null;
  const completedVersionRaw = Number(src.completedVersion ?? src.completed_version ?? 0);

  return {
    completedVersion: Number.isFinite(completedVersionRaw) && completedVersionRaw > 0
      ? Math.floor(completedVersionRaw)
      : 0,
    status,
    chosenPath,
    coachMarks: asPlainObject(src.coachMarks ?? src.coach_marks),
    checklist: asPlainObject(src.checklist),
    welcomeCardDismissed: Boolean(src.welcomeCardDismissed ?? src.welcome_card_dismissed),
    firstSeenAt: src.firstSeenAt ?? src.first_seen_at ?? null,
    completedAt: src.completedAt ?? src.completed_at ?? null,
    skippedAt: src.skippedAt ?? src.skipped_at ?? null,
  };
}

// Idempotent merge of two states (e.g. local vs remote across devices). Keeps
// the most-advanced progress from either side; never loses a seen coach mark.
export function mergeOnboardingStates(a, b) {
  const left = normalizeOnboardingState(a);
  const right = normalizeOnboardingState(b);
  const leftChecklist = asPlainObject(left.checklist);
  const rightChecklist = asPlainObject(right.checklist);

  const completedVersion = Math.max(left.completedVersion, right.completedVersion);
  const status = (STATUS_RANK[right.status] || 0) >= (STATUS_RANK[left.status] || 0)
    ? right.status
    : left.status;

  return {
    completedVersion,
    status,
    chosenPath: right.chosenPath || left.chosenPath || null,
    coachMarks: { ...left.coachMarks, ...right.coachMarks },
    checklist: {
      ...leftChecklist,
      ...rightChecklist,
      // Action signals can be written on different devices. Union them so a
      // later reconciliation never rolls a genuinely completed step back.
      actions: {
        ...asPlainObject(leftChecklist.actions),
        ...asPlainObject(rightChecklist.actions),
      },
      celebrated: Boolean(leftChecklist.celebrated || rightChecklist.celebrated),
      completionShown: Boolean(leftChecklist.completionShown || rightChecklist.completionShown),
    },
    welcomeCardDismissed: left.welcomeCardDismissed || right.welcomeCardDismissed,
    firstSeenAt: left.firstSeenAt || right.firstSeenAt || null,
    completedAt: right.completedAt || left.completedAt || null,
    skippedAt: right.skippedAt || left.skippedAt || null,
  };
}

export function readLocalOnboardingState(userId) {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    if (!raw) return null;
    return normalizeOnboardingState(JSON.parse(raw));
  } catch (_error) {
    return null;
  }
}

export function writeLocalOnboardingState(userId, state) {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(normalizeOnboardingState(state)));
  } catch (_error) {
    // Ignore private-mode / quota failures; DB remains the source of truth.
  }
}

function toDbRow(userId, state) {
  const normalized = normalizeOnboardingState(state);
  return {
    user_id: userId,
    completed_version: normalized.completedVersion,
    status: normalized.status,
    chosen_path: normalized.chosenPath,
    coach_marks: normalized.coachMarks,
    checklist: normalized.checklist,
    welcome_card_dismissed: normalized.welcomeCardDismissed,
    // first_seen_at is only sent on first insert (see saveOnboardingState).
    completed_at: normalized.completedAt,
    skipped_at: normalized.skippedAt,
  };
}

/**
 * Load the user's onboarding state, reconciling remote + local.
 * Never throws: on any remote error it falls back to local (or defaults) so the
 * app always keeps working.
 *
 * @returns {Promise<{state: object, source: 'remote'|'local'|'default'|'merged'}>}
 */
export async function loadOnboardingState(userId, { client = supabase } = {}) {
  const local = readLocalOnboardingState(userId);

  if (!userId) {
    return { state: createDefaultOnboardingState(), source: 'default' };
  }

  try {
    const { data, error } = await client
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // No remote row yet. Local (if any) is authoritative until first write.
      const state = local || createDefaultOnboardingState();
      writeLocalOnboardingState(userId, state);
      return { state, source: local ? 'local' : 'default' };
    }

    const remote = normalizeOnboardingState(data);
    const merged = local ? mergeOnboardingStates(local, remote) : remote;
    writeLocalOnboardingState(userId, merged);
    return { state: merged, source: local ? 'merged' : 'remote' };
  } catch (error) {
    logger.warn('[ONBOARDING] loadOnboardingState remote failed, using local fallback', {
      code: error?.code || null,
    });
    return { state: local || createDefaultOnboardingState(), source: 'local' };
  }
}

/**
 * Persist the full next state. Optimistic local write first (synchronous, never
 * fails visibly), then best-effort upsert. Returns the normalized state that was
 * saved regardless of remote success.
 */
export async function saveOnboardingState(userId, nextState, { client = supabase, isFirstWrite = false } = {}) {
  const normalized = normalizeOnboardingState(nextState);
  writeLocalOnboardingState(userId, normalized);

  if (!userId) return { state: normalized, remoteOk: false };

  try {
    const row = toDbRow(userId, normalized);
    if (isFirstWrite && normalized.firstSeenAt) {
      row.first_seen_at = normalized.firstSeenAt;
    }
    const { error } = await client
      .from(TABLE)
      .upsert(row, { onConflict: 'user_id' });
    if (error) throw error;
    return { state: normalized, remoteOk: true };
  } catch (error) {
    logger.warn('[ONBOARDING] saveOnboardingState remote failed (kept locally)', {
      code: error?.code || null,
    });
    return { state: normalized, remoteOk: false };
  }
}

export const __test__ = {
  localKey,
  STATUS_RANK,
  CURRENT_ONBOARDING_VERSION,
};
