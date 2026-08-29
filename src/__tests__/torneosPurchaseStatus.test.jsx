import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import PurchaseStatusPage from '../features/torneos/components/PurchaseStatusPage';
import {
  loadTournamentPurchase,
  simulateFakeTournamentPayment,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../features/torneos/api/tournamentWorkspaceService', () => ({
  loadTournamentPurchase: jest.fn(),
  simulateFakeTournamentPayment: jest.fn(),
}));

const ORG = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const PURCHASE = '40000000-0000-4000-8000-000000000001';

function projection(status) {
  return {
    id: PURCHASE,
    organizationId: ORG,
    seasonId: SEASON,
    tournamentId: null,
    status,
    amount: 39900,
    currency: 'ARS',
    provider: 'FAKE',
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderStatus(view = 'pending') {
  const path = `/torneos/organizacion/${ORG}/temporada/${SEASON}/plan/compra/${PURCHASE}/${
    view === 'success' ? 'exito' : view === 'failure' ? 'fallo' : 'pendiente'
  }`;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/torneos/organizacion/:organizationId/temporada/:seasonId/plan/compra/:purchaseId/pendiente"
          element={<><PurchaseStatusPage view="pending" /><LocationProbe /></>}
        />
        <Route
          path="/torneos/organizacion/:organizationId/temporada/:seasonId/plan/compra/:purchaseId/exito"
          element={<><PurchaseStatusPage view="success" /><LocationProbe /></>}
        />
        <Route
          path="/torneos/organizacion/:organizationId/temporada/:seasonId/plan/compra/:purchaseId/fallo"
          element={<><PurchaseStatusPage view="failure" /><LocationProbe /></>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('purchase status routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    simulateFakeTournamentPayment.mockResolvedValue(projection('approved'));
  });

  test('pending page only reads the backend projection', async () => {
    loadTournamentPurchase.mockResolvedValue(projection('preference_created'));
    renderStatus('pending');
    expect(await screen.findByRole('heading', { name: /esperando confirmación/i }))
      .toBeInTheDocument();
    expect(loadTournamentPurchase).toHaveBeenCalledWith({
      purchaseId: PURCHASE,
      organizationId: ORG,
      seasonId: SEASON,
      tournamentId: undefined,
    });
    expect(simulateFakeTournamentPayment).not.toHaveBeenCalled();
    expect(screen.getByText(/Premium se activa cuando recibimos la confirmación/)).toBeInTheDocument();
    expect(screen.getByText('Pago generado')).toBeInTheDocument();
    expect(screen.getByText('Prueba · sin cobro real')).toBeInTheDocument();
    expect(screen.getByText(/status: preference_created · provider: FAKE/)).toBeInTheDocument();
  });

  test('approved backend state redirects pending URL to canonical success', async () => {
    loadTournamentPurchase.mockResolvedValue(projection('approved'));
    renderStatus('pending');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/exito'));
    expect(await screen.findByRole('heading', { name: /Premium ya está activo/i }))
      .toBeInTheDocument();
  });

  test('rejected backend state renders failure without granting access', async () => {
    loadTournamentPurchase.mockResolvedValue(projection('rejected'));
    renderStatus('failure');
    expect(await screen.findByRole('heading', { name: /pago no fue aprobado/i }))
      .toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });

  test.each([
    ['refunded', /pago fue reembolsado/i],
    ['charged_back', /pago está en contracargo/i],
    ['expired', /solicitud venció/i],
  ])('%s is rendered only from the verified backend state', async (status, title) => {
    loadTournamentPurchase.mockResolvedValue(projection(status));
    renderStatus('failure');
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });

  test('expired session fails closed and offers a retry', async () => {
    loadTournamentPurchase.mockRejectedValue(new Error('Tu sesión venció. Volvé a iniciar sesión.'));
    renderStatus('pending');
    expect(await screen.findByText(/Tu sesión venció/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });

  test('missing or cross-season purchase fails closed', async () => {
    loadTournamentPurchase.mockRejectedValue(
      new Error('No encontramos esa compra o no tenés permiso para verla.'),
    );
    renderStatus('success');
    expect(await screen.findByText(/No encontramos esa compra/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });
});
