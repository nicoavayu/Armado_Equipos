// PREMIUM SPONSORS (0020) — the four service methods in both compositions: the hybrid adapter over the Torneos gateway
// (BRANDING-V1 opt-in, signed reads, the object route) and the LOCAL single-project service (its own storage and RPCs).
// Same RPC names and p_* payloads, the uploaded object removed when the save is refused, the replaced or archived logo
// removed afterwards, ids checked before the network, and every refusal as Spanish copy (never an internal code).
import {
  createStagingV1WorkspaceService,
  SPONSOR_METHODS,
} from '../features/torneos/stagingV1/stagingV1WorkspaceService';
import { tournamentWorkspaceService } from '../features/torneos/api/tournamentWorkspaceService';
import { TorneosBoundaryError } from '../features/torneos/foundation/errors';
import {
  authorizedBrandingUrl,
  forgetAuthorizedBrandingUrls,
} from '../features/torneos/domain/brandingUrlRegistry';
import { ERROR_MESSAGES } from '../features/torneos/api/tournamentWorkspaceErrors';

jest.mock('../features/torneos/domain/brandingFiles', () => {
  const actual = jest.requireActual('../features/torneos/domain/brandingFiles');
  return {
    ...actual,
    // A plain function: CRA's resetMocks would wipe a jest.fn implementation before each test.
    prepareBrandingFile: async (file) => {
      if (file?.type === 'image/gif') throw new Error('Formato no admitido. Usá PNG, JPEG o WebP.');
      return { mime: 'image/png', width: 64, height: 64, source: file };
    },
  };
});

// LOCAL: the Core singleton, recorded. Plain functions over module state (resetMocks-safe).
const mockLocal = { calls: [], rpc: {}, uploadError: null, removed: [] };
jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: async (name, params) => {
      mockLocal.calls.push(['rpc', name, params]);
      const answer = mockLocal.rpc[name];
      return typeof answer === 'function' ? answer(params) : (answer || { data: null, error: null });
    },
    storage: {
      from: (bucket) => ({
        upload: async (path) => { mockLocal.calls.push(['upload', bucket, path]); return { error: mockLocal.uploadError }; },
        remove: async ([path]) => { mockLocal.calls.push(['remove', bucket, path]); mockLocal.removed.push(path); return { data: [{ name: path }], error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://local.example.test/public/${bucket}/${path}` } }),
      }),
    },
  },
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const SEASON = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444441';
const S2 = '44444444-4444-4444-8444-444444444442';
const S3 = '44444444-4444-4444-8444-444444444443';
const S4 = '44444444-4444-4444-8444-444444444444';
const GENERATED = '55555555-5555-4555-8555-555555555555';
const OWNER = `${ORG}/organizations/${ORG}`;
const path = (n) => `${OWNER}/6666666${n}-6666-4666-8666-666666666666.png`;
const NEW_PATH = `${OWNER}/${GENERATED}.png`;
const signed = (p) => `https://gateway.example.test/storage/v1/object/sign/tournament-branding/${p}?token=t`;
const png = () => new Blob(['png'], { type: 'image/png' });

function rpcError(message, { code = '42501', details = null } = {}) {
  const error = new TorneosBoundaryError('TORNEOS_RPC_ERROR');
  error.rpcError = { message, code, details, hint: null };
  return error;
}

function recordingTransport(answers = {}) {
  const calls = [];
  return {
    calls,
    transport: {
      rpc: async (name, params) => {
        calls.push(['rpc', name, params]);
        const answer = answers[name];
        return typeof answer === 'function' ? answer(params) : (answer ?? null);
      },
      brandingObject: async (method, objectPath) => {
        calls.push([method, objectPath]);
        if (method === 'POST') return { path: answers.storedPath ?? `${objectPath}/${GENERATED}.png` };
        if (answers.deleteFails) throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE');
        return { removed: true };
      },
      clear() {},
      dispose() {},
    },
  };
}

const hybrid = (answers, options = { branding: true }) => {
  const recorder = recordingTransport(answers);
  return { ...recorder, service: createStagingV1WorkspaceService({ transport: recorder.transport, ...options }) };
};

const LIST = {
  schemaVersion: 1,
  organizationId: ORG,
  seasonId: SEASON,
  canManage: true,
  entitled: true,
  limits: { maxActive: 20, maxPerExport: 3, nameMaxLength: 60 },
  sponsors: [
    { id: S1, name: 'Ferretería El Tornillo', logoPath: path(1), logoUrl: signed(path(1)), sortOrder: 0 },
    { id: S2, name: 'Panadería La Espiga', logoPath: path(2), logoUrl: null, sortOrder: 1 },
    { id: S3, name: 'Gimnasio Fénix', logoPath: null, logoUrl: null, sortOrder: 2 },
  ],
};

afterEach(() => {
  forgetAuthorizedBrandingUrls({ resetMode: true });
  mockLocal.calls = [];
  mockLocal.rpc = {};
  mockLocal.uploadError = null;
  mockLocal.removed = [];
});

describe('hybrid composition (gateway)', () => {
  test('the sponsor aliases exist only with the branding opt-in', () => {
    const off = hybrid({}, { connected: true, social: true, planRead: true });
    for (const name of SPONSOR_METHODS) expect(off.service[name]).toBeUndefined();
    const on = hybrid({});
    for (const name of SPONSOR_METHODS) expect(typeof on.service[name]).toBe('function');
  });

  test('load: the exact payload; a logo is kept only with the URL the gateway signed for it', async () => {
    const { service, calls } = hybrid({ get_tournament_organization_sponsors: LIST });
    const answer = await service.loadOrganizationSponsors({ organizationId: ORG, seasonId: SEASON });
    expect(calls).toEqual([['rpc', 'get_tournament_organization_sponsors', { p_organization_id: ORG, p_season_id: SEASON }]]);
    expect(answer.entitled).toBe(true);
    expect(answer.canManage).toBe(true);
    expect(answer.limits).toEqual({ maxActive: 20, maxPerExport: 3, nameMaxLength: 60 });
    expect(answer.sponsors).toEqual([
      { id: S1, name: 'Ferretería El Tornillo', logoPath: path(1), logoUrl: signed(path(1)), sortOrder: 0 },
      // Not signed (a collaborator's read): neither path nor URL survive, so it cannot be drawn or exported.
      { id: S2, name: 'Panadería La Espiga', logoPath: null, logoUrl: null, sortOrder: 1 },
      { id: S3, name: 'Gimnasio Fénix', logoPath: null, logoUrl: null, sortOrder: 2 },
    ]);
    expect(authorizedBrandingUrl(path(1))).toBe(signed(path(1)));
    await service.loadOrganizationSponsors({ organizationId: ORG });
    expect(calls.at(-1)).toEqual(['rpc', 'get_tournament_organization_sponsors', { p_organization_id: ORG, p_season_id: null }]);
  });

  test('save with a new logo: store it (organization owner), save, then remove the replaced logo', async () => {
    const { service, calls } = hybrid({
      upsert_tournament_organization_sponsor: { sponsor: { id: S1, name: 'Ferretería', logoPath: NEW_PATH, sortOrder: 0 }, previousLogoPath: path(1) },
    });
    const answer = await service.saveOrganizationSponsor({
      organizationId: ORG, sponsorId: S1, name: 'Ferretería', file: png(), logoPath: path(1), sortOrder: 0,
    });
    expect(calls).toEqual([
      ['POST', OWNER],
      ['rpc', 'upsert_tournament_organization_sponsor', {
        p_organization_id: ORG, p_sponsor_id: S1, p_name: 'Ferretería', p_logo_path: NEW_PATH, p_sort_order: 0,
      }],
      ['DELETE', path(1)],
    ]);
    expect(answer.sponsor.logoPath).toBe(NEW_PATH);
  });

  test('save without a file keeps the current logo (full replacement) and removes nothing', async () => {
    const { service, calls } = hybrid({
      upsert_tournament_organization_sponsor: { sponsor: { id: S1, name: 'Nuevo nombre', logoPath: path(1), sortOrder: 4 }, previousLogoPath: null },
    });
    await service.saveOrganizationSponsor({ organizationId: ORG, sponsorId: S1, name: 'Nuevo nombre', logoPath: path(1), sortOrder: 4 });
    expect(calls).toEqual([['rpc', 'upsert_tournament_organization_sponsor', {
      p_organization_id: ORG, p_sponsor_id: S1, p_name: 'Nuevo nombre', p_logo_path: path(1), p_sort_order: 4,
    }]]);
  });

  test('a refused save removes the object it just stored and reports the refusal in Spanish', async () => {
    const { service, calls } = hybrid({
      upsert_tournament_organization_sponsor: () => { throw rpcError('TORNEOS_SPONSORS_PREMIUM_REQUIRED'); },
    });
    await expect(service.saveOrganizationSponsor({ organizationId: ORG, name: 'Gimnasio Fénix', file: png() }))
      .rejects.toMatchObject({ code: 'TORNEOS_SPONSORS_PREMIUM_REQUIRED', message: ERROR_MESSAGES.TORNEOS_SPONSORS_PREMIUM_REQUIRED });
    expect(calls.map(([kind, name]) => (kind === 'rpc' ? name : kind))).toEqual(['POST', 'upsert_tournament_organization_sponsor', 'DELETE']);
    expect(calls.at(-1)).toEqual(['DELETE', NEW_PATH]);
  });

  test('an object stored outside the organization folder is refused before any save (never deleted by the client)', async () => {
    const foreign = `${ORG}/tournaments/${TOURNAMENT}/${GENERATED}.png`;
    const { service, calls } = hybrid({ storedPath: foreign });
    await expect(service.saveOrganizationSponsor({ organizationId: ORG, name: 'X', file: png() })).rejects.toThrow();
    expect(calls.some(([kind, name]) => kind === 'rpc' && name === 'upsert_tournament_organization_sponsor')).toBe(false);
    expect(calls.filter(([method]) => method === 'DELETE')).toEqual([]);
  });

  test('a file refused before any request never reaches the network', async () => {
    const { service, calls } = hybrid({});
    await expect(service.saveOrganizationSponsor({ organizationId: ORG, name: 'X', file: new Blob(['g'], { type: 'image/gif' }) }))
      .rejects.toThrow('Formato no admitido. Usá PNG, JPEG o WebP.');
    expect(calls).toEqual([]);
  });

  test('archive: the RPC, then the logo it returned is removed; a failed removal does not undo the archive', async () => {
    const { service, calls } = hybrid({
      archive_tournament_organization_sponsor: { sponsorId: S1, archived: true, alreadyArchived: false, previousLogoPath: path(1) },
    });
    await expect(service.archiveOrganizationSponsor({ organizationId: ORG, sponsorId: S1 })).resolves.toMatchObject({ archived: true });
    expect(calls).toEqual([
      ['rpc', 'archive_tournament_organization_sponsor', { p_organization_id: ORG, p_sponsor_id: S1 }],
      ['DELETE', path(1)],
    ]);
    const failing = hybrid({
      archive_tournament_organization_sponsor: { sponsorId: S1, archived: true, alreadyArchived: false, previousLogoPath: path(1) },
      deleteFails: true,
    });
    await expect(failing.service.archiveOrganizationSponsor({ organizationId: ORG, sponsorId: S1 })).resolves.toMatchObject({ archived: true });
    const already = hybrid({
      archive_tournament_organization_sponsor: { sponsorId: S1, archived: true, alreadyArchived: true, previousLogoPath: null },
    });
    await already.service.archiveOrganizationSponsor({ organizationId: ORG, sponsorId: S1 });
    expect(already.calls.filter(([method]) => method === 'DELETE')).toEqual([]);
  });

  test('authorize: the exact payload; the answer keeps only signed logos, in the requested order', async () => {
    const { service, calls } = hybrid({
      authorize_tournament_social_sponsors: {
        authorized: true, organizationId: ORG, seasonId: SEASON, tournamentId: TOURNAMENT, theme: 'street', capability: 'sponsors',
        sponsors: [
          { id: S2, name: 'Panadería La Espiga', logoPath: path(2), logoUrl: signed(path(2)) },
          { id: S1, name: 'Ferretería El Tornillo', logoPath: path(1), logoUrl: signed(path(1)) },
        ],
      },
    });
    const answer = await service.authorizeSocialSponsors({ seasonId: SEASON, tournamentId: TOURNAMENT, theme: 'street', sponsorIds: [S2, S1] });
    expect(calls).toEqual([['rpc', 'authorize_tournament_social_sponsors', {
      p_season_id: SEASON, p_tournament_id: TOURNAMENT, p_theme: 'street', p_sponsor_ids: [S2, S1],
    }]]);
    expect(answer.authorized).toBe(true);
    expect(answer.sponsors.map(({ id, logoUrl }) => [id, logoUrl])).toEqual([[S2, signed(path(2))], [S1, signed(path(1))]]);
  });

  test('invalid input fails before the network: ids, more than three, duplicates, theme', async () => {
    const { service, calls } = hybrid({});
    const cases = [
      () => service.loadOrganizationSponsors({ organizationId: 'org' }),
      () => service.loadOrganizationSponsors({ organizationId: ORG, seasonId: 'season' }),
      () => service.saveOrganizationSponsor({ organizationId: ORG, name: 'X', sponsorId: 'nope' }),
      () => service.saveOrganizationSponsor({ organizationId: ORG, name: 'X', logoPath: 'https://evil.example.test/x.png' }),
      () => service.saveOrganizationSponsor({ organizationId: ORG, name: 'X', sortOrder: 1000 }),
      () => service.archiveOrganizationSponsor({ organizationId: ORG, sponsorId: 'nope' }),
      () => service.authorizeSocialSponsors({ seasonId: SEASON, tournamentId: TOURNAMENT, theme: 'street', sponsorIds: [S1, S2, S3, S4] }),
      () => service.authorizeSocialSponsors({ seasonId: SEASON, tournamentId: TOURNAMENT, theme: 'street', sponsorIds: [S1, S1] }),
      () => service.authorizeSocialSponsors({ seasonId: SEASON, tournamentId: TOURNAMENT, theme: 'Street!', sponsorIds: [S1] }),
      () => service.authorizeSocialSponsors({ seasonId: SEASON, tournamentId: TOURNAMENT, theme: 'street', sponsorIds: null }),
    ];
    for (const run of cases) await expect(run()).rejects.toMatchObject({ code: 'TORNEOS_INVALID_REQUEST' });
    expect(calls).toEqual([]);
  });

  test('every database refusal reaches the page as Spanish copy, never as an internal code', async () => {
    const cases = [
      ['TORNEOS_AUTH_REQUIRED', {}, /sesión/],
      ['TORNEOS_SPONSORS_FORBIDDEN', {}, /permiso/],
      ['TORNEOS_SOCIAL_EXPORT_FORBIDDEN', {}, /rol/],
      ['TORNEOS_SPONSORS_PREMIUM_REQUIRED', {}, /Premium/],
      ['TORNEOS_SPONSOR_INVALID', { code: '22023', details: 'name' }, /entre 1 y 60/],
      ['TORNEOS_SPONSOR_INVALID', { code: '22023', details: 'logo_path' }, /logo/],
      ['TORNEOS_SOCIAL_THEME_UNKNOWN', { code: '22023' }, /estilo/],
      ['TORNEOS_SPONSORS_THEME_UNSUPPORTED', { code: '22023' }, /Base/],
      ['TORNEOS_SPONSORS_SELECTION_INVALID', { code: '22023' }, /hasta 3/],
      ['TORNEOS_SPONSOR_NOT_FOUND', { code: 'PT409' }, /ya no está disponible/],
      ['TORNEOS_SPONSORS_SELECTION_UNAVAILABLE', { code: 'PT409' }, /ya no está disponible/],
      ['TORNEOS_SPONSOR_LIMIT_REACHED', { code: 'PT422' }, /20/],
    ];
    for (const [message, options, copy] of cases) {
      const { service } = hybrid({
        authorize_tournament_social_sponsors: () => { throw rpcError(message, options); },
      });
      const caught = await service.authorizeSocialSponsors({ seasonId: SEASON, tournamentId: TOURNAMENT, theme: 'street', sponsorIds: [S1] })
        .then(() => null, (error) => error);
      expect(caught?.code).toBe(message);
      expect(caught.message).toMatch(copy);
      expect(caught.message).not.toMatch(/TORNEOS_|sponsor_id|logo_path/);
    }
  });
});

describe('LOCAL composition (single project)', () => {
  test('load: the same RPC and payload; logos resolve through the branding resolver', async () => {
    mockLocal.rpc.get_tournament_organization_sponsors = { data: { ...LIST, sponsors: LIST.sponsors.map(({ logoUrl, ...rest }) => rest) }, error: null };
    const answer = await tournamentWorkspaceService.loadOrganizationSponsors({ organizationId: ORG, seasonId: SEASON });
    expect(mockLocal.calls).toEqual([['rpc', 'get_tournament_organization_sponsors', { p_organization_id: ORG, p_season_id: SEASON }]]);
    expect(answer.sponsors[0]).toEqual({
      id: S1, name: 'Ferretería El Tornillo', logoPath: path(1),
      logoUrl: `https://local.example.test/public/tournament-branding/${path(1)}`, sortOrder: 0,
    });
    expect(answer.sponsors[2].logoUrl).toBeNull();
  });

  test('save: upload under the organization folder, save, remove the replaced logo', async () => {
    mockLocal.rpc.upsert_tournament_organization_sponsor = (params) => ({
      data: { sponsor: { id: S1, name: params.p_name, logoPath: params.p_logo_path, sortOrder: 0 }, previousLogoPath: path(1) },
      error: null,
    });
    const answer = await tournamentWorkspaceService.saveOrganizationSponsor({
      organizationId: ORG, sponsorId: S1, name: 'Ferretería', file: png(), logoPath: path(1),
    });
    const [upload, save, remove] = mockLocal.calls;
    expect(upload[0]).toBe('upload');
    expect(upload[1]).toBe('tournament-branding');
    expect(upload[2]).toMatch(new RegExp(`^${OWNER}/[0-9a-f-]{36}\\.png$`));
    expect(save).toEqual(['rpc', 'upsert_tournament_organization_sponsor', {
      p_organization_id: ORG, p_sponsor_id: S1, p_name: 'Ferretería', p_logo_path: upload[2], p_sort_order: null,
    }]);
    expect(remove).toEqual(['remove', 'tournament-branding', path(1)]);
    expect(answer.sponsor.logoPath).toBe(upload[2]);
  });

  test('a refused save removes the uploaded object and maps the refusal', async () => {
    mockLocal.rpc.upsert_tournament_organization_sponsor = {
      data: null, error: { message: 'TORNEOS_SPONSOR_LIMIT_REACHED', code: 'PT422', details: null },
    };
    await expect(tournamentWorkspaceService.saveOrganizationSponsor({ organizationId: ORG, name: 'Kiosco', file: png() }))
      .rejects.toMatchObject({ code: 'TORNEOS_SPONSOR_LIMIT_REACHED', message: ERROR_MESSAGES.TORNEOS_SPONSOR_LIMIT_REACHED });
    const uploaded = mockLocal.calls.find(([kind]) => kind === 'upload')[2];
    expect(mockLocal.calls.at(-1)).toEqual(['remove', 'tournament-branding', uploaded]);
  });

  test('a failed upload never saves', async () => {
    mockLocal.uploadError = { message: 'storage down' };
    await expect(tournamentWorkspaceService.saveOrganizationSponsor({ organizationId: ORG, name: 'Kiosco', file: png() })).rejects.toThrow();
    expect(mockLocal.calls.some(([kind]) => kind === 'rpc')).toBe(false);
  });

  test('archive removes the logo the RPC returned; authorize keeps the requested order', async () => {
    mockLocal.rpc.archive_tournament_organization_sponsor = { data: { sponsorId: S2, archived: true, alreadyArchived: false, previousLogoPath: path(2) }, error: null };
    await tournamentWorkspaceService.archiveOrganizationSponsor({ organizationId: ORG, sponsorId: S2 });
    expect(mockLocal.calls).toEqual([
      ['rpc', 'archive_tournament_organization_sponsor', { p_organization_id: ORG, p_sponsor_id: S2 }],
      ['remove', 'tournament-branding', path(2)],
    ]);
    mockLocal.calls = [];
    mockLocal.rpc.authorize_tournament_social_sponsors = {
      data: { authorized: true, seasonId: SEASON, tournamentId: TOURNAMENT, theme: 'heritage', sponsors: [{ id: S2, name: 'B', logoPath: path(2) }, { id: S1, name: 'A', logoPath: path(1) }] },
      error: null,
    };
    const answer = await tournamentWorkspaceService.authorizeSocialSponsors({ seasonId: SEASON, tournamentId: TOURNAMENT, theme: 'heritage', sponsorIds: [S2, S1] });
    expect(mockLocal.calls).toEqual([['rpc', 'authorize_tournament_social_sponsors', {
      p_season_id: SEASON, p_tournament_id: TOURNAMENT, p_theme: 'heritage', p_sponsor_ids: [S2, S1],
    }]]);
    expect(answer.sponsors.map((entry) => entry.id)).toEqual([S2, S1]);
    expect(answer.sponsors.every((entry) => entry.logoUrl.startsWith('https://local.example.test/'))).toBe(true);
  });

  test('a refusal with a field names what to fix', async () => {
    mockLocal.rpc.upsert_tournament_organization_sponsor = { data: null, error: { message: 'TORNEOS_SPONSOR_INVALID', code: '22023', details: 'name' } };
    await expect(tournamentWorkspaceService.saveOrganizationSponsor({ organizationId: ORG, name: '' }))
      .rejects.toMatchObject({ code: 'TORNEOS_SPONSOR_INVALID', message: 'El nombre del sponsor tiene que tener entre 1 y 60 caracteres.' });
  });
});
