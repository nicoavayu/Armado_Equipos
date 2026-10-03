// SOCIAL-V1: the Estudio Social on the authenticated route, strictly opt-in. TORNEOS_SOCIAL_MODE absent, "" or "off"
// keeps the allowlist untouched; "on" adds exactly the three RPCs of social-v1-rpc-allowlist.json; any other value,
// or a document that is not exactly that contract, disables the gateway (fail closed, like every config fault).
// Does not load or configure commerce/payments and never touches the public route.
import socialDoc from "./social-v1-rpc-allowlist.json" with { type: "json" }

export const SOCIAL_RPCS: readonly string[] = Object.freeze([
  "get_tournament_social_studio_context",
  "get_tournament_social_snapshot",
  "authorize_tournament_social_export",
])
export class SocialConfigError extends Error {}

function contractRpcs(doc: unknown): readonly string[] {
  const features = (doc as { phase?: unknown, features?: unknown } | null)?.features
  if (!doc || typeof doc !== "object" || (doc as { phase?: unknown }).phase !== "SOCIAL-V1"
    || !features || typeof features !== "object" || Array.isArray(features)
    || Object.keys(features).join() !== "social_studio") {
    throw new SocialConfigError("social-v1 allowlist is not the SOCIAL-V1 contract")
  }
  const rpcs = (features as { social_studio?: unknown }).social_studio
  if (!Array.isArray(rpcs) || rpcs.length !== SOCIAL_RPCS.length || rpcs.some((name, i) => name !== SOCIAL_RPCS[i])) {
    throw new SocialConfigError("social-v1 allowlist must list exactly the three Social RPCs")
  }
  return SOCIAL_RPCS
}

export function withSocial(base: ReadonlySet<string>, env: Record<string, string | undefined>, doc: unknown = socialDoc): ReadonlySet<string> {
  const mode = env.TORNEOS_SOCIAL_MODE ?? "off"
  if (mode === "" || mode === "off") return new Set(base)
  if (mode !== "on") throw new SocialConfigError("TORNEOS_SOCIAL_MODE must be on or off")
  const rpcs = contractRpcs(doc)
  if (rpcs.some((name) => base.has(name))) throw new SocialConfigError("social-v1 RPCs must not be enabled by another contract")
  return new Set([...base, ...rpcs])
}
