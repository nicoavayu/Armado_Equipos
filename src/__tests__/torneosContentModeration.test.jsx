import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicTournamentPage, { publicReportTargets } from '../features/torneos/components/PublicTournamentPage';
import ContentReportDialog from '../features/torneos/components/moderation/ContentReportDialog';
import { CommunicationModerationBar, MutedOrganizations } from '../features/torneos/components/moderation/CommunicationModeration';
import ApplicationModeration from '../features/torneos/components/moderation/ApplicationModeration';
import OrganizationModerationPage from '../features/torneos/components/moderation/OrganizationModerationPage';
import TermsPage from '../pages/TermsPage';
import {
  handleReportParams,
  mutedParams,
  reportContentParams,
  reportMailto,
  reportReceivedMessage,
} from '../features/torneos/domain/contentModeration';
import { TorneosFeaturesProvider } from '../features/torneos/context/TorneosFeaturesContext';

// MODERATION (0022): the report dialog and its honest copy, the public page entry point (signed in / out), the
// participant's report + mute, the organizer's report + block of an application, the organization's moderation page and
// the Terms. Services are recording fakes; the database rules are proven on the lab (moderation-0022.test.mjs).

let mockAuth = null;
let mockService = null;
let mockOrganization = { id: '10000000-0000-4000-8000-000000000001', name: 'Liga Devoto', role: 'owner' };
jest.mock('../components/AuthContext', () => ({ useOptionalAuth: () => mockAuth }));
jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => ({ service: mockService }),
}));
jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useOptionalTorneosCompetition: () => null,
}));
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useOutletContext: () => ({ organization: mockOrganization }) };
});

const KEY = '70000000-0000-4000-8000-000000000001';
const ANNOUNCEMENT = '90000000-0000-4000-8000-000000000001';
const ENTRY = '50000000-0000-4000-8000-000000000001';
const REPORT = '80000000-0000-4000-8000-000000000001';
const PAGE = {
  publicSlug: 'liga-devoto-apertura-a1b2c3d4e5',
  organization: { name: 'Liga Devoto' },
  season: { name: 'Temporada 2027' },
  tournament: { name: 'Copa Apertura', description: null, status: 'active', sportModality: 'football_7', competitionFormat: 'league' },
  categories: [{ name: 'Primera', slug: 'primera', hasPublishedFixture: true }],
  selectedCategory: { name: 'Primera', slug: 'primera' },
  hasPublishedFixture: true,
  matches: [],
  teams: [{ name: 'Los Pinos', status: 'active' }, { name: 'Estrella Sur', status: 'active' }],
  competition: [{
    scopeKey: 'phase-1',
    label: 'Fase regular',
    standings: [],
    players: [{ name: 'Leo Díaz', teamName: 'Los Pinos', goals: 2 }],
    discipline: [{ name: 'Pablo Suárez', teamName: 'Estrella Sur', yellowCards: 1, redCards: 0, suspensions: [] }, { name: 'Leo Díaz', teamName: 'Los Pinos' }],
  }],
};

function renderPublic(reportService) {
  const service = { loadPage: jest.fn().mockResolvedValue(PAGE), resolveTeamShieldUrl: () => null };
  return render(
    <MemoryRouter initialEntries={[`/torneos/publico/${PAGE.publicSlug}`]}>
      <Routes>
        <Route path="/torneos/publico/:publicSlug" element={<PublicTournamentPage service={service} reportService={reportService} />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth = null;
  mockService = null;
  mockOrganization = { id: '10000000-0000-4000-8000-000000000001', name: 'Liga Devoto', role: 'owner' };
});

describe('domain rules', () => {
  test('report bodies: public content by slug and visible text, private content by id; invalid input never leaves', () => {
    expect(reportContentParams({ kind: 'player', publicSlug: PAGE.publicSlug, targetLabel: ' Leo Díaz ', reason: 'personal_data', detail: '  Publicaron su teléfono  ', idempotencyKey: KEY })).toEqual({
      p_target_kind: 'player', p_public_slug: PAGE.publicSlug, p_target_id: null, p_target_label: 'Leo Díaz',
      p_reason: 'personal_data', p_detail: 'Publicaron su teléfono', p_idempotency_key: KEY,
    });
    expect(reportContentParams({ kind: 'announcement', publicSlug: 'x-y-z', targetId: ANNOUNCEMENT, reason: 'spam', idempotencyKey: KEY }).p_public_slug).toBeNull();
    for (const input of [
      { kind: 'team', publicSlug: PAGE.publicSlug, reason: 'spam', idempotencyKey: KEY },
      { kind: 'tournament', publicSlug: 'NO SLUG', reason: 'spam', idempotencyKey: KEY },
      { kind: 'tournament', publicSlug: PAGE.publicSlug, reason: 'odio', idempotencyKey: KEY },
      { kind: 'tournament', publicSlug: PAGE.publicSlug, reason: 'spam', detail: 'ab', idempotencyKey: KEY },
      { kind: 'tournament', publicSlug: PAGE.publicSlug, reason: 'spam', idempotencyKey: 'x' },
    ]) expect(() => reportContentParams(input)).toThrow('La solicitud no es válida');
    expect(() => handleReportParams({ reportId: REPORT, status: 'dismissed' })).toThrow();
    expect(handleReportParams({ reportId: REPORT, status: 'escalated' })).toEqual({ p_report_id: REPORT, p_status: 'escalated', p_action: null, p_note: null });
    expect(() => mutedParams({ organizationId: REPORT, announcementId: ANNOUNCEMENT, muted: true })).toThrow();
  });

  test('honest copy: who reviews, the 24–48 h goal, the reporter stays private; the email never carries a name', () => {
    expect(reportReceivedMessage({ reviewScope: 'organization' })).toMatch(/Lo revisa la organización del torneo, en general dentro de las 24 a 48 horas\. No le mostramos a nadie quién lo envió\./);
    expect(reportReceivedMessage({ reviewScope: 'platform' })).toMatch(/Lo revisa el equipo de Arma2/);
    expect(reportReceivedMessage({ alreadyReported: true })).toMatch(/Ya habías reportado esto/);
    const mailto = decodeURIComponent(reportMailto({ kind: 'player', publicSlug: PAGE.publicSlug, origin: 'https://app.example' }));
    expect(mailto).toMatch(/^mailto:arma2app@gmail\.com\?subject=Reporte de contenido/);
    expect(mailto).toContain(`https://app.example/torneos/publico/${PAGE.publicSlug}`);
    expect(mailto).not.toContain('Leo');
  });
});

describe('report dialog', () => {
  test('signed in: pick the content, the player by the name shown, a reason; one submit with a stable key', async () => {
    const submit = jest.fn().mockResolvedValue({ reportId: REPORT, reviewScope: 'organization', alreadyReported: false });
    render(<ContentReportDialog open onClose={() => {}} targets={publicReportTargets(PAGE, { publicSlug: PAGE.publicSlug })} submit={submit} />);
    const dialog = screen.getByRole('dialog', { name: /Reportar contenido/ });
    fireEvent.change(within(dialog).getByLabelText('¿Qué querés reportar?'), { target: { value: '3' } });
    const who = within(dialog).getByLabelText('¿Qué jugador?');
    expect([...who.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Elegí uno', 'Leo Díaz', 'Pablo Suárez']);
    const send = within(dialog).getByRole('button', { name: /Enviar reporte/ });
    expect(send).toBeDisabled();
    fireEvent.change(who, { target: { value: 'Leo Díaz' } });
    fireEvent.click(within(dialog).getByLabelText('Datos personales expuestos'));
    fireEvent.change(within(dialog).getByLabelText(/Detalle/), { target: { value: 'Publicaron su teléfono' } });
    fireEvent.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent('Recibimos tu reporte. Lo revisa la organización del torneo');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toMatchObject({
      kind: 'player', publicSlug: PAGE.publicSlug, targetLabel: 'Leo Díaz', reason: 'personal_data', detail: 'Publicaron su teléfono',
    });
    expect(submit.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('an error keeps the form and offers the email', async () => {
    const submit = jest.fn().mockRejectedValue(new Error('Enviaste muchos reportes seguidos.'));
    render(<ContentReportDialog open onClose={() => {}} targets={[{ kind: 'announcement', targetId: ANNOUNCEMENT, title: 'Aviso' }]} submit={submit} />);
    fireEvent.click(screen.getByLabelText('Spam o engaño'));
    fireEvent.click(screen.getByRole('button', { name: /Enviar reporte/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Enviaste muchos reportes seguidos.');
    expect(within(alert).getByRole('link', { name: 'arma2app@gmail.com' })).toHaveAttribute('href', expect.stringMatching(/^mailto:arma2app@gmail\.com/));
  });

  test('without a session it never submits: sign in (back to the page) or write an email', () => {
    const submit = jest.fn();
    render(<ContentReportDialog open onClose={() => {}} signedIn={false} loginHref="/login?returnTo=%2Ftorneos%2Fpublico%2Fx" targets={[{ kind: 'tournament', publicSlug: PAGE.publicSlug }]} submit={submit} />);
    expect(screen.getByText(/Para reportar necesitás iniciar sesión/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Iniciar sesión/ })).toHaveAttribute('href', '/login?returnTo=%2Ftorneos%2Fpublico%2Fx');
    expect(screen.getByRole('link', { name: /Escribir un email/ })).toHaveAttribute('href', expect.stringMatching(/^mailto:arma2app@gmail\.com/));
    expect(screen.queryByRole('button', { name: /Enviar reporte/ })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('public tournament page', () => {
  test('«Reportar contenido» lists what the page shows; signed out it asks to sign in', async () => {
    renderPublic({ report: jest.fn() });
    fireEvent.click(await screen.findByRole('button', { name: /Reportar contenido/ }));
    expect(screen.getByText(/Para reportar necesitás iniciar sesión/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Iniciar sesión/ }).getAttribute('href')).toBe(`/login?returnTo=${encodeURIComponent(`/torneos/publico/${PAGE.publicSlug}`)}`);
  });

  test('signed in, the report goes to the composed service', async () => {
    mockAuth = { user: { id: 'core-user' } };
    const report = jest.fn().mockResolvedValue({ reviewScope: 'platform' });
    renderPublic({ report });
    fireEvent.click(await screen.findByRole('button', { name: /Reportar contenido/ }));
    const dialog = screen.getByRole('dialog');
    expect([...within(dialog).getByLabelText('¿Qué querés reportar?').querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'El torneo «Copa Apertura» (nombre, descripción o logo)', 'La organización «Liga Devoto» (nombre o logo)',
      'Un equipo (nombre o escudo)', 'Un jugador (nombre)',
    ]);
    fireEvent.click(within(dialog).getByLabelText('Contenido ofensivo'));
    fireEvent.click(within(dialog).getByRole('button', { name: /Enviar reporte/ }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Lo revisa el equipo de Arma2');
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tournament', publicSlug: PAGE.publicSlug, reason: 'offensive' }));
  });

  test('targets: no team/player entries without names; the call only when the page has one', () => {
    const bare = { ...PAGE, teams: [], competition: [] };
    expect(publicReportTargets(bare, { publicSlug: 'x-y' }).map((t) => t.kind)).toEqual(['tournament', 'organization']);
    expect(publicReportTargets(PAGE, { publicSlug: 'x-y', hasCall: true }).map((t) => t.kind))
      .toEqual(['tournament', 'organization', 'catalog_listing', 'team', 'player']);
    expect(publicReportTargets(null, { publicSlug: 'x-y' })).toEqual([]);
  });
});

describe('communications and applications', () => {
  test('a participant reports a communication to Arma2 and mutes its organization', async () => {
    const service = {
      reportContent: jest.fn().mockResolvedValue({ reviewScope: 'platform' }),
      setCommunicationsMuted: jest.fn().mockResolvedValue({ muted: true }),
    };
    const onMuted = jest.fn();
    render(<CommunicationModerationBar service={service} detail={{ id: ANNOUNCEMENT, title: 'Aviso', organization: { name: 'Liga Devoto' } }} onMuted={onMuted} />);
    fireEvent.click(screen.getByRole('button', { name: /Silenciar a Liga Devoto/ }));
    expect(await screen.findByText(/Silenciaste los comunicados de Liga Devoto/)).toBeInTheDocument();
    expect(service.setCommunicationsMuted).toHaveBeenCalledWith({ announcementId: ANNOUNCEMENT, muted: true });
    expect(onMuted).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Reportar comunicado/ }));
    fireEvent.click(screen.getByLabelText('Contenido ofensivo'));
    fireEvent.click(screen.getByRole('button', { name: /Enviar reporte/ }));
    await waitFor(() => expect(service.reportContent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'announcement', targetId: ANNOUNCEMENT })));
  });

  test('without the aliases nothing renders (LOCAL or CONNECTED off)', () => {
    const { container } = render(<CommunicationModerationBar service={{}} detail={{ id: ANNOUNCEMENT }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('muted organizations can be reactivated', async () => {
    const service = {
      loadCommunicationMutes: jest.fn()
        .mockResolvedValueOnce({ mutes: [{ organizationId: mockOrganization.id, organizationName: 'Liga Devoto' }] })
        .mockResolvedValueOnce({ mutes: [] }),
      setCommunicationsMuted: jest.fn().mockResolvedValue({ muted: false }),
    };
    render(<MutedOrganizations service={service} />);
    fireEvent.click(await screen.findByRole('button', { name: /Reactivar/ }));
    await waitFor(() => expect(service.setCommunicationsMuted).toHaveBeenCalledWith({ organizationId: mockOrganization.id, muted: false }));
    await waitFor(() => expect(screen.queryByText('Organizaciones silenciadas')).toBeNull());
  });

  test('the organizer blocks an applicant with a private reason', async () => {
    const service = { reportContent: jest.fn(), blockApplicant: jest.fn().mockResolvedValue({ blocked: true, alreadyBlocked: false }) };
    render(<ApplicationModeration service={service} organizationId={mockOrganization.id} application={{ teamEntryId: ENTRY, teamName: 'Los Pinos' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Bloquear solicitante/ }));
    const confirm = screen.getByRole('button', { name: /^Bloquear$/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Motivo del bloqueo/), { target: { value: 'Mensajes agresivos' } });
    fireEvent.click(confirm);
    expect(await screen.findByText(/no puede volver a pedir lugar/)).toBeInTheDocument();
    expect(service.blockApplicant).toHaveBeenCalledWith({ organizationId: mockOrganization.id, teamEntryId: ENTRY, reason: 'Mensajes agresivos' });
  });
});

describe('organization moderation page', () => {
  const reports = [{
    id: REPORT, targetKind: 'team', targetLabel: 'Los Insultos', content: { teamName: 'Los Insultos' }, tournamentName: 'Copa Apertura',
    reason: 'offensive', detail: 'Nombre ofensivo', status: 'open', canHandle: true, escalated: false, createdAt: '2026-10-15T10:00:00Z',
  }, {
    id: '80000000-0000-4000-8000-000000000002', targetKind: 'player', targetLabel: 'Apodo', content: { playerName: 'Apodo', teamName: 'Los Pinos' },
    reason: 'impersonation', status: 'open', canHandle: false, escalated: true, createdAt: '2026-10-15T09:00:00Z',
  }];
  const renderPage = () => render(
    <MemoryRouter initialEntries={[`/o/${mockOrganization.id}/configuracion/moderacion`]}>
      <TorneosFeaturesProvider features={{ content_moderation: true }}>
        <Routes>
          <Route path="/o/:organizationId/configuracion/moderacion" element={<OrganizationModerationPage />} />
        </Routes>
      </TorneosFeaturesProvider>
    </MemoryRouter>,
  );

  test('lists the organization-scope reports, resolves one with an action and a note, undoes a block', async () => {
    mockService = {
      loadContentReports: jest.fn().mockResolvedValue({ reports, applicantBlocks: [{ id: 'b1', teamName: 'Solicitantes', reason: 'Spam', byPlatform: false }] }),
      handleContentReport: jest.fn().mockResolvedValue({ status: 'resolved' }),
      unblockApplicant: jest.fn().mockResolvedValue({ blocked: false }),
    };
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Moderación' })).toBeInTheDocument();
    expect(mockService.loadContentReports).toHaveBeenCalledWith({ organizationId: mockOrganization.id, status: 'pending' });
    expect(screen.getByText('Escalado a Arma2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Moderación/ })).toBeInTheDocument();
    const card = screen.getByText('Los Insultos').closest('li');
    fireEvent.change(within(card).getByLabelText('Acción'), { target: { value: 'neutralize_team_name' } });
    const resolve = within(card).getByRole('button', { name: /Resolver/ });
    expect(resolve).toBeDisabled();
    fireEvent.change(within(card).getByLabelText(/Nota de la decisión/), { target: { value: 'Nombre ofensivo reemplazado' } });
    fireEvent.click(resolve);
    await waitFor(() => expect(mockService.handleContentReport).toHaveBeenCalledWith({
      reportId: REPORT, status: 'resolved', action: 'neutralize_team_name', note: 'Nombre ofensivo reemplazado',
    }));
    expect(await screen.findByText(/el contenido ya se muestra con el valor neutro/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Desbloquear/ }));
    await waitFor(() => expect(mockService.unblockApplicant).toHaveBeenCalledWith({ organizationId: mockOrganization.id, blockId: 'b1' }));
  });

  test('a collaborator never sees the Moderación link; without the alias the page says it is unavailable', async () => {
    mockOrganization = { ...mockOrganization, role: 'collaborator' };
    mockService = { loadContentReports: jest.fn().mockResolvedValue({ reports: [], applicantBlocks: [] }) };
    const { unmount } = renderPage();
    expect(await screen.findByText(/No hay reportes en esta vista/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Moderación/ })).toBeNull();
    unmount();
    mockService = {};
    renderPage();
    expect(screen.getByText(/La moderación no está disponible/)).toBeInTheDocument();
  });
});

test('Terms: the prohibited content, how to report, who reviews and what can happen — as the system does it', () => {
  render(<MemoryRouter><TermsPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Contenido prohibido y moderación' })).toBeInTheDocument();
  for (const text of [/Reportar contenido/, /Reportar comunicado/, /Reportar a Arma2/, /Para reportar hace falta iniciar sesión/,
    /dentro de las 24 a 48 horas; es un objetivo, no una garantía/, /No revisamos todo antes de que se publique/,
    /los de emergencia te siguen llegando/, /suspender o\s+eliminar la cuenta/]) {
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  }
  expect(screen.getAllByRole('link', { name: 'arma2app@gmail.com' }).length).toBeGreaterThan(0);
});
