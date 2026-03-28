const normalizeIdentityToken = (value) => String(value || '').trim().toLowerCase();

const normalizeSurveyStatusToken = (value) => {
  const token = normalizeIdentityToken(value);
  if (!token) return null;
  if (token === 'closed' || token === 'cerrada') return 'closed';
  if (token === 'open' || token === 'abierta') return 'open';
  return null;
};

export const resolvePostSubmitCompletionUiState = ({
  finalizeResult = null,
  submissionGate = null,
} = {}) => {
  const finalizedSurveyStatus = normalizeSurveyStatusToken(finalizeResult?.survey_status);
  const shouldMarkSurveyClosed = (
    submissionGate?.canSubmit === false
    || finalizeResult?.alreadyClosed === true
    || finalizedSurveyStatus === 'closed'
  );

  return {
    shouldMarkSurveyClosed,
    closedAt: shouldMarkSurveyClosed
      ? (submissionGate?.closedAt || finalizeResult?.closedAt || finalizeResult?.deadlineAt || null)
      : null,
  };
};
