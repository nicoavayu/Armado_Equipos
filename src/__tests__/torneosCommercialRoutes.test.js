import { canonicalRoutes } from '../features/torneos/routing/canonicalRoutes';

const ORG = '10000000-0000-4000-8000-000000000001';
const TOURNAMENT = '30000000-0000-4000-8000-000000000001';
const PURCHASE = '40000000-0000-4000-8000-000000000001';

test('commercial routes are tournament-scoped and canonical', () => {
  expect(canonicalRoutes.tournamentPlan(ORG, TOURNAMENT)).toBe(
    `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/plan`,
  );
  expect(canonicalRoutes.tournamentPurchaseSuccess(ORG, TOURNAMENT, PURCHASE)).toMatch(/\/exito$/);
  expect(canonicalRoutes.tournamentPurchasePending(ORG, TOURNAMENT, PURCHASE)).toMatch(/\/pendiente$/);
  expect(canonicalRoutes.tournamentPurchaseFailure(ORG, TOURNAMENT, PURCHASE)).toMatch(/\/fallo$/);
});
