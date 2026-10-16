// torneos-gateway/db.ts — the ONLY database access of the gateway: the Torneos project's
// own database, through dedicated LOGIN roles that are NOINHERIT members of NOLOGIN roles
// (torneos_identity_writer, torneos_core_adapter; and, for the account erasure only,
// torneos_erasure_writer of migration 0021, through its own third login). Every unit of
// work is one transaction that begins with SET LOCAL ROLE, exactly like the Node gateway
// (pg.Pool + BEGIN / SET LOCAL ROLE / COMMIT). No Core database is ever reachable from here.
//
// postgres.js (npm:postgres) is the driver Supabase documents for Edge Functions. Named
// prepared statements are disabled so the same code works behind Supavisor's transaction
// pooler; statement_timeout is set per transaction because a pooler may drop startup
// options.
import postgres from "npm:postgres@3.4.7"

export type Sql = ReturnType<typeof postgres>
export type Tx = Parameters<Parameters<Sql["begin"]>[1]>[0]

export const STATEMENT_TIMEOUT_MS = 2000
export const CONNECT_TIMEOUT_S = 2

export class DbUnavailable extends Error {}

const UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED",
  "CONNECTION_ENDED", "CONNECTION_DESTROYED", "57P01", "57P02", "57P03", "53300", "08000", "08003", "08006"])

export function isUnavailable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return error instanceof DbUnavailable || (typeof code === "string" && UNAVAILABLE_CODES.has(code))
}

export function connect(url: string, options: { sslCa?: string; max?: number } = {}): Sql {
  const parsed = new URL(url)
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("TORNEOS_DB_URL_REJECTED")
  const ssl = options.sslCa ? { ca: options.sslCa, rejectUnauthorized: true, servername: parsed.hostname } : undefined
  return postgres(url, {
    max: options.max ?? 2, prepare: false, connect_timeout: CONNECT_TIMEOUT_S, idle_timeout: 20, max_lifetime: 300,
    ssl, connection: { application_name: "torneos-gateway" }, onnotice: () => {},
  })
}

/** BEGIN; SET LOCAL ROLE <role>; SET LOCAL statement_timeout; fn; COMMIT (ROLLBACK on error). */
export async function asRole<T>(sql: Sql, role: "torneos_identity_writer" | "torneos_core_adapter", fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`)
      await tx.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
      return await fn(tx)
    })
  } catch (error) {
    if (isUnavailable(error)) throw new DbUnavailable()
    throw error
  }
}

export type IdentityRow = { id: string; core_user_id: string }

/** ACCOUNT ERASURE (0021): the Core user was erased from Torneos (tombstone); no identity is ever created for it again. */
export class AccountErased extends Error {}
export const ACCOUNT_ERASED = "TORNEOS_ACCOUNT_ERASED"

/** The certified bridge upsert: same row, same identity, on every exchange. */
export async function allocateIdentity(sql: Sql, coreUserId: string): Promise<IdentityRow> {
  try {
    return await asRole(sql, "torneos_identity_writer", async (tx) => {
      const rows = await tx.unsafe(`INSERT INTO public.torneos_identity(core_user_id) VALUES ($1)
        ON CONFLICT(core_user_id) DO UPDATE SET core_user_id = EXCLUDED.core_user_id RETURNING id, core_user_id`, [coreUserId])
      return rows[0] as unknown as IdentityRow
    })
  } catch (error) {
    // The tombstone trigger (0021): a still-valid Core JWT of an erased account never gets a Torneos identity back.
    if ((error as { message?: unknown })?.message === ACCOUNT_ERASED) throw new AccountErased()
    throw error
  }
}

/** ACCOUNT ERASURE (0021): longer bounds than an RPC (one transaction that may touch a few hundred rows), fail-fast on locks. */
export const ERASURE_STATEMENT_TIMEOUT_MS = 15000
export const ERASURE_LOCK_TIMEOUT_MS = 5000
/** The only two calls the erasure login ever makes, each as the dedicated role (never the core adapter's login or role). */
export const ERASURE_FUNCTIONS = Object.freeze({
  erase: "SELECT private.erase_tournament_account($1::uuid, $2::uuid) AS result",
  confirm: "SELECT private.confirm_tournament_account_erasure($1::uuid, $2::uuid) AS result",
})

/**
 * private.erase_tournament_account / private.confirm_tournament_account_erasure as torneos_erasure_writer, through the
 * dedicated erasure login (TORNEOS_DB_ERASURE_WRITER_URL), for a Core user id taken ONLY from Core's signed request.
 */
export async function runErasure(sql: Sql, call: keyof typeof ERASURE_FUNCTIONS, coreUserId: string, requestId: string): Promise<Record<string, unknown>> {
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE torneos_erasure_writer")
      await tx.unsafe(`SET LOCAL statement_timeout = ${ERASURE_STATEMENT_TIMEOUT_MS}`)
      await tx.unsafe(`SET LOCAL lock_timeout = ${ERASURE_LOCK_TIMEOUT_MS}`)
      const rows = await tx.unsafe(ERASURE_FUNCTIONS[call], [coreUserId, requestId])
      return rows[0].result as Record<string, unknown>
    })
  } catch (error) {
    if (isUnavailable(error)) throw new DbUnavailable()
    throw error
  }
}

/** Same check as Phase 1.5/3A, through the bridge role's own read policy. */
export async function identityExists(sql: Sql, id: string, coreUserId: string): Promise<boolean> {
  return await asRole(sql, "torneos_identity_writer", async (tx) => {
    const rows = await tx.unsafe("SELECT id FROM public.torneos_identity WHERE id = $1 AND core_user_id = $2", [id, coreUserId])
    return rows.length === 1
  })
}
