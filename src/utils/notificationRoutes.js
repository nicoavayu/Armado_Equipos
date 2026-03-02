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

export const buildNotificationFallbackRoute = (notification = {}, idMapper = (value) => value) => {
  const data = notification?.data || {};
  const type = notification?.type || '';
  const teamMatchId = data?.team_match_id || data?.teamMatchId || null;
  const teamId = data?.team_id || data?.teamId || null;

  if ((notification?.type === 'challenge_accepted' || notification?.type === 'team_match_created') && teamMatchId) {
    return `/desafios/equipos/partidos/${teamMatchId}`;
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
