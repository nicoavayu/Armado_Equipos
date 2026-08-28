import {
  capturePremiumIntent,
  clearPremiumIntent,
  hasPendingPremiumIntent,
  isPremiumIntentSearch,
  withPremiumIntent,
} from '../features/torneos/domain/premiumIntent';

describe('Torneos Premium intent', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  test('captures intent and carries it through internal routes', () => {
    expect(isPremiumIntentSearch('?intent=premium')).toBe(true);
    expect(capturePremiumIntent('?intent=premium')).toBe(true);
    expect(hasPendingPremiumIntent()).toBe(true);
    expect(withPremiumIntent('/torneos/organizacion/abc/torneos')).toBe('/torneos/organizacion/abc/torneos?intent=premium');
    clearPremiumIntent();
    expect(hasPendingPremiumIntent()).toBe(false);
  });
});
