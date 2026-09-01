import { supabase } from '../services/api/supabase';
import {
  loadTeamPhotoState,
  removeTeamPhoto,
  resolveTeamPhoto,
  revokeTeamPhoto,
  setTeamPhotoEditorialStatus,
  uploadTeamPhoto,
} from '../features/torneos/api/tournamentTeamPhotoService';
import { prepareTeamPhotoFile } from '../features/torneos/domain/teamPhotos';

jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));

jest.mock('../features/torneos/domain/teamPhotos', () => ({
  ...jest.requireActual('../features/torneos/domain/teamPhotos'),
  prepareTeamPhotoFile: jest.fn(),
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const CURRENT = '33333333-3333-4333-8333-333333333333';
const CANDIDATE = '44444444-4444-4444-8444-444444444444';
const CURRENT_REF = { kind: 'team_photo', id: CURRENT, variant: 'original' };
const CANDIDATE_REF = { kind: 'team_photo', id: CANDIDATE, variant: 'original' };

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

describe('tournament team photo service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REACT_APP_SUPABASE_URL = 'http://127.0.0.1:57321';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'local-anon';
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'local-access-token' } },
    });
    prepareTeamPhotoFile.mockResolvedValue({
      source: new Blob(['jpeg']), mime: 'image/jpeg', width: 1600, height: 900,
    });
    global.fetch = jest.fn();
  });

  test('one read brings the current photo, the candidate and both capabilities', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        organizationId: ORG, teamEntryId: ENTRY,
        canManage: true, canModerate: false,
        current: { teamPhotoId: CURRENT, ref: CURRENT_REF, width: 1600, height: 900, approvedAt: '2026-08-20T10:00:00Z' },
        candidate: {
          teamPhotoId: CANDIDATE, ref: CANDIDATE_REF, width: 1600, height: 900,
          editorialStatus: 'pending_review', reviewReason: null,
        },
      },
      error: null,
    });
    const state = await loadTeamPhotoState({ organizationId: ORG, teamEntryId: ENTRY });
    expect(supabase.rpc).toHaveBeenCalledWith('get_tournament_team_photo_state', {
      p_organization_id: ORG, p_team_entry_id: ENTRY,
    });
    expect(state).toMatchObject({
      canManage: true, canModerate: false,
      current: { teamPhotoId: CURRENT, ref: CURRENT_REF },
      candidate: { teamPhotoId: CANDIDATE, editorialStatus: 'pending_review' },
    });
  });

  test('a viewer who cannot manage gets no candidate at all', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        organizationId: ORG, teamEntryId: ENTRY, canManage: false, canModerate: false,
        current: { teamPhotoId: CURRENT, ref: CURRENT_REF },
        candidate: null,
      },
      error: null,
    });
    const state = await loadTeamPhotoState({ organizationId: ORG, teamEntryId: ENTRY });
    expect(state.candidate).toBeNull();
    expect(state.canManage).toBe(false);
  });

  test('a forbidden read surfaces as a non-retryable message, not a raw SQLSTATE', async () => {
    supabase.rpc.mockResolvedValue({
      data: null, error: { message: 'TORNEOS_TEAM_PHOTO_FORBIDDEN' },
    });
    await expect(loadTeamPhotoState({ organizationId: ORG, teamEntryId: ENTRY }))
      .rejects.toMatchObject({
        code: 'TORNEOS_TEAM_PHOTO_FORBIDDEN',
        retryable: false,
        message: expect.stringContaining('No tenés permiso'),
      });
  });

  test('uploading sends normalized bytes and reports that the current photo stayed', async () => {
    global.fetch.mockResolvedValue(jsonResponse(201, {
      imageRef: CANDIDATE_REF,
      editorialStatus: 'pending_review',
      replacedCandidateId: null,
      currentTeamPhotoId: CURRENT,
    }));
    const result = await uploadTeamPhoto({
      organizationId: ORG, teamEntryId: ENTRY, file: { name: 'plantel.jpg' },
    });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain('/functions/v1/tournament-team-photos?action=upload');
    expect(url).toContain(`teamEntryId=${ENTRY}`);
    expect(init.method).toBe('PUT');
    expect(init.headers['x-image-width']).toBe('1600');
    expect(init.headers['Content-Type']).toBe('image/jpeg');
    // El navegador nunca manda un checksum: lo calcula el Edge function.
    expect(Object.keys(init.headers).join(' ')).not.toMatch(/checksum|sha/i);
    expect(result).toEqual({
      ref: CANDIDATE_REF,
      editorialStatus: 'pending_review',
      replacedCandidateId: null,
      currentTeamPhotoId: CURRENT,
    });
  });

  test('a contract-breaking upload response is rejected instead of trusted', async () => {
    global.fetch.mockResolvedValue(jsonResponse(201, {
      imageRef: { kind: 'player_portrait', id: CANDIDATE, variant: 'original' },
    }));
    await expect(uploadTeamPhoto({
      organizationId: ORG, teamEntryId: ENTRY, file: { name: 'plantel.jpg' },
    })).rejects.toMatchObject({ code: 'upload_contract_invalid', retryable: false });
  });

  test('a rejected file is not retried; a network hiccup is', async () => {
    global.fetch.mockResolvedValue(jsonResponse(422, { error: 'file_invalid' }));
    await expect(uploadTeamPhoto({
      organizationId: ORG, teamEntryId: ENTRY, file: { name: 'plantel.jpg' },
    })).rejects.toMatchObject({ code: 'file_invalid', retryable: false });

    global.fetch.mockResolvedValue(jsonResponse(502, { error: 'storage_unavailable' }));
    await expect(uploadTeamPhoto({
      organizationId: ORG, teamEntryId: ENTRY, file: { name: 'plantel.jpg' },
    })).rejects.toMatchObject({ code: 'storage_unavailable', retryable: true });
  });

  test('resolving rebuilds the signature against the configured origin and never persists it', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, {
      ref: CURRENT_REF, url: '/storage/v1/object/sign/tournament-team-photos/x?token=t',
      ttlSeconds: 300, width: 1600, height: 900, mimeType: 'image/jpeg',
    }));
    const resolved = await resolveTeamPhoto(CURRENT_REF);
    expect(resolved.url).toBe(
      'http://127.0.0.1:57321/storage/v1/object/sign/tournament-team-photos/x?token=t',
    );
    expect(resolved.ttlSeconds).toBe(300);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ action: 'resolve', ref: CURRENT_REF, audience: 'authenticated_team' });
  });

  test('an absolute URL in the payload is refused: the host is not the payload to choose', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, {
      ref: CURRENT_REF, url: 'https://evil.example/steal', ttlSeconds: 300,
    }));
    await expect(resolveTeamPhoto(CURRENT_REF))
      .rejects.toMatchObject({ code: 'storage_unavailable' });
  });

  test('a foreign ImageRef never reaches the network', async () => {
    await expect(resolveTeamPhoto({ kind: 'player_portrait', id: CURRENT, variant: 'original' }))
      .rejects.toMatchObject({ code: 'invalid_image_ref' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('approving and rejecting go through the moderation RPC with its reason', async () => {
    supabase.rpc.mockResolvedValue({
      data: { teamPhotoId: CANDIDATE, editorialStatus: 'approved', replacedTeamPhotoId: CURRENT },
      error: null,
    });
    await expect(setTeamPhotoEditorialStatus({
      organizationId: ORG, teamPhotoId: CANDIDATE, editorialStatus: 'approved',
    })).resolves.toMatchObject({ editorialStatus: 'approved', replacedTeamPhotoId: CURRENT });
    expect(supabase.rpc).toHaveBeenLastCalledWith(
      'set_tournament_team_photo_editorial_status',
      {
        p_organization_id: ORG, p_team_photo_id: CANDIDATE,
        p_editorial_status: 'approved', p_review_reason: null,
      },
    );

    supabase.rpc.mockResolvedValue({
      data: { teamPhotoId: CANDIDATE, editorialStatus: 'rejected', reviewReason: 'Falta el plantel completo.' },
      error: null,
    });
    await expect(setTeamPhotoEditorialStatus({
      organizationId: ORG, teamPhotoId: CANDIDATE, editorialStatus: 'rejected',
      reviewReason: 'Falta el plantel completo.',
    })).resolves.toMatchObject({ reviewReason: 'Falta el plantel completo.' });
  });

  test('revoking the current photo is its own operation', async () => {
    supabase.rpc.mockResolvedValue({ data: { teamPhotoId: CURRENT, revoked: true }, error: null });
    await expect(revokeTeamPhoto({ organizationId: ORG, teamPhotoId: CURRENT }))
      .resolves.toEqual({ teamPhotoId: CURRENT, revoked: true });
    expect(supabase.rpc).toHaveBeenCalledWith('revoke_tournament_team_photo', {
      p_organization_id: ORG, p_team_photo_id: CURRENT,
    });
  });

  test('removing an object goes through the trusted function, never Storage directly', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { teamPhotoId: CANDIDATE, deleted: true }));
    await expect(removeTeamPhoto({ teamPhotoId: CANDIDATE }))
      .resolves.toEqual({ teamPhotoId: CANDIDATE, deleted: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ action: 'delete', teamPhotoId: CANDIDATE });
  });

  test('an expired session fails before any request is made', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(removeTeamPhoto({ teamPhotoId: CANDIDATE }))
      .rejects.toMatchObject({ code: 'auth_required', retryable: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
