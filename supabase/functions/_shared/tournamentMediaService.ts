// supabase/functions/_shared/tournamentMediaService.ts
//
// Plumbing shared by the media signer and processor: CORS, JSON replies,
// caller identity and the error vocabulary. Kept in one place so the two
// functions cannot drift on what a 403 means or on how identity is resolved.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  createSupabaseCredentialFetch,
  getSupabasePublishableCredential,
} from "./supabaseApiKeys.ts"

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const SESSION_TOKEN_RE = /^[0-9a-f]{64}$/

export function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "*"
  const requested = request.headers.get("access-control-request-headers") ?? ""
  const required = ["content-type", "apikey", "authorization", "x-client-info"]
  const allowHeaders = Array.from(new Set(
    requested.split(",").map((header) => header.trim().toLowerCase())
      .filter(Boolean).concat(required),
  )).join(", ")
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers",
  }
}

export function jsonResponse(
  cors: Record<string, string>, status: number, payload: unknown,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

/**
 * Maps the media contract's PostgreSQL error vocabulary onto HTTP. Anything
 * unrecognised becomes a generic 500: a raw database message must never reach
 * a client, and neither must the fact that a given id exists.
 */
export function mapRpcError(message: string): { status: number; error: string } {
  const table: Array<[string, number, string]> = [
    ["TORNEOS_MEDIA_PIPELINE_NOT_READY", 503, "storage_unavailable"],
    ["TORNEOS_MEDIA_MVP_RATE_LIMITED", 429, "rate_limited"],
    ["TORNEOS_MEDIA_UPLOAD_SESSION_INVALID", 409, "upload_session_invalid"],
    ["TORNEOS_MEDIA_PROCESSING_REQUIRED", 409, "processing_required"],
    ["TORNEOS_MEDIA_DUPLICATE", 409, "duplicate_asset"],
    ["TORNEOS_MEDIA_QUOTA_EXCEEDED", 409, "quota_exceeded"],
    ["TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID", 422, "variant_payload_invalid"],
    ["TORNEOS_MEDIA_VARIANT_SLOT_INVALID", 409, "variant_slot_invalid"],
    ["TORNEOS_MEDIA_FILE_INVALID", 422, "file_invalid"],
    ["TORNEOS_MEDIA_TRANSITION_INVALID", 409, "transition_invalid"],
    ["TORNEOS_MEDIA_FORBIDDEN", 403, "forbidden"],
    ["TORNEOS_AUTH_REQUIRED", 401, "auth_required"],
  ]
  for (const [needle, status, error] of table) {
    if (message.includes(needle)) return { status, error }
  }
  return { status: 500, error: "media_service_failed" }
}

/**
 * Resolves the calling user through GoTrue. `verify_jwt = true` already makes
 * the gateway check the signature; this additionally rejects a token that was
 * revoked or belongs to a deleted user, and yields the `sub` the pipeline
 * binds every session to.
 */
export async function resolveActor(request: Request): Promise<string | null> {
  const authorization = request.headers.get("Authorization") ?? ""
  if (!/^Bearer\s+.+/i.test(authorization)) return null
  let publishable
  try {
    publishable = getSupabasePublishableCredential()
  } catch {
    return null
  }
  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", publishable.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: authorization },
      fetch: createSupabaseCredentialFetch(publishable),
    },
  })
  const { data, error } = await client.auth.getUser()
  if (error || !data?.user?.id) return null
  return data.user.id
}

/** Constant-time-ish comparison for the ops attestation secret. */
export function secretMatches(expected: string, provided: string) {
  if (!expected || expected.length !== provided.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  }
  return diff === 0
}
