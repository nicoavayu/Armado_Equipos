const DEFAULT_KEY_NAME = "default"

type EnvReader = (name: string) => string | undefined
type KeyKind = "publishable" | "secret"

type NamedKeyOptions = {
  kind: KeyKind
  keysVariable: string
  legacyVariable: string
  readEnv: EnvReader
}

function sanitizedConfigurationError(kind: KeyKind) {
  return new Error(`supabase_${kind}_key_misconfigured`)
}

function readNamedKey({
  kind,
  keysVariable,
  legacyVariable,
  readEnv,
}: NamedKeyOptions): string {
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
    if (typeof key !== "string" || !key.trim()) {
      throw sanitizedConfigurationError(kind)
    }

    return key.trim()
  }

  const legacyKey = readEnv(legacyVariable)
  if (typeof legacyKey === "string" && legacyKey.trim()) {
    return legacyKey.trim()
  }

  throw sanitizedConfigurationError(kind)
}

export function getSupabasePublishableKey(
  readEnv: EnvReader = (name: string) => Deno.env.get(name),
): string {
  return readNamedKey({
    kind: "publishable",
    keysVariable: "SUPABASE_PUBLISHABLE_KEYS",
    legacyVariable: "SUPABASE_ANON_KEY",
    readEnv,
  })
}

export function getSupabaseSecretKey(
  readEnv: EnvReader = (name: string) => Deno.env.get(name),
): string {
  return readNamedKey({
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
// Modern publishable/secret keys must be sent only through apikey. Preserve an
// actual user JWT if a caller supplied one explicitly.
export function createSupabaseApiKeyOnlyFetch(
  apiKey: string,
  fetchImplementation = fetch,
): typeof fetch {
  return (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    const authorization = headers.get("Authorization")

    if (authorization && isApiKeyBearer(authorization, apiKey)) {
      headers.delete("Authorization")
    }
    headers.set("apikey", apiKey)

    return fetchImplementation(input, { ...init, headers })
  }
}
