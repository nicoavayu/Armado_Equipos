import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import PurchaseStatusPage from '../features/torneos/components/PurchaseStatusPage';
import PlanExperiencePage from '../features/torneos/components/PlanExperiencePage';
import { TorneosCompetitionProvider } from '../features/torneos/context/TorneosCompetitionContext';
import { TorneosCommerceProvider } from '../features/torneos/context/TorneosCommerceContext';
import { TorneosWorkspaceProvider } from '../features/torneos/context/TorneosWorkspaceContext';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

const organization = { id: '10000000-0000-4000-8000-000000000001', name: 'Liga', role: 'owner', capabilities: ['workspace.manage'] };
const seasonId = '20000000-0000-4000-8000-000000000001';
const base = `/torneos/organizacion/${organization.id}/temporada/${seasonId}/plan`;
const purchasePath = `${base}/compra/purchase/pendiente`;
function setup(initialPlan = 'FREE', initialStatus = 'pending', providerStatus = 'pending') {
  let plan = initialPlan;
  let status = initialStatus;
  const loadSeasonEntitlements = jest.fn(async () => tournamentEntitlementsFixture({ plan, tournamentId: null }));
  const service = {
    loadCompetitionContext: jest.fn(async () => ({ seasons: [{ id: seasonId, name: 'Temporada' }], tournaments: [], preference: { activeSeasonId: seasonId } })),
    loadSeasonEntitlements,
  };
  const commerce = {
    entitlementsAuthority: true,
    loadSeasonEntitlements,
    loadPurchase: jest.fn(async () => ({ id: 'purchase', seasonId, status, providerStatus, amount: 39900, currency: 'ARS', provider: 'MERCADO_PAGO' })),
    createCheckout: jest.fn(),
  };
  const rendered = render(<MemoryRouter initialEntries={[base]}>
    <TorneosWorkspaceProvider service={service} autoLoad={false}>
      <TorneosCompetitionProvider organizationId={organization.id} routeSeasonId={seasonId} service={service}>
        <TorneosCommerceProvider commerce={commerce}>
          <Routes>
            <Route path="/torneos/organizacion/:organizationId/temporada/:seasonId/plan" element={<><PlanExperiencePage organization={organization} /><Link to={purchasePath}>Ver compra</Link></>} />
            {['pendiente', 'exito', 'fallo'].map((suffix, index) => <Route key={suffix} path={`/torneos/organizacion/:organizationId/temporada/:seasonId/plan/compra/:purchaseId/${suffix}`} element={<PurchaseStatusPage view={['pending', 'success', 'failure'][index]} />} />)}
          </Routes>
        </TorneosCommerceProvider>
      </TorneosCompetitionProvider>
    </TorneosWorkspaceProvider>
  </MemoryRouter>);
  return { ...rendered, commerce, loadSeasonEntitlements, change(nextStatus, nextPlan) { status = nextStatus; plan = nextPlan; } };
}

async function openPurchase(initialPlan) {
  await screen.findByRole('heading', { name: `${initialPlan} · Temporada` });
  fireEvent.click(screen.getByText('Ver compra'));
  await screen.findByText('Volver al Plan');
}

test.each([
  ['pending → approved', 'FREE', 'pending', 'pending', 'approved', 'PREMIUM'],
  ['rejected attempt → approved', 'FREE', 'pending', 'rejected', 'approved', 'PREMIUM'],
  ['refund', 'PREMIUM', 'approved', 'approved', 'refunded', 'FREE'],
  ['chargeback', 'PREMIUM', 'approved', 'approved', 'charged_back', 'FREE'],
  ['restored', 'FREE', 'charged_back', 'charged_back', 'approved', 'PREMIUM'],
])('%s updates the actual Plan on client navigation', async (_, initialPlan, status, providerStatus, nextStatus, nextPlan) => {
  const app = setup(initialPlan, status, providerStatus);
  await openPurchase(initialPlan);
  app.change(nextStatus, nextPlan);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await screen.findByText(nextStatus === 'approved' ? 'Premium ya está activo' : nextStatus === 'refunded' ? 'El pago fue reembolsado' : 'El pago está en contracargo');
  fireEvent.click(screen.getByText('Volver al Plan'));
  await screen.findByRole('heading', { name: `${nextPlan} · Temporada` });
  expect(app.commerce.createCheckout).not.toHaveBeenCalled();
});

test('unchanged terminal entitlement does not loop or keep polling', async () => {
  const app = setup('PREMIUM', 'approved');
  await openPurchase('PREMIUM');
  for (let visit = 0; visit < 3; visit += 1) {
    fireEvent.click(screen.getByText('Volver al Plan'));
    await openPurchase('PREMIUM');
  }
  expect(app.loadSeasonEntitlements.mock.calls.length).toBeLessThanOrEqual(9);
  const reads = app.loadSeasonEntitlements.mock.calls.length;
  jest.useFakeTimers();
  await act(async () => { jest.advanceTimersByTime(20000); });
  expect(app.loadSeasonEntitlements).toHaveBeenCalledTimes(reads);
  app.unmount();
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('polling approval refreshes Plan without a manual status refresh', async () => {
  jest.useFakeTimers();
  const app = setup();
  await openPurchase('FREE');
  app.change('approved', 'PREMIUM');
  await act(async () => { jest.advanceTimersByTime(4000); });
  expect(screen.getByText('Premium ya está activo')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Volver al Plan'));
  expect(screen.getByRole('heading', { name: 'PREMIUM · Temporada' })).toBeInTheDocument();
  app.unmount();
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('navigation during an entitlement read keeps Plan closed until the shared read resolves', async () => {
  const app = setup();
  await openPurchase('FREE');
  let resolve;
  app.loadSeasonEntitlements.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  app.change('approved', 'PREMIUM');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Actualizar' })); });
  fireEvent.click(screen.getByText('Volver al Plan'));
  expect(screen.queryByRole('heading', { name: 'FREE · Temporada' })).not.toBeInTheDocument();
  await act(async () => { resolve(tournamentEntitlementsFixture({ plan: 'PREMIUM', tournamentId: null })); });
  expect(screen.getByRole('heading', { name: 'PREMIUM · Temporada' })).toBeInTheDocument();
});

test('a superseded purchase response cannot overwrite the newer entitlement', async () => {
  const app = setup();
  await openPurchase('FREE');
  let resolve;
  app.commerce.loadPurchase.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  app.change('approved', 'PREMIUM');
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await screen.findByText('Premium ya está activo');
  await act(async () => { resolve({ seasonId, status: 'pending' }); });
  expect(screen.getByText('Premium ya está activo')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Volver al Plan'));
  expect(screen.getByRole('heading', { name: 'PREMIUM · Temporada' })).toBeInTheDocument();
});


test('failed entitlement refresh clears the previously effective Premium', async () => {
  const app = setup('PREMIUM', 'approved');
  await openPurchase('PREMIUM');
  app.loadSeasonEntitlements.mockRejectedValue(new Error('Entitlement unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await screen.findByText('Pago aprobado · verificando Premium');
  fireEvent.click(screen.getByText('Volver al Plan'));
  expect(screen.queryByRole('heading', { name: 'PREMIUM · Temporada' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Error transitorio' })).toBeInTheDocument();
  expect(screen.queryByText('Entitlement unavailable')).not.toBeInTheDocument();
});
