export const resolveSurveyAccess = async ({ supabaseClient, matchId, userId }) => {
  const matchIdNum = Number(matchId);
  if (!supabaseClient || !Number.isFinite(matchIdNum) || matchIdNum <= 0 || !userId) {
    return {
      allowed: false,
      title: 'Encuesta no disponible',
      message: 'No se pudo validar esta encuesta en este momento.',
      reason: 'invalid_params',
    };
  }

  try {
    const { data: rosterRows, error: rosterError } = await supabaseClient
      .from('jugadores')
      .select('usuario_id')
      .eq('partido_id', matchIdNum)
      .not('usuario_id', 'is', null);

    if (rosterError) throw rosterError;

    const loggedPlayers = Array.isArray(rosterRows) ? rosterRows : [];
    if (loggedPlayers.length === 0) {
      return {
        allowed: false,
        title: 'Encuesta no disponible',
        message: 'Este partido se jugó sin jugadores con cuenta registrada, por eso no se generaron datos para la encuesta.',
        reason: 'no_logged_players',
      };
    }

    const isCurrentUserInRoster = loggedPlayers.some((row) => String(row?.usuario_id || '') === String(userId));
    if (!isCurrentUserInRoster) {
      return {
        allowed: false,
        title: 'Encuesta no disponible',
        message: 'Esta encuesta solo está disponible para jugadores con cuenta registrada que participaron de este partido.',
        reason: 'user_not_participant',
      };
    }

    return {
      allowed: true,
      title: '',
      message: '',
      reason: 'ok',
    };
  } catch (_error) {
    return {
      allowed: false,
      title: 'Encuesta no disponible',
      message: 'No se pudo validar esta encuesta en este momento.',
      reason: 'query_error',
    };
  }
};
