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

const normalizeLabel = (value) => String(value || '').trim();

const resolveNotificationMatchReferenceId = (notification) => {
  const data = notification?.data || {};
  const candidate = data?.partido_id
    || data?.partidoId
    || data?.match_id
    || data?.matchId
    || notification?.partido_id
    || notification?.match_ref
    || null;
  const normalized = String(candidate || '').trim();
  return normalized || null;
};

const isChallengeCancellationNotification = (notification) => {
  const data = notification?.data || {};
  const source = String(data?.source || '').trim().toLowerCase();
  const originType = String(data?.origin_type || data?.originType || '').trim().toLowerCase();
  return Boolean(
    data?.team_match_id
    || data?.teamMatchId
    || source === 'team_challenge'
    || originType === 'challenge',
  );
};

const extractChallengeMatchupFromCancellationMessage = (notification) => {
  const rawMessage = String(notification?.message || '').trim();
  if (!rawMessage) return '';

  const explicitVs = rawMessage.match(/cancel[oó]\s+el\s+partido\s+(.+?)\s+vs\s+(.+?)(?:[.!]|$)/i);
  if (explicitVs?.[1] && explicitVs?.[2]) {
    return `${normalizeLabel(explicitVs[1])} vs ${normalizeLabel(explicitVs[2])}`.trim();
  }

  const challengeLabel = rawMessage.match(/desaf[ií]o\s+de\s+"?(.+?)"?\s+fue\s+cancelado/i);
  if (challengeLabel?.[1]) {
    return normalizeLabel(challengeLabel[1]);
  }

  return '';
};

export const resolveMatchCancellationLabel = (notification, fallback = '') => {
  const data = notification?.data || {};
  const teamAName = normalizeLabel(data?.team_a_name || data?.teamAName || data?.equipo_a_name);
  const teamBName = normalizeLabel(data?.team_b_name || data?.teamBName || data?.equipo_b_name);
  if (teamAName && teamBName) {
    return `${teamAName} vs ${teamBName}`;
  }

  const matchName = normalizeLabel(resolveNotificationMatchName(notification, ''));
  if (matchName) {
    return matchName;
  }

  const matchupFromMessage = extractChallengeMatchupFromCancellationMessage(notification);
  if (matchupFromMessage) {
    return matchupFromMessage;
  }

  return normalizeLabel(fallback);
};

export const formatMatchCancelledMessage = (notification, { fallbackLabel = 'el partido' } = {}) => {
  const data = notification?.data || {};
  const isChallengeCancellation = isChallengeCancellationNotification(notification);
  const matchReferenceId = resolveNotificationMatchReferenceId(notification);
  const cancelledByTeam = normalizeLabel(
    data?.cancelled_by_team_name
    || data?.cancelledByTeamName
    || data?.team_name
    || data?.teamName
    || '',
  );
  const targetLabel = resolveMatchCancellationLabel(notification, fallbackLabel) || fallbackLabel;
  const normalizedTarget = normalizeLabel(targetLabel);

  if (isChallengeCancellation) {
    const matchIdFromFallback = normalizedTarget.match(/^el\s+partido\s+#(\d+)$/i)?.[1] || null;
    const challengeReferenceId = matchReferenceId || matchIdFromFallback || null;
    if (!normalizedTarget || /^el\s+partido$/i.test(normalizedTarget)) {
      if (challengeReferenceId) {
        return `El desafío #${challengeReferenceId} fue cancelado por el administrador.`;
      }
      return 'El desafío fue cancelado por el administrador.';
    }
    if (matchIdFromFallback) {
      return `El desafío #${matchIdFromFallback} fue cancelado por el administrador.`;
    }
    return `El desafío de ${quoteMatchName(normalizedTarget, normalizedTarget)} fue cancelado por el administrador.`;
  }

  if (cancelledByTeam && normalizedTarget) {
    return `El capitán de ${quoteMatchName(cancelledByTeam, 'un equipo')} canceló ${normalizedTarget}.`;
  }
  if (normalizedTarget) {
    return `${normalizedTarget} fue cancelado por el administrador.`;
  }
  return 'El partido fue cancelado por el administrador.';
};
