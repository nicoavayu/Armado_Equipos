// ACCOUNT ERASURE 0021 — the gateway's dedicated erasure login: names and the only SQL an operator sends for it.
// PREPARED ONLY: nothing here connects anywhere or reads a secret. The provisioning and rotation procedure (who runs it,
// where the password lives, what never happens) is in ../README.md «Credencial de borrado».
//
// The pattern is the one of the two existing gateway logins (infra/torneos-gateway-auth, W2+W3): the migration creates a
// NOLOGIN NOINHERIT role (0021: torneos_erasure_writer, EXECUTE on the two erasure functions only); the login is created
// out of band, LOGIN NOINHERIT, with a SCRAM-SHA-256 verifier computed locally (the server never sees the plaintext), and
// made a member of that role. The gateway then runs `SET LOCAL ROLE torneos_erasure_writer` in every erasure transaction.
// Its password is separate from the adapter's and the identity writer's, and from the Core contract secret: it lives only
// in GCP Secret Manager (GCP.secret, read by the gateway's service account) as the whole postgres URL, which Cloud Run
// mounts as TORNEOS_DB_ERASURE_WRITER_URL. Never in a file, argv, env of a shell, log or evidence.
import { DB_PASSWORD_PATTERN, SCRAM_PATTERN, scramVerifier } from '../../infra/torneos-gateway-auth/gateway-auth-contract.mjs';

export const ERASURE_ROLE = 'torneos_erasure_writer';
export const ERASURE_LOGIN = 'torneos_edge_erasure_writer';
export const ERASURE_ENV = 'TORNEOS_DB_ERASURE_WRITER_URL';
export const TORNEOS_REF = 'onzpwnqxnvlgsevivngf';
export const GCP = Object.freeze({ project: 'arma2-465223', region: 'southamerica-east1', service: 'torneos-gateway',
  secret: 'torneos-gw-db-erasure-writer-url', member: 'serviceAccount:torneos-gateway-prod@arma2-465223.iam.gserviceaccount.com',
  role: 'roles/secretmanager.secretAccessor' });

const verifierOk = (verifier) => {
  if (!SCRAM_PATTERN.test(verifier ?? '')) throw new Error('verifier_shape');
  return verifier;
};

/** First provisioning (after 0021, with its own GO): one transaction, refused if the login already exists. */
export function renderProvisionSql(verifier) {
  return [
    'BEGIN;',
    "SET LOCAL statement_timeout = '30s';",
    `DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ERASURE_ROLE}' AND NOT rolcanlogin AND NOT rolinherit) THEN
    RAISE EXCEPTION 'ERASURE_ROLE_MISSING: apply 0021 first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ERASURE_LOGIN}') THEN RAISE EXCEPTION 'ERASURE_LOGIN_ALREADY_PRESENT'; END IF;
END $guard$;`,
    `CREATE ROLE ${ERASURE_LOGIN} LOGIN NOINHERIT PASSWORD '${verifierOk(verifier)}';`,
    `GRANT ${ERASURE_ROLE} TO ${ERASURE_LOGIN};`,
    'COMMIT;',
    '',
  ].join('\n');
}

/** Rotation: a new verifier for the same login (the old password stops working at COMMIT). */
export function renderRotationSql(verifier) {
  return [
    'BEGIN;',
    "SET LOCAL statement_timeout = '30s';",
    `DO $guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ERASURE_LOGIN}' AND rolcanlogin AND NOT rolinherit) THEN
    RAISE EXCEPTION 'ERASURE_LOGIN_MISSING'; END IF; END $guard$;`,
    `ALTER ROLE ${ERASURE_LOGIN} PASSWORD '${verifierOk(verifier)}';`,
    'COMMIT;',
    '',
  ].join('\n');
}

/** After a forced rollback of 0021 and a re-apply: the role is new, the login must be made its member again. */
export const REGRANT_SQL = `GRANT ${ERASURE_ROLE} TO ${ERASURE_LOGIN};\n`;

/** The skeletons the runbook and evidence may show (verifier masked). */
export const PROVISION_SQL_TEMPLATE = renderProvisionSql(`SCRAM-SHA-256$4096:${'A'.repeat(22)}==$${'A'.repeat(43)}=:${'A'.repeat(43)}=`)
  .replace(/PASSWORD 'SCRAM-SHA-256\$[^']+'/, "PASSWORD '<SCRAM-SHA-256 verifier>'");

/** A fresh password of the gateway logins' shape, and its verifier. The password goes ONLY into the Secret Manager URL. */
export function newCredential(randomBytes) {
  const password = randomBytes(30).toString('base64url');
  if (!DB_PASSWORD_PATTERN.test(password)) throw new Error('password_shape');
  return { password, verifier: scramVerifier(password) };
}

/** The value of the Secret Manager entry: the pooler URL of the login (transaction pooler, like the other two). */
export function erasureDbUrl({ poolerHost, password, port = 6543 }) {
  if (!/^aws-\d+-sa-east-1\.pooler\.supabase\.com$/.test(poolerHost)) throw new Error('pooler_host');
  if (!DB_PASSWORD_PATTERN.test(password)) throw new Error('password_shape');
  return `postgres://${ERASURE_LOGIN}.${TORNEOS_REF}:${password}@${poolerHost}:${port}/postgres`;
}
