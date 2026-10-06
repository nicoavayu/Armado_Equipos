// `npm run test:torneos:social:browser` — the Estudio Social certification the Prelaunch Quality Gate runs on every
// PR, inside `test:ci`: real Chromium, the real page and renderers, real PNG exports (SOCIAL_QA_PROFILE=ci).
//
// It installs the Chromium build @playwright/test pins (system libraries too on a Linux CI runner), compiles the
// offline fixture, runs browser-check.cjs and then reads the evidence back: a run that silently checked less than the
// contract below fails too, so the gate cannot go green by measuring nothing.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const EVIDENCE = path.join(ROOT, 'artifacts/social-studio/evidence.json');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env });
  if (result.status !== 0) {
    console.error(`SOCIAL_STUDIO_BROWSER_FAIL: ${command} ${args.join(' ')} exited ${result.status ?? result.signal}`);
    process.exit(1);
  }
}

const linuxCi = process.platform === 'linux' && Boolean(process.env.CI);
run('npx', ['playwright', 'install', ...(linuxCi ? ['--with-deps'] : []), 'chromium']);
run(process.execPath, [path.join(HERE, 'build.cjs')]);
fs.rmSync(EVIDENCE, { force: true });
// Every section, the CI profile: an inherited SOCIAL_QA_ONLY must not shrink what the gate checks.
const env = { ...process.env, SOCIAL_QA_PROFILE: 'ci' };
delete env.SOCIAL_QA_ONLY;
run(process.execPath, [path.join(HERE, 'browser-check.cjs')], env);

// ── coverage contract ──────────────────────────────────────────────────────────────────────────────────────────
const evidence = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
const failures = [];
const expect = (ok, what) => { if (!ok) failures.push(what); };
const exports = evidence.exports || [];
const checks = evidence.checks || [];
const has = (name, match = () => true) => checks.some((c) => c.name === name && match(c));

expect(evidence.profile === 'ci' && evidence.sections === 'all', 'the run did not cover every section of the CI profile');
for (const format of ['feed-4x5', 'historia-9x16']) {
  expect(exports.some((e) => e.plan === 'FREE' && e.format === format && e.previewIdentical), `FREE ${format} export identical to its preview`);
  for (const style of ['base', 'heritage', 'street', 'scoreboard', 'editorial']) {
    expect(exports.some((e) => e.plan === 'PREMIUM' && e.style === style && e.format === format && !e.viewport), `PREMIUM ${style} ${format} export`);
  }
}
for (const width of [320, 390]) {
  for (const device of ['scrollbar', 'phone']) {
    for (const plan of ['free', 'premium']) {
      expect(has('responsive', (c) => c.width === width && c.device === device && c.plan === plan), `responsive ${plan} ${width} ${device}`);
      expect(exports.some((e) => e.plan === plan.toUpperCase() && e.viewport === `${width} ${device}`), `export at ${width} ${device} (${plan})`);
    }
  }
  expect(exports.some((e) => e.viewport?.startsWith(`${width} `) && e.style === 'editorial'), `Editorial pages exported at ${width}`);
  expect(has('D2 mobile navigation symmetric, no dead body gutter', (c) => c.width === width && c.device === 'scrollbar'), `D2: mobile navigation at ${width} with a classic scrollbar`);
}
expect(has('FREE authorize payloads'), 'FREE authorization payloads (Base, three pieces, Arma2 signature)');
expect(has('FREE: Resultados keeps the chosen format (switch and refresh)'), 'D3: Resultados keeps the chosen format');
expect(has('FREE premium style previewed and locked'), 'FREE: Premium styles previewed and locked');
// Polish: FREE previews of Premium art carry the Premium veil; allowed and PREMIUM previews never do.
for (const style of ['Heritage', 'Street', 'Scoreboard', 'Editorial']) expect(has('FREE premium preview veiled', (c) => c.style === style), `FREE ${style} preview veiled`);
expect(has('FREE premium preview veiled', (c) => c.piece === 'scorers'), 'FREE Premium piece preview veiled');
expect(has('FREE allowed preview clean'), 'FREE allowed preview without the Premium veil');
expect(has('PREMIUM preview clean'), 'PREMIUM preview without the Premium veil');
// Polish: sparse tables, rounds and discipline lists start under their header in every Premium style and format.
for (const piece of ['standings', 'round_results', 'discipline']) {
  for (const format of ['feed-4x5', 'historia-9x16']) {
    for (const style of ['Heritage', 'Street', 'Scoreboard', 'Editorial']) {
      expect(has('sparse piece anchored under its header', (c) => c.piece === piece && c.format === format && c.style === style), `sparse ${piece} ${style} ${format} anchored`);
    }
  }
}
expect(has('PREMIUM Base signature optional; Premium styles white-label'), 'branding: Arma2 signature optional on PREMIUM Base, white-label styles');
expect(has('Figura photo/drag/zoom/reset'), 'Figura photo, focal point, zoom and reset');
expect(has('Editorial multi-page'), 'Editorial multi-page export');
expect(has('roles and empty states'), 'roles and empty states');
expect(checks.some((c) => c.name.startsWith('Studio OFF')), 'Social Studio OFF');
// D1: the file is the selection on screen, also through slow answers, a changed mind and failures.
for (const name of [
  'transitions: FREE → FREE with a slow answer exports the selected piece',
  'transitions: Premium locked → FREE with a slow answer never exports the Premium render',
  'transitions: selection changed during the authorization → no file, then the right one',
  'transitions: snapshot and authorization failures recover',
  'transitions: PREMIUM style, format and signature switches export what is shown',
]) expect(has(name), name);

if (failures.length) {
  console.error(`SOCIAL_STUDIO_BROWSER_FAIL: the CI certification is missing ${failures.length} required check(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(JSON.stringify({ result: 'SOCIAL_STUDIO_CI_CERTIFIED', exports: exports.length, checks: checks.length }));
