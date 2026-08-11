export const IMPORTANT_NAME_LIMITS = Object.freeze({
  long: 23,
  extraLong: 35,
});

export function getImportantNameLength(value) {
  const length = String(value || '').trim().replace(/\s+/g, ' ').length;
  if (length >= IMPORTANT_NAME_LIMITS.extraLong) return 'extra-long';
  if (length >= IMPORTANT_NAME_LIMITS.long) return 'long';
  return 'standard';
}

export function importantNameProps(value, context = 'card') {
  const name = String(value || '').trim();
  return {
    'data-important-name': context,
    'data-name-length': getImportantNameLength(name),
    ...(name ? { title: name } : {}),
  };
}
