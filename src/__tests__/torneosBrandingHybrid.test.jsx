// BRANDING-V1 in the hybrid composition: only URLs the Torneos gateway signed become images; a stored path never turns
// into a storage URL of another project; the upload follows the LOCAL service's exact sequence through the gateway.
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  authorizedBrandingUrl,
  forgetAuthorizedBrandingUrls,
  isAuthorizedBrandingUrl,
  rememberAuthorizedBrandingUrl,
  AUTHORIZED_URL_TTL_MS,
} from '../features/torneos/domain/brandingUrlRegistry';
import { withSignedBranding } from '../features/torneos/stagingV1/brandingUrls';
import { resolveBrandingAssetUrl } from '../features/torneos/domain/brandingAssets';
import BrandingImage from '../features/torneos/components/BrandingImage';
import { createStagingV1WorkspaceService, BRANDING_METHODS } from '../features/torneos/stagingV1/stagingV1WorkspaceService';

jest.mock('../features/torneos/domain/brandingFiles', () => {
  const actual = jest.requireActual('../features/torneos/domain/brandingFiles');
  return {
    ...actual,
    // A plain function: CRA's resetMocks would wipe a jest.fn implementation before each test.
    prepareBrandingFile: async (file) => ({ mime: 'image/png', width: 64, height: 64, source: file }),
  };
});

const ORG = '11111111-1111-4111-8111-111111111111';
const TNT = '22222222-2222-4222-8222-222222222222';
const PATH = `${ORG}/tournaments/${TNT}/33333333-3333-4333-8333-333333333333.png`;
const OTHER = `${ORG}/tournaments/${TNT}/44444444-4444-4444-8444-444444444444.png`;
const signed = (path, base = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1') => `${base}/object/sign/tournament-branding/${path}?token=t`;
const fakeStorageClient = { storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: `https://core.example.test/public/${p}` } }) }) } };

afterEach(() => forgetAuthorizedBrandingUrls({ resetMode: true }));

describe('authorized branding URLs', () => {
  test('only a signed URL of exactly that object of the branding bucket, over https (http only on loopback)', () => {
    expect(isAuthorizedBrandingUrl(signed(PATH), PATH)).toBe(true);
    expect(isAuthorizedBrandingUrl(signed(PATH, 'http://127.0.0.1:58425'), PATH)).toBe(true);
    for (const url of [
      signed(OTHER), // another object
      signed(PATH).replace('tournament-branding', 'tournament-media'), // another bucket
      signed(PATH).replace('?token=t', ''), // no storage token
      signed(PATH, 'http://evil.example.test'), // plain http off loopback
      `javascript:alert(1)//${PATH}`,
      'not a url',
      null,
    ]) expect(isAuthorizedBrandingUrl(url, PATH)).toBe(false);
    expect(isAuthorizedBrandingUrl(signed('../x.png'), '../x.png')).toBe(false);
  });

  test('a remembered URL expires well before the gateway\'s one-hour signature', () => {
    expect(rememberAuthorizedBrandingUrl(PATH, signed(PATH), 1_000)).toBe(true);
    expect(authorizedBrandingUrl(PATH, 1_000 + AUTHORIZED_URL_TTL_MS - 1)).toBe(signed(PATH));
    expect(authorizedBrandingUrl(PATH, 1_000 + AUTHORIZED_URL_TTL_MS)).toBeNull();
    expect(AUTHORIZED_URL_TTL_MS).toBeLessThan(60 * 60 * 1000);
  });

  test('withSignedBranding keeps a path only next to its signed URL, drops the URL keys and anything unsigned', () => {
    const out = withSignedBranding({
      items: [
        { logoPath: PATH, logoUrl: signed(PATH), organizationLogoPath: OTHER, organizationLogoUrl: null },
        { logoPath: OTHER, logoUrl: signed(PATH) }, // URL of another object: refused
      ],
      team: { shieldPath: 'legacy/crest.png', shieldUrl: 'https://core.example.test/legacy/crest.png' },
    });
    expect(out).toEqual({
      items: [{ logoPath: PATH, organizationLogoPath: null }, { logoPath: null }],
      team: { shieldPath: null },
    });
    expect(authorizedBrandingUrl(PATH)).toBe(signed(PATH));
    expect(authorizedBrandingUrl(OTHER)).toBeNull();
  });

  test('once the composition requires authorized URLs, an unsigned path never becomes a storage URL', () => {
    expect(resolveBrandingAssetUrl({ kind: 'tournament', path: PATH }, fakeStorageClient)).toBe(`https://core.example.test/public/${PATH}`);
    withSignedBranding({ logoPath: OTHER, logoUrl: null });
    expect(resolveBrandingAssetUrl({ kind: 'tournament', path: PATH }, fakeStorageClient)).toBeNull();
    rememberAuthorizedBrandingUrl(PATH, signed(PATH));
    expect(resolveBrandingAssetUrl({ kind: 'tournament', path: PATH }, fakeStorageClient)).toBe(signed(PATH));
  });

  test('BrandingImage renders the signed URL; without one, the initials', () => {
    withSignedBranding({ logoPath: PATH, logoUrl: signed(PATH) });
    const { container, rerender } = render(<BrandingImage kind="tournament" path={PATH} name="Copa Lab" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(signed(PATH));
    rerender(<BrandingImage kind="tournament" path={OTHER} name="Copa Lab" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('CL')).toBeInTheDocument();
  });
});

function recordingTransport(answers = {}) {
  const calls = [];
  return {
    calls,
    transport: {
      rpc: async (name, params) => { calls.push(['rpc', name, params]); return typeof answers[name] === 'function' ? answers[name](params) : (answers[name] ?? null); },
      brandingObject: async (method, path) => { calls.push([method, path]); if (answers.fail === method) throw Object.assign(new Error('boom'), { code: 'TORNEOS_UNAVAILABLE' }); return method === 'POST' ? { path } : { removed: true }; },
      clear() {},
      dispose() {},
    },
  };
}

describe('hybrid adapter branding', () => {
  test('without branding: true there is no branding alias and no object route', () => {
    const { transport } = recordingTransport();
    const service = createStagingV1WorkspaceService({ transport, connected: true });
    for (const name of BRANDING_METHODS) expect(service[name]).toBeUndefined();
  });

  test('upload: store the object, switch the reference, remove the previous object — the LOCAL sequence', async () => {
    const { transport, calls } = recordingTransport({ set_tournament_branding_reference: { previousPath: OTHER } });
    const service = createStagingV1WorkspaceService({ transport, branding: true });
    const file = new Blob(['png'], { type: 'image/png' });
    const result = await service.uploadBrandingAsset({ organizationId: ORG, kind: 'tournament', entityId: TNT, file });
    const [stored, reference, removed] = calls;
    expect(stored[0]).toBe('POST');
    expect(stored[1]).toMatch(new RegExp(`^${ORG}/tournaments/${TNT}/[0-9a-f-]{36}\\.png$`));
    expect(reference).toEqual(['rpc', 'set_tournament_branding_reference',
      { p_organization_id: ORG, p_entity_kind: 'tournament', p_entity_id: TNT, p_path: stored[1] }]);
    expect(removed).toEqual(['DELETE', OTHER]);
    expect(result.path).toBe(stored[1]);
  });

  test('a refused reference removes the object it just stored and reports the refusal', async () => {
    const { transport, calls } = recordingTransport({
      set_tournament_branding_reference: () => { throw Object.assign(new Error('TORNEOS_BRANDING_FORBIDDEN'), { code: 'TORNEOS_RPC_ERROR' }); },
    });
    const service = createStagingV1WorkspaceService({ transport, branding: true });
    await expect(service.uploadBrandingAsset({ organizationId: ORG, kind: 'tournament', entityId: TNT, file: new Blob(['png'], { type: 'image/png' }) }))
      .rejects.toThrow();
    const stored = calls.find(([method]) => method === 'POST')[1];
    expect(calls.at(-1)).toEqual(['DELETE', stored]);
  });

  test('responses the gateway signs keep only signed paths; others are untouched', async () => {
    const { transport } = recordingTransport({
      get_team_registration_context: { entry: { shieldPath: PATH, shieldUrl: signed(PATH) }, other: { shieldPath: OTHER } },
      get_tournament_workspace_context: { organizations: [{ logoPath: OTHER }] },
    });
    const service = createStagingV1WorkspaceService({ transport, branding: true });
    expect(await service.loadTeamRegistration(ORG, TNT)).toEqual({ entry: { shieldPath: PATH }, other: { shieldPath: null } });
    expect(authorizedBrandingUrl(PATH)).toBe(signed(PATH));
    expect(await service.loadContext()).toEqual({ organizations: [{ logoPath: OTHER }] });
  });
});
