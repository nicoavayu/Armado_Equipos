export const SURVEY_STEPS = {
  PLAYED: 0,
  ATTENDANCE: 1,
  MVP: 2,
  GOALKEEPER: 3,
  CLEAN_MATCH: 4,
  RESULT: 5,
  DIRTY_PLAYERS: 6,
  ORGANIZE_TEAMS: 7,
  NOT_PLAYED_REASON: 10,
  NOT_PLAYED_ABSENTS: 11,
  ABSENTS: 12,
  DONE: 99,
};

export const shouldUseTeamsSetupStep = ({ teamsConfirmed, teamsLocked }) => (
  !teamsConfirmed && !teamsLocked
);

export const resolveNextResultGateStep = ({ teamsConfirmed, teamsLocked }) => (
  shouldUseTeamsSetupStep({ teamsConfirmed, teamsLocked })
    ? SURVEY_STEPS.ORGANIZE_TEAMS
    : SURVEY_STEPS.RESULT
);

export const buildSurveyFlowSteps = ({
  currentStep,
  seJugo,
  asistieronTodos,
  partidoLimpio,
  teamsConfirmed,
  teamsLocked,
}) => {
  const resolvedSteps = [SURVEY_STEPS.PLAYED];

  if (currentStep === SURVEY_STEPS.NOT_PLAYED_REASON || currentStep === SURVEY_STEPS.NOT_PLAYED_ABSENTS) {
    resolvedSteps.push(SURVEY_STEPS.NOT_PLAYED_REASON);
    if (currentStep === SURVEY_STEPS.NOT_PLAYED_ABSENTS) {
      resolvedSteps.push(SURVEY_STEPS.NOT_PLAYED_ABSENTS);
    }
    return resolvedSteps;
  }

  if (seJugo === false && currentStep !== SURVEY_STEPS.RESULT && currentStep !== SURVEY_STEPS.ORGANIZE_TEAMS) {
    resolvedSteps.push(SURVEY_STEPS.NOT_PLAYED_REASON);
    return resolvedSteps;
  }

  resolvedSteps.push(SURVEY_STEPS.ATTENDANCE);

  if (currentStep === SURVEY_STEPS.ABSENTS || asistieronTodos === false) {
    resolvedSteps.push(SURVEY_STEPS.ABSENTS);
  }

  resolvedSteps.push(SURVEY_STEPS.MVP, SURVEY_STEPS.GOALKEEPER, SURVEY_STEPS.CLEAN_MATCH);

  if (currentStep === SURVEY_STEPS.DIRTY_PLAYERS || partidoLimpio === false) {
    resolvedSteps.push(SURVEY_STEPS.DIRTY_PLAYERS);
  }

  if (shouldUseTeamsSetupStep({ teamsConfirmed, teamsLocked })) {
    resolvedSteps.push(SURVEY_STEPS.ORGANIZE_TEAMS);
  }

  resolvedSteps.push(SURVEY_STEPS.RESULT);

  return resolvedSteps;
};
