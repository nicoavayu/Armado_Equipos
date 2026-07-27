import React from 'react';
import {
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
import CommunicationsAdminPage from '../features/torneos/components/CommunicationsAdminPage';
import TournamentCommunicationsPanel from '../features/torneos/components/TournamentCommunicationsPanel';

let mockContextService;

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => ({ service: mockContextService }),
}));

function inboxItem(overrides = {}) {
  return {
    id: 'announcement-a',
    type: 'match_update',
    title: 'Cambio de horario confirmado',
    summary: 'El próximo partido comienza una hora más tarde.',
    priority: 'urgent',
    acknowledgementMode: 'explicit',
    publishedAt: '2026-08-01T18:00:00Z',
    tournamentName: 'Copa Horizonte',
    organizationName: 'Liga Metropolitana',
    categoryName: 'Libre',
    readAt: null,
    ...overrides,
  };
}

function announcementDetail(overrides = {}) {
  return {
    ...inboxItem(),
    status: 'published',
    body: 'Contenido oficial completo.\nLlegá con anticipación.',
    version: 1,
    organization: { id: 'org-a', name: 'Liga Metropolitana' },
    tournament: { id: 'tournament-a', name: 'Copa Horizonte' },
    category: { id: 'category-a', name: 'Libre' },
    delivery: { status: 'available', readAt: null, confirmedAt: null },
    links: [],
    ...overrides,
  };
}

function createParticipantService(overrides = {}) {
  return {
    loadCommunicationsInbox: jest.fn().mockResolvedValue({
      items: [inboxItem()],
      unreadCount: 1,
      pagination: { total: 1 },
    }),
    loadPublishedDocuments: jest.fn().mockResolvedValue({ items: [] }),
    loadNotificationPreferences: jest.fn().mockResolvedValue({
      tournamentId: 'tournament-a',
      general: true,
      matchChanges: true,
      callups: true,
      discipline: true,
      documents: true,
      summaries: true,
      channels: { internal: true, push: false, email: false },
    }),
    loadAnnouncement: jest.fn().mockResolvedValue(announcementDetail()),
    markAnnouncementRead: jest.fn().mockResolvedValue({ status: 'confirmed' }),
    acknowledgeDocument: jest.fn().mockResolvedValue({ status: 'confirmed' }),
    updateNotificationPreferences: jest.fn().mockImplementation(
      async (payload) => payload,
    ),
    ...overrides,
  };
}

function renderPanel(service = createParticipantService(), props = {}) {
  return render(
    <MemoryRouter>
      <TournamentCommunicationsPanel
        tournamentId="tournament-a"
        categoryId="category-a"
        service={service}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('participant tournament communications', () => {
  test('shows unread urgent communications with institutional context', async () => {
    renderPanel();
    expect(await screen.findByText('Cambio de horario confirmado')).toBeInTheDocument();
    expect(screen.getByText('1 sin leer')).toBeInTheDocument();
    expect(screen.getByText('Partido · Libre')).toBeInTheDocument();
  });

  test('opens a long announcement and records explicit read confirmation', async () => {
    const service = createParticipantService({
      loadAnnouncement: jest.fn().mockResolvedValue(announcementDetail({
        links: [{
          id: 'link-a',
          type: 'match',
          resourceId: 'match-a',
          label: 'Ver partido',
          externalUrl: null,
        }],
      })),
    });
    renderPanel(service);
    await userEvent.click(await screen.findByText('Cambio de horario confirmado'));
    expect(await screen.findByText('Contenido oficial completo.')).toBeInTheDocument();
    expect(screen.getByText('Esta confirmación registra lectura; no representa una aceptación legal.'))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver partido' })).toHaveAttribute(
      'href',
      '/torneos/torneo/tournament-a/partidos/match-a?categoria=category-a',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirmo que lo leí' }));
    expect(service.markAnnouncementRead).toHaveBeenCalledWith({
      announcementId: 'announcement-a',
      confirm: true,
    });
  });

  test('renders the designed empty inbox state', async () => {
    renderPanel(createParticipantService({
      loadCommunicationsInbox: jest.fn().mockResolvedValue({
        items: [],
        unreadCount: 0,
        pagination: { total: 0 },
      }),
    }));
    expect(await screen.findByText('Estás al día')).toBeInTheDocument();
    expect(screen.getByText('No hay comunicados publicados para vos en este torneo.'))
      .toBeInTheDocument();
  });

  test('shows and acknowledges a required official document', async () => {
    const service = createParticipantService({
      loadPublishedDocuments: jest.fn().mockResolvedValue({
        items: [{
          id: 'document-a',
          type: 'regulation',
          title: 'Reglamento oficial',
          summary: 'Reglas vigentes.',
          body: 'Contenido estructurado.',
          version: 2,
          versionId: 'version-a',
          acknowledgementMode: 'explicit',
          effectiveAt: '2026-08-01T00:00:00Z',
          acknowledgement: null,
        }],
      }),
    });
    renderPanel(service);
    await userEvent.click(await screen.findByRole('tab', { name: 'Documentos' }));
    expect(screen.getByText('Reglamento oficial')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmo que lo leí' }));
    expect(service.acknowledgeDocument).toHaveBeenCalledWith({
      versionId: 'version-a',
      confirm: true,
    });
  });

  test('updates self preferences while explaining mandatory inbox items', async () => {
    const service = createParticipantService();
    renderPanel(service);
    await userEvent.click(await screen.findByRole('tab', { name: 'Preferencias' }));
    expect(screen.getByText(/Push y email siguen desactivados/)).toBeInTheDocument();
    const general = screen.getByRole('checkbox', { name: 'Comunicados generales' });
    await userEvent.click(general);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar preferencias' }));
    expect(service.updateNotificationPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentId: 'tournament-a', general: false }),
    );
  });

  test('fails closed on participant errors without keeping previous content', async () => {
    const service = createParticipantService({
      loadCommunicationsInbox: jest.fn().mockRejectedValue(
        new Error('Tu sesión venció.'),
      ),
    });
    renderPanel(service);
    expect(await screen.findByText('No pudimos cargar las novedades')).toBeInTheDocument();
    expect(screen.queryByText('Cambio de horario confirmado')).not.toBeInTheDocument();
  });

  test('discards an inverted late response after tournament scope changes', async () => {
    let resolveOld;
    const oldInbox = new Promise((resolve) => {
      resolveOld = resolve;
    });
    const service = createParticipantService({
      loadCommunicationsInbox: jest.fn(({ tournamentId }) => (
        tournamentId === 'tournament-a'
          ? oldInbox
          : Promise.resolve({
            items: [inboxItem({
              id: 'announcement-b',
              title: 'Comunicado del torneo nuevo',
            })],
            unreadCount: 1,
          })
      )),
    });
    const view = renderPanel(service);
    view.rerender(
      <MemoryRouter>
        <TournamentCommunicationsPanel
          tournamentId="tournament-b"
          categoryId="category-b"
          service={service}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Comunicado del torneo nuevo')).toBeInTheDocument();
    resolveOld({ items: [inboxItem()], unreadCount: 1 });
    await waitFor(() => {
      expect(screen.queryByText('Cambio de horario confirmado')).not.toBeInTheDocument();
    });
  });

  test('does not apply a late preference save to a different tournament', async () => {
    let resolveOldSave;
    const oldSave = new Promise((resolve) => {
      resolveOldSave = resolve;
    });
    const service = createParticipantService({
      loadNotificationPreferences: jest.fn().mockImplementation(
        async (tournamentId) => ({
          tournamentId,
          general: true,
          matchChanges: true,
          callups: true,
          discipline: true,
          documents: true,
          summaries: true,
        }),
      ),
      updateNotificationPreferences: jest.fn().mockReturnValue(oldSave),
    });
    const view = renderPanel(service);
    await userEvent.click(await screen.findByRole('tab', { name: 'Preferencias' }));
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Comunicados generales' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar preferencias' }));
    view.rerender(
      <MemoryRouter>
        <TournamentCommunicationsPanel
          tournamentId="tournament-b"
          categoryId="category-b"
          service={service}
        />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Comunicados generales' }))
        .toBeChecked();
    });
    resolveOldSave({
      tournamentId: 'tournament-a',
      general: false,
      matchChanges: true,
      callups: true,
      discipline: true,
      documents: true,
      summaries: true,
    });
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Comunicados generales' }))
        .toBeChecked();
    });
  });
});

describe('organizer communications composer', () => {
  beforeEach(() => {
    mockContextService = {
      loadCommunicationsAdminContext: jest.fn().mockResolvedValue({
        organizationId: 'org-a',
        scheduledPublishingEnabled: false,
        channels: { internal: true, push: false, email: false },
        capabilities: [
          'announcements.read',
          'announcements.create',
          'announcements.update_draft',
          'announcements.publish',
          'documents.read',
          'documents.create',
          'documents.update_draft',
          'documents.publish',
          'audiences.preview',
        ],
        tournaments: [{
          id: 'tournament-a',
          name: 'Copa Horizonte',
          seasonName: 'Temporada 2026',
          categories: [{ id: 'category-a', name: 'Libre' }],
          teams: [{ id: 'team-a', name: 'Violetas' }],
          matches: [{
            id: 'match-a',
            matchNumber: 1,
            scheduledAt: '2026-08-01T18:00:00Z',
          }],
        }],
        announcements: [],
        documents: [],
      }),
      createAnnouncementDraft: jest.fn().mockResolvedValue('announcement-a'),
      updateAnnouncementDraft: jest.fn().mockResolvedValue('announcement-a'),
      setAnnouncementAudience: jest.fn().mockResolvedValue('audience-a'),
      replaceAnnouncementAudience: jest.fn().mockResolvedValue('audience-a'),
      setAnnouncementLink: jest.fn().mockResolvedValue('link-a'),
      previewAnnouncementAudience: jest.fn().mockResolvedValue({
        estimatedRecipients: 12,
        roles: ['player', 'captain'],
        teams: [],
        channel: 'internal_only',
      }),
      publishAnnouncement: jest.fn().mockResolvedValue({
        announcementId: 'announcement-a',
        recipientCount: 12,
        audienceChanged: false,
      }),
      createDocument: jest.fn().mockResolvedValue({
        documentId: 'document-a',
        versionId: 'version-a',
      }),
      publishDocumentVersion: jest.fn().mockResolvedValue({ status: 'published' }),
      createIdempotencyKey: jest.fn().mockReturnValue('key-a'),
    };
  });

  test('shows a six-step internal-only composer and no automated scheduling claim', async () => {
    render(
      <MemoryRouter initialEntries={['/torneos/organizacion/org-a/comunicaciones']}>
        <Routes>
          <Route
            path="/torneos/organizacion/:organizationId/comunicaciones"
            element={<CommunicationsAdminPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Comunicaciones' }))
      .toBeInTheDocument();
    expect(screen.getByText('Push y email desactivados')).toBeInTheDocument();
    expect(screen.getByText('Confirmar')).toBeInTheDocument();
    expect(screen.getByText(/Canal institucional · Sólo interno/)).toBeInTheDocument();
  });

  test('previews an audience and publishes once despite rapid clicks', async () => {
    render(
      <MemoryRouter initialEntries={['/torneos/organizacion/org-a/comunicaciones']}>
        <Routes>
          <Route
            path="/torneos/organizacion/:organizationId/comunicaciones"
            element={<CommunicationsAdminPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Información general');
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await userEvent.type(screen.getByPlaceholderText('Ej. Cambio de sede confirmado'), 'Aviso oficial');
    await userEvent.type(
      screen.getByPlaceholderText('La información esencial en una frase.'),
      'Resumen oficial para participantes.',
    );
    await userEvent.type(
      screen.getByPlaceholderText('Texto plano. No se admite HTML.'),
      'Contenido completo del comunicado oficial.',
    );
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await userEvent.click(screen.getByRole('button', { name: /Preparar vista previa/ }));
    expect(await screen.findByText('12 destinatarios')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Revisar publicación/ }));
    const publish = screen.getByRole('button', { name: /Publicar comunicado/ });
    await userEvent.dblClick(publish);
    await waitFor(() => {
      expect(mockContextService.publishAnnouncement).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Comunicado publicado')).toBeInTheDocument();
  });

  test('revalidates edited draft content and replaces its prior audience', async () => {
    render(
      <MemoryRouter initialEntries={['/torneos/organizacion/org-a/comunicaciones']}>
        <Routes>
          <Route
            path="/torneos/organizacion/:organizationId/comunicaciones"
            element={<CommunicationsAdminPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Información general');
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await userEvent.type(
      screen.getByPlaceholderText('Ej. Cambio de sede confirmado'),
      'Aviso editable',
    );
    await userEvent.type(
      screen.getByPlaceholderText('La información esencial en una frase.'),
      'Resumen editable del comunicado.',
    );
    await userEvent.type(
      screen.getByPlaceholderText('Texto plano. No se admite HTML.'),
      'Contenido editable del comunicado.',
    );
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await userEvent.click(screen.getByRole('button', { name: /Preparar vista previa/ }));
    await screen.findByText('12 destinatarios');
    await userEvent.click(screen.getByRole('button', { name: /Anterior/ }));
    await userEvent.selectOptions(screen.getByLabelText('Prioridad'), 'urgent');
    await userEvent.click(screen.getByRole('button', { name: /Preparar vista previa/ }));
    await waitFor(() => {
      expect(mockContextService.updateAnnouncementDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          announcementId: 'announcement-a',
          priority: 'urgent',
        }),
      );
      expect(mockContextService.replaceAnnouncementAudience).toHaveBeenCalledTimes(2);
    });
  });
});
