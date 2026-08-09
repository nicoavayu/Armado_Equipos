/**
 * The guarantees docker-compose.staging.yml claims, re-derived from the file.
 *
 * `docker compose config` is the authoritative reader and is used where Docker
 * exists. It does not exist on every machine that reviews this change, so these
 * assertions are made against the parsed tree instead — a claim nobody re-reads
 * is a comment, not a control.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { flatten, interpolationReferences, parseYamlSubset } from '../lib/compose-subset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const RUNTIME = path.join(HERE, '..');

const PRODUCTION_REF = 'rcyuuoaqfwcembdajcss';
const STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';

const source = fs.readFileSync(path.join(RUNTIME, 'docker-compose.staging.yml'), 'utf8');
const compose = parseYamlSubset(source);
const services = compose.services;
const SERVICE_NAMES = ['clamd', 'processor', 'renewer'];

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

test('Production is never named as a permitted target', () => {
  for (const [where, value] of flatten(compose)) {
    if (typeof value !== 'string' || !value.includes(PRODUCTION_REF)) continue;
    // The ref appears exactly twice, and both are the FORBIDDEN lists. Any
    // third occurrence — a URL, an expected host, an expected ref — is a
    // Production target wearing a Staging file's name.
    assert.match(
      where,
      /TOURNAMENT_MEDIA_FORBIDDEN_(PROJECT_REFS|API_HOSTS)$/,
      `${PRODUCTION_REF} appears at ${where}, which is not a forbidden-list entry`,
    );
  }
});

test('both workers are given the Production ref as an explicit forbidden entry', () => {
  for (const name of ['processor', 'renewer']) {
    const env = services[name].environment;
    assert.equal(env.TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS, PRODUCTION_REF);
    assert.equal(env.TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS, `${PRODUCTION_REF}.supabase.co`);
  }
});

test('the Staging target is a required placeholder, never a baked-in value', () => {
  const refs = new Map(interpolationReferences(source).map((r) => [r.name, r]));
  for (const name of ['TOURNAMENT_MEDIA_STAGING_URL', 'TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF',
    'TOURNAMENT_MEDIA_EXPECTED_API_HOST', 'ARMA2_MEDIA_SECRET_DIR']) {
    assert.ok(refs.has(name), `${name} is not interpolated`);
    assert.equal(refs.get(name).required, true, `${name} must have no default: a stack that comes up on a guessed target is the failure mode`);
  }
  // The manifest itself must not hardcode the Staging ref either: the operator
  // names the project, in the host env file, once.
  assert.ok(!source.includes(`${STAGING_REF}.supabase.co`),
    'the compose file hardcodes the Staging host instead of interpolating it');
});

test('env.example points at Staging and never at Production', () => {
  const env = fs.readFileSync(path.join(RUNTIME, 'env.example'), 'utf8');
  const assignments = env.split('\n')
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.split('='));
  const byKey = Object.fromEntries(assignments.map(([k, ...v]) => [k, v.join('=')]));
  assert.equal(byKey.TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF, STAGING_REF);
  assert.equal(byKey.TOURNAMENT_MEDIA_EXPECTED_API_HOST, `${STAGING_REF}.supabase.co`);
  assert.equal(byKey.TOURNAMENT_MEDIA_STAGING_URL, `https://${STAGING_REF}.supabase.co`);
  for (const [key, value] of Object.entries(byKey)) {
    assert.ok(!value.includes(PRODUCTION_REF), `${key} names Production`);
  }
});

// ---------------------------------------------------------------------------
// Nothing is published
// ---------------------------------------------------------------------------

test('no service publishes a port to the host', () => {
  for (const name of SERVICE_NAMES) {
    assert.equal(services[name].ports, undefined, `${name} publishes a port`);
    assert.equal(services[name].expose, undefined, `${name} declares expose`);
    assert.equal(services[name].network_mode, undefined, `${name} overrides network_mode`);
  }
  // Blanket check: the string `ports:` must not appear as a service key at all,
  // so a future edit cannot add one to a service this list does not enumerate.
  assert.ok(!/^\s{4}ports:/m.test(source), 'a service declares ports:');
});

test('clamd:3310 is reachable only over the internal network', () => {
  assert.deepEqual(services.clamd.networks, ['media-internal', 'clamav-egress']);
  assert.equal(compose.networks['media-internal'].internal, true,
    'media-internal must be internal: true — it is what keeps clamd off the routed network');
  // The processor addresses clamd by service name on that shared network.
  assert.equal(services.processor.environment.TOURNAMENT_MEDIA_CLAMD_HOST, 'clamd');
  assert.equal(services.processor.environment.TOURNAMENT_MEDIA_CLAMD_PORT, '3310');
  assert.ok(services.processor.networks.includes('media-internal'));
  const members = SERVICE_NAMES.filter((name) => services[name].networks.includes('media-internal'));
  assert.deepEqual(members, ['clamd', 'processor'],
    'processor and clamd must remain the only members of media-internal');
});

test('the renewer shares no network with clamd or the processor', () => {
  const renewer = new Set(services.renewer.networks);
  for (const other of ['clamd', 'processor']) {
    const shared = services[other].networks.filter((n) => renewer.has(n));
    assert.deepEqual(shared, [], `renewer shares ${shared} with ${other}`);
  }
});

test('clamd is not on the processor egress network, and vice versa', () => {
  assert.ok(!services.clamd.networks.includes('processor-egress'));
  assert.ok(!services.processor.networks.includes('clamav-egress'));
});

test('every network pins its subnet, because the firewall matches on it', () => {
  const expected = {
    'media-internal': '172.31.20.0/28',
    'processor-egress': '172.31.20.16/28',
    'clamav-egress': '172.31.20.32/28',
    'renewer-egress': '172.31.20.48/28',
  };
  for (const [name, subnet] of Object.entries(expected)) {
    assert.equal(compose.networks[name].ipam.config[0].subnet, subnet);
  }
});

test('each egress service resolves through its own bridge gateway', () => {
  // Not cosmetic: dockerd discards a loopback nameserver from the host
  // /etc/resolv.conf and substitutes public resolvers, which would route every
  // container around the NXDOMAIN policy.
  assert.deepEqual(services.processor.dns, ['172.31.20.17']);
  assert.deepEqual(services.clamd.dns, ['172.31.20.33']);
  assert.deepEqual(services.renewer.dns, ['172.31.20.49']);
  assert.ok(!source.includes('extra_hosts'),
    'extra_hosts is a /etc/hosts override; the resolver policy is the supported layer');
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

test('the remote certification command is not wired as a healthcheck anywhere', () => {
  // `healthcheck-cli.mjs` uploads, downloads and deletes `_selftest/<n>.png` in
  // the Staging bucket every time it runs. On an interval that is an unbounded
  // series of remote writes nobody authorized.
  //
  // Scanned over the parsed VALUES rather than the raw text: the manifest
  // explains in a comment why that command is absent, and a guard that cannot
  // tell an explanation from a configuration would force the explanation out.
  for (const [where, value] of flatten(compose)) {
    if (typeof value !== 'string') continue;
    assert.ok(!value.includes('healthcheck-cli'), `the remote certification CLI is configured at ${where}`);
    assert.ok(!value.includes('_selftest'), `the remote self-test namespace is configured at ${where}`);
  }
  for (const name of SERVICE_NAMES) {
    const test_ = services[name].healthcheck?.test;
    if (!test_) continue;
    for (const part of test_) {
      assert.ok(!/npm|healthcheck-cli|selftest/i.test(part),
        `${name} healthcheck runs ${part}`);
    }
  }
});

test('the processor healthcheck is the local readiness probe', () => {
  assert.deepEqual(services.processor.healthcheck.test,
    ['CMD', 'node', '/app/probes/processor-local-readiness.mjs']);
  assert.deepEqual(services.processor.volumes, ['./probes:/app/probes:ro']);
  const probe = fs.readFileSync(path.join(RUNTIME, 'probes/processor-local-readiness.mjs'), 'utf8');
  // It must reach clamd and must not reach Supabase.
  assert.ok(probe.includes('node:net'), 'the probe does not open a TCP connection to clamd');
  assert.ok(!/supabase|SUPABASE_URL|fetch\(/i.test(probe),
    'the local readiness probe references Supabase');
});

test('the readiness layout resolves sharp from /app/node_modules and the old /opt layout does not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-readiness-layout-'));
  try {
    const modules = path.join(root, 'app/node_modules/sharp');
    fs.mkdirSync(modules, { recursive: true });
    fs.writeFileSync(path.join(modules, 'package.json'), JSON.stringify({
      name: 'sharp', version: '0.0.0-fixture', type: 'module', exports: './index.mjs',
    }));
    fs.writeFileSync(path.join(modules, 'index.mjs'), 'export default "fixture-sharp";\n');

    const probeSource = 'const { default: sharp } = await import("sharp"); process.stdout.write(sharp);\n';
    const oldProbe = path.join(root, 'opt/arma2/probes/processor-local-readiness.mjs');
    const newProbe = path.join(root, 'app/probes/processor-local-readiness.mjs');
    fs.mkdirSync(path.dirname(oldProbe), { recursive: true });
    fs.mkdirSync(path.dirname(newProbe), { recursive: true });
    fs.writeFileSync(oldProbe, probeSource);
    fs.writeFileSync(newProbe, probeSource);

    const oldLayout = spawnSync(process.execPath, [oldProbe], { encoding: 'utf8' });
    assert.notEqual(oldLayout.status, 0,
      'the regression fixture is invalid: /opt unexpectedly resolved /app/node_modules/sharp');
    assert.match(oldLayout.stderr, /ERR_MODULE_NOT_FOUND|Cannot find package/);

    const newLayout = spawnSync(process.execPath, [newProbe], { encoding: 'utf8' });
    assert.equal(newLayout.status, 0, newLayout.stderr);
    assert.equal(newLayout.stdout, 'fixture-sharp');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the renewer has no healthcheck at all', () => {
  // Its only health endpoint ATTESTS as a side effect of answering, so probing
  // it on an interval would mint a fresh 3600s attestation forever.
  assert.equal(services.renewer.healthcheck.disable, true);
  assert.equal(services.renewer.healthcheck.test, undefined);
});

test('the clamd healthcheck is local and asserts a loaded signature set', () => {
  const [kind, script] = services.clamd.healthcheck.test;
  assert.equal(kind, 'CMD-SHELL');
  assert.match(script, /clamdscan --ping/);
  assert.match(script, /clamdscan --version/);
  assert.ok(!/curl|wget|http|supabase/i.test(script), 'the clamd healthcheck leaves the host');
});

// ---------------------------------------------------------------------------
// Confinement
// ---------------------------------------------------------------------------

test('the processor is confined as the architecture requires', () => {
  const p = services.processor;
  assert.equal(p.read_only, true);
  assert.deepEqual(p.tmpfs, ['/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777']);
  assert.deepEqual(p.cap_drop, ['ALL']);
  assert.deepEqual(p.security_opt, ['no-new-privileges:true']);
  assert.equal(p.pids_limit, 128);
  assert.equal(p.mem_limit, '1g');
  assert.equal(p.cpus, 1.0);
});

test('the processor stop grace period is at least the lease', () => {
  const leaseSeconds = Number(services.processor.environment.TOURNAMENT_MEDIA_LEASE_SECONDS);
  const grace = services.processor.stop_grace_period;
  const graceSeconds = /^(\d+)m$/.test(grace) ? Number(grace.slice(0, -1)) * 60 : Number(grace.replace('s', ''));
  assert.ok(graceSeconds >= leaseSeconds,
    `stop_grace_period ${grace} is shorter than the ${leaseSeconds}s lease`);
});

test('the renewer is confined and holds no persistent volume', () => {
  const r = services.renewer;
  assert.equal(r.read_only, true);
  assert.deepEqual(r.cap_drop, ['ALL']);
  assert.deepEqual(r.security_opt, ['no-new-privileges:true']);
  assert.equal(r.mem_limit, '256m');
  assert.equal(r.volumes, undefined, 'the renewer must not mount a volume in loop mode');
  // A state file is only needed by `--once` under an external scheduler; with
  // no volume, configuring one would write into the read-only rootfs.
  assert.equal(r.environment.TOURNAMENT_MEDIA_RENEW_STATE_FILE, undefined);
});

test('clamd gets 4g and a persistent signature volume', () => {
  assert.equal(services.clamd.mem_limit, '4g');
  assert.deepEqual(services.clamd.volumes, ['clamav-db:/var/lib/clamav']);
  assert.ok(Object.prototype.hasOwnProperty.call(compose.volumes, 'clamav-db'),
    'clamav-db is mounted but never declared, so it would be an anonymous volume lost on recreate');
  assert.equal(services.clamd.environment.CLAMAV_NO_FRESHCLAMD, 'false');
  assert.equal(services.clamd.environment.CLAMAV_NO_CLAMD, 'false');
});

test('only clamd mounts the signature volume', () => {
  for (const name of ['processor', 'renewer']) {
    const mounts = services[name].volumes || [];
    for (const mount of mounts) {
      assert.ok(!mount.includes('clamav-db'), `${name} mounts the signature volume`);
      assert.ok(!mount.includes('/var/lib/clamav'), `${name} mounts the signature directory`);
    }
  }
});

test('restart policies are deliberate rather than defaults', () => {
  // Bounded for the processor: every start-up refusal it has is a fail-closed
  // configuration verdict, and none of them improve on retry.
  assert.equal(services.processor.restart, 'on-failure:5');
  assert.equal(services.clamd.restart, 'unless-stopped');
  assert.equal(services.renewer.restart, 'unless-stopped');
});

test('logs are bounded on every service', () => {
  for (const name of SERVICE_NAMES) {
    assert.equal(services[name].logging.driver, 'json-file');
    assert.ok(services[name].logging.options['max-size']);
    assert.ok(services[name].logging.options['max-file']);
  }
});

// ---------------------------------------------------------------------------
// Drift against the certified local stack
// ---------------------------------------------------------------------------

test('no hardening present in the certified stack is dropped here', () => {
  const certified = parseYamlSubset(
    fs.readFileSync(path.join(REPO, 'workers/tournament-media-processor/docker-compose.yml'), 'utf8'),
  ).services.worker;
  const staging = services.processor;
  for (const key of ['read_only', 'cap_drop', 'security_opt', 'pids_limit', 'mem_limit', 'cpus', 'tmpfs']) {
    assert.ok(staging[key] !== undefined,
      `the certified stack sets ${key} on the worker and the Staging stack does not`);
  }
  // Ceilings may be tighter here, never looser.
  assert.equal(staging.pids_limit, certified.pids_limit);
  assert.equal(staging.mem_limit, certified.mem_limit);
  assert.equal(staging.cpus, certified.cpus);
  assert.deepEqual(staging.cap_drop, certified.cap_drop);
});

test('the image is built from the certified Dockerfile, not redefined', () => {
  assert.equal(services.processor.build.context, '../../../workers/tournament-media-processor');
  assert.equal(services.processor.build.dockerfile, 'Dockerfile');
  assert.ok(fs.existsSync(path.join(REPO, 'workers/tournament-media-processor/Dockerfile')));
  assert.equal(services.renewer.build.context, '../../../workers/tournament-media-signer-renewer');
  assert.ok(fs.existsSync(path.join(REPO, 'workers/tournament-media-signer-renewer/Dockerfile')),
    'the renewer build context has no Dockerfile');
});

test('every image reference is pinned to an exact tag', () => {
  for (const name of SERVICE_NAMES) {
    const image = services[name].image;
    assert.ok(image, `${name} has no image tag`);
    assert.ok(!image.endsWith(':latest'), `${name} uses :latest`);
    assert.match(image, /:[0-9]/, `${name} image ${image} is not pinned to a version`);
  }
  assert.equal(services.clamd.image, 'clamav/clamav:1.4.5-debian');
});
