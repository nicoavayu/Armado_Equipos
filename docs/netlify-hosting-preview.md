# Netlify hosting trial

This branch starts from main ffaf131c. It is a hosting compatibility trial, not
the combined Core/Torneos release and not an activation of Gallery or Premium.
The existing app.arma2.com.ar domain remains on Vercel.

## Build and policy

Netlify uses netlify.toml. The prepare script generates an edge-function version
of the existing middleware policy and converts its CommonJS route allowlists to
ES modules. Changes to the expected middleware transport stop generation rather
than silently dropping the gate. Generated files are ignored and rebuilt.

The two private-access endpoints wrap the existing server handlers. Same-origin
checks, signed host-only cookies and password verification remain in those
handlers. The adapter bounds the streamed request body at 4096 bytes.

The trial carries only the existing public Core URL and public anon key. No
database password, service-role key, payment secret, or Vercel private-access
secret has been transferred. Torneos activation is disabled; do not enable sales
on this branch or use it to certify the pending gallery/payment release.

Without private-access runtime credentials, protected routes remain gated and
the password endpoint returns 503. A separately approved trial credential is
needed to test private Core navigation. Do not reuse production signing secrets.
The trial hostname also needs explicit approval in the authentication redirect
allowlist before an end-to-end OAuth test. Do not change Production Auth settings
as part of this deployment.

## Checks

Run `node --test scripts/netlify/hosting.test.mjs server/__tests__/privateWebAccess.test.mjs`
for the Netlify transport and original access policy, then `npm run lint` and
`node scripts/netlify/prepare.mjs && npm run build`.

Before declaring hosting ready, check the deployed root/private routes remain
gated, login and deep routes render the SPA, health works, anonymous private
POSTs are denied, private-login POST is unavailable without credentials, and
cross-origin POSTs remain rejected. Login completion, actual payment return,
Gallery/Premium and private Core navigation are separate pending acceptance
checks, not certified by static rendering.

## Cost

Free only. No automatic paid upgrade or extra-credit purchase is authorized.
Observed Vercel usage for ARMA2 over the last 30 days: 3.19 GB outbound and
91,988 CDN requests. At the current Netlify rates this is roughly 83 credits
before production deployments (15 each), compute, and any other consumption.
This estimate does not predict launch traffic. Free sites pause if the shared
monthly credit quota is exhausted.

## Undo

The trial does not modify DNS, the Vercel site, databases, or application stores.
Stop its builds or unpublish the Netlify trial to remove it. Keep main unchanged.
