const HOUR_MS = 60 * 60 * 1000;

// Product requirement: surveys stay open up to 24h after opening.
export const SURVEY_FINALIZE_DELAY_MS = 24 * HOUR_MS;
export const SURVEY_START_DELAY_MS = Number(import.meta.env.VITE_SURVEY_START_DELAY_MS) || 60 * 60 * 1000;
export const SURVEY_REMINDER_12H_LEAD_MS = 12 * HOUR_MS;
export const SURVEY_REMINDER_1H_LEAD_MS = 1 * HOUR_MS;
// Backward-compatible alias used across existing flows.
export const SURVEY_REMINDER_LEAD_MS = SURVEY_REMINDER_1H_LEAD_MS;
export const SURVEY_MIN_VOTERS_FOR_AWARDS = Number(import.meta.env.VITE_SURVEY_MIN_VOTERS_FOR_AWARDS) || 3;
export const SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE = Number(import.meta.env.VITE_SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE) || 3;
