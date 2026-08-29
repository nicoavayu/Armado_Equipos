import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  TorneosFixtureProvider,
  useTorneosFixture,
} from '../features/torneos/context/TorneosFixtureContext';

let mockActiveTournament = {
  id: 'tournament-a',
  categories: [{ id: 'category-a', name: 'Primera', status: 'active' }],
};

jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useTorneosCompetition: () => ({ activeTournament: mockActiveTournament }),
}));

function Harness() {
  const fixture = useTorneosFixture();
  return (
    <div>
      <span data-testid="status">{fixture.status}</span>
      <span data-testid="matches">{fixture.matches.map((match) => match.id).join(',')}</span>
      <button type="button" onClick={() => fixture.actions.freeze().catch(() => {})}>
        Congelar
      </button>
    </div>
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('TorneosFixtureContext scope isolation', () => {
  beforeEach(() => {
    mockActiveTournament = {
      id: 'tournament-a',
      categories: [{ id: 'category-a', name: 'Primera', status: 'active' }],
    };
  });

  test('never requests the new tournament with the previous tournament category', async () => {
    const service = {
      loadFixtureContext: jest.fn().mockResolvedValue({}),
      loadScheduleContext: jest.fn().mockResolvedValue({}),
    };
    const view = render(
      <MemoryRouter>
        <TorneosFixtureProvider organizationId="org-a" service={service}>
          <Harness />
        </TorneosFixtureProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(service.loadFixtureContext).toHaveBeenCalledWith(
      'org-a',
      'tournament-a',
      'category-a',
    ));

    mockActiveTournament = {
      id: 'tournament-b',
      categories: [{ id: 'category-b', name: 'Segunda', status: 'active' }],
    };
    view.rerender(
      <MemoryRouter>
        <TorneosFixtureProvider organizationId="org-a" service={service}>
          <Harness />
        </TorneosFixtureProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(service.loadFixtureContext).toHaveBeenCalledWith(
      'org-a',
      'tournament-b',
      'category-b',
    ));
    expect(service.loadFixtureContext).not.toHaveBeenCalledWith(
      'org-a',
      'tournament-b',
      'category-a',
    );
    expect(service.loadScheduleContext).not.toHaveBeenCalledWith(
      'org-a',
      'tournament-b',
      'category-a',
    );

    mockActiveTournament = {
      id: 'tournament-a',
      categories: [{ id: 'category-a', name: 'Primera', status: 'active' }],
    };
    view.rerender(
      <MemoryRouter>
        <TorneosFixtureProvider organizationId="org-a" service={service}>
          <Harness />
        </TorneosFixtureProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(service.loadScheduleContext).toHaveBeenLastCalledWith(
      'org-a',
      'tournament-a',
      'category-a',
    ));
    expect(service.loadFixtureContext).not.toHaveBeenCalledWith(
      'org-a',
      'tournament-a',
      'category-b',
    );
  });

  test('discards responses from the previous organization even if they finish last', async () => {
    const requests = new Map();
    const service = {
      loadFixtureContext: jest.fn((organizationId) => {
        const request = deferred();
        requests.set(`${organizationId}:fixture`, request);
        return request.promise;
      }),
      loadScheduleContext: jest.fn((organizationId) => {
        const request = deferred();
        requests.set(`${organizationId}:schedule`, request);
        return request.promise;
      }),
    };
    const view = render(
      <MemoryRouter>
        <TorneosFixtureProvider organizationId="org-a" service={service}>
          <Harness />
        </TorneosFixtureProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(requests.has('org-a:fixture')).toBe(true));
    view.rerender(
      <MemoryRouter>
        <TorneosFixtureProvider organizationId="org-b" service={service}>
          <Harness />
        </TorneosFixtureProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(requests.has('org-b:fixture')).toBe(true));
    await act(async () => {
      requests.get('org-b:fixture').resolve({ matches: [{ id: 'match-b' }] });
      requests.get('org-b:schedule').resolve({});
    });
    expect(await screen.findByText('match-b')).toBeInTheDocument();
    await act(async () => {
      requests.get('org-a:fixture').resolve({ matches: [{ id: 'match-a' }] });
      requests.get('org-a:schedule').resolve({});
    });
    expect(screen.getByTestId('matches')).toHaveTextContent('match-b');
    expect(screen.getByTestId('matches')).not.toHaveTextContent('match-a');
  });

  test('clears previously loaded data when a mutation fails', async () => {
    const service = {
      loadFixtureContext: jest.fn().mockResolvedValue({
        matches: [{ id: 'persisted-match' }],
      }),
      loadScheduleContext: jest.fn().mockResolvedValue({}),
      createIdempotencyKey: jest.fn(() => 'request-a'),
      freezeParticipants: jest.fn().mockRejectedValue(new Error('freeze failed')),
    };
    render(
      <MemoryRouter>
        <TorneosFixtureProvider organizationId="org-a" service={service}>
          <Harness />
        </TorneosFixtureProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('persisted-match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Congelar' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('matches')).toBeEmptyDOMElement();
  });
});
