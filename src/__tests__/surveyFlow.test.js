import {
  buildSurveyFlowSteps,
  resolveNextResultGateStep,
  SURVEY_STEPS,
} from '../utils/surveyFlow';

describe('survey flow for unconfirmed teams', () => {
  test('routes to team organization first and then reaches result step', () => {
    expect(resolveNextResultGateStep({ teamsConfirmed: false, teamsLocked: false }))
      .toBe(SURVEY_STEPS.ORGANIZE_TEAMS);

    expect(resolveNextResultGateStep({ teamsConfirmed: false, teamsLocked: true }))
      .toBe(SURVEY_STEPS.ORGANIZE_TEAMS);
  });

  test('flow includes result question even when teams are not pre-confirmed', () => {
    const steps = buildSurveyFlowSteps({
      currentStep: SURVEY_STEPS.CLEAN_MATCH,
      seJugo: true,
      asistieronTodos: true,
      partidoLimpio: true,
      teamsConfirmed: false,
      teamsLocked: false,
    });

    expect(steps).toContain(SURVEY_STEPS.ORGANIZE_TEAMS);
    expect(steps).toContain(SURVEY_STEPS.RESULT);
  });

  test('can skip team organization for fixed-team flows (team challenges)', () => {
    expect(resolveNextResultGateStep({
      teamsConfirmed: false,
      teamsLocked: false,
      disableOrganizeTeamsStep: true,
    })).toBe(SURVEY_STEPS.RESULT);

    const steps = buildSurveyFlowSteps({
      currentStep: SURVEY_STEPS.CLEAN_MATCH,
      seJugo: true,
      asistieronTodos: true,
      partidoLimpio: true,
      teamsConfirmed: false,
      teamsLocked: false,
      disableOrganizeTeamsStep: true,
    });

    expect(steps).not.toContain(SURVEY_STEPS.ORGANIZE_TEAMS);
    expect(steps).toContain(SURVEY_STEPS.RESULT);
  });
});
