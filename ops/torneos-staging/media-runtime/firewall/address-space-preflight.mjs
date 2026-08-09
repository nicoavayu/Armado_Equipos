#!/usr/bin/env node
/**
 * Read-only, fail-closed collision preflight for the runtime's 172.31.20.0/24.
 *
 * It reads only local kernel/Docker state. It does not contact Hetzner or any
 * other API and never changes routes, addresses, Docker networks or daemon
 * configuration. UNKNOWN is a failure: an uninspected source is not evidence
 * that the address space is free.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CANDIDATE = '172.31.20.0/24';

function ipv4Number(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    throw new Error(`invalid IPv4 address: ${value}`);
  }
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) throw new Error(`invalid IPv4 address: ${value}`);
  return octets.reduce((result, part) => (result << 8n) | BigInt(part), 0n);
}

function cidrRange(value) {
  const text = String(value);
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:\/(0|[1-9]|[12]\d|3[0-2]))?$/.exec(text);
  if (!match) throw new Error(`invalid IPv4 CIDR: ${value}`);
  const [, address, prefixText = '32'] = match;
  const prefix = Number(prefixText);
  const hostBits = 32n - BigInt(prefix);
  const size = 1n << hostBits;
  const start = (ipv4Number(address) / size) * size;
  return { start, end: start + size - 1n };
}

function overlaps(left, right) {
  return left.start <= right.end && right.start <= left.end;
}

export function evaluateAddressSpace(input, candidate = CANDIDATE) {
  const target = cidrRange(candidate);
  const collisions = [];
  const unknown = [...(input.unknown || [])];
  for (const source of ['routes', 'addresses', 'dockerNetworks', 'dockerPools']) {
    for (const cidr of input[source] || []) {
      try {
        if (source === 'routes' && cidr === 'default') continue;
        const range = cidrRange(cidr);
        if (overlaps(target, range)) collisions.push({ source, cidr });
      } catch (error) {
        unknown.push(`${source}: ${error.message}`);
      }
    }
  }
  return { candidate, ok: collisions.length === 0 && unknown.length === 0, collisions, unknown };
}

function runJson(command, args, label, unknown) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    unknown.push(`${label} unavailable: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`);
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    unknown.push(`${label} returned invalid JSON: ${error.message}`);
    return null;
  }
}

function inspectLocalState() {
  const state = { routes: [], addresses: [], dockerNetworks: [], dockerPools: [], unknown: [] };

  const routes = runJson('ip', ['-j', '-4', 'route', 'show', 'table', 'all'], 'IPv4 routes (all tables)', state.unknown);
  if (routes) state.routes.push(...routes.map((route) => route.dst).filter((dst) => dst && dst !== 'default'));

  const addresses = runJson('ip', ['-j', '-4', 'address', 'show'], 'IPv4 interface addresses', state.unknown);
  if (addresses) {
    for (const iface of addresses) {
      for (const address of iface.addr_info || []) {
        if (address.family === 'inet' && address.local && Number.isInteger(address.prefixlen)) {
          state.addresses.push(`${address.local}/${address.prefixlen}`);
        }
      }
    }
  }

  const networkList = spawnSync('docker', ['network', 'ls', '--quiet'], { encoding: 'utf8' });
  if (networkList.error || networkList.status !== 0) {
    state.unknown.push(`Docker networks unavailable: ${networkList.error?.message || networkList.stderr.trim() || `exit ${networkList.status}`}`);
  } else {
    const ids = networkList.stdout.trim().split(/\s+/).filter(Boolean);
    if (ids.length) {
      const networks = runJson('docker', ['network', 'inspect', ...ids], 'Docker network inspection', state.unknown);
      if (networks) {
        for (const network of networks) {
          for (const config of network.IPAM?.Config || []) {
            if (config.Subnet && !config.Subnet.includes(':')) state.dockerNetworks.push(config.Subnet);
          }
        }
      }
    }
  }

  const daemonConfig = '/etc/docker/daemon.json';
  try {
    const config = JSON.parse(fs.readFileSync(daemonConfig, 'utf8'));
    const pools = config['default-address-pools'];
    if (!Array.isArray(pools) || pools.length === 0) {
      state.unknown.push(`${daemonConfig} does not declare default-address-pools`);
    } else {
      for (const pool of pools) {
        if (typeof pool?.base !== 'string' || pool.base.includes(':')) continue;
        state.dockerPools.push(pool.base);
      }
      if (state.dockerPools.length === 0) state.unknown.push(`${daemonConfig} has no inspectable IPv4 address pool`);
    }
  } catch (error) {
    state.unknown.push(`${daemonConfig} unavailable or invalid: ${error.message}`);
  }

  return state;
}

function main() {
  const report = evaluateAddressSpace(inspectLocalState());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.stderr.write('ADDRESS_SPACE_PREFLIGHT_BLOCKED collision or UNKNOWN source\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('ADDRESS_SPACE_PREFLIGHT_OK local sources inspected, no overlap\n');
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
