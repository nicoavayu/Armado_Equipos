export const extractNotificationMatchId = (notification = {}) => {
  const data = notification?.data || {};
  return (
    data?.team_match_id
    || data?.teamMatchId
    || data?.match_id
    || data?.matchId
    || data?.partido_id
    || data?.partidoId
    || notification?.partido_id
    || notification?.match_id
    || notification?.match_ref
    || notification?.target_params?.partido_id
    || null
  );
};

export const isTeamChallengeNotification = (notification = {}) => {
  const type = String(notification?.type || '').trim().toLowerCase();
  const data = notification?.data || {};
  const source = String(data?.source || '').trim().toLowerCase();
  const title = String(notification?.title || '').trim().toLowerCase();

  if (type === 'challenge_accepted' || type === 'team_match_created') return true;
  if (source === 'team_challenge') return true;
  if (data?.team_match_id || data?.teamMatchId || data?.challenge_id || data?.challengeId) return true;
  if (type === 'match_update' && title.includes('desafio aceptado')) return true;

  return false;
};

export const extractTeamMatchId = (notification = {}) => {
  const data = notification?.data || {};
  const explicitTeamMatchId = data?.team_match_id || data?.teamMatchId || null;
  if (explicitTeamMatchId !== null && explicitTeamMatchId !== undefined && String(explicitTeamMatchId).trim() !== '') {
    return explicitTeamMatchId;
  }

  const deepLink = data?.deep_link || data?.deepLink || data?.link || notification?.deep_link || notification?.deepLink || '';
  const linkMatch = String(deepLink).match(/\/desafios\/equipos\/partidos\/([^/?#]+)/i);
  if (linkMatch?.[1]) return linkMatch[1];

  return null;
};

export const buildTeamChallengeRoute = (notification = {}) => {
  const teamMatchId = extractTeamMatchId(notification);
  if (teamMatchId !== null && teamMatchId !== undefined && String(teamMatchId).trim() !== '') {
    return `/desafios/equipos/partidos/${teamMatchId}`;
  }
  return '/desafios';
};

export const buildNotificationFallbackRoute = (notification = {}, idMapper = (value) => value) => {
  const data = notification?.data || {};
  const type = notification?.type || '';
  const teamId = data?.team_id || data?.teamId || null;

  if (isTeamChallengeNotification(notification)) {
    return buildTeamChallengeRoute(notification);
  }

  if ((type === 'team_captain_transfer' || type === 'team_invite') && teamId) {
    return `/desafios/equipos/${teamId}`;
  }

  if (type === 'team_invite' || type === 'team_captain_transfer' || type === 'challenge_accepted' || type === 'team_match_created') {
    return '/desafios';
  }

  const matchId = extractNotificationMatchId(notification);
  if (matchId === null || matchId === undefined || matchId === '') {
    return '/quiero-jugar';
  }
  return `/partido-publico/${idMapper(matchId)}`;
};
