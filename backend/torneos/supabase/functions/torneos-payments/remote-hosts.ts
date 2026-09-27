// torneos-payments/remote-hosts.ts — MP-B1.1 R2: host policy of hosted commerce TEST, shared by the payments
// config and the gateway commerce loader (which already reuses hmac.ts from here). No I/O, no env reads.
//
//   Production markers (any of them refuses the host, whatever it is used for):
//     • the Production Supabase ref anywhere in the hostname (Core Production is that project);
//     • a Production web hostname (custom domain and the Vercel Production aliases of main);
//     • a DNS label that is, or is hyphen-joined with, live / prod / production.
//   Declared remote TEST hosts: one exact lowercase DNS name (≥ 2 labels, no port, no scheme, no wildcard, no IP
//   literal, no trailing dot, no non-routable TLD). URLs are then compared to it byte for byte — never by suffix.
export const PRODUCTION_REF = "rcyuuoaqfwcembdajcss"
export const PRODUCTION_HOSTS: ReadonlySet<string> = new Set([
  "arma2.com.ar", "app.arma2.com.ar", "www.arma2.com.ar",
  "arma2.vercel.app", "arma2-nicoavayus-projects.vercel.app", "arma2-git-main-nicoavayus-projects.vercel.app",
])
const PRODUCTION_LABEL_RE = /(?:^|-)(?:live|prod|production)(?:-|$)/
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
const HOSTNAME_RE = new RegExp(`^(?=.{4,253}$)${LABEL}(?:\\.${LABEL})+$`)
const NON_ROUTABLE_TLDS = new Set(["localhost", "invalid", "local", "internal"])

/** Why this hostname is Production, or null. Case and one trailing dot are ignored so spellings cannot hide it. */
export function productionHostProblem(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  if (host.includes(PRODUCTION_REF)) return "names the Production project"
  if (PRODUCTION_HOSTS.has(host)) return "is a Production web hostname"
  if (host.split(".").some((label) => PRODUCTION_LABEL_RE.test(label))) return "carries a live / prod / production label"
  return null
}

/** The declared remote TEST hostname, exactly as given; null when it is not one canonical public DNS name. */
export function canonicalRemoteHost(value: string): string | null {
  if (!HOSTNAME_RE.test(value)) return null
  const labels = value.split(".")
  const tld = labels[labels.length - 1]
  if (/^[0-9]+$/.test(tld) || NON_ROUTABLE_TLDS.has(tld)) return null
  return value
}
