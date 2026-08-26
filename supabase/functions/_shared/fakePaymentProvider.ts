import {
  type CheckoutPreference,
  type PaymentSimulation,
  type PurchaseProjection,
  type TournamentPaymentProvider,
} from "./paymentProvider.ts"

const SIMULATIONS = new Set<PaymentSimulation>([
  "approved",
  "pending",
  "rejected",
  "expired",
])

export type FakeProviderEnvironment = "local" | "qa"

export function enabledFakeProviderEnvironment(): FakeProviderEnvironment | null {
  if (Deno.env.get("FAKE_PAYMENT_ENABLED") !== "true") return null
  const environment = Deno.env.get("FAKE_PROVIDER_ENVIRONMENT")
  return environment === "local" || environment === "qa" ? environment : null
}

function baseUrl(value: string) {
  return value.replace(/\/+$/, "")
}

export const fakePaymentProvider: TournamentPaymentProvider = {
  code: "FAKE",
  createPreference(
    purchase: PurchaseProjection,
    appBaseUrl: string,
  ): CheckoutPreference {
    const purchasePath = `/torneos/organizacion/${encodeURIComponent(purchase.organizationId)}`
      + `/torneo/${encodeURIComponent(purchase.tournamentId)}/plan/compra/`
      + `${encodeURIComponent(purchase.id)}/pendiente`
    return {
      provider: "FAKE",
      purchaseId: purchase.id,
      checkoutUrl: `${baseUrl(appBaseUrl)}${purchasePath}`,
      expiresAt: purchase.preferenceExpiresAt ?? null,
    }
  },
  normalizeSimulation(value: unknown) {
    const normalized = String(value ?? "").trim().toLowerCase() as PaymentSimulation
    return SIMULATIONS.has(normalized) ? normalized : null
  },
}
