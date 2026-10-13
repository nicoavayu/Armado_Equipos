// 0018 / 0019 on the client: the season lifecycle the server states, the launch price as the only price, a late
// payment that never became Premium, and where a season deletion notice leads.
import {
  formatSeasonDeadline, normalizeSeasonLifecycle, SEASON_MEDIA_DELETION_COPY, seasonDeadlineCopy,
} from '../features/torneos/domain/seasonLifecycle';
import { seasonPurchaseSummary } from '../features/torneos/domain/premiumPurchase';
import { normalizeTournamentEntitlements } from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';
import { notificationTarget } from '../features/torneos/domain/connectedProduct';

const ACTIVE = { status: 'active', activatedAt: '2026-10-12T15:00:00Z', activationBasis: 'explicit', mediaDeadlineAt: '2027-04-12T15:00:00Z',
  mediaOpen: true, mediaReadable: true, maxMonths: 6, photosPendingDeletion: 0 };

test('the lifecycle is taken as the server sent it, and anything malformed is dropped', () => {
  expect(normalizeSeasonLifecycle(ACTIVE)).toEqual(ACTIVE);
  expect(normalizeSeasonLifecycle(null)).toBeNull();
  expect(normalizeSeasonLifecycle({ status: 'paused' })).toBeNull();
  expect(normalizeSeasonLifecycle({ ...ACTIVE, mediaDeadlineAt: 'mañana', activationBasis: 'guess', mediaOpen: 'yes' }))
    .toMatchObject({ mediaDeadlineAt: null, activationBasis: null, mediaOpen: false });
});

test('the deadline is said in Buenos Aires time, and never invented for a draft', () => {
  expect(formatSeasonDeadline('2027-04-12T15:00:00Z')).toBe('12/04/2027 a las 12:00');
  expect(formatSeasonDeadline('')).toBe('');
  expect(seasonDeadlineCopy(normalizeSeasonLifecycle(ACTIVE))).toBe('La temporada vence el 12/04/2027 a las 12:00: dura hasta 6 meses desde que la activaste.');
  expect(seasonDeadlineCopy(normalizeSeasonLifecycle({ ...ACTIVE, status: 'draft', activatedAt: null, mediaDeadlineAt: null })))
    .toBe('La temporada dura hasta 6 meses desde que la actives.');
  expect(seasonDeadlineCopy(normalizeSeasonLifecycle({ ...ACTIVE, status: 'completed', mediaOpen: false })))
    .toBe('La temporada terminó: no se suben fotos nuevas. Sus fotos y miniaturas se eliminan el 12/04/2027 a las 12:00.');
  expect(seasonDeadlineCopy(normalizeSeasonLifecycle({ ...ACTIVE, status: 'completed', mediaOpen: false, mediaReadable: false })))
    .toBe('La temporada terminó y sus fotos y miniaturas se eliminaron.');
  expect(SEASON_MEDIA_DELETION_COPY).toMatch(/Los resultados, tablas e historial se conservan\.$/);
});

test('0019: a launch price equal to the list price is a valid price (nothing to strike through)', () => {
  const payload = tournamentEntitlementsFixture({ organizationId: 'org', seasonId: 'season', tournamentId: null });
  const equal = normalizeTournamentEntitlements({ ...payload, pricing: { ...payload.pricing, listPrice: 20000, launchPrice: 20000 } },
    { organizationId: 'org', seasonId: 'season' });
  expect(equal.isTrusted).toBe(true);
  expect(equal.pricing).toMatchObject({ listPrice: 20000, launchPrice: 20000 });
  const above = normalizeTournamentEntitlements({ ...payload, pricing: { ...payload.pricing, listPrice: 20000, launchPrice: 20001 } },
    { organizationId: 'org', seasonId: 'season' });
  expect(above.isTrusted).toBe(false);
  expect(normalizeTournamentEntitlements({ ...payload, seasonLifecycle: ACTIVE }, { organizationId: 'org', seasonId: 'season' }).seasonLifecycle)
    .toEqual(ACTIVE);
});

test('0019: a payment approved after the season closed is a late payment, never Premium', () => {
  const late = { id: 'p1', status: 'approved', activationErrorCode: 'season_closed' };
  expect(seasonPurchaseSummary({ purchases: [late] })).toEqual({ kind: 'late_payment', purchase: late });
  const paid = { id: 'p2', status: 'approved', activationErrorCode: null };
  expect(seasonPurchaseSummary({ purchases: [paid] })).toEqual({ kind: 'approved', purchase: paid });
});

test('0018: a season deletion notice leads to Multimedia, where photos can still be saved', () => {
  for (const kind of ['season.media_deletion_7d', 'season.media_deletion_1d']) {
    expect(notificationTarget({ kind, audience: 'organization', organizationId: 'org-a', tournamentId: 't-1' }))
      .toBe('/torneos/organizacion/org-a/multimedia');
  }
});
