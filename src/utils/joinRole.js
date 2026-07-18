// Resolves HOW a user joins a match, per the two independent search toggles and
// whether the user actually keeps goal (ARQ among their positions).
//
// Outcomes:
//   'player'                → send a normal player request (role='player').
//   'goalkeeper'            → send a goalkeeper request (role='goalkeeper').
//   'choose'                → the match wants both and the user can keep goal:
//                             ask "¿Cómo querés sumarte?".
//   'blocked_no_goalkeeper' → the match ONLY wants a goalkeeper and the user does
//                             not have ARQ: cannot request.

export const JOIN_ROLE_MESSAGES = {
  blocked_no_goalkeeper: 'Este partido busca arquero. Agregá Arquero a tus posiciones en tu perfil para poder sumarte.',
};

/**
 * @param {object} params
 * @param {boolean} params.matchWantsPlayers - partidos.falta_jugadores
 * @param {boolean} params.matchWantsGoalkeeper - partidos.busca_arquero
 * @param {boolean} params.userHasGoalkeeper - user lists ARQ among positions
 * @returns {{ outcome: ('player'|'goalkeeper'|'choose'|'blocked_no_goalkeeper') }}
 */
export const resolveJoinRoleFlow = ({
  matchWantsPlayers,
  matchWantsGoalkeeper,
  userHasGoalkeeper,
}) => {
  const wantsPlayers = matchWantsPlayers === true;
  const wantsGoalkeeper = matchWantsGoalkeeper === true;
  const hasGoalkeeper = userHasGoalkeeper === true;

  if (wantsGoalkeeper && !wantsPlayers) {
    return { outcome: hasGoalkeeper ? 'goalkeeper' : 'blocked_no_goalkeeper' };
  }

  if (wantsPlayers && wantsGoalkeeper) {
    return { outcome: hasGoalkeeper ? 'choose' : 'player' };
  }

  // Only players, or (defensively) neither: a normal player request.
  return { outcome: 'player' };
};
