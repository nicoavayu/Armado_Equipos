export const extractNotificationMatchId = (notification = {}) => {
  const data = notification?.data || {};
  return (
    data?.match_id
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
  const matchId = extractNotificationMatchId(notification);
  if (matchId === null || matchId === undefined || matchId === '') {
    return '/quiero-jugar';
  }
  return `/partido-publico/${idMapper(matchId)}`;
};

