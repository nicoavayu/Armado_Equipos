import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const ORG = 'b1000000-0000-4000-8000-000000000001';
const TOURNAMENT = 'b2000000-0000-4000-8000-000000000001';
const CATEGORY = 'b3000000-0000-4000-8000-000000000001';
const MATCH = 'b4000000-0000-4000-8000-000000000001';

const hoursFromNow = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

function createService(scheduledAt) {
  const organization = {
    id: ORG,
    name: 'Liga QA',
    slug: 'liga-qa',
    role: 'owner',
    capabilities: getCapabilitiesForRole('owner'),
  };
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG },
      organizations: [organization],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    loadCompetitionContext: jest.fn().mockResolvedValue({
      preference: { organizationId: ORG, activeSeasonId: 'season-a', activeTournamentId: TOURNAMENT },
      seasons: [{ id: 'season-a', name: 'Apertura', status: 'active' }],
      tournaments: [{
        id: TOURNAMENT,
        seasonId: 'season-a',
        name: 'Liga QA',
        status: 'active',
        categories: [{ id: CATEGORY, name: 'Primera', status: 'active' }],
      }],
      modalities: [],
      formats: [],
    }),
    setTournamentContext: jest.fn(),
    loadFixtureContext: jest.fn().mockResolvedValue({}),
    loadScheduleContext: jest.fn().mockResolvedValue({}),
    loadMatchOperations: jest.fn().mockResolvedValue({
      matches: [{
        id: MATCH,
        categoryId: CATEGORY,
        matchNumber: 3,
        scheduledAt,
        planningStatus: 'scheduled',
        venue: 'Complejo QA',
        court: 'Cancha 1',
        homeName: 'Napoli',
        awayName: 'Belgrano',
        homeSquadStatus: null,
        awaySquadStatus: null,
        operationId: null,
        operationStatus: null,
      }],
    }),
    loadMatchOperation: jest.fn(),
    loadMatchSquad: jest.fn(),
    openMatchOperation: jest.fn().mockResolvedValue({ operation: { id: 'operation-a' } }),
    loadPlayerMatches: jest.fn().mockResolvedValue([]),
    respondMatchAvailability: jest.fn(),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
}

function renderMatch(service) {
  return render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/partidos/${MATCH}`]}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

// El backend permite abrir el acta antes de la ventana de seis horas siempre que
// llegue un motivo. La interfaz no tenía dónde escribirlo: el organizador veía
// un error y no podía avanzar.
describe('abrir el acta y la ventana de seis horas', () => {
  test('dentro de la ventana se abre directo, sin pedir motivo', async () => {
    const service = createService(hoursFromNow(2));
    renderMatch(service);
    const button = await screen.findByRole('button', { name: /Abrir acta/ });
    expect(button).toBeEnabled();
    expect(screen.queryByLabelText(/Por qué se abre antes de tiempo/)).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(service.openMatchOperation).toHaveBeenCalledWith(expect.objectContaining({
      matchId: MATCH,
    }));
    expect(service.openMatchOperation.mock.calls[0][0].overrideReason).toBeUndefined();
  });

  test('fuera de la ventana pide el motivo y explica por qué', async () => {
    const service = createService(hoursFromNow(48));
    renderMatch(service);
    const button = await screen.findByRole('button', { name: /Abrir acta/ });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Falta bastante para el horario del partido/)).toBeInTheDocument();
    expect(screen.getByText(/queda registrado junto al acta/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Por qué se abre antes de tiempo/)).toBeInTheDocument();
  });

  test('sin motivo no abre, y no le muestra jerga al organizador', async () => {
    const service = createService(hoursFromNow(48));
    const { container } = renderMatch(service);
    const button = await screen.findByRole('button', { name: /Abrir acta/ });
    fireEvent.click(button);
    expect(service.openMatchOperation).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/override/i);
    expect(container.textContent).not.toMatch(/TORNEOS_MATCH_OPEN_WINDOW/);
  });

  test('un motivo demasiado corto tampoco alcanza', async () => {
    const service = createService(hoursFromNow(48));
    renderMatch(service);
    fireEvent.change(await screen.findByLabelText(/Por qué se abre antes de tiempo/), {
      target: { value: 'x' },
    });
    expect(screen.getByRole('button', { name: /Abrir acta/ })).toBeDisabled();
    expect(service.openMatchOperation).not.toHaveBeenCalled();
  });

  test('con un motivo real abre y el motivo llega al backend', async () => {
    const service = createService(hoursFromNow(48));
    renderMatch(service);
    fireEvent.change(await screen.findByLabelText(/Por qué se abre antes de tiempo/), {
      target: { value: '  Se adelantó el partido por lluvia anunciada  ' },
    });
    const button = screen.getByRole('button', { name: /Abrir acta/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(service.openMatchOperation).toHaveBeenCalledWith(expect.objectContaining({
      matchId: MATCH,
      overrideReason: 'Se adelantó el partido por lluvia anunciada',
    }));
  });
});
