let warned = false;

const warnIfNeeded = () => {
  if (warned) return;
  warned = true;
  if (process.env.NODE_ENV !== 'production') {
    console.info('[SURVEY_SCHEDULER] Client scheduler is disabled. Use backend cron function process_survey_start_notifications_backend().');
  }
};

/**
 * Deprecated client entry point.
 * Survey notification fanout must run on backend cron.
 */
export const checkMatchesForSurveys = async () => {
  warnIfNeeded();
  return 0;
};

/**
 * Deprecated client scheduler initializer.
 */
export const initSurveyScheduler = () => {
  warnIfNeeded();
  return null;
};
