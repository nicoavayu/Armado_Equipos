// supabase/functions/_shared/appleSignInRevocation.ts
//
// ACCOUNT DELETION — revoke the person's Sign in with Apple tokens (App Review 5.1.1(v); Apple TN3194). Plan:
// PLAN-FOTOS-CORE-Y-APPLE.md §2, option (b): Arma2 never stores Apple tokens, so on deletion the iOS app re-runs the
// native Apple sheet and sends a FRESH authorizationCode (single use, valid five minutes) in the delete-account body.
// Here:
//   1. client_secret = ES256 JWT built per call (kid = APPLE_SIWA_KEY_ID; iss = APPLE_SIWA_TEAM_ID;
//      sub = APPLE_SIWA_CLIENT_ID; aud = https://appleid.apple.com; exp = iat + 300), signed with WebCrypto.
//   2. POST https://appleid.apple.com/auth/token (grant_type=authorization_code; NO redirect_uri: the native iOS
//      authorization did not send one).
//   3. The returned id_token must be for us (iss, aud) and for THIS person: its `sub` must be the Apple identity of the
//      Supabase session user (auth identities). Otherwise nothing is revoked (`sub_mismatch`): nobody can revoke someone
//      else's Apple ID with a code of their own. The id_token comes straight from Apple's token endpoint over TLS in
//      answer to our authenticated request, so its claims are checked without verifying its signature (OpenID Connect
//      Core §3.1.3.7, item 6).
//   4. POST https://appleid.apple.com/auth/revoke with the refresh token (token_type_hint=refresh_token); 200 = revoked.
//
// Never blocks the deletion (TN3194: the deletion must be fulfilled even without a token) and never throws: the result
// is one of OUTCOMES and the app shows how to unlink Arma2 by hand in iPhone Settings for anything but `revoked`.
// Secrets are read by NAME from the environment (Edge Function secrets) and never logged, nor are the code or the
// tokens. Missing or unusable secrets → `not_configured`, so the code can ship before the key is loaded.

export const APPLE_ISSUER = "https://appleid.apple.com"
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"
export const CLIENT_SECRET_TTL_SECONDS = 300
export const APPLE_TIMEOUT_MS = 8000
export const SECRET_NAMES = Object.freeze(["APPLE_SIWA_TEAM_ID", "APPLE_SIWA_CLIENT_ID", "APPLE_SIWA_KEY_ID", "APPLE_SIWA_PRIVATE_KEY"])
export const OUTCOMES: readonly string[] = Object.freeze(["revoked", "no_code", "not_apple", "sub_mismatch", "failed", "not_configured"])

export type AppleRevocationOutcome = "revoked" | "no_code" | "not_apple" | "sub_mismatch" | "failed" | "not_configured"
export type AppleEnv = { get(name: string): string | undefined }
export type AppleConfig = { teamId: string; clientId: string; keyId: string; privateKey: CryptoKey }

// GoTrue's identity JSON: `id` is the provider's subject (the Apple user id), `identity_id` the row uuid; identity_data
// carries the provider claims (`sub`, and `provider_id` in recent versions). Every place the subject may be is accepted:
// an Apple `sub` ("000123.<hex>.0456") can never equal a uuid, so this never widens a match to someone else.
type Identity = { provider?: unknown; id?: unknown; provider_id?: unknown; identity_data?: { sub?: unknown; provider_id?: unknown } | null }
export type SessionUser = { identities?: Identity[] | null; app_metadata?: { provider?: unknown; providers?: unknown } | null }

const encoder = new TextEncoder()
const APPLE_ID_RE = /^[A-Z0-9]{10}$/
const CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/
const CODE_RE = /^[A-Za-z0-9._-]{10,2048}$/

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecodeToString(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** The Apple user ids (`sub`) of the session user's Apple identities. Empty when the account has no Apple identity. */
export function appleSubjectsOf(user: SessionUser | null | undefined): string[] {
  const out = new Set<string>()
  for (const identity of Array.isArray(user?.identities) ? user!.identities! : []) {
    if (identity?.provider !== "apple") continue
    for (const candidate of [identity.id, identity.provider_id, identity.identity_data?.sub, identity.identity_data?.provider_id]) {
      if (typeof candidate === "string" && candidate.trim()) out.add(candidate.trim())
    }
  }
  return [...out]
}

/** true when the account signed in with Apple at some point (identities or app_metadata). */
export function hasAppleSignIn(user: SessionUser | null | undefined): boolean {
  if (appleSubjectsOf(user).length) return true
  const meta = user?.app_metadata
  return meta?.provider === "apple" || (Array.isArray(meta?.providers) && meta!.providers.includes("apple"))
}

/** PEM (or bare base64) PKCS#8 → bytes. Accepts the literal `\n` a dashboard paste may leave. null when unusable. */
export function pkcs8FromPem(raw: string | undefined): Uint8Array | null {
  const text = String(raw ?? "").replace(/\\n/g, "\n").trim()
  if (!text) return null
  const match = text.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/)
  const body = (match ? match[1] : text).replace(/\s+/g, "")
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) return null
  try {
    return Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** The four secrets, validated and the key imported (sign only, not extractable). null → not_configured. */
export async function readAppleConfig(env: AppleEnv): Promise<AppleConfig | null> {
  const teamId = String(env.get("APPLE_SIWA_TEAM_ID") ?? "").trim()
  const clientId = String(env.get("APPLE_SIWA_CLIENT_ID") ?? "").trim()
  const keyId = String(env.get("APPLE_SIWA_KEY_ID") ?? "").trim()
  const der = pkcs8FromPem(env.get("APPLE_SIWA_PRIVATE_KEY"))
  if (!APPLE_ID_RE.test(teamId) || !APPLE_ID_RE.test(keyId) || !CLIENT_ID_RE.test(clientId) || !der) return null
  try {
    const privateKey = await crypto.subtle.importKey("pkcs8", der as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
    return { teamId, clientId, keyId, privateKey }
  } catch {
    return null
  }
}

/** The short-lived client_secret JWT (ES256; WebCrypto returns the raw r||s signature JWS expects). */
export async function buildAppleClientSecret(config: AppleConfig, nowSeconds: number): Promise<string> {
  const iat = Math.floor(nowSeconds)
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" })))
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    iss: config.teamId, iat, exp: iat + CLIENT_SECRET_TTL_SECONDS, aud: APPLE_ISSUER, sub: config.clientId,
  })))
  const signingInput = `${header}.${payload}`
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, config.privateKey, encoder.encode(signingInput)))
  return `${signingInput}.${base64UrlEncode(signature)}`
}

/** The claims of a compact JWT (no signature check: see the header, item 3). null when malformed. */
export function decodeJwtClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null
  const parts = token.split(".")
  if (parts.length !== 3) return null
  try {
    const claims = JSON.parse(base64UrlDecodeToString(parts[1]))
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null
  } catch {
    return null
  }
}

export function isPlausibleAuthorizationCode(code: unknown): code is string {
  return typeof code === "string" && CODE_RE.test(code)
}

async function postForm(fetchImpl: typeof fetch, url: string, form: Record<string, string>, timeoutMs: number): Promise<Response> {
  return await fetchImpl(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  })
}

async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel() } catch { /* nothing to free */ }
}

export type AppleRevocationOptions = {
  env: AppleEnv
  user: SessionUser | null | undefined
  authorizationCode: unknown
  fetchImpl?: typeof fetch
  clock?: () => number
  timeoutMs?: number
}

/** Exchange the fresh code and revoke (see the header). Never throws; never blocks the deletion. */
export async function revokeAppleSignIn(options: AppleRevocationOptions): Promise<AppleRevocationOutcome> {
  try {
    if (!hasAppleSignIn(options.user)) return "not_apple"
    const code = options.authorizationCode
    if (code === undefined || code === null || code === "") return "no_code"
    if (!isPlausibleAuthorizationCode(code)) return "failed"
    const subjects = appleSubjectsOf(options.user)
    if (!subjects.length) return "sub_mismatch"
    const config = await readAppleConfig(options.env)
    if (!config) return "not_configured"
    const fetchImpl = options.fetchImpl ?? fetch
    const timeoutMs = options.timeoutMs ?? APPLE_TIMEOUT_MS
    const now = options.clock ?? (() => Date.now() / 1000)

    const tokenResponse = await postForm(fetchImpl, APPLE_TOKEN_URL, {
      client_id: config.clientId,
      client_secret: await buildAppleClientSecret(config, now()),
      code,
      grant_type: "authorization_code",
    }, timeoutMs)
    if (tokenResponse.status !== 200) { await discard(tokenResponse); return "failed" }
    const tokens = await tokenResponse.json().catch(() => null) as Record<string, unknown> | null
    const claims = decodeJwtClaims(tokens?.id_token)
    if (!claims || claims.iss !== APPLE_ISSUER) return "failed"
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!aud.includes(config.clientId)) return "failed"
    if (typeof claims.sub !== "string" || !subjects.includes(claims.sub)) return "sub_mismatch"

    const refresh = typeof tokens?.refresh_token === "string" && tokens.refresh_token ? tokens.refresh_token : null
    const access = typeof tokens?.access_token === "string" && tokens.access_token ? tokens.access_token : null
    if (!refresh && !access) return "failed"
    const revokeResponse = await postForm(fetchImpl, APPLE_REVOKE_URL, {
      client_id: config.clientId,
      client_secret: await buildAppleClientSecret(config, now()),
      token: (refresh ?? access) as string,
      token_type_hint: refresh ? "refresh_token" : "access_token",
    }, timeoutMs)
    await discard(revokeResponse)
    return revokeResponse.status === 200 ? "revoked" : "failed"
  } catch {
    return "failed"
  }
}
