import { isArma2NativeRuntime } from '../../../utils/runtimePlatform';

// The store apps are a free companion of the paid web tool (Apple App Review 3.1.1 / 3.1.3(f), Google Play Payments
// «consumption-only»): inside the native shells there is no price, no purchase, no «Ver Premium», no FREE vs PREMIUM
// sales table and no link or call to action towards a purchase anywhere else. What a season already has keeps working:
// capabilities come from the server's entitlements, never from this guard, which only hides selling.
//
// One rule for every call site (PremiumUpsell, PremiumFeatureGate, PlanExperiencePage, …): the runtime is native.
export function isNativeCommerceBlocked({ isNative = isArma2NativeRuntime() } = {}) {
  return isNative === true;
}

// Neutral, informative copy for a Premium-only function inside the app: it states a fact and points nowhere.
export const NATIVE_PREMIUM_NOTICE = 'Disponible con Premium.';

export function nativePremiumNotice(feature) {
  const name = String(feature || '').trim();
  return name ? `${name}: ${NATIVE_PREMIUM_NOTICE.charAt(0).toLowerCase()}${NATIVE_PREMIUM_NOTICE.slice(1)}` : NATIVE_PREMIUM_NOTICE;
}
