export type PaymentSimulation = "approved" | "pending" | "rejected" | "expired"

export type PurchaseProjection = {
  id: string
  organizationId: string
  tournamentId: string
  productCode: string
  provider: string
  providerEnvironment: string
  providerPreferenceId?: string | null
  externalReference: string
  status: string
  amount: number
  currency: string
  createdAt: string
  preferenceExpiresAt?: string | null
}

export type CheckoutPreference = {
  provider: string
  purchaseId: string
  checkoutUrl: string
  expiresAt: string | null
  preferenceId?: string | null
}

export interface TournamentPaymentProvider {
  readonly code: string
  createPreference(
    purchase: PurchaseProjection,
    context: PaymentPreferenceContext,
  ): Promise<CheckoutPreference>
}

export type PaymentPreferenceContext = {
  appBaseUrl: string
  notificationUrl?: string | null
}
