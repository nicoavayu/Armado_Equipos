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
      <span data-testid="action-error">{fixture.actionError}</span>
      <span data-testid="notice">{fixture.notice}</span>
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

  test('a failed mutation keeps the page and its data, reports the error and re-reads the data in the background', async () => {
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
    expect(await screen.findByText('freeze failed')).toBeInTheDocument();
    await waitFor(() => expect(service.loadFixtureContext).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('matches')).toHaveTextContent('persisted-match');
    expect(screen.getByTestId('action-error')).toHaveTextContent('freeze failed');
  });

  test('when the background re-read after a failed mutation fails, stale data is not kept', async () => {
    const service = {
      loadFixtureContext: jest.fn()
        .mockResolvedValueOnce({ matches: [{ id: 'persisted-match' }] })
        .mockRejectedValueOnce(new Error('reload failed')),
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

  test('a successful mutation re-reads without a full-page loading state', async () => {
    const reload = deferred();
    const service = {
      loadFixtureContext: jest.fn()
        .mockResolvedValueOnce({ matches: [{ id: 'persisted-match' }] })
        .mockReturnValueOnce(reload.promise),
      loadScheduleContext: jest.fn().mockResolvedValue({}),
      createIdempotencyKey: jest.fn(() => 'request-a'),
      freezeParticipants: jest.fn().mockResolvedValue({ ok: true }),
    };
    const statuses = [];
    function Recorder() {
      const { status } = useTorneosFixture();
      statuses.push(status);
      return null;
    }
    render(
      <MemoryRouter>
        <TorneosFixtureProvider organizationId="org-a" service={service}>
          <Harness />
          <Recorder />
        </TorneosFixtureProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('persisted-match')).toBeInTheDocument();
    statuses.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Congelar' }));
    await waitFor(() => expect(service.loadFixtureContext).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('matches')).toHaveTextContent('persisted-match');
    await act(async () => { reload.resolve({ matches: [{ id: 'fresh-match' }] }); });
    expect(await screen.findByText('fresh-match')).toBeInTheDocument();
    expect(statuses).not.toContain('loading');
    expect(screen.getByTestId('notice')).toHaveTextContent('Lista de participantes confirmada.');
  });
});
