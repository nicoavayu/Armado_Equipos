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
  const teamMatchId = data?.team_match_id || data?.teamMatchId || null;
  if ((notification?.type === 'challenge_accepted' || notification?.type === 'team_match_created') && teamMatchId) {
    return `/quiero-jugar/equipos/partidos/${teamMatchId}`;
  }

  const matchId = extractNotificationMatchId(notification);
  if (matchId === null || matchId === undefined || matchId === '') {
    return '/quiero-jugar';
  }
  return `/partido-publico/${idMapper(matchId)}`;
};
