/**
 * The Quality Gate, asserted as a contract instead of trusted as a habit.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * The signer-renewer suite passed for weeks while contributing nothing: it was
 * a script in `package.json` that no CI step ever called. Nobody had to break
 * it — it simply was not on the path, and a green Quality Gate said so anyway.
 * That is the failure mode this file exists to make impossible: not "the tests
 * broke", but "the tests stopped being run and nothing said so".
 *
 * The rule enforced here is a single entrypoint. The workflow runs
 * `npm run test:ci`; `test:ci` composes the suites. A step added to the YAML
 * without a matching script, or a script quietly dropped from `test:ci`, fails
 * this test — which itself runs inside `test:ci`, so the check cannot be
 * skipped without also skipping everything it protects.
 *
 * ---------------------------------------------------------------------------
 * What the Quality Gate covers (kept in sync by REQUIRED_IN_TEST_CI below)
 * ---------------------------------------------------------------------------
 *   npm run migrations:guard        — migration source guard (its own step)
 *   npm run test:db                 — PostgreSQL integration suite
 *   npm run test:db:security        — RPC grants + Security Advisor parser
 *   npm run lint                    — ESLint over src/
 *   npm run build                   — production build
 *   npm run test:ci                 — which is, in order:
 *       npm run test:staging:guard        — this contract test, the staging
 *                                           guard, the A1/A2 execution
 *                                           contracts, psql TLS + live
 *                                           connection contracts, readonly
 *                                           inspector, readiness,
 *                                           observability, signer gateway
 *                                           probe, rollback contract, static
 *                                           guard (which scans the whole
 *                                           repository for credentials and
 *                                           unknown Supabase hosts), and the
 *                                           tournament-media storage procedure
 *       npm run test:worker:signer-renewer — the signer attestation renewer:
 *                                           config, forbidden-target policy,
 *                                           schedule, redirects, state store,
 *                                           locking, shutdown, CLI
 *       npm run test:worker:media:ci      — the media processor's suites that
 *                                           need no infrastructure: target
 *                                           guard, quarantine sweeper, geometry
 *                                           contract, job pipeline, self-test,
 *                                           storage client, antivirus protocol.
 *                                           `codec.test.mjs` is excluded on
 *                                           purpose — it loads real libvips,
 *                                           which the repository's npm ci does
 *                                           not install; it runs through
 *                                           `test:worker:media` on the host
 *                                           that certifies the worker.
 *       CI=true react-scripts test        — the Jest suite
 *
 * `torneos:staging:validate` is covered by construction: every node test it
 * names is also named by `test:staging:guard`, and that containment is asserted
 * below so the two lists cannot drift apart.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW_PATH = '.github/workflows/smoke-stats-notifications.yml';

const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8'));
const readText = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

const scripts = readJson('package.json').scripts;
const workflow = readText(WORKFLOW_PATH);

/**
 * The workflow's directives, with full-line comments removed. The prose in that
 * file necessarily contains the words `continue-on-error` and `|| true` — it
 * documents that they are banned — so the scans below must not read it.
 */
const workflowDirectives = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

/**
 * Every `npm run <name>` in the workflow, comments included: a script name in
 * the coverage comment that package.json does not define is stale documentation
 * about what the gate runs, which is exactly what this file exists to prevent.
 */
const workflowScriptCalls = [...workflow.matchAll(/npm run ([a-z0-9:_-]+)/g)].map(([, name]) => name);

/** Only the names the workflow actually executes. */
const workflowExecutedScripts = [...workflowDirectives.matchAll(/npm run ([a-z0-9:_-]+)/g)]
  .map(([, name]) => name);

/** The suites `test:ci` must compose. Removing one from the script fails here. */
const REQUIRED_IN_TEST_CI = [
  'test:staging:guard', 'test:worker:signer-renewer', 'test:worker:media:ci',
];

/**
 * The media-processor suites that need nothing but Node — no Supabase, no
 * ClamAV, no libvips, no network. These are what `test:worker:media:ci` runs,
 * and each one is named explicitly rather than globbed so that adding a suite
 * with an infrastructure dependency cannot quietly join the CI path.
 *
 * `codec.test.mjs` is deliberately absent: it loads real sharp at import time,
 * and the worker's native dependencies are not installed by the repository's
 * `npm ci`. It stays in `test:worker:media`, which is run on a host that has
 * the worker's own `node_modules` — the same host that certifies the codec.
 */
const MEDIA_CI_SUITES = [
  'antivirus', 'cleanup', 'contract', 'pipeline', 'secret-source', 'selfTest', 'supabase', 'target',
];

/** Extracts the test files a `node --test a.mjs b.mjs` script names. */
const testFilesOf = (script) => String(script || '').split(/\s+/)
  .filter((token) => token.endsWith('.test.mjs'));

test('the workflow delegates to npm scripts that actually exist', () => {
  assert.ok(workflowScriptCalls.length > 0, 'the workflow runs no npm scripts at all');
  for (const name of workflowScriptCalls) {
    assert.ok(Object.hasOwn(scripts, name),
      `${WORKFLOW_PATH} runs "npm run ${name}", which package.json does not define`);
  }
});

test('the workflow reaches the test suites through test:ci and nothing else', () => {
  assert.ok(workflowExecutedScripts.includes('test:ci'),
    `${WORKFLOW_PATH} must run "npm run test:ci"`);
  assert.ok(workflowExecutedScripts.includes('migrations:guard'),
    `${WORKFLOW_PATH} must run "npm run migrations:guard"`);
});

test('test:ci runs the signer-renewer suite', () => {
  // The finding this whole file answers: 104 renewer tests that CI never ran.
  for (const required of REQUIRED_IN_TEST_CI) {
    assert.match(scripts['test:ci'], new RegExp(`npm run ${required}(\\s|$|&)`),
      `test:ci must run "npm run ${required}"`);
  }
  assert.ok(scripts['test:worker:signer-renewer'].includes('workers/tournament-media-signer-renewer/test/'),
    'test:worker:signer-renewer no longer points at the renewer test directory');
});

test('test:ci runs the media-processor suites that need no infrastructure', () => {
  // The same finding as the renewer's, one worker over: the processor suite —
  // including the target guard that keeps a service-role key away from
  // Production, and the sweeper that deletes quarantined uploads — existed in
  // package.json and was on no CI path at all.
  const script = scripts['test:worker:media:ci'];
  assert.ok(script, 'package.json must define test:worker:media:ci');
  for (const suite of MEDIA_CI_SUITES) {
    assert.ok(script.includes(`workers/tournament-media-processor/test/${suite}.test.mjs`),
      `test:worker:media:ci must run ${suite}.test.mjs`);
  }
  // A suite added to the directory and forgotten here is a coverage hole, so
  // the two lists are held together: everything on disk is either on the CI
  // path or is the one suite documented as needing real libvips.
  const onDisk = fs.readdirSync(path.join(REPO_ROOT, 'workers/tournament-media-processor/test'))
    .filter((entry) => entry.endsWith('.test.mjs'))
    .map((entry) => entry.replace(/\.test\.mjs$/, ''));
  for (const suite of onDisk) {
    assert.ok(MEDIA_CI_SUITES.includes(suite) || suite === 'codec',
      `${suite}.test.mjs is in the processor test directory but on no CI path`);
  }
  // The full suite, libvips included, must stay available for the host that
  // certifies the worker.
  assert.ok(scripts['test:worker:media'].includes('workers/tournament-media-processor/test/'),
    'test:worker:media no longer points at the processor test directory');
});

test('every suite in test:ci is chained with && so a failure fails the gate', () => {
  const chain = scripts['test:ci'];
  assert.equal(chain.includes(';'), false, 'test:ci uses ";" — a failing suite would not stop the run');
  assert.equal(chain.includes('||'), false, 'test:ci uses "||" — a failing suite would be swallowed');
  for (const required of REQUIRED_IN_TEST_CI) {
    const before = chain.slice(0, chain.indexOf(required));
    assert.equal(/(?:\|\||;|\|\s*true)/.test(before), false,
      `${required} is reachable through a construct that could mask its exit code`);
  }
});

test('no Quality Gate step is optional, tolerated or conditionally skipped', () => {
  assert.equal(/continue-on-error/i.test(workflowDirectives), false,
    `${WORKFLOW_PATH} must not use continue-on-error`);
  assert.equal(/\|\|\s*true/.test(workflowDirectives), false,
    `${WORKFLOW_PATH} must not swallow a failure with "|| true"`);
  assert.equal(/^\s*if:/m.test(workflowDirectives), false,
    `${WORKFLOW_PATH} must not make a step conditional`);
  // A suite that reports "0 tests" because its glob stopped matching is a
  // silent skip; the renewer directory is asserted to be non-empty.
  const renewerTests = fs.readdirSync(path.join(REPO_ROOT, 'workers/tournament-media-signer-renewer/test'))
    .filter((entry) => entry.endsWith('.test.mjs'));
  assert.ok(renewerTests.length >= 8,
    `the renewer test directory holds only ${renewerTests.length} suites; a glob or a deletion has gone wrong`);
  assert.ok(renewerTests.includes('forbidden-targets.test.mjs'),
    'the forbidden-target policy suite is missing from the renewer test directory');
});

test('test:staging:guard covers every suite torneos:staging:validate names', () => {
  // The two scripts are maintained by hand and only one of them is on the CI
  // path. Containment is what keeps that from becoming a coverage hole.
  const guarded = new Set(testFilesOf(scripts['test:staging:guard']));
  for (const file of testFilesOf(scripts['torneos:staging:validate'])) {
    assert.ok(guarded.has(file),
      `torneos:staging:validate runs ${file}, which test:staging:guard — the CI path — does not`);
  }
  assert.ok(scripts['torneos:staging:validate'].includes('npm run migrations:guard'),
    'torneos:staging:validate no longer chains migrations:guard');
});

test('this contract test is itself on the CI path', () => {
  // Otherwise every assertion above is advisory.
  assert.ok(testFilesOf(scripts['test:staging:guard']).includes('scripts/ci/quality-gate-contract.test.mjs'),
    'quality-gate-contract.test.mjs must be named by test:staging:guard');
});

test('the static repository guard is reached by the CI path', () => {
  // `staging:static-guard` is not a CI step; its scanner is exercised by
  // static-guard.test.mjs, which runs scanRepository over the whole tree.
  assert.ok(testFilesOf(scripts['test:staging:guard']).includes('scripts/torneos-staging/static-guard.test.mjs'),
    'static-guard.test.mjs must stay on the CI path — it is what runs the repository credential scan');
  assert.ok(readText('scripts/torneos-staging/static-guard.test.mjs').includes('scanRepository'),
    'static-guard.test.mjs no longer runs the repository-wide scan');
});

test('the documented coverage list matches what test:ci really composes', () => {
  // The header comment is documentation people act on, so it is checked too.
  const header = readText('scripts/ci/quality-gate-contract.test.mjs').split('import assert')[0];
  for (const name of [...REQUIRED_IN_TEST_CI, 'test:ci', 'migrations:guard']) {
    assert.ok(header.includes(name), `the coverage comment in this file does not mention ${name}`);
  }
});
