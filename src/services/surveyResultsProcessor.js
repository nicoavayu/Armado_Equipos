import { finalizeIfComplete } from './surveyCompletionService';
import { ensureAwards } from './awardsService';

/**
 * Legacy compatibility wrapper.
 * Canonical closure and awards pipeline is:
 * EncuestaPartido -> finalizeIfComplete -> computeAndPersistAwards -> ensureAwards.
 */
export const processSurveyResults = async (partidoId) => {
  const idNum = Number(partidoId);
  if (!Number.isFinite(idNum) || idNum <= 0) return false;

  try {
    const finalizeRes = await finalizeIfComplete(idNum);
    if (!finalizeRes?.done) return false;
    if (finalizeRes?.awardsSkipped) return true;

    const ensureRes = await ensureAwards(idNum);
    return Boolean(ensureRes?.ok && (ensureRes?.applied || ensureRes?.row?.results_ready));
  } catch (error) {
    console.error('[SURVEY_RESULTS] compatibility processing failed:', error);
    return false;
  }
};

/**
 * Schedules compatibility processing.
 * Kept only for legacy callers that still invoke this module directly.
 */
export const scheduleSurveyResultsProcessing = (partidoId, partidoFecha, partidoHora) => {
  try {
    const matchDateTime = new Date(`${partidoFecha}T${partidoHora}`);
    const surveyCloseTime = new Date(matchDateTime.getTime() + (7 * 60 * 60 * 1000));
    const now = new Date();
    const timeUntilProcessing = surveyCloseTime.getTime() - now.getTime();

    if (timeUntilProcessing > 0) {
      setTimeout(() => {
        processSurveyResults(partidoId);
      }, timeUntilProcessing);

      console.log('[SURVEY_RESULTS] Scheduled compatibility processing:', {
        partidoId,
        minutesUntil: Math.round(timeUntilProcessing / 1000 / 60),
      });
      return;
    }

    processSurveyResults(partidoId);
  } catch (error) {
    console.error('[SURVEY_RESULTS] Error scheduling compatibility processing:', error);
  }
};
