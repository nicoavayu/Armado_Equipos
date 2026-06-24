const CANCELLED_OR_CLOSED_STATES = new Set([
  'cancelado',
  'cancelled',
  'canceled',
  'deleted',
  'eliminado',
  'archived',
  'hidden',
  'finalizado',
  'finished',
  'completed',
  'closed',
  'cerrado',
  'cerrada',
]);

const normalizeToken = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const normalizeUserId = (value) => String(value || '').trim();

export const isMatchClosedForPlayerInvites = (match) => {
  const estado = normalizeToken(match?.estado_normalizado || match?.estado);
  if (estado && CANCELLED_OR_CLOSED_STATES.has(estado)) return true;

  const surveyStatus = normalizeToken(match?.survey_status);
  if (surveyStatus === 'closed' || surveyStatus === 'cerrada') return true;

  const resultStatus = normalizeToken(match?.result_status);
  if (['finished', 'completed', 'closed', 'draw', 'not_played', 'cancelled', 'canceled', 'cancelado'].includes(resultStatus)) {
    return true;
  }

  return Boolean(match?.deleted_at || match?.finished_at);
};

export const resolvePlayerInvitePermission = ({
  match,
  currentUserId,
  membershipRows = [],
}) => {
  const userId = normalizeUserId(currentUserId);
  const adminUserId = normalizeUserId(match?.creado_por);
  const isAdmin = Boolean(userId && adminUserId && userId === adminUserId);
  const isPlayer = Boolean(userId) && (membershipRows || []).some((row) => (
    String(row?.partido_id || '') === String(match?.id || '')
    && normalizeUserId(row?.usuario_id) === userId
  ));
  const isClosed = isMatchClosedForPlayerInvites(match);
  const playerInvitesEnabled = match?.player_invites_enabled === true;

  if (!userId) {
    return {
      canInvite: false,
      inviteStatus: 'not_authenticated',
      isAdmin,
      isPlayer,
      playerInvitesEnabled,
      isClosed,
      helper: 'Iniciá sesión para invitar.',
    };
  }

  if (isClosed) {
    return {
      canInvite: false,
      inviteStatus: 'match_closed',
      isAdmin,
      isPlayer,
      playerInvitesEnabled,
      isClosed,
      helper: 'Este partido ya no recibe invitaciones.',
    };
  }

  if (isAdmin) {
    return {
      canInvite: true,
      inviteStatus: 'available',
      isAdmin,
      isPlayer,
      playerInvitesEnabled,
      isClosed,
      helper: 'Organizador',
    };
  }

  if (!isPlayer) {
    return {
      canInvite: false,
      inviteStatus: 'not_in_match',
      isAdmin,
      isPlayer,
      playerInvitesEnabled,
      isClosed,
      helper: 'Sólo jugadores del partido pueden invitar.',
    };
  }

  if (!playerInvitesEnabled) {
    return {
      canInvite: false,
      inviteStatus: 'player_invites_disabled',
      isAdmin,
      isPlayer,
      playerInvitesEnabled,
      isClosed,
      helper: 'El organizador no habilitó invitaciones de jugadores.',
    };
  }

  return {
    canInvite: true,
    inviteStatus: 'available',
    isAdmin,
    isPlayer,
    playerInvitesEnabled,
    isClosed,
    helper: 'Invitaciones habilitadas para jugadores.',
  };
};

export const canShowGuestInviteActions = ({ isAdmin }) => Boolean(isAdmin);
