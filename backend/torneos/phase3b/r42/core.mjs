// Core staging (GoTrue) helpers for the R4.2 matrix: dedicated QA users created and removed by
// this run only (admin API, service key held in memory, identity guard before deletion), password
// grant sessions, logout scopes. Every call is confined to the Core staging origin by guardedFetch.
import crypto from 'node:crypto';
import {CORE_ORIGIN, CORE_REF, decodeJwt, registerSecret, Stop, UUID} from './lib.mjs';

export const QA_PURPOSE = 'phase3b-r42';
export const maskEmail = (e) => String(e).replace(/^(.).*(@.*)$/, '$1***$2');
export function assertAnonKey(key) {
  if (typeof key !== 'string') throw new Stop('CORE_ANON_KEY_REQUIRED');
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) return 'publishable';
  const c = decodeJwt(key);
  if (c?.role === 'anon' && c?.ref === CORE_REF) return 'legacy-anon';
  throw new Stop('ONLY_CORE_STAGING_PUBLIC_ANON_KEY_ALLOWED');
}
export function assertServiceKey(key) {
  if (typeof key !== 'string') throw new Stop('CORE_SERVICE_KEY_REQUIRED');
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) return 'secret';
  const c = decodeJwt(key);
  if (c?.role === 'service_role' && c?.ref === CORE_REF) return 'legacy-service_role';
  throw new Stop('ONLY_CORE_STAGING_SERVICE_KEY_ALLOWED');
}

/** tag/purpose/label default to the R4.2 identifiers; R5 passes its own so its QA users are distinguishable per phase and run. */
export function coreClient({http, anonKey, serviceKey, run, tag = 'r42', purpose = QA_PURPOSE, label = 'R4.2'}) {
  if (!/^r[0-9]+$/.test(tag) || !/^phase3b-r[0-9]+$/.test(purpose)) throw new Stop('QA_TAG_INVALID');
  const auth = `${CORE_ORIGIN}/auth/v1`;
  const created = [];
  async function admin(method, suffix, body) {
    return http(`${auth}/admin/users${suffix}`, {method, headers: {apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  }
  return {
    created,
    /** Dedicated synthetic user, tagged by run; never a real or pre-existing account. */
    async createUser(role) {
      const email = `qa-${tag}-${run}-${role}-${crypto.randomUUID().slice(0, 8)}@accounts.invalid`;
      const password = crypto.randomBytes(32).toString('base64url');
      registerSecret(password);
      const r = await admin('POST', '', {email, password, email_confirm: true, app_metadata: {purpose, run}, user_metadata: {name: `QA ${label} ${role} ${run}`}});
      if (![200, 201].includes(r.status) || !UUID.test(r.body?.id ?? '') || r.body?.email !== email) throw new Stop('QA_CREATE_FAILED', `${role} ${r.status} ${JSON.stringify(r.body?.msg ?? r.body?.error_code ?? '').slice(0, 120)}`);
      const user = {role, email, emailMasked: maskEmail(email), password, coreUserId: r.body.id, sessions: []};
      created.push(user);
      return user;
    },
    /** GoTrue password grant → {accessToken, refreshToken, sessionId}. */
    async login(user) {
      const r = await http(`${auth}/token?grant_type=password`, {method: 'POST', headers: {apikey: anonKey, 'content-type': 'application/json'}, body: JSON.stringify({email: user.email, password: user.password})});
      if (r.status !== 200 || typeof r.body?.access_token !== 'string') throw new Stop('QA_LOGIN_FAILED', `${user.role} ${r.status} ${r.body?.error_code ?? r.body?.error ?? r.body?.msg ?? ''}`);
      registerSecret(r.body.access_token); if (r.body.refresh_token) registerSecret(r.body.refresh_token);
      const claims = decodeJwt(r.body.access_token) ?? {};
      if (claims.sub !== user.coreUserId || !UUID.test(claims.session_id ?? '') || claims.is_anonymous === true) throw new Stop('QA_LOGIN_CLAIMS', user.role);
      const session = {accessToken: r.body.access_token, sessionId: claims.session_id, aud: claims.aud, role: claims.role, iss: claims.iss};
      user.sessions.push(session);
      return session;
    },
    async logout(session, scope = 'local') {
      const r = await http(`${auth}/logout?scope=${scope}`, {method: 'POST', headers: {apikey: anonKey, authorization: `Bearer ${session.accessToken}`}});
      return r.status;
    },
    async userInfo(session) {
      const r = await http(`${auth}/user`, {headers: {apikey: anonKey, authorization: `Bearer ${session.accessToken}`}});
      return {status: r.status, id: r.body?.id ?? null};
    },
    /** Hard delete ONLY a user this run created, after re-reading its identity and purpose. */
    async deleteUser(user) {
      const own = await admin('GET', `/${user.coreUserId}`);
      if (own.status !== 200 || own.body?.id !== user.coreUserId || own.body?.email !== user.email || own.body?.app_metadata?.purpose !== purpose || own.body?.app_metadata?.run !== run) {
        return {deleted: false, reason: 'IDENTITY_GUARD', status: own.status};
      }
      const del = await admin('DELETE', `/${user.coreUserId}`, {should_soft_delete: false});
      const after = await admin('GET', `/${user.coreUserId}`);
      return {deleted: after.status === 404 && [200, 204].includes(del.status), deleteStatus: del.status, afterStatus: after.status};
    },
  };
}
