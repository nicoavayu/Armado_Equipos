import { useEffect } from 'react';

/**
 * Client scheduler disabled.
 * Survey fanout now runs from backend cron.
 */
export const useSurveyScheduler = (enabled = true) => {
  useEffect(() => {
    if (!enabled) return;
    if (process.env.NODE_ENV !== 'production') {
      console.info('[SURVEY_SCHEDULER] Client polling disabled. Backend cron is responsible for survey fanout.');
    }
  }, [enabled]);
};
