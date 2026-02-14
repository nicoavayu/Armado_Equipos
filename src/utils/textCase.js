export const toSentenceCase = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const lowerCased = trimmed.toLocaleLowerCase('es-AR');
  return lowerCased.charAt(0).toLocaleUpperCase('es-AR') + lowerCased.slice(1);
};

