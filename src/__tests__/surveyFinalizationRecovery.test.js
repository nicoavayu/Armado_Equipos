import { runSurveyFinalizationRecovery } from '../hooks/useSurveyFinalizationRecovery';
import { supabase } from '../lib/supabaseClient';

jest.mock('../lib/supabaseClient', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

afterEach(() => jest.clearAllMocks());

test('finishes every due survey the database lists for this account', async () => {
  supabase.rpc.mockResolvedValueOnce({
    data: [{ partido_id: 5, reason: 'closure_due' }, { partido_id: '9', reason: 'results_or_awards_due' }, { partido_id: 5 }],
    error: null,
  });
  const finalize = jest.fn(async () => ({ done: true }));

  const result = await runSurveyFinalizationRecovery({ loadFinalize: async () => finalize });

  expect(supabase.rpc).toHaveBeenCalledWith('list_my_pending_survey_finalizations', { p_limit: 5 });
  expect(finalize.mock.calls.map(([matchId]) => matchId)).toEqual([5, 9]);
  expect(result).toEqual({ processed: 2, total: 2 });
});

test('one match failing does not stop the others (it is retried next time)', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: [{ partido_id: 5 }, { partido_id: 6 }], error: null });
  const finalize = jest.fn(async (matchId) => {
    if (matchId === 5) throw Object.assign(new Error('network'), { code: 'FETCH_ERROR' });
    return { done: true };
  });

  const result = await runSurveyFinalizationRecovery({ loadFinalize: async () => finalize });

  expect(finalize).toHaveBeenCalledTimes(2);
  expect(result).toEqual({ processed: 1, total: 2 });
});

test('nothing due: the finalize pipeline is not even loaded', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: [], error: null });
  const loadFinalize = jest.fn();
  await expect(runSurveyFinalizationRecovery({ loadFinalize })).resolves.toEqual({ processed: 0, total: 0 });
  expect(loadFinalize).not.toHaveBeenCalled();
});

test('a backend without the migration is reported as unsupported, not as an error', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  await expect(runSurveyFinalizationRecovery()).resolves.toEqual({ processed: 0, total: 0, unsupported: true });
});

test('other listing errors surface to the caller', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
  await expect(runSurveyFinalizationRecovery()).rejects.toMatchObject({ code: '42501' });
});
