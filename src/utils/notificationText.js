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

export const resolveNotificationTeamName = (notification, fallback = 'Equipo') => {
  const data = notification?.data || {};
  return (
    data?.team_name
    || data?.teamName
    || data?.equipo_nombre
    || data?.equipoName
    || fallback
  );
};

export const resolveTeamInviteActorName = (notification) => {
  const data = notification?.data || {};
  const fromData = [
    data?.inviter_name,
    data?.inviterName,
    data?.sender_name,
    data?.senderName,
    data?.from_name,
    data?.fromName,
  ].find(Boolean);

  if (fromData) return String(fromData).trim();

  const sourceText = String(notification?.message || notification?.title || '').trim();
  const actorMatch = sourceText.match(/^(.+?)\s+te\s+invito/i);
  if (actorMatch?.[1]) return actorMatch[1].trim();

  return '';
};

export const formatTeamInviteMessage = (notification) => {
  const teamName = resolveNotificationTeamName(notification, 'Equipo');
  const quotedTeamName = quoteMatchName(teamName, 'Equipo');
  const actorName = resolveTeamInviteActorName(notification);

  if (actorName) {
    return `${actorName} te invito al equipo ${quotedTeamName}`;
  }

  return `Te invitaron al equipo ${quotedTeamName}`;
};
