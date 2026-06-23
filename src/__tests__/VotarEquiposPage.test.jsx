import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VotarEquiposPage from '../pages/VotarEquiposPage';
import { captureException, captureMessage } from '../utils/monitoring/sentry';

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: (...args) => mockFrom(...args),
  },
}));

jest.mock('../utils/monitoring/sentry', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('../utils/globalNoticeModal', () => ({
  showGlobalNotice: jest.fn(() => 'notice-id'),
}));

jest.mock('../components/NetworkStatus', () => {
  const React = require('react');
  return function MockNetworkStatus() {
    return React.createElement('div', { 'data-testid': 'network-status' });
  };
});

jest.mock('../pages/VotingView', () => {
  const React = require('react');
  return function MockVotingView({ partidoActual, isLoading, jugadores = [] }) {
    return React.createElement(
      'div',
      { 'data-testid': 'voting-view' },
      isLoading
        ? 'Cargando votación'
        : `Voting ready ${partidoActual?.id || ''} ${partidoActual?.codigo || ''}`,
      React.createElement(
        'ul',
        null,
        jugadores.map((jugador) => (
          React.createElement('li', { key: jugador.id || jugador.uuid || jugador.nombre }, jugador.nombre)
        )),
      ),
    );
  };
});

const noRows = { data: null, error: null };

const buildMatch = (overrides = {}) => ({
  id: 321,
  codigo: 'H03G61',
  jugadores: [],
  ...overrides,
});

const installSupabaseMock = ({
  rpcResult = noRows,
  viewCodeResult = noRows,
  directCodeResult = noRows,
  matchResult = { data: buildMatch(), error: null },
  playersResult = { data: [{ id: 7, nombre: 'Ana' }], error: null },
} = {}) => {
  mockRpc.mockResolvedValue(rpcResult);
  mockFrom.mockImplementation((table) => ({
    select: jest.fn(() => ({
      ilike: jest.fn(() => ({
        maybeSingle: jest.fn(() => Promise.resolve(
          table === 'partidos_view' ? viewCodeResult : directCodeResult,
        )),
      })),
      eq: jest.fn(() => {
        if (table === 'partidos_view') {
          return {
            single: jest.fn(() => Promise.resolve(matchResult)),
          };
        }
        if (table === 'jugadores') {
          return Promise.resolve(playersResult);
        }
        return Promise.resolve(noRows);
      }),
    })),
  }));
};

const renderVotingRoute = (initialEntry) => render(
  <MemoryRouter
    initialEntries={[initialEntry]}
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
  >
    <Routes>
      <Route path="/votar-equipos" element={<VotarEquiposPage />} />
      <Route path="/" element={<div>Inicio</div>} />
    </Routes>
  </MemoryRouter>,
);

describe('VotarEquiposPage public code resolution', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('muestra estado de partido no encontrado sin reportar a Sentry ni console.error', async () => {
    installSupabaseMock({
      rpcResult: noRows,
      viewCodeResult: noRows,
      directCodeResult: noRows,
    });

    renderVotingRoute('/votar-equipos?codigo=INVALIDO');
    consoleErrorSpy.mockClear();

    expect(await screen.findByRole('heading', { name: /No encontramos ese partido/i })).toBeInTheDocument();
    expect(screen.getByText(/Revisá el código/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Código del partido/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Buscar/i })).toBeDisabled();
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('reporta a Sentry cuando todas las consultas fallan por error real de Supabase', async () => {
    const supabaseError = { message: 'fetch failed', code: 'NETWORK_ERROR' };
    installSupabaseMock({
      rpcResult: { data: null, error: supabaseError },
      viewCodeResult: { data: null, error: supabaseError },
      directCodeResult: { data: null, error: supabaseError },
    });

    renderVotingRoute('/votar-equipos?codigo=H03G61');

    expect(await screen.findByText(/No pudimos validar el código del partido/i)).toBeInTheDocument();
    await waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        screen: 'public_voting',
        action: 'resolve_match_by_code',
        source: 'codigo',
        status: 'error',
        has_codigo: true,
        codigo_length: 6,
      }),
    );
    expect(captureMessage).not.toHaveBeenCalled();
  });

  test('mantiene el flujo válido de public voting', async () => {
    installSupabaseMock({
      rpcResult: { data: 321, error: null },
      matchResult: { data: buildMatch(), error: null },
      playersResult: { data: [{ id: 7, nombre: 'Ana' }], error: null },
    });

    renderVotingRoute('/votar-equipos?codigo=H03G61');

    await waitFor(() => {
      expect(screen.getByTestId('voting-view')).toHaveTextContent('Voting ready 321 H03G61');
    });
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  test('normaliza códigos con minúsculas y espacios antes de resolver', async () => {
    installSupabaseMock({
      rpcResult: { data: 321, error: null },
      matchResult: { data: buildMatch(), error: null },
    });

    renderVotingRoute('/votar-equipos?codigo=%20h03g61%20');

    await screen.findByTestId('voting-view');
    expect(mockRpc).toHaveBeenCalledWith('resolve_match_by_code', {
      p_codigo: 'H03G61',
    });
  });
});
