// torneos-payments/rpc.ts — the complete database surface of the payments service.
//
// The service reaches PostgreSQL through a dedicated LOGIN that is a NOINHERIT member of the MP-A2 role
// torneos_payment_service (00000000000002): EXECUTE on exactly the four functions below, no table
// privilege. This allowlist is the code-side mirror of that grant: any other name is refused before a
// statement is built, in particular the baseline apply_tournament_purchase_reversal (service_role only,
// different restored-after-revoked semantics) and every direct activation/grant function. The domain state
// machine lives in these RPCs; the service never duplicates it.
export const PAYMENT_SERVICE_ROLE = "torneos_payment_service"

export const PAYMENT_RPCS: Readonly<Record<string, string>> = Object.freeze({
  get_provider_tournament_purchase: "public.get_provider_tournament_purchase($1::text, $2::text, $3::text)",
  record_tournament_purchase_preference:
    "public.record_tournament_purchase_preference($1::uuid, $2::text, $3::text, $4::text, $5::timestamptz)",
  apply_verified_tournament_payment_status:
    "public.apply_verified_tournament_payment_status($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::timestamptz)",
  apply_verified_tournament_payment_reversal:
    "public.apply_verified_tournament_payment_reversal($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::timestamptz)",
})

export type PaymentRpc =
  | "get_provider_tournament_purchase"
  | "record_tournament_purchase_preference"
  | "apply_verified_tournament_payment_status"
  | "apply_verified_tournament_payment_reversal"

/** The only statement shape the service sends: one allowlisted function call, fully parameterized. */
export function rpcStatement(name: string): string {
  if (!Object.prototype.hasOwnProperty.call(PAYMENT_RPCS, name)) throw new Error("TORNEOS_PAYMENTS_RPC_FORBIDDEN")
  return `SELECT ${PAYMENT_RPCS[name]} AS result`
}

export interface PaymentsDb {
  call(name: PaymentRpc, args: unknown[]): Promise<Record<string, unknown>>
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
