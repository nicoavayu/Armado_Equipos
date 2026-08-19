import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const ORG = 'c1000000-0000-4000-8000-000000000001';
const TOURNAMENT = 'c2000000-0000-4000-8000-000000000001';
const CATEGORY = 'c3000000-0000-4000-8000-000000000001';
const MATCH = 'c4000000-0000-4000-8000-000000000001';
const OPERATION = 'c5000000-0000-4000-8000-000000000001';
const HOME = 'c6000000-0000-4000-8000-000000000001';
const AWAY = 'c6000000-0000-4000-8000-000000000002';

function createService() {
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
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        planningStatus: 'scheduled',
        homeName: 'Napoli',
        awayName: 'Belgrano',
        homeTeamEntryId: HOME,
        awayTeamEntryId: AWAY,
        operationId: OPERATION,
        operationStatus: 'draft',
      }],
    }),
    loadMatchOperation: jest.fn().mockResolvedValue({
      operation: {
        id: OPERATION,
        // La operación declara su torneo y su organización, igual que la
        // tabla real: son columnas not null y la UI las usa para comprobar
        // que el recurso es el de la URL.
        organization_id: ORG,
        tournament_id: TOURNAMENT,
        category_id: CATEGORY,
        operation_version: 1,
        status: 'draft',
        home_team_entry_id: HOME,
        away_team_entry_id: AWAY,
        home_team_snapshot: { name: 'Napoli' },
        away_team_snapshot: { name: 'Belgrano' },
      },
      outcome: null,
      score: null,
      events: [],
      players: [],
      reviews: [],
    }),
    loadMatchSquad: jest.fn(),
    openMatchOperation: jest.fn(),
    setMatchOutcome: jest.fn().mockResolvedValue({ ok: true }),
    setMatchScore: jest.fn().mockResolvedValue({ ok: true }),
    addMatchEvent: jest.fn().mockResolvedValue({ ok: true }),
    loadPlayerMatches: jest.fn().mockResolvedValue([]),
    respondMatchAvailability: jest.fn(),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
}

function renderReport(service) {
  return render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/partidos/${MATCH}/acta`]}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

// El estado deportivo por defecto es "Jugado", que no usa minuto de suspensión.
// El formulario igual conservaba el campo en su estado y lo mandaba vacío, así
// que el guardado más común del acta fallaba siempre.
describe('estado deportivo del acta en la interfaz', () => {
  test('guardar "Jugado" recién abierto funciona y no manda minuto de suspensión', async () => {
    const service = createService();
    renderReport(service);
    const save = await screen.findByRole('button', { name: /Guardar estado/ });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(service.setMatchOutcome).toHaveBeenCalled());
    const payload = service.setMatchOutcome.mock.calls[0][0].outcome;
    expect(payload.outcomeType).toBe('played');
    expect(payload.suspensionMinute).toBe('');
  });

  test('un partido suspendido no se puede guardar incompleto y se explica qué falta', async () => {
    const service = createService();
    renderReport(service);
    await screen.findByRole('button', { name: /Guardar estado/ });
    fireEvent.change(screen.getByLabelText(/Qué ocurrió/), { target: { value: 'suspended' } });
    const save = screen.getByRole('button', { name: /Guardar estado/ });
    expect(save).toBeDisabled();
    const hint = screen.getByText(/Para un partido suspendido/);
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/minuto/i);
    expect(hint.textContent).not.toMatch(/smallint|22P02|null/i);
    expect(service.setMatchOutcome).not.toHaveBeenCalled();
  });

  test('completado el detalle, el partido suspendido sí se guarda', async () => {
    const service = createService();
    renderReport(service);
    await screen.findByRole('button', { name: /Guardar estado/ });
    fireEvent.change(screen.getByLabelText(/Qué ocurrió/), { target: { value: 'suspended' } });
    // "Minuto" también existe en el alta de eventos: el primero es el de la suspensión.
    fireEvent.change(screen.getAllByLabelText(/Minuto/)[0], { target: { value: '63' } });
    fireEvent.change(screen.getByLabelText(/Motivo u observación/), { target: { value: 'Tormenta' } });
    const save = screen.getByRole('button', { name: /Guardar estado/ });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(service.setMatchOutcome).toHaveBeenCalled());
    const payload = service.setMatchOutcome.mock.calls[0][0].outcome;
    expect(payload.outcomeType).toBe('suspended');
    expect(payload.suspensionMinute).toBe('63');
    expect(payload.reasonText).toBe('Tormenta');
  });
});
