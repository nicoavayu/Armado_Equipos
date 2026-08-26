export type PaymentSimulation = "approved" | "pending" | "rejected" | "expired"

export type PurchaseProjection = {
  id: string
  organizationId: string
  tournamentId: string
  provider: string
  status: string
  amount: number
  currency: string
  preferenceExpiresAt?: string | null
}

export type CheckoutPreference = {
  provider: string
  purchaseId: string
  checkoutUrl: string
  expiresAt: string | null
}

export interface TournamentPaymentProvider {
  readonly code: string
  createPreference(purchase: PurchaseProjection, appBaseUrl: string): CheckoutPreference
  normalizeSimulation(value: unknown): PaymentSimulation | null
}
