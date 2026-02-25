export const SURVEY_FINALIZE_DELAY_MS = Number(import.meta.env.VITE_SURVEY_FINALIZE_DELAY_MS) || 12 * 60 * 60 * 1000;
export const SURVEY_START_DELAY_MS = Number(import.meta.env.VITE_SURVEY_START_DELAY_MS) || 60 * 60 * 1000;
export const SURVEY_REMINDER_LEAD_MS = Number(import.meta.env.VITE_SURVEY_REMINDER_LEAD_MS) || 60 * 60 * 1000;
export const SURVEY_MIN_VOTERS_FOR_AWARDS = Number(import.meta.env.VITE_SURVEY_MIN_VOTERS_FOR_AWARDS) || 3;
export const SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE = Number(import.meta.env.VITE_SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE) || 3;
