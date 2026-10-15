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
// PREMIUM SPONSORS: 0–3 sponsors in every Premium style and both formats, Tabla and Resultados, each a real file whose
// band was measured on screen (a tile per sponsor); FREE unchanged; every other piece through the band matrix.
for (const piece of ['standings', 'round_results']) {
  for (const format of ['feed-4x5', 'historia-9x16']) {
    for (const style of ['heritage', 'street', 'scoreboard', 'editorial']) {
      for (const count of [0, 1, 2, 3]) {
        expect(exports.some((e) => e.section === 'sponsors' && e.piece === piece && e.style === style && e.format === format && e.sponsors === count
          && Array.isArray(e.sponsorNames) && e.sponsorNames.length === count && (e.tiles || []).length === count
          && (count === 0 ? !e.band : e.band?.count === count)), `sponsors: ${count} × ${piece} ${style} ${format} export`);
      }
    }
  }
}
expect(has('sponsors: band matrix — every piece × four styles × two formats × 0–3 sponsors, nothing under the band, nothing cut', (c) => c.renders === 4 * 2 * 21 * 4),
  'sponsors: band matrix (21 piece variants × 4 styles × 2 formats × 0–3 sponsors)');
for (const name of [
  'sponsors: 0–3 × four Premium styles × two formats × Tabla and Resultados exported through Descargar PNG',
  'sponsors: the band on every exported piece is prominent, whole and over nothing',
  'sponsors: a white logo on a transparent background gets a dark tile',
  'sponsors: at most 3 per piece',
  'sponsors: a refused authorization exports nothing, then the retry does',
  'sponsors: Base hides and clears the selection',
  'sponsors: settings list (Premium) and Premium explanation (FREE)',
  'sponsors: a collaborator with export exports without sponsors and never reads «sin logo»',
  'sponsors: a square logo is whole inside its frame; the settings tabs never clip (desktop and phone)',
  'sponsors: FREE unchanged (no selector, no request, same file)',
]) expect(has(name), name);
expect(has('FREE authorize payloads'), 'FREE authorization payloads (Base, three pieces, Arma2 signature)');
expect(has('FREE: Resultados keeps the chosen format (switch and refresh)'), 'D3: Resultados keeps the chosen format');
expect(has('FREE premium style previewed and locked'), 'FREE: Premium styles previewed and locked (behind the Premium veil)');
expect(checks.filter((c) => c.name === 'sparse content starts under the title').length === 32,
  'sparse content: 4 pieces × 4 Premium styles × 2 formats start under the title');
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
