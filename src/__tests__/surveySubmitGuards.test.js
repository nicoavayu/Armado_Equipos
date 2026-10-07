import fs from 'fs';
import path from 'path';
import {
  SURVEY_SUBMIT_TIMEOUT_CODE,
  isDuplicateSurveyResponseError,
  resolveSurveySubmitErrorMessage,
  runWithSubmitTimeout,
} from '../utils/surveySubmitGuards';

describe('survey submission guards', () => {
  afterEach(() => jest.useRealTimers());

  test('a step that answers in time returns its result and passes an abort signal', async () => {
    let receivedSignal = null;
    const result = await runWithSubmitTimeout(async (signal) => {
      receivedSignal = signal;
      return { error: null, data: 'ok' };
    }, 1000);
    expect(result).toEqual({ error: null, data: 'ok' });
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal.aborted).toBe(false);
  });

  test('a step that never answers ends in a timeout error and aborts the request', async () => {
    jest.useFakeTimers();
    let receivedSignal = null;
    const pending = runWithSubmitTimeout((signal) => {
      receivedSignal = signal;
      return new Promise(() => {});
    }, 20000);
    jest.advanceTimersByTime(20000);
    await expect(pending).rejects.toMatchObject({ code: SURVEY_SUBMIT_TIMEOUT_CODE });
    expect(receivedSignal.aborted).toBe(true);
  });

  test('an already stored response (double tap, retry) counts as saved', () => {
    expect(isDuplicateSurveyResponseError({ code: '23505', message: 'duplicate key value violates unique constraint "uq_survey_once"' })).toBe(true);
    expect(isDuplicateSurveyResponseError({ message: 'duplicate key value violates unique constraint "post_match_surveys_partido_id_votante_id_key"' })).toBe(true);
    expect(isDuplicateSurveyResponseError({ code: '42501', message: 'permission denied for table post_match_surveys' })).toBe(false);
    expect(isDuplicateSurveyResponseError(null)).toBe(false);
  });

  test('a failed save tells the person it was not saved and how to retry', () => {
    expect(resolveSurveySubmitErrorMessage({ code: SURVEY_SUBMIT_TIMEOUT_CODE })).toMatch(/no se guardaron.*reintentar/i);
    expect(resolveSurveySubmitErrorMessage(new Error('Failed to fetch'))).toMatch(/No pudimos guardar tus respuestas.*reintentar/);
  });
});

describe('EncuestaPartido submission contract', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../pages/EncuestaPartido.js'), 'utf8');

  test('renders on the public web route without a NotificationProvider', () => {
    expect(source).toContain('useNotifications() || {}');
  });

  test('a second tap cannot start a second submission before the re-render', () => {
    expect(source).toMatch(/if \(submitInFlightRef\.current\) \{/);
    expect(source).toMatch(/submitInFlightRef\.current = true;\s+setSubmitting\(true\);\s+await continueSubmitFlow/);
  });

  test('success is shown only after the insert, and closing the survey runs after it', () => {
    const insertIndex = source.indexOf("'db.insert_post_match_surveys'");
    const savedIndex = source.indexOf('setSubmittedNow(true);');
    const reconcileIndex = source.indexOf('reconcileSurveyAfterSubmit(matchIdNum, trace).catch');
    expect(insertIndex).toBeGreaterThan(-1);
    expect(savedIndex).toBeGreaterThan(insertIndex);
    expect(reconcileIndex).toBeGreaterThan(savedIndex);
  });

  test('a calendar date is not shifted by the time zone', () => {
    expect(source).toContain("new Date(Number(calendarDay[1]), Number(calendarDay[2]) - 1, Number(calendarDay[3]))");
  });
});
