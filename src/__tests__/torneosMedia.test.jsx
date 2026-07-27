import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
} from 'react-router-dom';
import MediaAdminPage from '../features/torneos/components/MediaAdminPage';
import ParticipantMediaGallery from '../features/torneos/components/ParticipantMediaGallery';

let mockContextService;

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => ({ service: mockContextService }),
}));

const asset = (id, overrides = {}) => ({
  id,
  safeName: `foto-${id}.jpg`,
  width: 1600,
  height: 900,
  byteSize: 2048,
  status: 'pending_review',
  sortOrder: 0,
  thumbnailUrl: `https://signed.local/${id}-thumb`,
  gridUrl: `https://signed.local/${id}-grid`,
  detailUrl: `https://signed.local/${id}-detail`,
  caption: `Foto ${id}`,
  ...overrides,
});

function adminPayload(overrides = {}) {
  return {
    storage: {
      bucket: 'tournament-media',
      private: true,
      certified: false,
      uploadReady: false,
      requiresStagingGate: true,
      maxFileBytes: 12582912,
      maxPixels: 36000000,
      maxBatchFiles: 40,
    },
    capabilities: [
      'media.read',
      'media.create_gallery',
      'media.update_gallery',
      'media.upload',
      'media.review',
      'media.publish',
      'media.archive',
      'media.set_cover',
      'media.handle_reports',
    ],
    tournaments: [{
      id: 'tournament-a',
      name: 'Copa Horizonte',
      categories: [{ id: 'category-a', name: 'Libre' }],
      matches: [{
        id: 'match-a',
        categoryId: 'category-a',
        roundId: 'round-a',
        matchNumber: 1,
      }],
    }],
    galleries: [],
    reports: [],
    ...overrides,
  };
}

function createAdminService(payload = adminPayload()) {
  return {
    loadMediaAdminContext: jest.fn().mockResolvedValue(payload),
    createMediaGallery: jest.fn().mockResolvedValue('gallery-a'),
    requestMediaUploadSession: jest.fn().mockResolvedValue({
      sessionId: 'session-a',
      safeName: 'foto-safe.jpg',
      uploadReady: false,
      requiresStagingStorageSigner: true,
    }),
    transitionMediaAsset: jest.fn().mockResolvedValue({ status: 'approved' }),
    setMediaCover: jest.fn().mockResolvedValue({ coverAssetId: 'asset-a' }),
    reorderMediaItem: jest.fn().mockResolvedValue({ sortOrder: 1 }),
    publishMediaGallery: jest.fn().mockResolvedValue({ status: 'published' }),
    changeMediaGalleryState: jest.fn().mockResolvedValue({ status: 'archived' }),
    handleMediaReport: jest.fn().mockResolvedValue({ status: 'resolved' }),
    createIdempotencyKey: jest.fn().mockReturnValue('key-a'),
  };
}

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/torneos/organizacion/org-a/multimedia']}>
      <Routes>
        <Route
          path="/torneos/organizacion/:organizationId/multimedia"
          element={<MediaAdminPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('organizer tournament media center', () => {
  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = jest.fn();
    mockContextService = createAdminService();
  });

  test('renders premium empty state and an honest environment gate', async () => {
    renderAdmin();
    expect(await screen.findByRole('heading', { name: 'Centro Multimedia' }))
      .toBeInTheDocument();
    expect(screen.getByText('El archivo visual empieza acá')).toBeInTheDocument();
    expect(screen.getByText(/La carga de fotos todavía no está habilitada/)).toBeInTheDocument();
    expect(screen.queryByText(/Storage|bucket|staging/i)).not.toBeInTheDocument();
  });

  test('creates a match gallery with relation-scoped visibility', async () => {
    renderAdmin();
    await userEvent.click(await screen.findByRole('button', { name: 'Crear galería' }));
    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'category-a');
    await userEvent.selectOptions(screen.getByLabelText('Partido'), 'match-a');
    await userEvent.type(screen.getByLabelText('Título'), 'La gran final');
    await userEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
    expect(mockContextService.createMediaGallery).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        tournamentId: 'tournament-a',
        categoryId: 'category-a',
        roundId: 'round-a',
        matchId: 'match-a',
        visibility: 'match_participants',
      }),
    );
  });

  test('keeps a valid file when another file has an invalid MIME', async () => {
    mockContextService = createAdminService(adminPayload({
      galleries: [{
        id: 'gallery-a',
        tournamentId: 'tournament-a',
        title: 'Fecha 1',
        description: '',
        status: 'draft',
        visibility: 'tournament_participants',
        coverAssetId: null,
        assets: [],
      }],
    }));
    renderAdmin();
    const input = await screen.findByLabelText('Seleccionar fotos');
    const valid = new File(['foto'], 'partido.jpg', { type: 'image/jpeg' });
    const invalid = new File(['svg'], 'vector.svg', { type: 'image/svg+xml' });
    fireEvent.change(input, { target: { files: [valid, invalid] } });
    expect(await screen.findByText('Foto 01')).toBeInTheDocument();
    expect(screen.getByText('Foto 02')).toBeInTheDocument();
    expect(screen.getByText(/Formato no admitido/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preparar' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/La carga de fotos todavía no está habilitada/).length)
      .toBeGreaterThan(1);
  });

  test('keeps upload fail-closed without issuing a session or faking progress', async () => {
    mockContextService = createAdminService(adminPayload({
      galleries: [{
        id: 'gallery-a',
        tournamentId: 'tournament-a',
        title: 'Fecha 1',
        description: '',
        status: 'draft',
        visibility: 'tournament_participants',
        coverAssetId: null,
        assets: [],
      }],
    }));
    renderAdmin();
    expect((await screen.findAllByText('Fecha 1')).length).toBeGreaterThan(0);
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, {
      target: { files: [new File(['foto'], 'partido.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => {
      expect(
        screen.getAllByText(/La carga de fotos todavía no está habilitada/).length,
      ).toBeGreaterThan(1);
    });
    expect(screen.queryByRole('button', { name: 'Preparar' })).not.toBeInTheDocument();
    expect(mockContextService.requestMediaUploadSession).not.toHaveBeenCalled();
  });

  test('approves, selects cover and protects publication from rapid double click', async () => {
    let resolvePublication;
    mockContextService = createAdminService(adminPayload({
      galleries: [{
        id: 'gallery-a',
        tournamentId: 'tournament-a',
        title: 'Fecha 1',
        description: '',
        status: 'under_review',
        visibility: 'tournament_participants',
        coverAssetId: null,
        assets: [
          asset('asset-a'),
          asset('asset-b', { status: 'approved', sortOrder: 1 }),
        ],
      }],
    }));
    mockContextService.publishMediaGallery.mockReturnValue(
      new Promise((resolve) => { resolvePublication = resolve; }),
    );
    renderAdmin();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprobar' }));
    expect(mockContextService.transitionMediaAsset).toHaveBeenCalledWith({
      assetId: 'asset-a',
      action: 'approve',
      reason: null,
    });
    await waitFor(() => {
      expect(mockContextService.loadMediaAdminContext.mock.calls.length).toBeGreaterThan(1);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Publicar galería' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publicar galería' }));
    expect(mockContextService.publishMediaGallery).toHaveBeenCalledTimes(1);
    resolvePublication({ status: 'published' });
  });

  test('renders collaborator as read-only', async () => {
    mockContextService = createAdminService(adminPayload({
      capabilities: ['media.read'],
    }));
    renderAdmin();
    expect(await screen.findByText('Modo lectura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear galería' })).not.toBeInTheDocument();
  });
});

function participantPayload() {
  return {
    delivery: {
      status: 'ready',
      signedUrlTtlSeconds: 300,
      originalsRestricted: true,
    },
    items: [{
      id: 'gallery-a',
      title: 'La noche de la final',
      description: 'Una fecha para recordar.',
      coverAssetId: 'asset-a',
      assets: [
        asset('asset-a', { status: 'published' }),
        asset('asset-b', { status: 'published', sortOrder: 1 }),
      ],
    }],
  };
}

function createParticipantService(overrides = {}) {
  return {
    loadPublishedMedia: jest.fn().mockResolvedValue(participantPayload()),
    reportMediaAsset: jest.fn().mockResolvedValue({ status: 'open' }),
    createIdempotencyKey: jest.fn().mockReturnValue('key-a'),
    ...overrides,
  };
}

describe('participant tournament media gallery', () => {
  test('renders thumbnails and opens an accessible lightbox', async () => {
    const service = createParticipantService();
    render(
      <ParticipantMediaGallery
        tournamentId="tournament-a"
        categoryId="category-a"
        service={service}
      />,
    );
    await userEvent.click(await screen.findByRole('button', {
      name: 'Abrir portada de La noche de la final',
    }));
    expect(screen.getByRole('dialog', { name: 'Foto 1 de 2' })).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'Foto 2 de 2' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('reports a photo privately and can request temporary hiding', async () => {
    const service = createParticipantService();
    render(
      <ParticipantMediaGallery tournamentId="tournament-a" service={service} />,
    );
    await userEvent.click(await screen.findByRole('button', {
      name: 'Abrir portada de La noche de la final',
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Reportar foto' }));
    expect(screen.getByText('Reporte privado')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Motivo'), 'privacy');
    await userEvent.type(screen.getByLabelText('Detalle'), 'Necesito una revisión de privacidad.');
    await userEvent.click(screen.getByRole('checkbox', {
      name: 'Solicitar que se oculte mientras se revisa',
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));
    expect(service.reportMediaAsset).toHaveBeenCalledWith({
      assetId: 'asset-a',
      reason: 'privacy',
      detail: 'Necesito una revisión de privacidad.',
      requestHide: true,
      idempotencyKey: 'key-a',
    });
    expect(await screen.findByText('Reporte enviado')).toBeInTheDocument();
  });

  test('does not render a hidden empty integration surface', async () => {
    const service = createParticipantService({
      loadPublishedMedia: jest.fn().mockResolvedValue({ items: [] }),
    });
    const view = render(
      <ParticipantMediaGallery
        tournamentId="tournament-a"
        service={service}
        hideWhenEmpty
      />,
    );
    await waitFor(() => expect(service.loadPublishedMedia).toHaveBeenCalled());
    expect(view.container).toBeEmptyDOMElement();
  });

  test('discards a late gallery response after tournament changes', async () => {
    let resolveOld;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    const service = createParticipantService({
      loadPublishedMedia: jest.fn(({ tournamentId }) => (
        tournamentId === 'old' ? old : Promise.resolve({
          ...participantPayload(),
          items: [{
            ...participantPayload().items[0],
            id: 'gallery-new',
            title: 'Galería nueva',
          }],
        })
      )),
    });
    const view = render(
      <ParticipantMediaGallery tournamentId="old" service={service} />,
    );
    view.rerender(<ParticipantMediaGallery tournamentId="new" service={service} />);
    expect(await screen.findByText('Galería nueva')).toBeInTheDocument();
    resolveOld(participantPayload());
    await waitFor(() => {
      expect(screen.queryByText('La noche de la final')).not.toBeInTheDocument();
    });
  });
});
