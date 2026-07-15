import {
  AUTH_REQUIRED_MESSAGE,
  PERMISSION_DENIED_MESSAGE,
  getAutoMatchProposalResponseError,
} from '../services/db/availability';

jest.mock('../lib/supabaseClient', () => ({
  supabase: { auth: {} },
}));

describe('auto-match proposal response errors', () => {
  test.each([
    ['proposal_member_expired', 'invite_expired', 'venció'],
    ['proposal_not_open', 'proposal_closed', 'no está disponible'],
    ['proposal_full', 'proposal_full', 'cupo'],
    ['proposal_geographic_incompatibility', 'geographic_incompatibility', 'otra compatible'],
    ['auto_match_location_or_account_ineligible', 'availability_ineligible', 'ubicación'],
  ])('maps %s to a safe product state', (technical, code, visibleCopy) => {
    const mapped = getAutoMatchProposalResponseError({ message: technical });
    expect(mapped).toEqual(expect.objectContaining({ code }));
    expect(mapped.message).toContain(visibleCopy);
    expect(mapped.message).not.toContain(technical);
  });

  test('does not expose a gestation schedule-conflict state anymore', () => {
    expect(getAutoMatchProposalResponseError({ message: 'proposal_schedule_conflict' })).toBeNull();
  });

  test.each([
    [AUTH_REQUIRED_MESSAGE, 'authentication_required'],
    [PERMISSION_DENIED_MESSAGE, 'permission_denied'],
  ])('keeps safe auth/access copy identifiable', (message, code) => {
    expect(getAutoMatchProposalResponseError({ message })).toEqual(expect.objectContaining({ code, message }));
  });

  test('reserves the generic UI fallback for unexpected/network failures', () => {
    expect(getAutoMatchProposalResponseError(new Error('Failed to fetch'))).toBeNull();
    expect(getAutoMatchProposalResponseError(new Error('unexpected database failure'))).toBeNull();
  });

  test('uses the approved copy for a geographically incompatible invitation', () => {
    expect(getAutoMatchProposalResponseError({ message: 'proposal_geographic_incompatibility' })).toEqual({
      code: 'geographic_incompatibility',
      message: 'Esta oportunidad ya no coincide con tu ubicación. Vamos a buscarte otra compatible.',
      refreshSource: 'proposal_geographic_incompatibility',
    });
  });
});
