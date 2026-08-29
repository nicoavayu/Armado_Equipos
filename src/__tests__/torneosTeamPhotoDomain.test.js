import {
  TEAM_PHOTO_ENABLED_AUDIENCES,
  TEAM_PHOTO_LIMITS,
  isTeamPhotoRef,
  resolveTeamPhotoDisplay,
  teamPhotoActions,
  teamPhotoRef,
  validateTeamPhotoFile,
} from '../features/torneos/domain/teamPhotos';

const ID = '33333333-3333-4333-8333-333333333333';
const REF = { kind: 'team_photo', id: ID, variant: 'original' };

function file({ name = 'plantel.jpg', type = 'image/jpeg', size = 1024 } = {}) {
  return { name, type, size };
}

describe('team photo reference', () => {
  test('is a durable ImageRef and never a path or a URL', () => {
    expect(teamPhotoRef(ID)).toEqual(REF);
    expect(isTeamPhotoRef(REF)).toBe(true);
    expect(() => teamPhotoRef('not-a-uuid')).toThrow(TypeError);
    // Una referencia de retrato no es una referencia de foto de equipo.
    expect(isTeamPhotoRef({ kind: 'player_portrait', id: ID, variant: 'original' })).toBe(false);
    expect(isTeamPhotoRef({ kind: 'team_photo', id: ID, variant: 'social' })).toBe(false);
  });

  test('only the authenticated_team audience exists in this phase', () => {
    expect(TEAM_PHOTO_ENABLED_AUDIENCES).toEqual(['authenticated_team']);
    expect(TEAM_PHOTO_ENABLED_AUDIENCES).not.toContain('public_page');
    expect(TEAM_PHOTO_ENABLED_AUDIENCES).not.toContain('social_export');
  });
});

describe('selection pre-flight', () => {
  test('accepts the three raster formats the pipeline stores', () => {
    for (const [type, name] of [
      ['image/jpeg', 'a.jpg'], ['image/png', 'a.png'], ['image/webp', 'a.webp'],
    ]) {
      expect(validateTeamPhotoFile(file({ type, name })).valid).toBe(true);
    }
  });

  test('rejects what the server would reject, with a reason in Spanish', () => {
    expect(validateTeamPhotoFile(null)).toMatchObject({ valid: false, code: 'missing' });
    expect(validateTeamPhotoFile(file({ type: 'image/heic', name: 'a.heic' })))
      .toMatchObject({ valid: false, code: 'mime' });
    expect(validateTeamPhotoFile(file({ type: 'image/png', name: 'a.jpg' })))
      .toMatchObject({ valid: false, code: 'extension' });
    expect(validateTeamPhotoFile(file({ size: 0 }))).toMatchObject({ valid: false, code: 'size' });
    expect(validateTeamPhotoFile(file({ size: 9 * 1024 * 1024 })))
      .toMatchObject({ valid: false, code: 'size' });
  });

  test('normalization strips metadata by re-encoding and stays under the server ceiling', () => {
    // `resizeToFit` es lo que fuerza el re-encode del canvas, y el re-encode es
    // lo que deja el archivo sin metadata. Sin eso subiría el original con EXIF.
    expect(TEAM_PHOTO_LIMITS.resizeToFit).toBe(true);
    expect(TEAM_PHOTO_LIMITS.allowHeicTranscode).toBe(false);
    expect(TEAM_PHOTO_LIMITS.maxEdge).toBeLessThan(12_000);
    expect(TEAM_PHOTO_LIMITS.maxPixels).toBeLessThan(36_000_000);
  });
});

describe('what gets displayed', () => {
  const current = { teamPhotoId: ID, ref: REF, editorialStatus: 'approved' };
  const candidateRef = { kind: 'team_photo', id: '44444444-4444-4444-8444-444444444444', variant: 'original' };
  const candidate = { teamPhotoId: candidateRef.id, ref: candidateRef, editorialStatus: 'pending_review' };

  test('the approved photo is the one shown', () => {
    expect(resolveTeamPhotoDisplay({ current, candidate: null }))
      .toMatchObject({ source: 'current', ref: REF });
  });

  test('a pending candidate never replaces the current photo on screen', () => {
    expect(resolveTeamPhotoDisplay({ current, candidate }))
      .toMatchObject({ source: 'current', ref: REF });
  });

  test('a rejected candidate never replaces the current photo either', () => {
    expect(resolveTeamPhotoDisplay({
      current, candidate: { ...candidate, editorialStatus: 'rejected' },
    })).toMatchObject({ source: 'current', ref: REF });
  });

  test('without an approved photo it falls back, even while a candidate waits', () => {
    expect(resolveTeamPhotoDisplay({ current: null, candidate }))
      .toMatchObject({ source: 'fallback', ref: null, hasCandidate: true });
    expect(resolveTeamPhotoDisplay({ current: null, candidate: null }))
      .toMatchObject({ source: 'fallback', ref: null });
    expect(resolveTeamPhotoDisplay(null)).toMatchObject({ source: 'fallback', ref: null });
  });

  test('an unrecognized state falls back instead of guessing', () => {
    expect(resolveTeamPhotoDisplay({ current: { teamPhotoId: ID, ref: null } }))
      .toMatchObject({ source: 'unknown', ref: null });
    expect(resolveTeamPhotoDisplay({ current: { ref: { kind: 'gallery_asset', id: ID } } }))
      .toMatchObject({ source: 'unknown', ref: null });
  });
});

describe('which actions are offered', () => {
  const current = { teamPhotoId: ID, ref: REF };
  const candidate = { teamPhotoId: 'x', editorialStatus: 'pending_review' };

  test('an actor who can only read gets no actions at all', () => {
    expect(teamPhotoActions({ canManage: false, canModerate: false, current, candidate: null }))
      .toEqual({
        canUpload: false, canWithdrawCandidate: false, canApprove: false,
        canReject: false, canRevokeCurrent: false,
      });
  });

  test('managing is uploading, and never moderating', () => {
    const actions = teamPhotoActions({
      canManage: true, canModerate: false, current, candidate,
    });
    expect(actions).toMatchObject({
      canUpload: true, canWithdrawCandidate: true,
      canApprove: false, canReject: false, canRevokeCurrent: false,
    });
  });

  test('moderating decides, and the decision needs something pending to decide on', () => {
    expect(teamPhotoActions({ canManage: false, canModerate: true, current, candidate }))
      .toMatchObject({ canApprove: true, canReject: true, canRevokeCurrent: true, canUpload: false });
    // Ya rechazada: no hay nada que aprobar hasta que suban otra.
    expect(teamPhotoActions({
      canManage: false, canModerate: true, current,
      candidate: { ...candidate, editorialStatus: 'rejected' },
    })).toMatchObject({ canApprove: false, canReject: false, canRevokeCurrent: true });
    // Sin vigente no hay nada que retirar.
    expect(teamPhotoActions({ canManage: false, canModerate: true, current: null, candidate: null }))
      .toMatchObject({ canRevokeCurrent: false, canApprove: false });
  });
});
