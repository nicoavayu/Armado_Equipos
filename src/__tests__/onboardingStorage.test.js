import {
  normalizeOnboardingState,
  mergeOnboardingStates,
  createDefaultOnboardingState,
  readLocalOnboardingState,
  writeLocalOnboardingState,
  loadOnboardingState,
  saveOnboardingState,
} from '../features/onboarding/storage';
import { ONBOARDING_STATUS } from '../features/onboarding/content';

const USER = 'user-123';

// Minimal chainable Supabase stub for a single-row table.
function makeClient({ selectResult, upsertResult, onUpsert } = {}) {
  return {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => selectResult || { data: null, error: null }),
        })),
      })),
      upsert: jest.fn(async (row) => {
        if (onUpsert) onUpsert(row);
        return upsertResult || { error: null };
      }),
    })),
  };
}

afterEach(() => window.localStorage.clear());

describe('normalizeOnboardingState', () => {
  test('coerces db snake_case row into canonical camelCase', () => {
    const s = normalizeOnboardingState({
      completed_version: 2,
      status: 'completed',
      chosen_path: 'organizer',
      coach_marks: { 'new-match:manual': true },
      checklist: { actions: { openedPlay: true } },
      welcome_card_dismissed: true,
    });
    expect(s).toMatchObject({
      completedVersion: 2,
      status: 'completed',
      chosenPath: 'organizer',
      coachMarks: { 'new-match:manual': true },
      checklist: { actions: { openedPlay: true } },
      welcomeCardDismissed: true,
    });
  });

  test('rejects invalid path / status, keeps safe defaults', () => {
    const s = normalizeOnboardingState({ chosen_path: 'nope', status: 'weird' });
    expect(s.chosenPath).toBeNull();
    expect(s.status).toBe(ONBOARDING_STATUS.NOT_STARTED);
  });
});

describe('mergeOnboardingStates (cross-device idempotency)', () => {
  test('keeps the most-advanced progress and unions coach marks', () => {
    const local = normalizeOnboardingState({
      completedVersion: 1, status: 'completed', coachMarks: { a: true },
    });
    const remote = normalizeOnboardingState({
      completedVersion: 0, status: 'in_progress', coachMarks: { b: true }, chosenPath: 'auto_match',
    });
    const merged = mergeOnboardingStates(local, remote);
    expect(merged.completedVersion).toBe(1);
    expect(merged.status).toBe('completed'); // completed outranks in_progress
    expect(merged.coachMarks).toEqual({ a: true, b: true });
    expect(merged.chosenPath).toBe('auto_match');
  });

  test('is idempotent', () => {
    const a = normalizeOnboardingState({ completedVersion: 1, status: 'skipped' });
    const once = mergeOnboardingStates(a, a);
    const twice = mergeOnboardingStates(once, a);
    expect(twice).toEqual(once);
  });

  test('unions real checklist actions and one-time completion guards across devices', () => {
    const local = normalizeOnboardingState({
      checklist: { actions: { openedPlay: true }, completionShown: true },
    });
    const remote = normalizeOnboardingState({
      checklist: { actions: { reviewedMatch: true }, celebrated: true },
    });

    expect(mergeOnboardingStates(local, remote).checklist).toMatchObject({
      actions: { openedPlay: true, reviewedMatch: true },
      completionShown: true,
      celebrated: true,
    });
  });
});

describe('local fallback', () => {
  test('write then read round-trips', () => {
    writeLocalOnboardingState(USER, createDefaultOnboardingState({ chosenPath: 'overview' }));
    expect(readLocalOnboardingState(USER)).toMatchObject({ chosenPath: 'overview' });
  });
});

describe('loadOnboardingState', () => {
  test('returns remote row when present', async () => {
    const client = makeClient({ selectResult: { data: { completed_version: 1, status: 'completed' }, error: null } });
    const { state, source } = await loadOnboardingState(USER, { client });
    expect(source).toBe('remote');
    expect(state.completedVersion).toBe(1);
  });

  test('merges remote with local when both exist', async () => {
    writeLocalOnboardingState(USER, createDefaultOnboardingState({ coachMarks: { local: true } }));
    const client = makeClient({ selectResult: { data: { completed_version: 1, coach_marks: { remote: true } }, error: null } });
    const { state, source } = await loadOnboardingState(USER, { client });
    expect(source).toBe('merged');
    expect(state.coachMarks).toEqual({ local: true, remote: true });
    expect(state.completedVersion).toBe(1);
  });

  test('falls back to local when the remote query errors (offline)', async () => {
    writeLocalOnboardingState(USER, createDefaultOnboardingState({ status: ONBOARDING_STATUS.IN_PROGRESS, chosenPath: 'organizer' }));
    const client = makeClient({ selectResult: { data: null, error: { code: 'NETWORK' } } });
    const { state, source } = await loadOnboardingState(USER, { client });
    expect(source).toBe('local');
    expect(state.status).toBe(ONBOARDING_STATUS.IN_PROGRESS);
    expect(state.chosenPath).toBe('organizer');
  });

  test('returns defaults when there is no remote row and no local', async () => {
    const client = makeClient({ selectResult: { data: null, error: null } });
    const { state, source } = await loadOnboardingState(USER, { client });
    expect(source).toBe('default');
    expect(state.completedVersion).toBe(0);
  });
});

describe('saveOnboardingState', () => {
  test('writes local optimistically and upserts remote', async () => {
    let upserted = null;
    const client = makeClient({ onUpsert: (row) => { upserted = row; } });
    const next = createDefaultOnboardingState({ status: ONBOARDING_STATUS.COMPLETED, completedVersion: 1, firstSeenAt: '2026-08-01T00:00:00.000Z' });
    const { state, remoteOk } = await saveOnboardingState(USER, next, { client, isFirstWrite: true });
    expect(remoteOk).toBe(true);
    expect(state.completedVersion).toBe(1);
    expect(upserted.user_id).toBe(USER);
    expect(upserted.first_seen_at).toBe('2026-08-01T00:00:00.000Z');
    // local mirror persisted
    expect(readLocalOnboardingState(USER).status).toBe(ONBOARDING_STATUS.COMPLETED);
  });

  test('keeps local state even when remote upsert fails', async () => {
    const client = makeClient({ upsertResult: { error: { code: 'NETWORK' } } });
    const { remoteOk } = await saveOnboardingState(USER, createDefaultOnboardingState({ completedVersion: 1 }), { client });
    expect(remoteOk).toBe(false);
    expect(readLocalOnboardingState(USER).completedVersion).toBe(1);
  });
});
