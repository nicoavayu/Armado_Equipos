import React from 'react';
import {
  act,
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
    deleteMediaAsset: jest.fn().mockResolvedValue({ assetId: 'asset-a', deleted: true }),
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
      galleries: [{
        id: 'gallery-a',
        tournamentId: 'tournament-a',
        title: 'Fecha 1',
        description: '',
        status: 'draft',
        visibility: 'tournament_participants',
        coverAssetId: null,
        assets: [asset('asset-a')],
      }],
    }));
    renderAdmin();
    expect(await screen.findByText('Modo lectura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear galería' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar definitivamente' }))
      .not.toBeInTheDocument();
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

function readyPayload(galleryOverrides = {}) {
  return adminPayload({
    storage: {
      bucket: 'tournament-media',
      private: true,
      certified: true,
      uploadReady: true,
      requiresStagingGate: false,
      storageReady: true,
      signerReady: true,
      processorReady: true,
      blockers: [],
      pixelTranscode: false,
      antivirusScanning: false,
      signedUrlTtlSeconds: 300,
      maxFileBytes: 12582912,
      maxPixels: 36000000,
      maxBatchFiles: 40,
    },
    galleries: [{
      id: 'gallery-a',
      tournamentId: 'tournament-a',
      title: 'Fecha 1',
      description: '',
      status: 'draft',
      visibility: 'tournament_participants',
      coverAssetId: null,
      assets: [],
      ...galleryOverrides,
    }],
  });
}

describe('media center with a certified pipeline', () => {
  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = jest.fn();
    mockContextService = createAdminService(readyPayload());
    mockContextService.uploadMediaPhoto = jest.fn();
    mockContextService.signMediaReadUrls = jest.fn().mockResolvedValue({});
  });

  test('offers a real upload and reports progress from the transfer, not a timer', async () => {
    let reportStage;
    let reportProgress;
    let finishUpload;
    mockContextService.uploadMediaPhoto.mockImplementation(
      ({ onStage, onProgress }) => new Promise((resolve) => {
        reportStage = onStage;
        reportProgress = onProgress;
        finishUpload = resolve;
      }),
    );
    renderAdmin();
    const input = await screen.findByLabelText('Seleccionar fotos');
    fireEvent.change(input, {
      target: { files: [new File(['foto'], 'partido.jpg', { type: 'image/jpeg' })] },
    });

    const upload = await screen.findByRole('button', { name: 'Subir' });
    // Nothing pretends to be in progress before the user asks for it.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await userEvent.click(upload);

    await waitFor(() => expect(mockContextService.uploadMediaPhoto).toHaveBeenCalled());
    expect(mockContextService.uploadMediaPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ galleryId: 'gallery-a', idempotencyKey: 'key-a' }),
    );

    await act(async () => {
      reportStage('uploading');
      reportProgress(0.42);
    });
    const bar = screen.getByRole('progressbar', { name: /Progreso de Foto 01/ });
    expect(bar).toHaveAttribute('aria-valuenow', '42');

    await act(async () => { reportStage('processing'); });
    expect(screen.getByText(/Procesando/)).toBeInTheDocument();
    // Processing is genuinely indeterminate, so no bar is shown for it.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    await act(async () => {
      finishUpload({ assetId: 'asset-a', status: 'pending_review' });
    });
    expect(await screen.findByText('Pendiente de aprobación')).toBeInTheDocument();
  });

  test('cancels an in-flight upload and lets the queue retry it', async () => {
    mockContextService.uploadMediaPhoto
      .mockImplementationOnce(({ onStage, signal }) => new Promise((resolve, reject) => {
        onStage('uploading');
        signal.addEventListener('abort', () => {
          const error = new Error('Carga cancelada.');
          error.code = 'cancelled';
          error.retryable = true;
          reject(error);
        });
      }))
      .mockResolvedValueOnce({ assetId: 'asset-a', status: 'pending_review' });

    renderAdmin();
    fireEvent.change(await screen.findByLabelText('Seleccionar fotos'), {
      target: { files: [new File(['foto'], 'partido.jpg', { type: 'image/jpeg' })] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Subir' }));
    await userEvent.click(await screen.findByRole('button', {
      name: 'Cancelar la carga de Foto 01',
    }));

    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    expect(screen.getByText('Carga cancelada.')).toBeInTheDocument();
    // A consumed intent can never be replayed, so a retry must carry a new key.
    mockContextService.createIdempotencyKey.mockReturnValue('key-b');
    await userEvent.click(retry);
    await waitFor(() => {
      expect(mockContextService.uploadMediaPhoto).toHaveBeenCalledTimes(2);
    });
  });

  test('a rejected file explains itself without naming infrastructure', async () => {
    const rejection = new Error('El archivo no es una foto JPEG, PNG o WebP real.');
    rejection.code = 'MEDIA_MIME_MISMATCH';
    rejection.retryable = false;
    mockContextService.uploadMediaPhoto.mockRejectedValue(rejection);

    renderAdmin();
    fireEvent.change(await screen.findByLabelText('Seleccionar fotos'), {
      target: { files: [new File(['foto'], 'partido.jpg', { type: 'image/jpeg' })] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Subir' }));
    expect(await screen.findByText(/no es una foto JPEG/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/bucket|signer|processor|storage/i)).not.toBeInTheDocument();
  });

  test('accepts drag and drop and exposes a camera control', async () => {
    renderAdmin();
    await screen.findByLabelText('Seleccionar fotos');
    expect(screen.getByLabelText('Tomar una foto')).toHaveAttribute('capture', 'environment');
    expect(screen.getByText(/arrastrar y soltar/i)).toBeInTheDocument();

    const panel = document.querySelector('[data-dragging]');
    fireEvent.dragOver(panel);
    expect(panel).toHaveAttribute('data-dragging', 'true');
    fireEvent.drop(panel, {
      dataTransfer: { files: [new File(['foto'], 'partido.jpg', { type: 'image/jpeg' })] },
    });
    expect(await screen.findByText('Foto 01')).toBeInTheDocument();
    expect(panel).toHaveAttribute('data-dragging', 'false');
  });

  test('an asset whose variants are missing cannot be moderated yet', async () => {
    mockContextService = createAdminService(readyPayload({
      status: 'under_review',
      assets: [asset('asset-a', { variantsReady: 1 })],
    }));
    mockContextService.signMediaReadUrls = jest.fn().mockResolvedValue({});
    renderAdmin();
    expect(await screen.findByText('Procesando…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  test('thumbnails come from the signer, never from the projection', async () => {
    mockContextService = createAdminService(readyPayload({
      assets: [asset('asset-a', {
        variantsReady: 4, thumbnailUrl: null, gridUrl: null, detailUrl: null,
      })],
    }));
    mockContextService.signMediaReadUrls = jest.fn().mockResolvedValue({
      'asset-a:thumbnail': 'https://signed.local/asset-a?token=abc',
    });
    renderAdmin();
    await waitFor(() => expect(mockContextService.signMediaReadUrls).toHaveBeenCalledWith(
      [{ assetId: 'asset-a', kind: 'thumbnail' }],
      expect.objectContaining({ signal: expect.anything() }),
    ));
    await waitFor(() => {
      expect(document.querySelector('img[src^="https://signed.local/"]')).toBeTruthy();
    });
  });

  test('hard deletion requires revoke capability, explicit confirmation and reloads', async () => {
    const payloadWithDelete = readyPayload({
      assets: [asset('asset-a', { variantsReady: 4 })],
    });
    payloadWithDelete.capabilities = [...payloadWithDelete.capabilities, 'media.revoke'];
    mockContextService = createAdminService(payloadWithDelete);
    mockContextService.signMediaReadUrls = jest.fn().mockResolvedValue({});
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    renderAdmin();

    await userEvent.click(await screen.findByRole('button', {
      name: 'Eliminar definitivamente',
    }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/no se puede deshacer/i));
    expect(mockContextService.deleteMediaAsset).toHaveBeenCalledWith('asset-a');
    await waitFor(() => {
      expect(mockContextService.loadMediaAdminContext.mock.calls.length).toBeGreaterThan(1);
    });
    expect(screen.getByText(/se eliminaron correctamente/i)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  test('does not delete when the owner cancels the confirmation', async () => {
    const payload = readyPayload({ assets: [asset('asset-a', { variantsReady: 4 })] });
    payload.capabilities = [...payload.capabilities, 'media.revoke'];
    mockContextService = createAdminService(payload);
    mockContextService.signMediaReadUrls = jest.fn().mockResolvedValue({});
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    renderAdmin();

    await userEvent.click(await screen.findByRole('button', {
      name: 'Eliminar definitivamente',
    }));
    expect(mockContextService.deleteMediaAsset).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
