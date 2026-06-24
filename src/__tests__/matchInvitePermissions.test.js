import {
  canShowGuestInviteActions,
  resolvePlayerInvitePermission,
} from '../utils/matchInvitePermissions';

const ADMIN_ID = 'admin-user';
const PLAYER_ID = 'player-user';
const OTHER_ID = 'other-user';

const baseMatch = {
  id: 55,
  creado_por: ADMIN_ID,
  estado: 'active',
  player_invites_enabled: false,
};

const membershipRows = [
  { partido_id: 55, usuario_id: PLAYER_ID },
];

describe('matchInvitePermissions', () => {
  test('admin puede invitar aunque el toggle esté apagado', () => {
    const permission = resolvePlayerInvitePermission({
      match: baseMatch,
      currentUserId: ADMIN_ID,
      membershipRows,
    });

    expect(permission.canInvite).toBe(true);
    expect(permission.inviteStatus).toBe('available');
    expect(permission.isAdmin).toBe(true);
  });

  test('jugador confirmado puede invitar si el toggle está prendido', () => {
    const permission = resolvePlayerInvitePermission({
      match: { ...baseMatch, player_invites_enabled: true },
      currentUserId: PLAYER_ID,
      membershipRows,
    });

    expect(permission.canInvite).toBe(true);
    expect(permission.inviteStatus).toBe('available');
    expect(permission.isPlayer).toBe(true);
  });

  test('jugador confirmado no puede invitar si el toggle está apagado', () => {
    const permission = resolvePlayerInvitePermission({
      match: baseMatch,
      currentUserId: PLAYER_ID,
      membershipRows,
    });

    expect(permission.canInvite).toBe(false);
    expect(permission.inviteStatus).toBe('player_invites_disabled');
    expect(permission.helper).toBe('El organizador no habilitó invitaciones de jugadores.');
  });

  test('usuario que no pertenece al partido no puede invitar', () => {
    const permission = resolvePlayerInvitePermission({
      match: { ...baseMatch, player_invites_enabled: true },
      currentUserId: OTHER_ID,
      membershipRows,
    });

    expect(permission.canInvite).toBe(false);
    expect(permission.inviteStatus).toBe('not_in_match');
  });

  test('partidos cerrados o finalizados no aceptan invitaciones de jugadores', () => {
    const permission = resolvePlayerInvitePermission({
      match: { ...baseMatch, player_invites_enabled: true, estado: 'finalizado' },
      currentUserId: PLAYER_ID,
      membershipRows,
    });

    expect(permission.canInvite).toBe(false);
    expect(permission.inviteStatus).toBe('match_closed');
  });

  test('guest/link/WhatsApp no aparece para no-admin', () => {
    expect(canShowGuestInviteActions({ isAdmin: true })).toBe(true);
    expect(canShowGuestInviteActions({ isAdmin: false })).toBe(false);
  });
});
