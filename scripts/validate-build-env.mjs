import { hasValue, loadBuildEnvironment } from './build-env.mjs';

const requiredVariables = [
  'REACT_APP_SUPABASE_URL',
  'REACT_APP_SUPABASE_ANON_KEY',
];

// The Torneos gateway target is optional (without it Torneos never opens outside
// the LOCAL QA stack), but when present it must be a sane, non-Production target
// distinct from the Core project: the same rule src/features/torneos/foundation/
// config.js applies at runtime, checked before the bundle exists.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function validateTorneosGatewayTarget(env = process.env) {
  const raw = String(env.REACT_APP_TORNEOS_GATEWAY_URL || '').trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return 'REACT_APP_TORNEOS_GATEWAY_URL is not a URL'; }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) return 'REACT_APP_TORNEOS_GATEWAY_URL must be https (http only on loopback)';
  if (url.username || url.password || url.search || url.hash) return 'REACT_APP_TORNEOS_GATEWAY_URL carries credentials, query or fragment';
  const productionRef = String(env.REACT_APP_PRODUCTION_PROJECT_REF || '').trim().toLowerCase();
  if (productionRef && url.hostname.toLowerCase().split('.').includes(productionRef)) return 'REACT_APP_TORNEOS_GATEWAY_URL names the Production project';
  try {
    if (url.origin === new URL(String(env.REACT_APP_SUPABASE_URL || '')).origin) return 'REACT_APP_TORNEOS_GATEWAY_URL must not be the Core project origin';
  } catch { /* the Core URL is validated by its own required check */ }
  return null;
}

// MP-A5: the Premium purchase with Mercado Pago Checkout Pro TEST exists only in the local lab dev server: a build
// never carries REACT_APP_TORNEOS_BILLING_MODE=test (or any other value). COMMERCE-PRODUCTION: the one value a build
// may carry is `production`, and only for the production deployment with PLAN READ on (the runtime additionally
// demands the production web host and an https gateway; validateTorneosGatewayTarget checks the gateway here).
export function validateTorneosBillingMode(env = process.env) {
  const mode = String(env.REACT_APP_TORNEOS_BILLING_MODE ?? '').trim();
  if (!mode) return null;
  if (mode !== 'production') return 'REACT_APP_TORNEOS_BILLING_MODE is lab-only (local dev server) except production; builds must not set it';
  if (String(env.REACT_APP_DEPLOY_ENV || '').trim().toLowerCase() !== 'production') {
    return 'REACT_APP_TORNEOS_BILLING_MODE=production is only for the production deployment (REACT_APP_DEPLOY_ENV=production)';
  }
  if (env.REACT_APP_TORNEOS_PLAN_READ_MODE !== 'on') return 'REACT_APP_TORNEOS_BILLING_MODE=production requires REACT_APP_TORNEOS_PLAN_READ_MODE=on';
  if (!String(env.REACT_APP_TORNEOS_GATEWAY_URL || '').trim().startsWith('https://')) {
    return 'REACT_APP_TORNEOS_BILLING_MODE=production requires an https REACT_APP_TORNEOS_GATEWAY_URL';
  }
  return null;
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url;
if (isMain) {
  const loadedFiles = loadBuildEnvironment();
  const missingVariables = requiredVariables.filter((name) => !hasValue(name));

  if (missingVariables.length > 0) {
    console.error(
      `Build aborted: missing required environment variables: ${missingVariables.join(', ')}`
    );
    console.error(
      `Environment files detected: ${loadedFiles.length > 0 ? loadedFiles.join(', ') : 'none'}`
    );
    process.exit(1);
  }

  const gatewayProblem = validateTorneosGatewayTarget();
  if (gatewayProblem) {
    console.error(`Build aborted: ${gatewayProblem}`);
    process.exit(1);
  }

  const billingProblem = validateTorneosBillingMode();
  if (billingProblem) {
    console.error(`Build aborted: ${billingProblem}`);
    process.exit(1);
  }

  console.log(
    `Build environment validated (${requiredVariables.map((name) => `${name}=true`).join(', ')}, REACT_APP_TORNEOS_GATEWAY_URL=${hasValue('REACT_APP_TORNEOS_GATEWAY_URL') ? 'set' : 'absent'}).`
  );
}
