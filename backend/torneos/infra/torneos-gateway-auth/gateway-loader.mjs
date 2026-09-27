// GATEWAY/AUTH — loads the REAL gateway sources (backend/torneos/supabase/functions) into Node for offline tests
// and the offline rehearsal. Same technique as phase3b/gateway-port.test.mjs, applied to the whole function tree:
// every .ts is transpiled (typescript, isolatedModules), relative `.ts` imports become `.mjs`, JSON import
// attributes become createRequire, `npm:jose@6.2.12` is the lab's jose 6.2.12 (the same library Deno resolves), and
// `npm:postgres@3.4.7` is whatever driver module the caller hands in (a recording stub for unit tests; the real
// postgres.js 3.4.7 from the local Deno cache behind an emulated pooler for the rehearsal). Nothing is fetched.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../../..');
export const FUNCTIONS_DIR = path.join(REPO_ROOT, 'backend/torneos/supabase/functions');
const LAB = path.join(REPO_ROOT, 'integration/torneos-core-contracts');
export const JOSE_URL = pathToFileURL(createRequire(path.join(LAB, 'package.json')).resolve('jose')).href;
const ts = (await import(pathToFileURL(path.join(REPO_ROOT, 'node_modules/typescript/lib/typescript.js')).href)).default;

export const RECORDING_POSTGRES_STUB = `export const calls = [];
export default function postgres(url, options) {
  return { url, options, begin: async (fn) => fn({ unsafe: async (q, params) => { calls.push({ q, params }); return [{ id: 'x', core_user_id: 'x' }]; } }), end: async () => {} };
}`;

async function walk(dir, rel = '') {
  const out = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...await walk(dir, r)); else out.push(r);
  }
  return out;
}

/**
 * Transpiles the function tree into a temporary directory. `postgresModule`: source text of the module that replaces
 * npm:postgres. Returns { dir, import(relPath), cleanup }.
 */
export async function loadGatewayTree({ postgresModule = RECORDING_POSTGRES_STUB } = {}) {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-gateway-auth-tree-'));
  await fs.writeFile(path.join(out, 'postgres-driver.mjs'), postgresModule);
  for (const rel of await walk(FUNCTIONS_DIR)) {
    const src = path.join(FUNCTIONS_DIR, rel);
    const dst = path.join(out, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    if (!rel.endsWith('.ts')) { await fs.copyFile(src, dst); continue; }
    const depth = rel.split(path.sep).length - 1;
    const driver = `${depth ? '../'.repeat(depth) : './'}postgres-driver.mjs`;
    let source = await fs.readFile(src, 'utf8');
    source = source.replace(/"npm:jose@6\.2\.12"/g, JSON.stringify(JOSE_URL))
      .replace(/"npm:postgres@3\.4\.7"/g, JSON.stringify(driver))
      .replace(/from "(\.{1,2}\/[\w./-]+)\.ts"/g, 'from "$1.mjs"')
      .replace(/import (\w+) from "(\.{1,2}\/[\w./-]+\.json)" with \{ type: "json" \}/g,
        'import { createRequire as __cr_$1 } from "node:module"; const $1 = __cr_$1(import.meta.url)("$2")');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true, verbatimModuleSyntax: false }, fileName: path.basename(rel) }).outputText;
    await fs.writeFile(dst.replace(/\.ts$/, '.mjs'), js);
  }
  return {
    dir: out,
    import: (rel) => import(pathToFileURL(path.join(out, rel.replace(/\.ts$/, '.mjs'))).href),
    cleanup: () => fs.rm(out, { recursive: true, force: true }),
  };
}
