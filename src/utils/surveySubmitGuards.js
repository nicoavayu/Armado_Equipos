// Guards for the post-match survey submission: never show success before the answer is
// saved, never leave the button waiting forever, and treat "already saved" as saved.

// Longest a single submission step may take before the screen offers a retry.
export const SURVEY_SUBMIT_STEP_TIMEOUT_MS = 20000;

export const SURVEY_SUBMIT_TIMEOUT_CODE = 'SURVEY_SUBMIT_TIMEOUT';

/**
 * Runs `task(signal)` and rejects with a SURVEY_SUBMIT_TIMEOUT error after `timeoutMs`.
 * The signal is aborted on timeout so a request that supports it is cancelled too.
 */
export const runWithSubmitTimeout = (task, timeoutMs = SURVEY_SUBMIT_STEP_TIMEOUT_MS) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      const error = new Error('La conexión tardó demasiado.');
      error.code = SURVEY_SUBMIT_TIMEOUT_CODE;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => task(controller?.signal)), timeout])
    .finally(() => clearTimeout(timer));
};

/**
 * The response is already stored (post_match_surveys is unique per match and voter): a
 * double tap, or a retry after a lost response, must end in the saved state, not an error.
 */
export const isDuplicateSurveyResponseError = (error) => {
  const code = String(error?.code || '').trim();
  if (code === '23505') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('duplicate key') && message.includes('post_match_surveys');
};

/** Message for a submission that did not save; the answers stay on screen. */
export const resolveSurveySubmitErrorMessage = (error) => {
  if (error?.code === SURVEY_SUBMIT_TIMEOUT_CODE) {
    return 'La conexión tardó demasiado y tus respuestas no se guardaron. Tocá de nuevo para reintentar.';
  }
  return 'No pudimos guardar tus respuestas. Revisá tu conexión y tocá de nuevo para reintentar.';
};
