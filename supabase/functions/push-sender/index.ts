import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type DeliveryLogRow = {
  id: string;
  user_id: string | null;
  partido_id: number | null;
  notification_type: string;
  payload_json: Record<string, unknown> | null;
  attempt_count: number;
};

type DeviceTokenRow = {
  id: string;
  token: string;
  platform: string;
  provider: string;
  is_active: boolean;
};

type FcmCredentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type ApnsCredentials = {
  teamId: string;
  keyId: string;
  privateKey: string;
  topic: string;
  useSandbox: boolean;
};

type PushProvider = "fcm" | "apns";

type PushSendResult = {
  ok: boolean;
  retryable: boolean;
  invalidToken: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  providerMessageId: string | null;
  responsePayload: Record<string, unknown> | null;
};

type SenderConfig = {
  batchLimit: number;
  maxAttempts: number;
  processingTimeoutMinutes: number;
  initialBackoffSeconds: number;
  maxBackoffSeconds: number;
};

type JwtClaims = Record<string, unknown> & {
  role?: string;
};

const OAUTH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_AUDIENCE = "https://oauth2.googleapis.com/token";
const APNS_PRODUCTION_HOST = "api.push.apple.com";
const APNS_SANDBOX_HOST = "api.sandbox.push.apple.com";
const DEFAULT_BATCH_LIMIT = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_PROCESSING_TIMEOUT_MINUTES = 20;
const DEFAULT_INITIAL_BACKOFF_SECONDS = 30;
const DEFAULT_MAX_BACKOFF_SECONDS = 3600;
const REQUIRED_JWT_ROLE = "service_role";

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;
let cachedApnsJwt: { token: string; expiresAtMs: number } | null = null;

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  const reqHeaders = req.headers.get("access-control-request-headers") ?? "";
  const required = ["content-type", "authorization", "apikey", "x-push-sender-secret"];
  const allowHeaders = Array.from(
    new Set(
      reqHeaders
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
        .concat(required),
    ),
  ).join(", ");

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers",
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function parseBearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

function decodeBase64Url(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    return atob(normalized + padding);
  } catch {
    return null;
  }
}

function parseJwtClaims(req: Request): JwtClaims | null {
  const token = parseBearerToken(req);
  if (!token) return null;

  const segments = token.split(".");
  if (segments.length < 2) return null;

  const payload = decodeBase64Url(segments[1]);
  if (!payload) return null;

  try {
    const claims = JSON.parse(payload);
    if (!claims || typeof claims !== "object") return null;
    return claims as JwtClaims;
  } catch {
    return null;
  }
}

function hasServiceRoleJwt(req: Request): boolean {
  const claims = parseJwtClaims(req);
  if (!claims) return false;

  const role = String(claims.role ?? claims["https://supabase.com/role"] ?? "").trim().toLowerCase();
  return role === REQUIRED_JWT_ROLE;
}

function readConfiguredSenderSecret(): string | null {
  const secret = String(Deno.env.get("PUSH_SENDER_SECRET") ?? "").trim();
  return secret || null;
}

function hasValidSenderSecret(req: Request, expectedSecret: string): boolean {
  const providedSecret = req.headers.get("x-push-sender-secret")?.trim() ?? "";
  return providedSecret.length > 0 && providedSecret === expectedSecret;
}

function getConfig(body: Record<string, unknown>): SenderConfig {
  const envBatchLimit = Number(Deno.env.get("PUSH_SENDER_BATCH_LIMIT") ?? DEFAULT_BATCH_LIMIT);
  const envMaxAttempts = Number(Deno.env.get("PUSH_SENDER_MAX_ATTEMPTS") ?? DEFAULT_MAX_ATTEMPTS);
  const envProcessingTimeout = Number(
    Deno.env.get("PUSH_SENDER_PROCESSING_TIMEOUT_MINUTES") ?? DEFAULT_PROCESSING_TIMEOUT_MINUTES,
  );
  const envInitialBackoff = Number(
    Deno.env.get("PUSH_SENDER_INITIAL_BACKOFF_SECONDS") ?? DEFAULT_INITIAL_BACKOFF_SECONDS,
  );
  const envMaxBackoff = Number(
    Deno.env.get("PUSH_SENDER_MAX_BACKOFF_SECONDS") ?? DEFAULT_MAX_BACKOFF_SECONDS,
  );

  const requestedLimit = Number(body.limit ?? envBatchLimit);
  const requestedMaxAttempts = Number(body.max_attempts ?? envMaxAttempts);
  const requestedTimeout = Number(body.processing_timeout_minutes ?? envProcessingTimeout);

  return {
    batchLimit: Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : DEFAULT_BATCH_LIMIT,
    maxAttempts: Number.isFinite(requestedMaxAttempts)
      ? Math.max(1, Math.min(requestedMaxAttempts, 10))
      : DEFAULT_MAX_ATTEMPTS,
    processingTimeoutMinutes: Number.isFinite(requestedTimeout)
      ? Math.max(1, Math.min(requestedTimeout, 120))
      : DEFAULT_PROCESSING_TIMEOUT_MINUTES,
    initialBackoffSeconds: Number.isFinite(envInitialBackoff)
      ? Math.max(5, Math.min(envInitialBackoff, 3600))
      : DEFAULT_INITIAL_BACKOFF_SECONDS,
    maxBackoffSeconds: Number.isFinite(envMaxBackoff)
      ? Math.max(30, Math.min(envMaxBackoff, 86400))
      : DEFAULT_MAX_BACKOFF_SECONDS,
  };
}

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveTokenProvider(tokenRow: DeviceTokenRow): PushProvider | null {
  const provider = String(tokenRow.provider || "").trim().toLowerCase();
  const platform = String(tokenRow.platform || "").trim().toLowerCase();

  if (provider === "fcm") return "fcm";
  if (provider === "apns") return "apns";

  if (provider === "" || provider === "unknown") {
    if (platform === "android") return "fcm";
    if (platform === "ios") return "apns";
  }

  return null;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const raw = payload[key];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function safeString(value: unknown, maxLen = 500): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, maxLen);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value).slice(0, maxLen);
  } catch {
    return "";
  }
}

function defaultTitleForType(type: string): string {
  switch ((type || "").toLowerCase()) {
    case "match_invite":
      return "Invitacion al partido";
    case "match_cancelled":
      return "Partido cancelado";
    case "match_reminder_1h":
      return "Recordatorio de partido";
    case "survey_start":
    case "survey_reminder":
    case "survey_finished":
      return "Actualizacion de encuesta";
    default:
      return "Nueva notificacion";
  }
}

function buildPushMessage(row: DeliveryLogRow) {
  const payload = row.payload_json && typeof row.payload_json === "object"
    ? row.payload_json
    : {};

  const title = readString(payload, "title") ?? defaultTitleForType(row.notification_type);
  const body = readString(payload, "message") ?? readString(payload, "body") ?? "Tenes una actualizacion nueva.";

  const data: Record<string, string> = {
    notification_type: safeString(row.notification_type, 120),
    delivery_log_id: safeString(row.id, 80),
  };

  if (row.partido_id !== null && row.partido_id !== undefined) {
    data.partido_id = String(row.partido_id);
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!key || key in data) continue;
    const normalized = safeString(value, 600);
    if (!normalized) continue;
    data[key] = normalized;
  }

  return { title, body, data };
}

function clampErrorText(input: string | null, maxLen = 700): string | null {
  if (!input) return null;
  const normalized = input.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLen);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlFromString(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

function pemToPkcs8Bytes(privateKeyPem: string): Uint8Array {
  const cleaned = privateKeyPem
    .replace(/\\n/g, "\n")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function signJwtAssertion(unsignedToken: string, privateKeyPem: string): Promise<string> {
  const pkcs8Bytes = pemToPkcs8Bytes(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );

  return base64UrlFromBytes(new Uint8Array(signature));
}

async function signJwtAssertionEs256(unsignedToken: string, privateKeyPem: string): Promise<string> {
  const pkcs8Bytes = pemToPkcs8Bytes(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );

  return base64UrlFromBytes(new Uint8Array(signature));
}

function parseServiceAccount(): FcmCredentials {
  const rawJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    const projectId = String(parsed?.project_id ?? "").trim();
    const clientEmail = String(parsed?.client_email ?? "").trim();
    const privateKey = String(parsed?.private_key ?? "").trim();

    if (projectId && clientEmail && privateKey) {
      return { projectId, clientEmail, privateKey };
    }
  }

  const projectId = String(Deno.env.get("FCM_PROJECT_ID") ?? "").trim();
  const clientEmail = String(Deno.env.get("FCM_CLIENT_EMAIL") ?? "").trim();
  const privateKey = String(Deno.env.get("FCM_PRIVATE_KEY") ?? "").trim();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("missing_fcm_credentials");
  }

  return { projectId, clientEmail, privateKey };
}

function parseApnsCredentials(): ApnsCredentials {
  const teamId = String(Deno.env.get("APNS_TEAM_ID") ?? "").trim();
  const keyId = String(Deno.env.get("APNS_KEY_ID") ?? "").trim();
  const privateKey = String(Deno.env.get("APNS_PRIVATE_KEY") ?? "").trim();
  const topic = String(Deno.env.get("APNS_TOPIC") ?? "").trim()
    || String(Deno.env.get("IOS_BUNDLE_ID") ?? "").trim();
  const useSandbox = parseBooleanEnv(Deno.env.get("APNS_USE_SANDBOX"), false);

  if (!teamId || !keyId || !privateKey || !topic) {
    throw new Error("missing_apns_credentials");
  }

  return {
    teamId,
    keyId,
    privateKey,
    topic,
    useSandbox,
  };
}

async function getFcmAccessToken(credentials: FcmCredentials): Promise<string> {
  const nowMs = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAtMs > nowMs + 60_000) {
    return cachedAccessToken.token;
  }

  const nowSec = Math.floor(nowMs / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: credentials.clientEmail,
    sub: credentials.clientEmail,
    aud: OAUTH_AUDIENCE,
    scope: OAUTH_SCOPE,
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const unsigned = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(payload))}`;
  const signature = await signJwtAssertion(unsigned, credentials.privateKey);
  const assertion = `${unsigned}.${signature}`;

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);

  const tokenRes = await fetch(OAUTH_AUDIENCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  const tokenJson = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok) {
    throw new Error(`fcm_oauth_failed:${tokenRes.status}:${safeString(tokenJson, 300)}`);
  }

  const accessToken = String((tokenJson as Record<string, unknown>)?.access_token ?? "").trim();
  const expiresIn = Number((tokenJson as Record<string, unknown>)?.expires_in ?? 3600);

  if (!accessToken) {
    throw new Error("fcm_oauth_missing_access_token");
  }

  cachedAccessToken = {
    token: accessToken,
    expiresAtMs: nowMs + Math.max(300, expiresIn - 60) * 1000,
  };

  return accessToken;
}

async function getApnsAuthToken(credentials: ApnsCredentials): Promise<string> {
  const nowMs = Date.now();
  if (cachedApnsJwt && cachedApnsJwt.expiresAtMs > nowMs + 60_000) {
    return cachedApnsJwt.token;
  }

  const nowSec = Math.floor(nowMs / 1000);
  const header = {
    alg: "ES256",
    kid: credentials.keyId,
  };
  const payload = {
    iss: credentials.teamId,
    iat: nowSec,
  };

  const unsigned = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(payload))}`;
  const signature = await signJwtAssertionEs256(unsigned, credentials.privateKey);
  const jwt = `${unsigned}.${signature}`;

  cachedApnsJwt = {
    token: jwt,
    expiresAtMs: nowMs + (50 * 60 * 1000),
  };

  return jwt;
}

function classifyFcmError(statusCode: number, errorCode: string | null, errorMessage: string | null) {
  const upperCode = (errorCode || "").toUpperCase();
  const msg = (errorMessage || "").toLowerCase();

  const retryable =
    statusCode === 429 ||
    statusCode >= 500 ||
    ["UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED", "ABORTED"].includes(upperCode);

  const invalidToken =
    upperCode === "UNREGISTERED" ||
    (upperCode === "INVALID_ARGUMENT" && msg.includes("registration token"));

  return { retryable, invalidToken };
}

function classifyApnsError(statusCode: number, reason: string | null) {
  const upperReason = (reason || "").trim().toUpperCase();

  const retryable =
    statusCode === 429 ||
    statusCode >= 500 ||
    ["TOOMANYREQUESTS", "INTERNALSERVERERROR", "SERVICEUNAVAILABLE", "SHUTDOWN"].includes(upperReason);

  const invalidToken =
    statusCode === 410 ||
    ["BADDEVICETOKEN", "UNREGISTERED", "DEVICETOKENNOTFORTOPIC"].includes(upperReason);

  return { retryable, invalidToken };
}

async function sendFcmToToken(
  credentials: FcmCredentials,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<PushSendResult> {
  const url = `https://fcm.googleapis.com/v1/projects/${credentials.projectId}/messages:send`;

  const payload = {
    message: {
      token,
      notification: {
        title,
        body,
      },
      data,
      android: {
        priority: "high",
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await res.text();
  const parsed = (() => {
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  if (res.ok) {
    return {
      ok: true,
      retryable: false,
      invalidToken: false,
      errorCode: null,
      errorMessage: null,
      providerMessageId: String(parsed?.name ?? "").trim() || null,
      responsePayload: parsed,
    };
  }

  const errorObject = parsed?.error as Record<string, unknown> | undefined;
  const errorCode = String(errorObject?.status ?? `HTTP_${res.status}`).trim() || `HTTP_${res.status}`;
  const errorMessage =
    String(errorObject?.message ?? responseText ?? `FCM request failed (${res.status})`).slice(0, 700) ||
    `FCM request failed (${res.status})`;

  const classified = classifyFcmError(res.status, errorCode, errorMessage);

  return {
    ok: false,
    retryable: classified.retryable,
    invalidToken: classified.invalidToken,
    errorCode,
    errorMessage,
    providerMessageId: null,
    responsePayload: parsed,
  };
}

async function sendApnsToToken(
  credentials: ApnsCredentials,
  apnsJwt: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<PushSendResult> {
  const host = credentials.useSandbox ? APNS_SANDBOX_HOST : APNS_PRODUCTION_HOST;
  const url = `https://${host}/3/device/${encodeURIComponent(token)}`;
  const payload = {
    aps: {
      alert: {
        title,
        body,
      },
      sound: "default",
    },
    ...data,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `bearer ${apnsJwt}`,
      "Content-Type": "application/json",
      "apns-topic": credentials.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await res.text();
  const parsed = (() => {
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  if (res.ok) {
    return {
      ok: true,
      retryable: false,
      invalidToken: false,
      errorCode: null,
      errorMessage: null,
      providerMessageId: res.headers.get("apns-id")?.trim() ?? null,
      responsePayload: parsed,
    };
  }

  const reason = String(parsed?.reason ?? `HTTP_${res.status}`).trim() || `HTTP_${res.status}`;
  const errorMessage =
    String(parsed?.reason ?? responseText ?? `APNS request failed (${res.status})`).slice(0, 700) ||
    `APNS request failed (${res.status})`;

  const classified = classifyApnsError(res.status, reason);

  return {
    ok: false,
    retryable: classified.retryable,
    invalidToken: classified.invalidToken,
    errorCode: reason,
    errorMessage,
    providerMessageId: res.headers.get("apns-id")?.trim() ?? null,
    responsePayload: parsed,
  };
}

function computeNextRetryAt(attemptCount: number, initialBackoffSeconds: number, maxBackoffSeconds: number): string {
  const attemptIndex = Math.max(0, attemptCount - 1);
  const seconds = Math.min(maxBackoffSeconds, initialBackoffSeconds * (2 ** attemptIndex));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function markTokenInactive(
  supabase: ReturnType<typeof createClient>,
  tokenRow: DeviceTokenRow,
  errorCode: string | null,
) {
  await supabase
    .from("device_tokens")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
      invalidated_reason: "provider_invalid_token",
      last_error_code: errorCode,
      last_error_at: new Date().toISOString(),
    })
    .eq("id", tokenRow.id);
}

async function markTokenAttempt(
  supabase: ReturnType<typeof createClient>,
  tokenRow: DeviceTokenRow,
  status: PushSendResult,
) {
  const nowIso = new Date().toISOString();
  if (status.ok) {
    await supabase
      .from("device_tokens")
      .update({
        last_seen_at: nowIso,
        updated_at: nowIso,
        last_error_code: null,
        last_error_at: null,
      })
      .eq("id", tokenRow.id);
    return;
  }

  await supabase
    .from("device_tokens")
    .update({
      updated_at: nowIso,
      last_error_code: status.errorCode,
      last_error_at: nowIso,
    })
    .eq("id", tokenRow.id);
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, reason: "method_not_allowed" }, 405, cors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, reason: "missing_supabase_env" }, 500, cors);
  }

  if (!hasServiceRoleJwt(req)) {
    return jsonResponse({ ok: false, reason: "unauthorized" }, 401, cors);
  }

  const expectedSecret = readConfiguredSenderSecret();
  if (!expectedSecret) {
    return jsonResponse({ ok: false, reason: "sender_misconfigured" }, 500, cors);
  }

  if (!hasValidSenderSecret(req, expectedSecret)) {
    return jsonResponse({ ok: false, reason: "unauthorized" }, 401, cors);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = Boolean(body?.dry_run === true);
  const workerId = String(body?.worker_id ?? "edge_push_sender").trim() || "edge_push_sender";
  const config = getConfig(body as Record<string, unknown>);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: claimedRows, error: claimError } = await supabase.rpc("claim_push_delivery_batch", {
    p_limit: config.batchLimit,
    p_worker_id: workerId,
    p_max_attempts: config.maxAttempts,
    p_processing_timeout_minutes: config.processingTimeoutMinutes,
  });

  if (claimError) {
    return jsonResponse(
      {
        ok: false,
        reason: "claim_failed",
        details: claimError.message,
      },
      500,
      cors,
    );
  }

  const logs = (claimedRows ?? []) as DeliveryLogRow[];

  if (logs.length === 0) {
    return jsonResponse(
      {
        ok: true,
        processed: 0,
        sent: 0,
        failed: 0,
        retryable_failed: 0,
      },
      200,
      cors,
    );
  }

  let fcmCredentials: FcmCredentials | null = null;
  let fcmCredentialError: string | null = null;
  let fcmAccessToken: string | null = null;
  let fcmAccessTokenError: string | null = null;
  let apnsCredentials: ApnsCredentials | null = null;
  let apnsCredentialError: string | null = null;
  let apnsAuthToken: string | null = null;
  let apnsAuthTokenError: string | null = null;

  const ensureFcmAccessToken = async () => {
    if (fcmAccessToken) {
      return { ok: true as const, accessToken: fcmAccessToken };
    }

    if (!fcmCredentials && !fcmCredentialError) {
      try {
        fcmCredentials = parseServiceAccount();
      } catch (error) {
        fcmCredentialError = (error as Error).message || "missing_fcm_credentials";
      }
    }

    if (fcmCredentialError || !fcmCredentials) {
      return {
        ok: false as const,
        retryable: false,
        errorCode: "fcm_misconfigured",
        errorMessage: clampErrorText(fcmCredentialError ?? "FCM credentials are missing"),
      };
    }

    if (!fcmAccessTokenError) {
      try {
        fcmAccessToken = await getFcmAccessToken(fcmCredentials);
      } catch (error) {
        fcmAccessTokenError = (error as Error).message || "fcm_auth_error";
      }
    }

    if (!fcmAccessToken) {
      const message = fcmAccessTokenError ?? "fcm_auth_error";
      return {
        ok: false as const,
        retryable: !message.toLowerCase().includes("missing_"),
        errorCode: "fcm_auth_error",
        errorMessage: clampErrorText(message),
      };
    }

    return { ok: true as const, accessToken: fcmAccessToken };
  };

  const ensureApnsAuthToken = async () => {
    if (apnsAuthToken) {
      return { ok: true as const, authToken: apnsAuthToken };
    }

    if (!apnsCredentials && !apnsCredentialError) {
      try {
        apnsCredentials = parseApnsCredentials();
      } catch (error) {
        apnsCredentialError = (error as Error).message || "missing_apns_credentials";
      }
    }

    if (apnsCredentialError || !apnsCredentials) {
      return {
        ok: false as const,
        retryable: false,
        errorCode: "apns_misconfigured",
        errorMessage: clampErrorText(apnsCredentialError ?? "APNS credentials are missing"),
      };
    }

    if (!apnsAuthTokenError) {
      try {
        apnsAuthToken = await getApnsAuthToken(apnsCredentials);
      } catch (error) {
        apnsAuthTokenError = (error as Error).message || "apns_auth_error";
      }
    }

    if (!apnsAuthToken) {
      const message = apnsAuthTokenError ?? "apns_auth_error";
      return {
        ok: false as const,
        retryable: !message.toLowerCase().includes("missing_"),
        errorCode: "apns_auth_error",
        errorMessage: clampErrorText(message),
      };
    }

    return { ok: true as const, authToken: apnsAuthToken };
  };

  const summary = {
    processed: 0,
    sent: 0,
    failed: 0,
    retryable_failed: 0,
    skipped: 0,
    rows: [] as Array<Record<string, unknown>>,
  };

  for (const log of logs) {
    summary.processed += 1;
    try {

      if (!log.user_id) {
        await supabase.rpc("finalize_push_delivery_attempt", {
          p_log_id: log.id,
          p_status: "failed",
          p_error_code: "missing_user_id",
          p_error_text: "Delivery log missing user_id",
          p_provider_response_json: {
            provider: "push",
            worker_id: workerId,
          },
        });
        summary.failed += 1;
        summary.rows.push({ id: log.id, status: "failed", reason: "missing_user_id" });
        continue;
      }

      const { data: tokenRows, error: tokenError } = await supabase
        .from("device_tokens")
        .select("id, token, platform, provider, is_active")
        .eq("user_id", log.user_id)
        .eq("is_active", true)
        .order("last_seen_at", { ascending: false })
        .limit(10);

      if (tokenError) {
        const status = log.attempt_count >= config.maxAttempts ? "failed" : "retryable_failed";
        const nextRetryAt =
          status === "retryable_failed"
            ? computeNextRetryAt(log.attempt_count, config.initialBackoffSeconds, config.maxBackoffSeconds)
            : null;

        await supabase.rpc("finalize_push_delivery_attempt", {
          p_log_id: log.id,
          p_status: status,
          p_error_code: "token_lookup_error",
          p_error_text: tokenError.message,
          p_next_retry_at: nextRetryAt,
          p_provider_response_json: {
            provider: "push",
            worker_id: workerId,
          },
        });

        if (status === "retryable_failed") summary.retryable_failed += 1;
        else summary.failed += 1;
        summary.rows.push({ id: log.id, status, reason: "token_lookup_error" });
        continue;
      }

      const activeTokens = (tokenRows ?? []) as DeviceTokenRow[];
      if (activeTokens.length === 0) {
        await supabase.rpc("finalize_push_delivery_attempt", {
          p_log_id: log.id,
          p_status: "failed",
          p_error_code: "no_active_tokens",
          p_error_text: "No active device tokens for recipient",
          p_provider_response_json: {
            provider: "push",
            worker_id: workerId,
          },
        });
        summary.failed += 1;
        summary.rows.push({ id: log.id, status: "failed", reason: "no_active_tokens" });
        continue;
      }

      const sendableTokens = activeTokens.filter((tokenRow) => resolveTokenProvider(tokenRow) !== null);
      const unsupportedTokens = activeTokens.length - sendableTokens.length;
      const providerAttemptedCounts = sendableTokens.reduce((acc, tokenRow) => {
        const provider = resolveTokenProvider(tokenRow);
        if (provider) acc[provider] = (acc[provider] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      if (sendableTokens.length === 0) {
        await supabase.rpc("finalize_push_delivery_attempt", {
          p_log_id: log.id,
          p_status: "failed",
          p_error_code: "unsupported_provider",
          p_error_text: "No compatible provider for push sender",
          p_provider_response_json: {
            provider: "push",
            worker_id: workerId,
            token_count: activeTokens.length,
            unsupported_provider_count: unsupportedTokens,
          },
        });
        summary.failed += 1;
        summary.rows.push({ id: log.id, status: "failed", reason: "unsupported_provider" });
        continue;
      }

      const message = buildPushMessage(log);

      if (dryRun) {
        await supabase.rpc("finalize_push_delivery_attempt", {
          p_log_id: log.id,
          p_status: "skipped",
          p_error_code: "dry_run",
          p_error_text: "dry_run=true",
          p_provider_response_json: {
            provider: "push",
            worker_id: workerId,
            tokens_attempted: sendableTokens.length,
            unsupported_provider_count: unsupportedTokens,
            providers_attempted: providerAttemptedCounts,
            title: message.title,
          },
        });
        summary.skipped += 1;
        summary.rows.push({ id: log.id, status: "skipped", reason: "dry_run" });
        continue;
      }

      let sentCount = 0;
      let retryableCount = 0;
      let invalidTokenCount = 0;
      let nonRetryableCount = unsupportedTokens;
      let firstProviderMessageId: string | null = null;
      const providerSentCounts: Record<string, number> = {};
      const errorCodes = new Set<string>();
      const errorMessages: string[] = [];

      if (unsupportedTokens > 0) {
        errorCodes.add("UNSUPPORTED_PROVIDER");
        errorMessages.push(`${unsupportedTokens} token(s) skipped due to unsupported provider`);
      }

      for (const tokenRow of sendableTokens) {
        const provider = resolveTokenProvider(tokenRow);
        if (!provider) continue;

        let sendRes: PushSendResult;
        if (provider === "fcm") {
          const tokenState = await ensureFcmAccessToken();
          if (!tokenState.ok) {
            sendRes = {
              ok: false,
              retryable: tokenState.retryable,
              invalidToken: false,
              errorCode: tokenState.errorCode,
              errorMessage: tokenState.errorMessage,
              providerMessageId: null,
              responsePayload: null,
            };
          } else if (!fcmCredentials) {
            sendRes = {
              ok: false,
              retryable: false,
              invalidToken: false,
              errorCode: "fcm_misconfigured",
              errorMessage: "FCM credentials unavailable after token resolution",
              providerMessageId: null,
              responsePayload: null,
            };
          } else {
            sendRes = await sendFcmToToken(
              fcmCredentials,
              tokenState.accessToken,
              tokenRow.token,
              message.title,
              message.body,
              message.data,
            );
          }
        } else {
          const tokenState = await ensureApnsAuthToken();
          if (!tokenState.ok) {
            sendRes = {
              ok: false,
              retryable: tokenState.retryable,
              invalidToken: false,
              errorCode: tokenState.errorCode,
              errorMessage: tokenState.errorMessage,
              providerMessageId: null,
              responsePayload: null,
            };
          } else if (!apnsCredentials) {
            sendRes = {
              ok: false,
              retryable: false,
              invalidToken: false,
              errorCode: "apns_misconfigured",
              errorMessage: "APNS credentials unavailable after token resolution",
              providerMessageId: null,
              responsePayload: null,
            };
          } else {
            sendRes = await sendApnsToToken(
              apnsCredentials,
              tokenState.authToken,
              tokenRow.token,
              message.title,
              message.body,
              message.data,
            );
          }
        }

        await markTokenAttempt(supabase, tokenRow, sendRes);

        if (sendRes.ok) {
          sentCount += 1;
          providerSentCounts[provider] = (providerSentCounts[provider] ?? 0) + 1;
          if (!firstProviderMessageId && sendRes.providerMessageId) {
            firstProviderMessageId = sendRes.providerMessageId;
          }
          continue;
        }

        if (sendRes.errorCode) errorCodes.add(sendRes.errorCode);
        if (sendRes.errorMessage) errorMessages.push(sendRes.errorMessage);

        if (sendRes.invalidToken) {
          invalidTokenCount += 1;
          await markTokenInactive(supabase, tokenRow, sendRes.errorCode);
        }

        if (sendRes.retryable) {
          retryableCount += 1;
        } else {
          nonRetryableCount += 1;
        }
      }

      let finalStatus: "sent" | "failed" | "retryable_failed";
      let finalErrorCode: string | null = null;
      let finalErrorText: string | null = null;
      let nextRetryAt: string | null = null;

      if (sentCount > 0) {
        finalStatus = "sent";
        if (retryableCount > 0 || nonRetryableCount > 0) {
          finalErrorCode = "partial_delivery";
          finalErrorText = `sent=${sentCount}, failed=${retryableCount + nonRetryableCount}`;
        }
      } else if (retryableCount > 0 && log.attempt_count < config.maxAttempts) {
        finalStatus = "retryable_failed";
        finalErrorCode = "provider_retryable_error";
        finalErrorText = clampErrorText(errorMessages[0] ?? "Retryable provider error");
        nextRetryAt = computeNextRetryAt(log.attempt_count, config.initialBackoffSeconds, config.maxBackoffSeconds);
      } else {
        finalStatus = "failed";
        if (invalidTokenCount === activeTokens.length) {
          finalErrorCode = "all_tokens_invalid";
        } else {
          finalErrorCode = retryableCount > 0 ? "max_attempts_reached" : "provider_failed";
        }
        finalErrorText = clampErrorText(errorMessages[0] ?? "Push delivery failed");
      }

      await supabase.rpc("finalize_push_delivery_attempt", {
        p_log_id: log.id,
        p_status: finalStatus,
        p_error_code: finalErrorCode,
        p_error_text: finalErrorText,
        p_next_retry_at: nextRetryAt,
        p_provider_message_id: firstProviderMessageId,
        p_provider_response_json: {
          provider: "push",
          worker_id: workerId,
          token_count: activeTokens.length,
          sendable_token_count: sendableTokens.length,
          unsupported_provider_count: unsupportedTokens,
          providers_attempted: providerAttemptedCounts,
          providers_sent: providerSentCounts,
          sent_count: sentCount,
          retryable_count: retryableCount,
          non_retryable_count: nonRetryableCount,
          invalid_token_count: invalidTokenCount,
          error_codes: Array.from(errorCodes).slice(0, 10),
        },
      });

      if (finalStatus === "sent") summary.sent += 1;
      else if (finalStatus === "retryable_failed") summary.retryable_failed += 1;
      else summary.failed += 1;

      summary.rows.push({
        id: log.id,
        status: finalStatus,
        sent_count: sentCount,
        token_count: activeTokens.length,
        sendable_token_count: sendableTokens.length,
        providers_attempted: providerAttemptedCounts,
        retryable_count: retryableCount,
        invalid_token_count: invalidTokenCount,
        unsupported_provider_count: unsupportedTokens,
        attempt_count: log.attempt_count,
      });
    } catch (error) {
      const status = log.attempt_count >= config.maxAttempts ? "failed" : "retryable_failed";
      const nextRetryAt =
        status === "retryable_failed"
          ? computeNextRetryAt(log.attempt_count, config.initialBackoffSeconds, config.maxBackoffSeconds)
          : null;

      await supabase.rpc("finalize_push_delivery_attempt", {
        p_log_id: log.id,
        p_status: status,
        p_error_code: "sender_runtime_error",
        p_error_text: clampErrorText((error as Error)?.message ?? "Unexpected sender error"),
        p_next_retry_at: nextRetryAt,
        p_provider_response_json: {
          provider: "push",
          worker_id: workerId,
          crashed: true,
        },
      });

      if (status === "retryable_failed") summary.retryable_failed += 1;
      else summary.failed += 1;
      summary.rows.push({
        id: log.id,
        status,
        reason: "sender_runtime_error",
      });
    }
  }

  return jsonResponse(
    {
      ok: true,
      dry_run: dryRun,
      config,
      ...summary,
    },
    200,
    cors,
  );
});
