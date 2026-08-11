import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicTournamentPage from '../features/torneos/components/PublicTournamentPage';
import TournamentPublicPageSettings from '../features/torneos/components/TournamentPublicPageSettings';

const PAGE = {
  publicSlug: 'liga-devoto-apertura-a1b2c3d4e5',
  organization: { name: 'Liga Devoto' },
  season: { name: 'Temporada 2027' },
  tournament: {
    name: 'Copa Apertura',
    description: 'La competencia oficial del barrio.',
    status: 'active',
    sportModality: 'football_7',
    competitionFormat: 'league',
    genderCategory: 'open',
  },
  categories: [
    { name: 'Primera', slug: 'primera', hasPublishedFixture: true },
    { name: 'Reserva', slug: 'reserva', hasPublishedFixture: false },
  ],
  selectedCategory: { name: 'Primera', slug: 'primera' },
  hasPublishedFixture: true,
  matches: [{
    matchNumber: 1,
    status: 'official',
    scheduledAt: '2027-03-20T18:00:00.000Z',
    round: { number: 1, name: 'Fecha 1' },
    venue: { name: 'Club Central', courtName: 'Cancha 1' },
    home: { name: 'Los Pinos', shortName: 'LP', primaryColor: '#351c75' },
    away: { name: 'Estrella Sur', shortName: 'ES', primaryColor: '#bd2130' },
    result: { home: 3, away: 1, outcomeType: 'played' },
  }, {
    matchNumber: 2,
    status: 'scheduled',
    scheduledAt: '2027-03-27T18:00:00.000Z',
    round: { number: 2, name: 'Fecha 2' },
    venue: null,
    home: { name: 'Estrella Sur', shortName: 'ES' },
    away: { name: 'Los Pinos', shortName: 'LP' },
    result: null,
  }],
  teams: [
    { name: 'Los Pinos', shortName: 'LP', status: 'active' },
    { name: 'Estrella Sur', shortName: 'ES', status: 'active' },
  ],
  competition: [{
    scopeKey: 'phase-1',
    label: 'Fase regular',
    publishedAt: '2027-03-21T00:00:00.000Z',
    standings: [{ position: 1, teamName: 'Los Pinos', shortName: 'LP', played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 3, goalsAgainst: 1, goalDifference: 2, points: 3 }],
    players: [{ name: 'Leo Díaz', teamName: 'Los Pinos', goals: 2, assists: 1, appearances: 1 }],
    discipline: [{ name: 'Pablo Suárez', teamName: 'Estrella Sur', yellowCards: 1, redCards: 0, suspensions: [{ remainingMatches: 0 }] }],
  }],
};

function publicService(page = PAGE) {
  return {
    loadPage: jest.fn().mockResolvedValue(page),
    resolveTeamShieldUrl: jest.fn(() => null),
  };
}

function renderPublic(service, entry = '/torneos/publico/liga-devoto-apertura-a1b2c3d4e5?categoria=primera') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/torneos/publico/:publicSlug" element={<PublicTournamentPage service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('public tournament page', () => {
  test('renders the anonymous public product with official sporting data only', async () => {
    const service = publicService();
    renderPublic(service);

    expect(await screen.findByRole('heading', { name: 'Copa Apertura' })).toBeInTheDocument();
    expect(service.loadPage).toHaveBeenCalledWith({
      publicSlug: 'liga-devoto-apertura-a1b2c3d4e5',
      categorySlug: 'primera',
    });
    expect(screen.getByText('Sitio oficial')).toBeInTheDocument();
    expect(screen.getByText('Resultado oficial')).toBeInTheDocument();
    expect(screen.queryByText(/iniciar sesión/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/administración/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dirección|email|teléfono/i)).not.toBeInTheDocument();
  });

  test('navigates every public section from local published data', async () => {
    renderPublic(publicService());
    await screen.findByRole('heading', { name: 'Copa Apertura' });

    fireEvent.click(screen.getByRole('button', { name: 'Tabla' }));
    expect(screen.getByRole('columnheader', { name: 'Pts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Goleadores' }));
    expect(screen.getByText('Leo Díaz')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Equipos' }));
    expect(screen.getByText('Los Pinos')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disciplina' }));
    expect(screen.getByText('Pablo Suárez')).toBeInTheDocument();
    expect(screen.queryByText(/motivo/i)).not.toBeInTheDocument();
  });

  test('reloads the server projection when category changes', async () => {
    const service = publicService();
    renderPublic(service);
    await screen.findByRole('heading', { name: 'Copa Apertura' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), { target: { value: 'reserva' } });
    await waitFor(() => expect(service.loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ categorySlug: 'reserva' })));
  });

  test('fails closed without a login action when publication is absent', async () => {
    renderPublic(publicService(null));
    expect(await screen.findByRole('heading', { name: 'Torneo no disponible' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /iniciar sesión/i })).not.toBeInTheDocument();
  });
});

describe('tournament public settings', () => {
  test('owner can publish, copy and unpublish a stable public link', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const unpublished = { published: false, publicPath: null, publicSlug: null, eligible: true };
    const published = { published: true, publicPath: '/torneos/publico/stable-a1b2c3d4e5', publicSlug: 'stable-a1b2c3d4e5', eligible: true };
    const service = {
      loadPublicPageSettings: jest.fn().mockResolvedValue(unpublished),
      setPublicPagePublished: jest.fn()
        .mockResolvedValueOnce(published)
        .mockResolvedValueOnce({ ...published, published: false }),
    };
    render(<TournamentPublicPageSettings organizationId="org" tournamentId="tournament" canPublish service={service} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Publicar página' }));
    expect(await screen.findByText('Publicada')).toBeInTheDocument();
    expect(service.setPublicPagePublished).toHaveBeenCalledWith({ organizationId: 'org', tournamentId: 'tournament', published: true });
    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace público' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/torneos/publico/stable-a1b2c3d4e5`));
    fireEvent.click(screen.getByRole('button', { name: 'Despublicar' }));
    expect(await screen.findByText('No publicada')).toBeInTheDocument();
  });

  test('collaborator sees publication status but no write actions', async () => {
    const service = {
      loadPublicPageSettings: jest.fn().mockResolvedValue({ published: true, publicPath: '/torneos/publico/stable-a1b2c3d4e5', eligible: true }),
      setPublicPagePublished: jest.fn(),
    };
    render(<TournamentPublicPageSettings organizationId="org" tournamentId="tournament" canPublish={false} service={service} />);
    expect(await screen.findByText('Publicada')).toBeInTheDocument();
    expect(screen.getByText(/no cambiarlo/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Despublicar' })).not.toBeInTheDocument();
    expect(service.setPublicPagePublished).not.toHaveBeenCalled();
  });
});
