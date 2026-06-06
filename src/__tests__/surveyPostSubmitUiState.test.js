import {
  resolvePostSubmitCompletionUiState,
  shouldRecheckPostSubmitSubmissionGate,
} from '../utils/surveyPostSubmitUiState';

describe('resolvePostSubmitCompletionUiState', () => {
  test('marks survey closed when finalize reports closed status', () => {
    expect(resolvePostSubmitCompletionUiState({
      finalizeResult: {
        survey_status: 'closed',
        closedAt: '2026-03-28T03:00:00.000Z',
      },
    })).toEqual({
      shouldMarkSurveyClosed: true,
      closedAt: '2026-03-28T03:00:00.000Z',
    });
  });

  test('marks survey closed when canonical post-submit gate rejects new submissions', () => {
    expect(resolvePostSubmitCompletionUiState({
      finalizeResult: {
        survey_status: 'open',
      },
      submissionGate: {
        canSubmit: false,
        closedAt: '2026-03-28T04:00:00.000Z',
      },
    })).toEqual({
      shouldMarkSurveyClosed: true,
      closedAt: '2026-03-28T04:00:00.000Z',
    });
  });

  test('keeps survey open locally when finalize stays inconclusive and gate is still open', () => {
    expect(resolvePostSubmitCompletionUiState({
      finalizeResult: {
        done: false,
        survey_status: 'open',
      },
      submissionGate: {
        canSubmit: true,
      },
    })).toEqual({
      shouldMarkSurveyClosed: false,
      closedAt: null,
    });
  });

  test('defaults to not marking the survey closed when reconciliation data is unavailable', () => {
    expect(resolvePostSubmitCompletionUiState()).toEqual({
      shouldMarkSurveyClosed: false,
      closedAt: null,
    });
  });
});

describe('shouldRecheckPostSubmitSubmissionGate', () => {
  test('skips the post-submit gate when finalize already closed the survey', () => {
    expect(shouldRecheckPostSubmitSubmissionGate({ survey_status: 'closed' })).toBe(false);
  });

  test('keeps the fallback gate when finalize failed or returned inconclusive data', () => {
    expect(shouldRecheckPostSubmitSubmissionGate(null)).toBe(true);
    expect(shouldRecheckPostSubmitSubmissionGate({ done: true })).toBe(true);
    expect(shouldRecheckPostSubmitSubmissionGate({ survey_status: 'open' })).toBe(true);
  });
});
