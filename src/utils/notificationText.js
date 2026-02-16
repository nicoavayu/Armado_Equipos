const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const quoteMatchName = (value, fallback = 'este partido') => {
  const raw = String(value || fallback).trim().replace(/^"+|"+$/g, '');
  return `"${raw || fallback}"`;
};

export const resolveNotificationMatchName = (notification, fallback = 'este partido') => {
  const data = notification?.data || {};
  return (
    data?.partido_nombre
    || data?.match_name
    || data?.matchName
    || notification?.partido_nombre
    || notification?.match_name
    || fallback
  );
};

export const applyMatchNameQuotes = (text, matchName) => {
  const sourceText = String(text || '');
  const normalizedMatchName = String(matchName || '').trim().replace(/^"+|"+$/g, '');
  if (!sourceText || !normalizedMatchName) return sourceText;

  const quoted = quoteMatchName(normalizedMatchName);
  const pattern = new RegExp(escapeRegExp(normalizedMatchName), 'g');

  return sourceText.replace(pattern, (found, offset, fullText) => {
    const before = fullText[offset - 1];
    const after = fullText[offset + found.length];
    if (before === '"' && after === '"') return found;
    return quoted;
  });
};
