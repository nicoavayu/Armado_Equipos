// MEDIA-V1 · the gallery in the hybrid composition: what the organizer and the participant actually get.
//   organizer: the season quota in plain words, a retry that never makes a second photo, a double tap that uploads
//   once, iPhone HEIC explained before any upload, and retiring (never erasing) photos;
//   participant: swipe between photos, the page behind does not scroll, an expired link is renewed once.
import React from 'react';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MediaAdminPage from '../features/torneos/components/MediaAdminPage';
import ParticipantMediaGallery from '../features/torneos/components/ParticipantMediaGallery';

let mockContextService;
let mockCompetition = null;

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => ({ service: mockContextService }),
}));
jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useOptionalTorneosCompetition: () => mockCompetition,
}));

const MVP_STORAGE = {
  mode: 'MVP_SIMPLE', processingTier: 'mvp_simple', bucket: 'tournament-media', private: true,
  uploadReady: true, storageReady: true, blockers: [], maxSelectedFileBytes: 26214400, maxFileBytes: 4194304,
  maxPixels: 2560000, maxEdge: 1600, maxBatchFiles: 10, maxConcurrentUploads: 2, signedUrlTtlSeconds: 300,
  allowHeicTranscode: false, pixelTranscode: false, antivirusScanning: false,
};
const OWNER_CAPABILITIES = ['media.read', 'media.create_gallery', 'media.update_gallery', 'media.upload', 'media.review',
  'media.publish', 'media.archive', 'media.revoke', 'media.set_cover', 'media.handle_reports'];

const asset = (id, overrides = {}) => ({
  id, safeName: `foto-${id}.jpg`, width: 1600, height: 1067, byteSize: 420000, status: 'published', sortOrder: 0,
  processingTier: 'mvp_simple', ...overrides,
});

function adminPayload(galleryOverrides = {}) {
  return {
    storage: MVP_STORAGE,
    capabilities: OWNER_CAPABILITIES,
    tournaments: [{ id: 'tournament-a', name: 'Copa Lab', categories: [], matches: [] }],
    galleries: [{
      id: 'gallery-a', tournamentId: 'tournament-a', title: 'Fecha 1', description: '', status: 'draft',
      visibility: 'tournament_participants', coverAssetId: null, assets: [], ...galleryOverrides,
    }],
    reports: [],
    entitlements: null,
  };
}

function hybridService(payload = adminPayload()) {
  // The hybrid adapter's surface: no deleteMediaAsset (retiring is moderation), plus the season quota.
  return {
    loadMediaAdminContext: jest.fn().mockResolvedValue(payload),
    loadSeasonMediaUsage: jest.fn().mockResolvedValue({
      schemaVersion: 1, seasonId: 'season-a', plan: 'FREE', assetCount: 12, pendingCount: 0, usage: 12, limit: 25, remaining: 13,
    }),
    uploadMediaPhoto: jest.fn(),
    signMediaReadUrls: jest.fn().mockResolvedValue({}),
    transitionMediaAsset: jest.fn().mockResolvedValue({ status: 'hidden' }),
    changeMediaGalleryState: jest.fn(),
    publishMediaGallery: jest.fn(),
    setMediaCover: jest.fn(),
    reorderMediaItem: jest.fn(),
    handleMediaReport: jest.fn(),
    createMediaGallery: jest.fn(),
    createIdempotencyKey: jest.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValue('22222222-2222-4222-8222-222222222222'),
  };
}

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/torneos/organizacion/org-a/multimedia']}>
      <Routes>
        <Route path="/torneos/organizacion/:organizationId/multimedia" element={<MediaAdminPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pick = (name = 'cancha.jpg', type = 'image/jpeg') => {
  fireEvent.change(screen.getByLabelText('Seleccionar fotos'), { target: { files: [new File(['foto'], name, { type })] } });
};

describe('MEDIA-V1 · organizer', () => {
  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = jest.fn();
    mockCompetition = { activeSeason: { id: 'season-a' }, tournaments: [{ id: 'tournament-a', seasonId: 'season-a' }] };
    mockContextService = hybridService();
  });

  test('the season quota is read from the server and said in plain words', async () => {
    renderAdmin();
    expect(await screen.findByText('12 / 25')).toBeInTheDocument();
    expect(screen.getByText(/Quedan 13 de 25/)).toBeInTheDocument();
    expect(mockContextService.loadSeasonMediaUsage).toHaveBeenCalledWith({ organizationId: 'org-a', seasonId: 'season-a' });
    expect(screen.queryByText(/bucket|storage|signer|MVP|cuota multimedia/i)).not.toBeInTheDocument();
  });

  test('a failed upload is retried with the SAME key (the server answers with the photo, never a second one)', async () => {
    mockContextService.uploadMediaPhoto
      .mockRejectedValueOnce(Object.assign(new Error('Torneos no está disponible en este momento.'), { code: 'TORNEOS_UNAVAILABLE', retryable: true }))
      .mockResolvedValueOnce({ assetId: 'asset-a', status: 'pending_review', replayed: true });
    renderAdmin();
    await screen.findByText('12 / 25');
    pick();
    await userEvent.click(await screen.findByRole('button', { name: 'Subir' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(mockContextService.uploadMediaPhoto).toHaveBeenCalledTimes(2));
    const [first, second] = mockContextService.uploadMediaPhoto.mock.calls.map(([options]) => options.idempotencyKey);
    expect(second).toBe(first);
    expect(await screen.findByText('Pendiente de aprobación')).toBeInTheDocument();
  });

  test('a double tap uploads once', async () => {
    let finish;
    mockContextService.uploadMediaPhoto.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderAdmin();
    await screen.findByText('12 / 25');
    pick();
    const upload = await screen.findByRole('button', { name: 'Subir' });
    fireEvent.click(upload);
    fireEvent.click(upload);
    await waitFor(() => expect(mockContextService.uploadMediaPhoto).toHaveBeenCalledTimes(1));
    await act(async () => finish({ assetId: 'asset-a', status: 'pending_review' }));
    expect(mockContextService.uploadMediaPhoto).toHaveBeenCalledTimes(1);
  });

  test('an iPhone HEIC photo is explained before any upload; the quota refusal refreshes the counter', async () => {
    renderAdmin();
    await screen.findByText('12 / 25');
    pick('IMG_0042.HEIC', '');
    expect(await screen.findByText(/HEIC del iPhone no se pueden subir así/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subir' })).not.toBeInTheDocument();
    expect(mockContextService.uploadMediaPhoto).not.toHaveBeenCalled();

    mockContextService.uploadMediaPhoto.mockRejectedValueOnce(Object.assign(
      new Error('Llegaste al límite de fotos de esta temporada (25 de 25). Retirá fotos que no uses o pasá la temporada a Premium.'),
      { code: 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED', retryable: false },
    ));
    pick();
    await userEvent.click(await screen.findByRole('button', { name: 'Subir' }));
    expect(await screen.findByText(/25 de 25/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    await waitFor(() => expect(mockContextService.loadSeasonMediaUsage.mock.calls.length).toBeGreaterThan(1));
  });

  test('a season-scoped admin refused the organization-wide view opens the active tournament instead of an error', async () => {
    mockCompetition = { ...mockCompetition, activeTournament: { id: 'tournament-a', seasonId: 'season-a' } };
    const forbidden = Object.assign(new Error('La galería no está disponible o no tenés permiso para esa acción.'), { code: 'TORNEOS_MEDIA_FORBIDDEN' });
    mockContextService.loadMediaAdminContext = jest.fn(({ tournamentId }) => (tournamentId
      ? Promise.resolve(adminPayload()) : Promise.reject(forbidden)));
    renderAdmin();
    expect(await screen.findByRole('heading', { name: 'Fecha 1' })).toBeInTheDocument();
    expect(mockContextService.loadMediaAdminContext).toHaveBeenLastCalledWith(expect.objectContaining({ tournamentId: 'tournament-a' }));
    expect(screen.queryByText('No pudimos abrir Multimedia')).not.toBeInTheDocument();
  });

  test('published photos can be retired and restored, never erased, in the hybrid composition', async () => {
    mockContextService = hybridService(adminPayload({
      status: 'published', coverAssetId: 'asset-a', assets: [asset('asset-a'), asset('asset-b', { sortOrder: 1, status: 'hidden' })],
    }));
    renderAdmin();
    const retire = await screen.findByRole('button', { name: /Retirar/ });
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();
    expect(screen.getByText('Retirada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restaurar/ })).toBeInTheDocument();
    await userEvent.click(retire);
    expect(mockContextService.transitionMediaAsset).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-a', action: 'hide' }));
  });
});

describe('MEDIA-V1 · participant viewer', () => {
  const payload = {
    delivery: { status: 'signed_urls', signedUrlTtlSeconds: 300, originalsRestricted: true },
    items: [{
      id: 'gallery-a', title: 'Fecha 1', description: '', coverAssetId: 'asset-a',
      assets: [asset('asset-a'), asset('asset-b', { sortOrder: 1 }), asset('asset-c', { sortOrder: 2 })],
    }],
  };
  const signed = (ids) => Object.fromEntries(ids.flatMap((id) => [[`${id}:grid`, `https://s.test/${id}?t=1`], [`${id}:detail`, `https://s.test/${id}?t=1`]]));

  test('swipes between photos, locks the page scroll and gives it back', async () => {
    const service = {
      loadPublishedMedia: jest.fn().mockResolvedValue(payload),
      signMediaReadUrls: jest.fn().mockResolvedValue(signed(['asset-a', 'asset-b', 'asset-c'])),
      reportMediaAsset: jest.fn(),
      createIdempotencyKey: () => 'k',
    };
    render(<ParticipantMediaGallery tournamentId="tournament-a" service={service} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir portada de Fecha 1' }));
    expect(screen.getByRole('dialog', { name: 'Foto 1 de 3' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    const stage = screen.getByRole('dialog').querySelector('[data-loading]');
    fireEvent.touchStart(stage, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 120, clientY: 210 }] });
    expect(screen.getByRole('dialog', { name: 'Foto 2 de 3' })).toBeInTheDocument();
    fireEvent.touchStart(stage, { touches: [{ clientX: 120, clientY: 200 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 300, clientY: 205 }] });
    expect(screen.getByRole('dialog', { name: 'Foto 1 de 3' })).toBeInTheDocument();
    // A vertical drag is a scroll, not a swipe.
    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 140, clientY: 400 }] });
    expect(screen.getByRole('dialog', { name: 'Foto 1 de 3' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  test('an expired link is renewed once for that photo; a refused one stays a protected placeholder', async () => {
    const version = { 'asset-b': 1 };
    const service = {
      loadPublishedMedia: jest.fn().mockResolvedValue(payload),
      // Each renewal of asset-b gets a new link; the others keep theirs.
      signMediaReadUrls: jest.fn(async (items) => Object.fromEntries(items.map(({ assetId, kind }) => (
        [`${assetId}:${kind}`, `https://s.test/${assetId}?t=${version[assetId] || 1}`])))),
      reportMediaAsset: jest.fn(),
      createIdempotencyKey: () => 'k',
    };
    const view = render(<ParticipantMediaGallery tournamentId="tournament-a" service={service} />);
    await waitFor(() => expect(view.container.querySelector('img[src="https://s.test/asset-b?t=1"]')).not.toBeNull());
    const before = service.signMediaReadUrls.mock.calls.length;
    version['asset-b'] = 2;
    fireEvent.error(view.container.querySelector('img[src="https://s.test/asset-b?t=1"]'));
    await waitFor(() => expect(view.container.querySelector('img[src="https://s.test/asset-b?t=2"]')).not.toBeNull());
    const renewals = service.signMediaReadUrls.mock.calls.slice(before).map(([items]) => items);
    expect(renewals[0]).toEqual([{ assetId: 'asset-b', kind: 'grid' }, { assetId: 'asset-b', kind: 'detail' }]);
    const after = service.signMediaReadUrls.mock.calls.length;
    version['asset-b'] = 3;
    fireEvent.error(view.container.querySelector('img[src="https://s.test/asset-b?t=2"]'));
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(service.signMediaReadUrls.mock.calls.length).toBe(after);
    expect(view.container.querySelector('img[src="https://s.test/asset-b?t=2"]')).not.toBeNull();
  });

});
