// LAB ONLY: an explicit test setting so a phone on the same Wi-Fi can use the local lab.
//
// The local-lab checks accept only loopback hosts (127.0.0.1, localhost, [::1]), and a phone cannot reach the
// development machine through its own loopback. REACT_APP_LAB_DEVICE_HOST names that machine's private IPv4
// address so those checks treat it like loopback, and only when every condition holds:
//   * the development server (NODE_ENV=development): a production build never honors it;
//   * REACT_APP_DEPLOY_ENV=development and REACT_APP_TORNEOS_DATA_ENV=local;
//   * the value is a private IPv4 literal (10/8, 172.16/12, 192.168/16) and nothing else.
// Staging and the Production enablement contract never read it.
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateIpv4(value) {
  const match = IPV4.exec(value);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const normalized = (value) => String(value || '').trim().toLowerCase();

export function resolveLabDeviceHost(env = {}) {
  if (normalized(env.NODE_ENV) !== 'development') return null;
  if (normalized(env.REACT_APP_DEPLOY_ENV) !== 'development') return null;
  if (normalized(env.REACT_APP_TORNEOS_DATA_ENV) !== 'local') return null;
  const host = String(env.REACT_APP_LAB_DEVICE_HOST || '').trim();
  return isPrivateIpv4(host) ? host : null;
}

export function isLabDeviceHost(hostname, env = {}) {
  const host = resolveLabDeviceHost(env);
  return Boolean(host) && String(hostname || '') === host;
}
