// torneos-gateway/db.ts — the ONLY database access of the gateway: the Torneos project's
// own database, through two dedicated LOGIN roles that are NOINHERIT members of the
// baseline's NOLOGIN roles (torneos_identity_writer, torneos_core_adapter). Every unit of
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

/** The certified bridge upsert: same row, same identity, on every exchange. */
export async function allocateIdentity(sql: Sql, coreUserId: string): Promise<IdentityRow> {
  return await asRole(sql, "torneos_identity_writer", async (tx) => {
    const rows = await tx.unsafe(`INSERT INTO public.torneos_identity(core_user_id) VALUES ($1)
      ON CONFLICT(core_user_id) DO UPDATE SET core_user_id = EXCLUDED.core_user_id RETURNING id, core_user_id`, [coreUserId])
    return rows[0] as unknown as IdentityRow
  })
}

/** Same check as Phase 1.5/3A, through the bridge role's own read policy. */
export async function identityExists(sql: Sql, id: string, coreUserId: string): Promise<boolean> {
  return await asRole(sql, "torneos_identity_writer", async (tx) => {
    const rows = await tx.unsafe("SELECT id FROM public.torneos_identity WHERE id = $1 AND core_user_id = $2", [id, coreUserId])
    return rows.length === 1
  })
}
