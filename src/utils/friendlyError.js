const TECHNICAL_PATTERNS = [
  /edge function returned a non-2xx/i,
  /failed to fetch/i,
  /network request failed/i,
  /networkerror/i,
  /fetch error/i,
  /jwt expired/i,
  /token is expired/i,
  /invalid jwt/i,
  /row-level security/i,
  /duplicate key value/i,
  /violates.*constraint/i,
  /pgrst/i,
  /postgrest/i,
  /supabase\.co/i,
  /non-2xx status/i,
  /\b[45]\d{2}\b.*status/i,
];

export function friendlyError(error, fallback) {
  const message = typeof error === 'string' ? error : (error?.message || '');
  if (!message) return fallback;
  const isTechnical = TECHNICAL_PATTERNS.some((p) => p.test(message));
  return isTechnical ? fallback : message;
}
