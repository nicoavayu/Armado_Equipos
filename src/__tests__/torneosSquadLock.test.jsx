import React from 'react';
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import {
  describeSquadLock,
  getSquadActionErrorMessage,
  SQUAD_OFFICIAL_LOCK_MESSAGE,
  SQUAD_OPERATION_LOCK_MESSAGE,
} from '../features/torneos/domain/matchSquads';
import {
  ERROR_MESSAGES,
  TournamentWorkspaceError,
} from '../features/torneos/api/tournamentWorkspaceErrors';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

// POST-BETA issue 2: `save_match_squad` / `submit_match_squad` refuse any match whose acta is active
// (TORNEOS_MATCH_OPERATION_ACTIVE) — an OFFICIAL match included, which keeps planning status
// `scheduled`. "Guardar borrador" used to stay enabled and the refusal spoke of "cambios de programación".

describe('regla de edición de la convocatoria (espejo de save/submit_match_squad)', () => {
  test('sin acta y con el partido programado o listo, se puede editar', () => {
    expect(describeSquadLock({ planningStatus: 'scheduled' })).toBeNull();
    expect(describeSquadLock({ planningStatus: 'ready', operationId: null })).toBeNull();
  });

  test('un acta superseded o anulada no bloquea', () => {
    expect(describeSquadLock({ planningStatus: 'ready', operationId: 'op', operationStatus: 'voided' })).toBeNull();
    expect(describeSquadLock({ planningStatus: 'ready', operationId: 'op', operationStatus: 'superseded' })).toBeNull();
  });

  test.each(['draft', 'submitted', 'under_review', 'validated', 'correction_requested'])(
    'un acta %s bloquea con la copy del acta abierta',
    (operationStatus) => {
      expect(describeSquadLock({ planningStatus: 'scheduled', operationId: 'op', operationStatus }))
        .toEqual({ code: 'operation_active', message: SQUAD_OPERATION_LOCK_MESSAGE });
    },
  );

  test('un partido oficial bloquea con la copy del resultado oficial', () => {
    expect(describeSquadLock({ planningStatus: 'scheduled', operationId: 'op', operationStatus: 'official' }))
      .toEqual({ code: 'official', message: SQUAD_OFFICIAL_LOCK_MESSAGE });
  });

  test.each(['postponed', 'cancelled', 'draft', 'unscheduled'])('un partido %s no admite convocatoria', (planningStatus) => {
    const lock = describeSquadLock({ planningStatus });
    expect(lock.code).toBe('match_status');
    expect(lock.message).not.toMatch(/programación/);
  });

  test('ninguna copy de la convocatoria habla de programación ni muestra códigos', () => {
    for (const message of [SQUAD_OFFICIAL_LOCK_MESSAGE, SQUAD_OPERATION_LOCK_MESSAGE]) {
      expect(message).toMatch(/convocatoria/);
      expect(message).not.toMatch(/programación|TORNEOS_/);
    }
  });

  test('el rechazo del backend se explica en términos de convocatoria', () => {
    const rejected = new TournamentWorkspaceError(
      'TORNEOS_MATCH_OPERATION_ACTIVE',
      ERROR_MESSAGES.TORNEOS_MATCH_OPERATION_ACTIVE,
    );
    expect(getSquadActionErrorMessage(rejected, rejected.message)).toBe(SQUAD_OPERATION_LOCK_MESSAGE);
    const other = new TournamentWorkspaceError('TORNEOS_INVALID_MATCH_SQUAD', 'Revisá titulares.');
    expect(getSquadActionErrorMessage(other, other.message)).toBe('Revisá titulares.');
  });

  test('la copy general del código ya no habla sólo de programación', () => {
    expect(ERROR_MESSAGES.TORNEOS_MATCH_OPERATION_ACTIVE).toMatch(/acta activa/);
    expect(ERROR_MESSAGES.TORNEOS_MATCH_OPERATION_ACTIVE).toMatch(/convocatorias/);
  });
});

const ORG = 'e1000000-0000-4000-8000-000000000001';
const TOURNAMENT = 'e2000000-0000-4000-8000-000000000001';
const CATEGORY = 'e3000000-0000-4000-8000-000000000001';
const MATCH = 'e4000000-0000-4000-8000-000000000001';
const OPERATION = 'e5000000-0000-4000-8000-000000000001';
const HOME = 'e6000000-0000-4000-8000-000000000001';
const AWAY = 'e6000000-0000-4000-8000-000000000002';

function createService({ operationId = OPERATION, operationStatus = 'official' } = {}) {
  const organization = {
    id: ORG, name: 'Liga QA', slug: 'liga-qa', role: 'owner', capabilities: getCapabilitiesForRole('owner'),
  };
  const squad = (teamEntryId, teamName) => ({
    matchId: MATCH,
    teamEntryId,
    teamName,
    status: 'scheduled',
    teamSize: 5,
    squad: { id: `${teamEntryId}-squad`, status: 'draft' },
    players: [{
      rosterPlayerId: `${teamEntryId.slice(0, -1)}9`,
      displayName: `Arquero ${teamName}`,
      shirtNumber: 1,
      position: 'ARQ',
      isGoalkeeper: true,
      availability: 'available',
      selection: null,
    }],
  });
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
        status: 'scheduled',
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
        matchNumber: 1,
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        planningStatus: 'scheduled',
        homeName: 'Napoli',
        awayName: 'Belgrano',
        homeTeamEntryId: HOME,
        awayTeamEntryId: AWAY,
        operationId,
        operationStatus: operationId ? operationStatus : null,
      }],
    }),
    loadMatchOperation: jest.fn().mockResolvedValue({
      operation: {
        id: OPERATION,
        organization_id: ORG,
        tournament_id: TOURNAMENT,
        category_id: CATEGORY,
        operation_version: 1,
        status: operationStatus,
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
    loadMatchSquad: jest.fn(({ teamEntryId }) => Promise.resolve(
      squad(teamEntryId, teamEntryId === HOME ? 'Napoli' : 'Belgrano'),
    )),
    saveMatchSquad: jest.fn().mockResolvedValue({}),
    submitMatchSquad: jest.fn().mockResolvedValue({}),
    loadPlayerMatches: jest.fn().mockResolvedValue([]),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
}

function renderSquads(service) {
  return render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/partidos/${MATCH}/convocatorias`]}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('convocatoria de un partido con acta', () => {
  test('partido OFICIAL: Guardar borrador y Presentar deshabilitados, con la explicación correcta', async () => {
    const service = createService({ operationStatus: 'official' });
    renderSquads(service);
    const save = await screen.findByRole('button', { name: /Guardar borrador/ });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: /Presentar/ })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent(SQUAD_OFFICIAL_LOCK_MESSAGE);
    expect(save).toHaveAccessibleDescription(SQUAD_OFFICIAL_LOCK_MESSAGE);
    expect(screen.queryByText(/programación/)).not.toBeInTheDocument();
    // Nothing in the squad is editable either.
    expect(await screen.findByRole('button', { name: /Arquero Napoli/ })).toBeDisabled();
    fireEvent.click(save);
    expect(service.saveMatchSquad).not.toHaveBeenCalled();
  });

  test('acta abierta en borrador: también bloqueada, con la copy del acta abierta', async () => {
    const service = createService({ operationStatus: 'draft' });
    renderSquads(service);
    expect(await screen.findByRole('button', { name: /Guardar borrador/ })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent(SQUAD_OPERATION_LOCK_MESSAGE);
  });

  test('sin acta: se guarda como siempre (sin permisos nuevos ni botones de más)', async () => {
    const service = createService({ operationId: null });
    renderSquads(service);
    const save = await screen.findByRole('button', { name: /Guardar borrador/ });
    expect(save).toBeEnabled();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(service.saveMatchSquad).toHaveBeenCalledTimes(1));
  });

  test('si el backend igual rechaza (dato viejo), la copy habla de la convocatoria, no de programación', async () => {
    const service = createService({ operationId: null });
    service.saveMatchSquad.mockRejectedValueOnce(new TournamentWorkspaceError(
      'TORNEOS_MATCH_OPERATION_ACTIVE',
      ERROR_MESSAGES.TORNEOS_MATCH_OPERATION_ACTIVE,
    ));
    renderSquads(service);
    fireEvent.click(await screen.findByRole('button', { name: /Guardar borrador/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SQUAD_OPERATION_LOCK_MESSAGE);
    expect(alert).not.toHaveTextContent(/programación/);
  });
});
