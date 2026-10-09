// torneos-payments-production/db.ts — the ONLY database access of the production payments service: the Torneos
// project's database through the dedicated production LOGIN (NOINHERIT member of torneos_payment_production_service,
// 00000000000013). Every call is one transaction: SET LOCAL ROLE, a statement timeout, then exactly one allowlisted
// RPC (rpc.ts). Never service_role, never the gateway logins, never the TEST login, never a Supabase client.
// Same transport as the certified TEST service (postgres.js, unnamed statements: Supavisor transaction pooler safe).
import postgres from "npm:postgres@3.4.7"
import { DbError, DbUnavailable, PRODUCTION_PAYMENT_ROLE, type ProductionPaymentRpc, type ProductionPaymentsDb, productionRpcStatement } from "./rpc.ts"

const STATEMENT_TIMEOUT_MS = 3000
const CONNECT_TIMEOUT_S = 3
const UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED",
  "CONNECTION_ENDED", "CONNECTION_DESTROYED", "57P01", "57P02", "57P03", "57014", "53300", "08000", "08003", "08006", "40001", "40P01"])

export function createProductionPaymentsDb(url: string, sslCa: string | undefined): ProductionPaymentsDb {
  const parsed = new URL(url)
  const ssl = sslCa ? { ca: sslCa, rejectUnauthorized: true, servername: parsed.hostname } : undefined
  const sql = postgres(url, {
    max: 2, prepare: false, connect_timeout: CONNECT_TIMEOUT_S, idle_timeout: 20, max_lifetime: 300,
    ssl, connection: { application_name: "torneos-payments-production" }, onnotice: () => {},
  })
  return {
    async call(name: ProductionPaymentRpc, args: unknown[]): Promise<unknown> {
      const statement = productionRpcStatement(name)
      try {
        return await sql.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${PRODUCTION_PAYMENT_ROLE}`)
          await tx.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
          const rows = await tx.unsafe(statement, args as never[])
          const value = rows[0]?.result
          if (value === undefined || value === null || typeof value !== "object") throw new DbUnavailable()
          return value
        })
      } catch (error) {
        const code = (error as { code?: unknown })?.code
        if (error instanceof DbUnavailable || (typeof code === "string" && UNAVAILABLE_CODES.has(code))) throw new DbUnavailable()
        if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
          const token = /\bTORNEOS_[A-Z_]+/.exec(String((error as Error).message ?? ""))?.[0] ?? "DB_ERROR"
          throw new DbError(code, token)
        }
        throw new DbUnavailable()
      }
    },
  }
}
