export const DEFAULT_SOCIAL_TIMEZONE = 'America/Argentina/Buenos_Aires';

/** Formats schedule text with an explicit zone; device locale settings cannot leak in. */
export function formatSocialDateTime(value, timezone = DEFAULT_SOCIAL_TIMEZONE) {
  if (!value) return 'A confirmar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'A confirmar';
  const options = {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: timezone || DEFAULT_SOCIAL_TIMEZONE,
  };
  try {
    return new Intl.DateTimeFormat('es-AR', options).format(date);
  } catch {
    return new Intl.DateTimeFormat('es-AR', {
      ...options, timeZone: DEFAULT_SOCIAL_TIMEZONE,
    }).format(date);
  }
}
