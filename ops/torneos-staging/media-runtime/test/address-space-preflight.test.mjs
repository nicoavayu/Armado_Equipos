import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluateAddressSpace } from '../firewall/address-space-preflight.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const empty = () => ({ routes: [], addresses: [], dockerNetworks: [], dockerPools: [], unknown: [] });

for (const source of ['routes', 'addresses', 'dockerNetworks', 'dockerPools']) {
  test(`${source}: valid, overlapping and malformed inputs are classified`, () => {
    const clear = empty();
    clear[source].push('10.0.0.0/8');
    assert.equal(evaluateAddressSpace(clear).ok, true);

    const collision = empty();
    collision[source].push('172.31.20.17/32');
    const overlap = evaluateAddressSpace(collision);
    assert.equal(overlap.ok, false);
    assert.equal(overlap.collisions.length, 1);

    for (const malformed of ['10.0.0.0/8/GARBAGE', '10.0.0.0/33', '10.0.0.999/8']) {
      const input = empty();
      input[source].push(malformed);
      const report = evaluateAddressSpace(input);
      assert.equal(report.collisions.length, 0);
      assert.ok(report.unknown.length > 0, `${source} accepted malformed ${malformed}`);
      assert.equal(report.ok, false, `${source} treated malformed ${malformed} as clear`);
    }
  });
}

test('CIDR parsing rejects every documented partial or malformed spelling', () => {
  for (const malformed of [
    '10.0.0.0/8/GARBAGE',
    '10.0.0.0//8',
    '10.0.0.0/',
    '10.0.0.0/33',
    '10.0.0.0/-1',
    '10.0.0.0/8junk',
    '10.0.0.999/8',
    '10.0.0/8',
    '10.0.0.0.1/8',
    '10.0.0.0 /8',
    '10.0.0.0/ 8',
  ]) {
    const input = empty();
    input.routes.push(malformed);
    const report = evaluateAddressSpace(input);
    assert.equal(report.collisions.length, 0);
    assert.ok(report.unknown.length > 0, `accepted malformed ${malformed}`);
    assert.equal(report.ok, false, `treated malformed ${malformed} as clear`);
  }
});

test('strict CIDR parsing accepts the documented IPv4 forms', () => {
  for (const valid of ['10.0.0.1', '10.0.0.0/8', '172.31.20.17/32', '0.0.0.0/0']) {
    const input = empty();
    input.routes.push(valid);
    const report = evaluateAddressSpace(input, '192.0.2.0/24');
    assert.equal(report.unknown.length, 0, `rejected valid ${valid}`);
  }
});

test('default is explicit only for routes', () => {
  const route = empty();
  route.routes.push('default');
  assert.equal(evaluateAddressSpace(route).ok, true);

  const network = empty();
  network.dockerNetworks.push('default');
  const report = evaluateAddressSpace(network);
  assert.equal(report.ok, false);
  assert.ok(report.unknown.length > 0);
});
