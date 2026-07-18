import { resolveJoinRoleFlow, JOIN_ROLE_MESSAGES } from '../utils/joinRole';

describe('resolveJoinRoleFlow', () => {
  test('only players → player request', () => {
    expect(resolveJoinRoleFlow({
      matchWantsPlayers: true, matchWantsGoalkeeper: false, userHasGoalkeeper: true,
    })).toEqual({ outcome: 'player' });
  });

  test('only goalkeeper + user has ARQ → goalkeeper request', () => {
    expect(resolveJoinRoleFlow({
      matchWantsPlayers: false, matchWantsGoalkeeper: true, userHasGoalkeeper: true,
    })).toEqual({ outcome: 'goalkeeper' });
  });

  test('only goalkeeper + user without ARQ → blocked', () => {
    expect(resolveJoinRoleFlow({
      matchWantsPlayers: false, matchWantsGoalkeeper: true, userHasGoalkeeper: false,
    })).toEqual({ outcome: 'blocked_no_goalkeeper' });
    expect(JOIN_ROLE_MESSAGES.blocked_no_goalkeeper).toMatch(/arquero/i);
  });

  test('both + user has ARQ → choose', () => {
    expect(resolveJoinRoleFlow({
      matchWantsPlayers: true, matchWantsGoalkeeper: true, userHasGoalkeeper: true,
    })).toEqual({ outcome: 'choose' });
  });

  test('both + user without ARQ → player request (no chooser)', () => {
    expect(resolveJoinRoleFlow({
      matchWantsPlayers: true, matchWantsGoalkeeper: true, userHasGoalkeeper: false,
    })).toEqual({ outcome: 'player' });
  });

  test('neither flag → defensive player request', () => {
    expect(resolveJoinRoleFlow({
      matchWantsPlayers: false, matchWantsGoalkeeper: false, userHasGoalkeeper: true,
    })).toEqual({ outcome: 'player' });
  });
});
