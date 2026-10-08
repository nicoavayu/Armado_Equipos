// torneos-gateway/token.ts — Deno port of integration/torneos-sso/token.mjs (Phase 1.5,
// mounted verbatim by the Phase 3A Node gateway). Same library (jose), same algorithm,
// same claims, same issuer/audience/TTL constants the certified baseline's
// private.current_identity_id() checks, same required-claims list, same clock tolerance.
// Nothing here is configurable on purpose: issuer/audience are baked into the baseline SQL.
import { importPKCS8, importJWK, SignJWT, jwtVerify } from "npm:jose@6.2.12"

export const ISSUER = "urn:arma2:local:identity-bridge"
export const AUDIENCE = "arma2-torneos-local"
export const TTL = 120

export type BridgeKey = { kid: string; privateKey?: string; publicKey: Record<string, unknown> }
export type BridgeConfig = { keys: BridgeKey[]; activeKid: string; trustedKids: string[] }
export type Identity = { id: string; core_user_id: string }

export const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export async function issueToken(cfg: BridgeConfig, identity: Identity, sessionId: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = cfg.keys.find((k) => k.kid === cfg.activeKid)
  if (!key?.privateKey) throw new Error("active signing key unavailable")
  return await new SignJWT({ core_user_id: identity.core_user_id, session_id: sessionId, role: "authenticated" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: key.kid })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(identity.id)
    .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + TTL).setJti(crypto.randomUUID())
    .sign(await importPKCS8(key.privateKey, "RS256"))
}

/**
 * MEDIA-V1: the same bridge token (identity, Core session, issuer, audience, TTL) for an identity the gateway has
 * ALREADY verified, plus the one claim only the gateway signs: the upload session it may write and complete
 * (migration 00000000000012, private.tournament_media_gateway_session). Never returned to a client.
 */
export async function issueMediaUploadToken(cfg: BridgeConfig, verified: { sub: string; core_user_id: string; session_id: string },
  uploadSessionId: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  if (![verified.sub, verified.core_user_id, verified.session_id, uploadSessionId].every(uuid)) throw new Error("invalid media claim")
  const key = cfg.keys.find((k) => k.kid === cfg.activeKid)
  if (!key?.privateKey) throw new Error("active signing key unavailable")
  return await new SignJWT({ core_user_id: verified.core_user_id, session_id: verified.session_id, role: "authenticated",
    torneos_media_upload_session: uploadSessionId })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: key.kid })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(verified.sub)
    .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + TTL).setJti(crypto.randomUUID())
    .sign(await importPKCS8(key.privateKey, "RS256"))
}

export type TorneosClaims = {
  sub: string; core_user_id: string; session_id: string; jti: string; role: string
  iat: number; exp: number; nbf: number; iss: string; aud: string
}

export async function verifyToken(token: string, cfg: BridgeConfig, currentDate = new Date()): Promise<TorneosClaims> {
  const { payload: p, protectedHeader: h } = await jwtVerify(token, async (header) => {
    const key = cfg.keys.find((k) => k.kid === header.kid && cfg.trustedKids.includes(k.kid))
    if (!key) throw new Error("untrusted signing key")
    return await importJWK(key.publicKey as Parameters<typeof importJWK>[0], "RS256")
  }, {
    algorithms: ["RS256"], issuer: ISSUER, audience: AUDIENCE, clockTolerance: 5, currentDate,
    requiredClaims: ["sub", "iat", "exp", "nbf", "jti", "session_id", "core_user_id", "role"],
  })
  const c = p as unknown as TorneosClaims
  if (h.typ !== "JWT" || p.aud !== AUDIENCE || c.role !== "authenticated" ||
      ![c.sub, c.core_user_id, c.session_id, c.jti].every(uuid) ||
      ![c.iat, c.exp, c.nbf].every(Number.isInteger) || c.exp - c.iat !== TTL ||
      c.nbf !== c.iat || c.iat > Math.floor(currentDate.getTime() / 1000) + 5 ||
      // MEDIA-V1: the upload-session claim is gateway-internal; a presented token never carries it.
      "torneos_media_upload_session" in p) {
    throw new Error("invalid token contract")
  }
  return c
}

/** The public half of every trusted key, for verifiers (PostgREST JWKS, hosted trust). */
export function jwks(cfg: BridgeConfig): { keys: Record<string, unknown>[] } {
  return { keys: cfg.keys.filter((k) => cfg.trustedKids.includes(k.kid)).map((k) => ({ ...k.publicKey, kid: k.kid, alg: "RS256", use: "sig" })) }
}
