// Torneos-side client of the REAL Core contract endpoint (Phase 3A).
// Node port of the certified Phase 2A `CoreClient` (backend/torneos/phase2a/contracts.py):
// same signed transport (X-Time / X-Nonce / X-Signature, HMAC-SHA256 over
// path + "\n" + time + "\n" + nonce + "\n" + body), same 2 s timeout, 16 KiB
// request / 256 KiB response caps, closed response schemas (schemas.json), team
// echo check, 3 s freshness window and the same sanitized errors: downstream
// bodies are never surfaced, only CORE_DENIED (4xx) or CORE_UNAVAILABLE.
import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SCHEMAS = {
  ...JSON.parse(await readFile(new URL('./schemas.json', import.meta.url), 'utf8')).$defs,
  // CONNECTED-V1 (Core contract v1.2): the gateway's own schema for `my_teams`, mounted next to schemas.json.
  ...JSON.parse(await readFile(new URL('./my-teams.schema.json', import.meta.url), 'utf8')).$defs,
};

export class Denied extends Error {
  constructor(status = 403, code = 'FORBIDDEN') { super(code); this.status = status; this.code = code; }
}

function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** Same keyword subset as phase2a/schema_validation.py; any violation fails closed. */
export function validate(value, schema) {
  if (typeof schema === 'string') schema = SCHEMAS[schema];
  if (!schema) throw new Error('SCHEMA_UNKNOWN');
  if (schema.type) {
    const kinds = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!kinds.includes(kindOf(value))) throw new Error('SCHEMA_TYPE');
  }
  if ('enum' in schema && !schema.enum.includes(value)) throw new Error('SCHEMA_ENUM');
  if (kindOf(value) === 'object') {
    const keys = Object.keys(value).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...schema.required].sort())) throw new Error('SCHEMA_KEYS');
    for (const k of keys) validate(value[k], schema.properties[k]);
  } else if (kindOf(value) === 'array') {
    if (value.length > schema.maxItems) throw new Error('SCHEMA_SIZE');
    for (const v of value) validate(v, schema.items);
  } else if (typeof value === 'string') {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw new Error('SCHEMA_LENGTH');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error('SCHEMA_PATTERN');
  } else if (kindOf(value) === 'integer') {
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error('SCHEMA_RANGE');
  }
}

export const ROUTES = {
  verified_email: '/v1/verified-email',
  directory_players: '/v1/directory',
  directory_teams: '/v1/directory',
  team_snapshot: '/v1/team-snapshot',
  // CONNECTED-V1 (Core contract v1.2): the applicant's own teams and whether Core lets them register each one.
  my_teams: '/v1/my-teams',
};

export class CoreClient {
  /**
   * @param {string} baseUrl  fixed internal Core endpoint base (…/functions/v1/torneos-core-contract)
   * @param {Buffer} key      service secret shared with Core (never in the browser)
   */
  constructor(baseUrl, key, clock = () => Date.now() / 1000) {
    const parsed = new URL(baseUrl);
    // Lab-only transport: an internal hostname on the private network, never a hosted URL.
    if (parsed.protocol !== 'http:' || parsed.hostname !== 'core-api' || parsed.search || parsed.hash || parsed.username) {
      throw new Error('LOCAL_ONLY');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.key = key;
    this.clock = clock;
  }

  async call(path, request) {
    const body = Buffer.from(JSON.stringify(request));
    if (body.length > 16384) throw new Denied(400, 'INVALID_REQUEST');
    const time = String(Math.floor(this.clock()));
    const nonce = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', this.key).update(`${path}\n${time}\n${nonce}\n`).update(body).digest('hex');
    let response;
    try {
      response = await fetch(this.baseUrl + path, {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(2000),
        headers: { 'content-type': 'application/json', 'x-time': time, 'x-nonce': nonce, 'x-signature': signature },
      });
    } catch {
      throw new Denied(503, 'CORE_UNAVAILABLE');
    }
    let raw;
    try {
      raw = Buffer.from(await response.arrayBuffer());
    } catch {
      throw new Denied(503, 'CORE_UNAVAILABLE');
    }
    if (response.status !== 200) {
      // Keep the downstream body out of errors and logs.
      throw new Denied(response.status, response.status < 500 ? 'CORE_DENIED' : 'CORE_UNAVAILABLE');
    }
    try {
      if (raw.length > 262144) throw new Error('RESPONSE_TOO_LARGE');
      const result = JSON.parse(raw.toString('utf8'));
      const schema = { '/v1/verified-email': 'verifiedEmailResponse', '/v1/team-snapshot': 'teamSnapshotResponse',
        '/v1/directory': request.kind === 'players' ? 'playersResponse' : 'teamsResponse',
        '/v1/my-teams': 'myTeamsResponse' }[path];
      validate(result, schema);
      if (path === '/v1/team-snapshot' && result.core_team_id !== request.core_team_id) throw new Error('WRONG_TEAM');
      if (path !== '/v1/directory') {
        const observed = result.checked_at ?? result.captured_at;
        const age = this.clock() - observed;
        if (!(age >= 0 && age <= 3)) throw new Error('STALE_RESPONSE');
      }
      return result;
    } catch {
      throw new Denied(503, 'CORE_UNAVAILABLE');
    }
  }
}
