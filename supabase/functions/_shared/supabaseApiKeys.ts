const DEFAULT_KEY_NAME = "default"

type EnvReader = (name: string) => string | undefined
type KeyKind = "publishable" | "secret"
type KeySource = "named" | "legacy"

export type SupabaseApiCredential = {
  key: string
  source: KeySource
  kind: KeyKind
}

type CredentialOptions = {
  kind: KeyKind
  keysVariable: string
  legacyVariable: string
  readEnv: EnvReader
}

function sanitizedConfigurationError(kind: KeyKind) {
  return new Error(`supabase_${kind}_key_misconfigured`)
}

function isValidNamedKey(kind: KeyKind, key: string): boolean {
  // The environment variable establishes provenance. Prefix validation only
  // rejects a contradictory named-key configuration; it never selects legacy
  // versus named behavior.
  const expectedPrefix = kind === "secret" ? "sb_secret_" : "sb_publishable_"
  return key.startsWith(expectedPrefix) && key.length > expectedPrefix.length
}

function resolveCredential({
  kind,
  keysVariable,
  legacyVariable,
  readEnv,
}: CredentialOptions): SupabaseApiCredential {
  const serializedKeys = readEnv(keysVariable)

  if (serializedKeys !== undefined) {
    let keys: unknown
    try {
      keys = JSON.parse(serializedKeys)
    } catch {
      throw sanitizedConfigurationError(kind)
    }

    if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
      throw sanitizedConfigurationError(kind)
    }

    const key = (keys as Record<string, unknown>)[DEFAULT_KEY_NAME]
    const normalizedKey = typeof key === "string" ? key.trim() : ""
    if (!normalizedKey || !isValidNamedKey(kind, normalizedKey)) {
      throw sanitizedConfigurationError(kind)
    }

    return { key: normalizedKey, source: "named", kind }
  }

  const legacyKey = readEnv(legacyVariable)
  if (typeof legacyKey === "string" && legacyKey.trim()) {
    return { key: legacyKey.trim(), source: "legacy", kind }
  }

  throw sanitizedConfigurationError(kind)
}

export function getSupabasePublishableCredential(
  readEnv: EnvReader = (name: string) => Deno.env.get(name),
): SupabaseApiCredential {
  return resolveCredential({
    kind: "publishable",
    keysVariable: "SUPABASE_PUBLISHABLE_KEYS",
    legacyVariable: "SUPABASE_ANON_KEY",
    readEnv,
  })
}

export function getSupabaseSecretCredential(
  readEnv: EnvReader = (name: string) => Deno.env.get(name),
): SupabaseApiCredential {
  return resolveCredential({
    kind: "secret",
    keysVariable: "SUPABASE_SECRET_KEYS",
    legacyVariable: "SUPABASE_SERVICE_ROLE_KEY",
    readEnv,
  })
}

function isApiKeyBearer(authorization: string, apiKey: string): boolean {
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return Boolean(match && match[1] === apiKey)
}

// supabase-js 2.49 falls back to placing the client key in Authorization.
// Named publishable/secret keys must be sent only through apikey. Legacy JWT
// keys still require Bearer when no distinct user JWT was supplied.
export function createSupabaseCredentialFetch(
  credential: SupabaseApiCredential,
  fetchImplementation = fetch,
): typeof fetch {
  return (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    const authorization = headers.get("Authorization")

    if (credential.source === "named") {
      if (authorization && isApiKeyBearer(authorization, credential.key)) {
        headers.delete("Authorization")
      }
    } else if (!authorization || isApiKeyBearer(authorization, credential.key)) {
      headers.set("Authorization", `Bearer ${credential.key}`)
    }
    headers.set("apikey", credential.key)

    return fetchImplementation(input, { ...init, headers })
  }
}
