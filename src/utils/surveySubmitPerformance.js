const STORAGE_FLAG = 'survey_submit_perf_debug';
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

const normalizeFlagValue = (value) => String(value || '').trim().toLowerCase();

export const isSurveySubmitPerformanceTracingEnabled = () => {
  const envValue = typeof process !== 'undefined' && process?.env
    ? process.env.REACT_APP_SURVEY_SUBMIT_PERF
    : '';
  if (ENABLED_VALUES.has(normalizeFlagValue(envValue))) return true;

  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return ENABLED_VALUES.has(normalizeFlagValue(window.localStorage.getItem(STORAGE_FLAG)));
  } catch (_error) {
    return false;
  }
};

const nowMs = () => Date.now();

const roundMs = (value) => Math.round(Number(value || 0) * 10) / 10;

const summarizeError = (error) => ({
  message: error?.message || String(error || 'unknown_error'),
  code: error?.code || null,
  details: error?.details || null,
});

export const createSurveySubmitTrace = ({
  scope = 'survey-submit',
  partidoId = null,
  context = {},
  enabled = isSurveySubmitPerformanceTracingEnabled(),
} = {}) => {
  const startedAtMs = nowMs();
  const normalizedPartidoId = Number.isFinite(Number(partidoId)) ? Number(partidoId) : partidoId;
  const traceId = `${scope}:${normalizedPartidoId || 'unknown'}:${Math.round(startedAtMs)}:${Math.random().toString(36).slice(2, 8)}`;

  const log = (event, payload = {}) => {
    if (!enabled) return;
    console.info('[SURVEY_SUBMIT_PERF]', {
      traceId,
      scope,
      event,
      partidoId: normalizedPartidoId,
      elapsedMs: roundMs(nowMs() - startedAtMs),
      ...context,
      ...payload,
    });
  };

  const mark = (label, details = {}) => {
    log('mark', { label, ...details });
  };

  const measure = async (label, fn, details = {}) => {
    const stepStartedAtMs = nowMs();
    try {
      const result = await fn();
      log('step', {
        label,
        durationMs: roundMs(nowMs() - stepStartedAtMs),
        ok: true,
        ...details,
      });
      return result;
    } catch (error) {
      log('step', {
        label,
        durationMs: roundMs(nowMs() - stepStartedAtMs),
        ok: false,
        error: summarizeError(error),
        ...details,
      });
      throw error;
    }
  };

  const end = (details = {}) => {
    log('total', {
      durationMs: roundMs(nowMs() - startedAtMs),
      ...details,
    });
  };

  return {
    enabled,
    traceId,
    mark,
    measure,
    end,
  };
};
