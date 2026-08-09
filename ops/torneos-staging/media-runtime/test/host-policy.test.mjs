/**
 * The host-side templates: resolver policy, firewall, systemd unit.
 *
 * None of these are applied by anything in this repository, so what is checked
 * here is internal consistency — that the subnets three files talk about are
 * the same subnets, that nothing carries a real address, and that the two
 * claims most easily overstated (Production is blocked; egress is restricted)
 * are stated with their limits attached rather than as guarantees.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parseYamlSubset } from '../lib/compose-subset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.join(HERE, '..');

const PRODUCTION_REF = 'rcyuuoaqfwcembdajcss';

const read = (rel) => fs.readFileSync(path.join(RUNTIME, rel), 'utf8');
const compose = parseYamlSubset(read('docker-compose.staging.yml'));

/**
 * The directive lines only, with `#` comments dropped.
 *
 * Every one of these files explains at length which mechanisms it deliberately
 * does NOT use, so a check run over the raw text finds `local-data`,
 * `LoadCredentialEncrypted` and `docker compose down` in the prose that argues
 * against them. Assertions about configuration must read configuration.
 */
const directives = (text) => text.split('\n')
  .map((line) => line.replace(/^\s*#.*$/, '').trim())
  .filter(Boolean)
  .join('\n');

/** The value of every occurrence of a systemd directive, e.g. `ExecStop`. */
const unitDirective = (text, name) => directives(text).split('\n')
  .filter((line) => line.startsWith(`${name}=`))
  .map((line) => line.slice(name.length + 1));

const nft = read('firewall/nftables-host.staging.nft');
const dockerUser = read('firewall/docker-user.rules.sh');
const hetzner = JSON.parse(read('firewall/hetzner-cloud-firewall.json'));
const unbound = read('dns/unbound-media-staging.conf');
const unit = read('systemd/arma2-media-staging.service');

// ---------------------------------------------------------------------------
// One set of subnets, named in four places
// ---------------------------------------------------------------------------

test('the firewall and the resolver describe the compose file subnets', () => {
  const subnets = Object.fromEntries(
    Object.entries(compose.networks).map(([name, net]) => [name, net.ipam.config[0].subnet]),
  );
  for (const subnet of Object.values(subnets)) {
    assert.ok(nft.includes(subnet), `the nft ruleset never mentions ${subnet}`);
    assert.ok(dockerUser.includes(subnet), `the DOCKER-USER policy never mentions ${subnet}`);
  }
  // The resolver listens on each EGRESS gateway and refuses the internal one,
  // which has no route to the host at all.
  for (const service of ['processor', 'clamd', 'renewer']) {
    const [address] = compose.services[service].dns;
    assert.ok(unbound.includes(`interface: ${address}`),
      `unbound does not listen on ${address}, which ${service} is told to query`);
  }
  assert.ok(!unbound.includes('access-control: 172.31.20.0/28'),
    'the resolver accepts queries from the internal network, which cannot reach it');
});

// ---------------------------------------------------------------------------
// Nothing personal, nothing pinned
// ---------------------------------------------------------------------------

test('no real administrative address is committed', () => {
  assert.ok(nft.includes('@ADMIN_CIDR@'), 'the nft ruleset lost its placeholder');
  for (const rule of hetzner.rules) {
    for (const ip of rule.source_ips || []) {
      assert.equal(ip, 'ADMIN_CIDR_PLACEHOLDER', 'the Hetzner spec carries a real source address');
    }
  }
  // A stray real address anywhere in the firewall templates. Permitted: the
  // two documented DoT resolvers, the cloud metadata address, loopback, this
  // stack's own bridge subnets, and the RFC 5737 documentation ranges the
  // examples are written in — which exist precisely so an example never names
  // a host that belongs to somebody.
  const allowed = new Set(['1.1.1.1', '9.9.9.9', '169.254.169.254', '127.0.0.1']);
  const isDocumentationRange = (ip) => ip.startsWith('192.0.2.')
    || ip.startsWith('198.51.100.') || ip.startsWith('203.0.113.');
  // Over the directives, not the prose: the templates name 8.8.8.8 in a comment
  // to explain which bypass the DoT-only egress rule exists to close, and a
  // scan that cannot tell a named threat from a configured destination would
  // force that explanation out of the file.
  for (const [name, file] of [['nftables', directives(nft)], ['DOCKER-USER', directives(dockerUser)]]) {
    for (const match of file.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []) {
      assert.ok(
        allowed.has(match) || match.startsWith('172.31.20.') || isDocumentationRange(match),
        `unexpected address ${match} in the ${name} template`,
      );
    }
  }
});

test('the resolver returns NXDOMAIN for Production and pins no address', () => {
  assert.match(unbound, new RegExp(`local-zone:\\s*"${PRODUCTION_REF}\\.supabase\\.co\\."\\s*always_nxdomain`));
  // A hosts-style answer is the rejected design: 127.0.0.1 is an ANSWER, so a
  // client connects to the loopback and reads whatever listens there.
  const configured = directives(unbound);
  assert.ok(!/local-data/.test(configured), 'the resolver pins an answer instead of refusing');
  assert.ok(!configured.includes('/etc/hosts'), 'the resolver defers to /etc/hosts');
});

// ---------------------------------------------------------------------------
// The two claims that must not be overstated
// ---------------------------------------------------------------------------

test('the firewall templates state that tcp/443 does not identify a destination', () => {
  // The whole point of writing this down: a reviewer must not read
  // `tcp dport 443 accept` as "may reach Supabase Staging". A packet filter
  // never sees the SNI it would need to tell one TLS endpoint from another.
  for (const [name, text] of [['nftables', nft], ['DOCKER-USER', dockerUser]]) {
    assert.match(text, /443/, `${name} does not mention 443`);
    assert.ok(/does not|cannot|NOT/.test(text) && /destination|Production|endpoint/i.test(text),
      `${name} does not state the limit of a port-based rule`);
  }
  const outbound443 = hetzner.rules.find((r) => r.direction === 'out' && r.port === '443');
  assert.match(outbound443.description, /NOT destination-restricted/);
});

test('the resolver template states that it is defence in depth, not the guarantee', () => {
  assert.match(unbound, /target\.mjs/,
    'the resolver policy does not point at the code guard that is the actual guarantee');
  assert.match(unbound, /IP literal|by IP/i,
    'the resolver policy does not admit that it stops nothing that connects by address');
});

test('the Docker DNS substitution trap is documented where it is fixed', () => {
  // A loopback nameserver in the host /etc/resolv.conf is DISCARDED by dockerd,
  // which substitutes public resolvers. Every container would then resolve
  // around the NXDOMAIN policy while the host looks correctly configured.
  const composeSource = read('docker-compose.staging.yml');
  assert.match(composeSource, /loopback resolver|DISCARDS/i);
  assert.match(unbound, /DOCKER TRAP|discards|DISCARDS/i);
});

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

test('SSH is the only inbound service, at both firewall layers', () => {
  const inbound = hetzner.rules.filter((r) => r.direction === 'in');
  const tcpPorts = inbound.filter((r) => r.protocol === 'tcp').map((r) => r.port);
  assert.deepEqual(tcpPorts, ['22']);
  for (const rule of inbound) {
    assert.deepEqual(rule.source_ips, ['ADMIN_CIDR_PLACEHOLDER']);
  }
  // And nothing in the compose file publishes a port for them to have reached.
  for (const service of Object.values(compose.services)) {
    assert.equal(service.ports, undefined);
  }
  assert.match(nft, /tcp dport 22/);
  assert.ok(!/dport 3310/.test(nft), 'the host ruleset opens clamd');
});

test('the outbound policy keeps what a cloud VM needs to stay reachable', () => {
  // Each of these has cost someone a host. DHCP renewal failure takes the
  // address away hours later; missing ICMP frag-needed turns into TLS hangs;
  // no NTP produces attestation windows that are wrong on both ends; no
  // metadata breaks cloud-init reconfiguration.
  for (const needed of [/udp sport 67 udp dport 68 accept/, /udp dport 123 accept/,
    /169\.254\.169\.254/, /icmp/]) {
    assert.match(nft, needed, `the host ruleset drops something a Hetzner VM needs: ${needed}`);
  }
  assert.match(nft, /destination-unreachable/, 'PMTU discovery would black-hole');
});

test('plain udp/53 egress is not permitted, so the resolver cannot be bypassed', () => {
  // If a container could query 8.8.8.8 directly, the NXDOMAIN policy would be
  // a suggestion. Only DoT to the two configured upstreams leaves the host.
  assert.match(nft, /tcp dport 853 accept/);
  assert.ok(!/udp dport 53 accept/.test(nft.split('chain output')[1] || ''),
    'the output chain permits plain DNS to anywhere');
  const dnsOut = hetzner.rules.filter((r) => r.direction === 'out' && r.port === '53');
  assert.deepEqual(dnsOut, [], 'the Hetzner spec permits plain DNS egress');
});

// ---------------------------------------------------------------------------
// Container egress
// ---------------------------------------------------------------------------

test('container policy goes into DOCKER-USER and not into a private nft chain', () => {
  // Two rulesets hooking `forward` are evaluated independently; a drop in a
  // private table overrides Docker's accepts invisibly.
  const rules = directives(dockerUser);
  assert.match(rules, /^JUMP_FROM=DOCKER-USER$/m);
  // Inserted at position 1, so it is evaluated before whatever is already in
  // the chain rather than after an accept that has already let the packet by.
  assert.match(rules, /-I "\$JUMP_FROM" 1 -j "\$CHAIN"/);
  const forwardChain = nft.split('chain forward')[1]?.split('chain output')[0] || '';
  assert.match(forwardChain, /policy accept/,
    'the private nft table also filters forward, which fights with Docker');
  assert.ok(!/drop|DROP/.test(forwardChain.replace(/#.*/g, '')),
    'the private forward chain contains drop rules');
});

test('each service subnet gets its own egress rule and a default drop', () => {
  for (const subnet of ['NET_PROCESSOR', 'NET_CLAMAV', 'NET_RENEWER']) {
    assert.ok(dockerUser.includes(`-s "$${subnet}" -j DROP`),
      `${subnet} has no default drop, so an unlisted port is permitted`);
  }
  const rules = directives(dockerUser).split('\n');
  const establishedAt = rules.findIndex((line) => line.includes('ESTABLISHED,RELATED'));
  const internalAllow = '"$IPT" -A "$CHAIN" -s "$NET_INTERNAL" -d "$NET_INTERNAL" -p tcp --dport 3310 -j RETURN';
  const allowAt = rules.indexOf(internalAllow);
  const sourceDropAt = rules.indexOf('"$IPT" -A "$CHAIN" -s "$NET_INTERNAL" -j DROP');
  const destinationDropAt = rules.indexOf('"$IPT" -A "$CHAIN" -d "$NET_INTERNAL" -j DROP');
  assert.ok(establishedAt >= 0 && allowAt > establishedAt,
    'tcp/3310 east-west must follow ESTABLISHED,RELATED');
  assert.ok(sourceDropAt > allowAt && destinationDropAt > allowAt,
    'both NET_INTERNAL blanket drops must remain after the tcp/3310 exception');
  assert.equal(rules.filter((line) => line.includes('$NET_INTERNAL') && line.endsWith('-j RETURN')).length, 1,
    'tcp/3310 must be the only new east-west exception on media-internal');
  assert.match(internalAllow, /-p tcp --dport 3310 -j RETURN$/);
  assert.match(dockerUser, /-s 172\.31\.20\.0\/24 -j DROP/,
    'the enclosing Docker subnet still needs a fail-closed default');

  // This is a port allowance, not destination isolation: clamd can reach any
  // TCP/80 or TCP/443 destination but holds no Supabase credential.
  assert.match(dockerUser, /NET_CLAMAV.*multiport --dports 80,443 -j RETURN/);
  assert.doesNotMatch(dockerUser, /clamd cannot reach Supabase(?: at all| on any port)/i);
});

// ---------------------------------------------------------------------------
// systemd
// ---------------------------------------------------------------------------

test('the unit manages the stack without destroying state', () => {
  const [stop, ...extraStops] = unitDirective(unit, 'ExecStop');
  assert.equal(extraStops.length, 0, 'more than one ExecStop');
  assert.match(stop, /compose .*\bstop\b/, 'ExecStop uses something other than `compose stop`');
  // `down` removes the networks, and is one flag away from removing the
  // signature volume with them.
  assert.ok(!/\bdown\b/.test(stop), 'ExecStop tears the stack down');
  assert.ok(!/(^|\s)-v(\s|$)|--volumes/.test(stop), 'ExecStop carries a volume flag');
  for (const start of unitDirective(unit, 'ExecStart')) {
    assert.match(start, /--no-build/,
      'the unit builds images on start, so a restart can ship code nobody reviewed');
  }
});

test('the unit stop timeout outlives the processor grace period', () => {
  const grace = compose.services.processor.stop_grace_period; // e.g. 6m
  const graceSeconds = /^(\d+)m$/.test(grace) ? Number(grace.slice(0, -1)) * 60 : Number(grace.replace('s', ''));
  const timeout = Number(/TimeoutStopSec=(\d+)/.exec(unit)[1]);
  const composeTimeout = Number(/--timeout (\d+)/.exec(unit)[1]);
  assert.ok(composeTimeout >= graceSeconds,
    `compose stop --timeout ${composeTimeout} is under the ${graceSeconds}s grace period`);
  assert.ok(timeout > composeTimeout,
    'systemd would SIGKILL the CLI before it finished stopping the containers');
});

test('the unit carries no secret and explains why it carries no credential', () => {
  assert.ok(!/LoadCredentialEncrypted=|LoadCredential=/.test(unit.replace(/^#.*$/gm, '')),
    'the unit uses systemd credentials, whose visibility to dockerd is unverified');
  assert.match(unit, /LoadCredentialEncrypted/, 'the unit does not explain why it does not use them');
  for (const line of unit.split('\n')) {
    if (line.startsWith('#')) continue;
    assert.ok(!/(KEY|SECRET|TOKEN|JWT)=/.test(line), `the unit sets a credential: ${line}`);
  }
  assert.match(unit, /EnvironmentFile=\/etc\/arma2\/media-staging\/runtime\.env/);
});

// ---------------------------------------------------------------------------
// Nothing is applied
// ---------------------------------------------------------------------------

test('the apply path validates first and arms a revert before it commits', () => {
  const apply = read('firewall/apply-with-rollback.sh');
  const validateAt = apply.indexOf('validate.sh"');
  const armAt = apply.indexOf('systemctl start');
  const loadAt = apply.indexOf('nft -f "$tmp"');
  assert.ok(validateAt > 0 && armAt > validateAt && loadAt > armAt,
    'the order must be validate, then arm the revert, then load');
  assert.match(apply, /--dry-run/);
  // Confirming from the session that applied the rules proves nothing: it is
  // already ESTABLISHED, so conntrack accepts it whatever the policy says.
  assert.match(apply, /ESTABLISHED/);
  assert.match(apply, /203\.0\.113\.0\/24/,
    'the script does not refuse to apply the documentation placeholder');
});

test('the nft backup is replacement-safe and the deadman restores that exact backup', () => {
  const apply = read('firewall/apply-with-rollback.sh');
  assert.match(apply, /printf ['"]flush ruleset\\n['"] > "\$BACKUP_TMP"/,
    'the backup does not begin with flush ruleset');
  assert.match(apply, /nft list ruleset >> "\$BACKUP_TMP"/,
    'the original ruleset is not appended after the flush instruction');
  assert.match(apply, /if ! nft list ruleset >> "\$BACKUP_TMP"; then[\s\S]*?die /,
    'a failed dump is not rejected');
  assert.match(apply, /\[ -s "\$BACKUP_TMP" \]/,
    'the apply path never rejects an empty backup');
  assert.match(apply, /mv "\$BACKUP_TMP" "\$BACKUP"/,
    'the incomplete temporary backup is not atomically published after success');
  assert.match(apply, /ExecStart=\/usr\/sbin\/nft -f \$\{BACKUP\}/,
    'the deadman no longer restores through nft -f BACKUP');
  assert.match(apply, /iptables-save > "\$STATE_DIR\/iptables\.pre-apply\.rules"/);
  assert.match(apply, /ExecStart=\/usr\/sbin\/iptables-restore \$\{STATE_DIR\}\/iptables\.pre-apply\.rules/);
});

test('Unbound can bind only the explicit future bridge gateways before Docker creates them', () => {
  const configured = directives(unbound);
  assert.match(configured, /^ip-freebind: yes$/m);
  assert.doesNotMatch(configured, /^interface:\s+0\.0\.0\.0$/m);
  for (const address of ['172.31.20.17', '172.31.20.33', '172.31.20.49']) {
    assert.match(configured, new RegExp(`^interface: ${address}$`, 'm'));
  }
});

test('I1 has a fail-closed, local-only address-space collision preflight', async () => {
  const preflight = path.join(RUNTIME, 'firewall/address-space-preflight.mjs');
  assert.ok(fs.existsSync(preflight), 'address-space-preflight.mjs is missing');
  const { evaluateAddressSpace } = await import(new URL(`file://${preflight}`));
  const base = { routes: [], addresses: [], dockerNetworks: [], dockerPools: [], unknown: [] };
  assert.deepEqual(evaluateAddressSpace(base).collisions, []);
  for (const [source, value] of [
    ['routes', '172.31.20.0/24'],
    ['addresses', '172.31.20.17/32'],
    ['dockerNetworks', '172.31.16.0/20'],
    ['dockerPools', '172.16.0.0/12'],
  ]) {
    const input = structuredClone(base);
    input[source].push(value);
    assert.ok(evaluateAddressSpace(input).collisions.length > 0, `${source} collision was accepted`);
  }
  const unknown = evaluateAddressSpace({ ...base, unknown: ['docker address pools unavailable'] });
  assert.equal(unknown.ok, false, 'an UNKNOWN inspection source must fail closed');
});

test('the Hetzner spec records that nothing was provisioned', () => {
  assert.deepEqual(hetzner.$notApplied, {
    vmCreated: false,
    firewallCreated: false,
    apiCallsMade: 0,
    hetznerTokenRead: false,
  });
});
