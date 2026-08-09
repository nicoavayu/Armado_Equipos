/**
 * The parser the rest of this suite depends on.
 *
 * Two obligations. First, that it reads the accepted subset correctly — which
 * is checked by parsing both real manifests and comparing, key for key, against
 * js-yaml whenever js-yaml resolves. Second, that it REFUSES everything else,
 * because a permissive reader would let a manifest reach for an anchor or a
 * merge key and quietly mean something other than what a reviewer read.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { ComposeSubsetError, flatten, interpolationReferences, parseYamlSubset } from '../lib/compose-subset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');

const STAGING_COMPOSE = path.join(HERE, '..', 'docker-compose.staging.yml');
const CERTIFIED_COMPOSE = path.join(REPO, 'workers/tournament-media-processor/docker-compose.yml');

/** js-yaml is a transitive dependency, so its absence is a skip, not a failure. */
function loadJsYaml() {
  try {
    return createRequire(path.join(REPO, 'noop.cjs'))('js-yaml');
  } catch {
    return null;
  }
}

test('parses block mappings, sequences, flow sequences and scalars', () => {
  const parsed = parseYamlSubset([
    'name: stack',
    'services:',
    '  worker:',
    '    read_only: true',
    '    pids_limit: 128',
    '    cpus: 1.0',
    '    disabled: false',
    '    nothing: null',
    '    cap_drop:',
    '      - ALL',
    '    healthcheck:',
    '      test: ["CMD", "node", "probe.mjs"]',
    '    volumes:',
    '      - "./probes:/opt/arma2/probes:ro"',
    '    networks:',
    '      - media-internal',
  ].join('\n'));

  assert.deepEqual(parsed, {
    name: 'stack',
    services: {
      worker: {
        read_only: true,
        pids_limit: 128,
        cpus: 1.0,
        disabled: false,
        nothing: null,
        cap_drop: ['ALL'],
        healthcheck: { test: ['CMD', 'node', 'probe.mjs'] },
        volumes: ['./probes:/opt/arma2/probes:ro'],
        networks: ['media-internal'],
      },
    },
  });
});

test('parses a sequence of mappings, which is how ipam config is written', () => {
  const parsed = parseYamlSubset([
    'networks:',
    '  media-internal:',
    '    ipam:',
    '      config:',
    '        - subnet: 172.31.20.0/28',
    '          gateway: 172.31.20.1',
    '        - subnet: 172.31.20.16/28',
  ].join('\n'));
  assert.deepEqual(parsed.networks['media-internal'].ipam.config, [
    { subnet: '172.31.20.0/28', gateway: '172.31.20.1' },
    { subnet: '172.31.20.16/28' },
  ]);
});

test('a # inside a quoted scalar is not a comment', () => {
  const parsed = parseYamlSubset('forward: "1.1.1.1@853#cloudflare-dns.com" # trailing');
  assert.equal(parsed.forward, '1.1.1.1@853#cloudflare-dns.com');
});

test('refuses the YAML features the manifests must not use', () => {
  const refused = {
    anchors: 'base: &defaults\n  a: 1\n',
    aliases: 'a: 1\nb: *defaults\n',
    'merge keys': 'a:\n  <<: *defaults\n',
    tags: 'a: !!binary abc\n',
    'block scalars': 'a: |\n  text\n',
    'flow mappings': 'a: {b: 1}\n',
    'multi-document streams': '---\na: 1\n',
    tabs: 'a:\n\tb: 1\n',
  };
  for (const [what, source] of Object.entries(refused)) {
    assert.throws(() => parseYamlSubset(source), ComposeSubsetError, `${what} should be refused`);
  }
});

test('refuses a duplicate key rather than silently keeping the last one', () => {
  // The dangerous case: a second `mem_limit` overriding a reviewed ceiling.
  assert.throws(
    () => parseYamlSubset('service:\n  mem_limit: 1g\n  mem_limit: 8g\n'),
    /duplicate key mem_limit/,
  );
});

test('reads Compose interpolation, including whether a variable is required', () => {
  const refs = interpolationReferences(
    'a: ${REQUIRED:?msg}\nb: ${OPTIONAL:-fallback}\nc: ${BARE}\n',
  );
  assert.deepEqual(refs, [
    { name: 'REQUIRED', required: true, hasDefault: false },
    { name: 'OPTIONAL', required: false, hasDefault: true },
    { name: 'BARE', required: false, hasDefault: false },
  ]);
});

test('flatten yields a scalar per leaf, with a readable path', () => {
  const pairs = flatten({ services: { a: { cap_drop: ['ALL'] } } });
  assert.deepEqual(pairs, [['services.a.cap_drop[0]', 'ALL']]);
});

for (const [label, file] of [['staging', STAGING_COMPOSE], ['certified', CERTIFIED_COMPOSE]]) {
  test(`agrees with js-yaml on the ${label} compose file`, (t) => {
    const yaml = loadJsYaml();
    if (!yaml) {
      // Reported, never silently passed: this is the check that keeps the
      // subset honest, so its absence has to be visible in the output.
      t.skip('js-yaml could not be resolved; the cross-check did not run');
      return;
    }
    const source = fs.readFileSync(file, 'utf8');
    assert.deepEqual(parseYamlSubset(source), yaml.load(source));
  });
}
