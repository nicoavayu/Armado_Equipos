import { canonicalRoutes } from '../features/torneos/routing/canonicalRoutes';

const ORG = '10000000-0000-4000-8000-000000000001';
const TOURNAMENT = '30000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const PURCHASE = '40000000-0000-4000-8000-000000000001';

test('new commercial routes are season-scoped and canonical', () => {
  expect(canonicalRoutes.seasonPlan(ORG, SEASON)).toBe(
    `/torneos/organizacion/${ORG}/temporada/${SEASON}/plan`,
  );
  expect(canonicalRoutes.seasonPurchaseSuccess(ORG, SEASON, PURCHASE)).toMatch(/\/exito$/);
  expect(canonicalRoutes.seasonPurchasePending(ORG, SEASON, PURCHASE)).toMatch(/\/pendiente$/);
  expect(canonicalRoutes.seasonPurchaseFailure(ORG, SEASON, PURCHASE)).toMatch(/\/fallo$/);
  expect(canonicalRoutes.seasonPlan(ORG, SEASON)).not.toContain(TOURNAMENT);
});
