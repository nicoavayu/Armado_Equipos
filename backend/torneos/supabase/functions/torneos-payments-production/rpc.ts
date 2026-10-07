// torneos-payments-production/rpc.ts — the complete database surface of the PRODUCTION payments service.
//
// The service reaches PostgreSQL through its own LOGIN, a NOINHERIT member of torneos_payment_production_service
// (00000000000013): EXECUTE on exactly the seven functions below, no table privilege. This allowlist is the code-side
// mirror of that grant; any other name is refused before a statement is built. It shares nothing with the TEST role
// (torneos_payment_service): the TEST functions are not reachable from here and the database refuses the reverse
// (environment isolation trigger on tournament_purchases).
export const PRODUCTION_PAYMENT_ROLE = "torneos_payment_production_service"

export const PRODUCTION_PAYMENT_RPCS: Readonly<Record<string, string>> = Object.freeze({
  get_production_provider_tournament_purchase: "public.get_production_provider_tournament_purchase($1::text)",
  record_production_tournament_purchase_preference:
    "public.record_production_tournament_purchase_preference($1::uuid, $2::text, $3::timestamptz)",
  apply_production_tournament_payment_status:
    "public.apply_production_tournament_payment_status($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::timestamptz)",
  apply_production_tournament_payment_reversal:
    "public.apply_production_tournament_payment_reversal($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::timestamptz)",
  list_production_tournament_purchases_to_reconcile: "public.list_production_tournament_purchases_to_reconcile($1::integer)",
  claim_production_tournament_purchase_check: "public.claim_production_tournament_purchase_check($1::uuid, $2::integer)",
  complete_production_tournament_purchase_check: "public.complete_production_tournament_purchase_check($1::uuid, $2::text)",
})

export type ProductionPaymentRpc = keyof typeof PRODUCTION_PAYMENT_RPCS

/** The only statement shape the service sends: one allowlisted function call, fully parameterized. */
export function productionRpcStatement(name: string): string {
  if (!Object.prototype.hasOwnProperty.call(PRODUCTION_PAYMENT_RPCS, name)) throw new Error("TORNEOS_PAYMENTS_RPC_FORBIDDEN")
  return `SELECT ${PRODUCTION_PAYMENT_RPCS[name]} AS result`
}

export interface ProductionPaymentsDb {
  call(name: ProductionPaymentRpc, args: unknown[]): Promise<unknown>
}

/** A database refusal: SQLSTATE plus the TORNEOS_* token of the message (never the message itself). */
export class DbError extends Error {
  sqlstate: string
  token: string
  constructor(sqlstate: string, token: string) {
    super(`${sqlstate} ${token}`)
    this.sqlstate = sqlstate
    this.token = token
  }
}
/** The database could not be reached or answered in time: a transient condition (503). */
export class DbUnavailable extends Error {}
