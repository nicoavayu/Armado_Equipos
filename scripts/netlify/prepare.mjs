import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Generate from the existing Vercel policy instead of maintaining a second
// allowlist. Abort if its transport contract changes; never silently drop it.
export function prepare(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) {
  const destination = path.join(root, '.netlify-generated');
  fs.mkdirSync(path.join(destination, 'edge-functions'), { recursive: true });
  fs.mkdirSync(path.join(destination, 'server'), { recursive: true });
  fs.mkdirSync(path.join(destination, 'config'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server/privateWebAccess.mjs'), path.join(destination, 'server/privateWebAccess.mjs'));
  for (const name of ['publicVotingRoutes', 'publicMatchInviteRoutes']) {
    const source = fs.readFileSync(path.join(root, `src/config/${name}.js`), 'utf8');
    if ((source.match(/module\.exports =/g) || []).length !== 1) throw new Error(`Unexpected ${name} module format`);
    fs.writeFileSync(path.join(destination, `config/${name}.mjs`), source.replace('module.exports =', 'export default'));
  }
  let source = fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8');
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error(`Web gate transport changed: ${before}`);
    source = source.replace(before, after);
  };
  replace("import { next, rewrite } from '@vercel/functions';\n", '');
  replace("'./server/privateWebAccess.mjs'", "'../server/privateWebAccess.mjs'");
  replace("'./src/config/publicVotingRoutes.js'", "'../config/publicVotingRoutes.mjs'");
  replace("'./src/config/publicMatchInviteRoutes.js'", "'../config/publicMatchInviteRoutes.mjs'");
  replace('privateWebGate(request) {', `privateWebGate(request, context) {
  const next = async () => {
    const response = await context.next();
    return new Response(response.body, response);
  };
  const rewrite = async (target) => {
    const response = await context.next(new Request(target, {
      method: request.method, headers: request.headers,
    }));
    return new Response(response.body, response);
  };`);
  replace("process.env.PRIVATE_WEB_ACCESS_SIGNING_SECRET || ''", "globalThis.Netlify?.env?.get('PRIVATE_WEB_ACCESS_SIGNING_SECRET') || ''");
  source = source.replaceAll('withGateSecurityHeaders(rewrite(', 'withGateSecurityHeaders(await rewrite(')
    .replaceAll('withGateSecurityHeaders(next())', 'withGateSecurityHeaders(await next())');
  replace("matcher: '/:path*',", "path: '/*',\n  onError: 'fail',");
  fs.writeFileSync(path.join(destination, 'edge-functions/private-web-gate.js'), source);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepare();
