// Mercado Pago webhook signature: our verifier (torneos-payments/webhook-signature.ts, used by the production function)
// against the OFFICIAL Node SDK's algorithm (mercadopago/sdk-nodejs src/utils/webhook/index.ts, reviewed 2026-10-13):
// manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, HMAC-SHA256 hex under the webhook secret, x-signature
// `ts=<ts>,v1=<hex>`. The SDK reference below is a transcription of that algorithm for test vectors, not shipped code.
//
// Scope (documented, deliberate): the production function handles PAYMENT notifications only (data.id numeric), and our
// parser is STRICTER than the SDK in four ways — numeric data.id, both headers mandatory, duplicate ts / v1 refused,
// ts must be 10 (s) or 13 (ms) digits. Every message the SDK accepts for a payment and we refuse is listed here with why;
// nothing the SDK refuses is accepted by us.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';

const tree = await loadGatewayTree();
const ours = await tree.import('torneos-payments/webhook-signature.ts');
test.after(() => tree.cleanup());

/** The SDK's algorithm (v1 only, no tolerance): parse, build the manifest from what is present, compare lowercase hex. */
function sdkValid({ xSignature, xRequestId, dataId, secret }) {
  if (!xSignature || !xSignature.trim()) return false;
  let ts = null; const hashes = {};
  for (const segment of xSignature.trim().split(',')) {
    const at = segment.indexOf('=');
    if (at < 0) continue;
    const key = segment.slice(0, at).trim().toLowerCase(); const value = segment.slice(at + 1).trim();
    if (!key || !value) continue;
    if (key === 'ts') ts = value; else if (/^v\d+$/.test(key)) hashes[key] = value;
  }
  if (!ts || !/^\d+$/.test(ts) || !hashes.v1) return false;
  const parts = [];
  if (dataId) parts.push(`id:${String(dataId).trim()}`);
  if (xRequestId) parts.push(`request-id:${xRequestId}`);
  parts.push(`ts:${ts}`);
  const expected = createHmac('sha256', secret).update(`${parts.join(';')};`).digest('hex');
  return Buffer.byteLength(expected) === Buffer.byteLength(hashes.v1) && expected === hashes.v1;
}
async function oursValid({ xSignature, xRequestId, dataId, secret }) {
  const signature = ours.parseMercadoPagoSignature(xSignature);
  return signature !== null && await ours.verifyMercadoPagoSignature({ signature, xRequestId, dataId, secret });
}
const SECRET = 'prod-webhook-secret-fixture-0001';
const sign = (manifest) => createHmac('sha256', SECRET).update(manifest).digest('hex');
const DATA = '123456789012'; const REQ = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e'; const TS = '1742505638';
const good = `ts=${TS},v1=${sign(`id:${DATA};request-id:${REQ};ts:${TS};`)}`;

test('the documented manifest: both accept a correctly signed payment notification, and both refuse a wrong secret', async () => {
  const msg = { xSignature: good, xRequestId: REQ, dataId: DATA, secret: SECRET };
  assert.equal(sdkValid(msg), true);
  assert.equal(await oursValid(msg), true);
  assert.equal(ours.mercadoPagoManifest(DATA, REQ, TS), `id:${DATA};request-id:${REQ};ts:${TS};`);
  assert.equal(sdkValid({ ...msg, secret: 'other' }), false);
  assert.equal(await oursValid({ ...msg, secret: 'other' }), false);
});

test('equivalent spellings both accept: spaces around parts, key case, extra unknown keys', async () => {
  const v1 = sign(`id:${DATA};request-id:${REQ};ts:${TS};`);
  for (const xSignature of [`ts=${TS}, v1=${v1}`, ` ts=${TS},v1=${v1}`, `ts=${TS},v1=${v1},v2=abc`, `ts=${TS},v1=${v1.toUpperCase()}`]) {
    const msg = { xSignature, xRequestId: REQ, dataId: DATA, secret: SECRET };
    // Uppercase hex: the SDK compares case-sensitively (refuses), we lowercase (accept the same bytes); both signed by MP
    // in lowercase, so this never decides a real notification.
    if (xSignature.includes(v1.toUpperCase())) { assert.equal(await oursValid(msg), true); continue; }
    assert.equal(sdkValid(msg), true, xSignature);
    assert.equal(await oursValid(msg), true, xSignature);
  }
});

test('stricter on purpose: what the SDK may accept and we refuse, each with its reason', async () => {
  const cases = [
    // A non-numeric data.id is not a payment (merchant_order / other topics): out of the function's scope.
    { why: 'non-numeric data.id', msg: { dataId: 'abc123', xRequestId: REQ, sig: (d, r) => `ts=${TS},v1=${sign(`id:${d};request-id:${r};ts:${TS};`)}` } },
    // Without x-request-id the SDK signs `id:..;ts:..;`: we require the header (Mercado Pago always sends it).
    { why: 'missing x-request-id', msg: { dataId: DATA, xRequestId: null, sig: (d) => `ts=${TS},v1=${sign(`id:${d};ts:${TS};`)}` } },
    // A repeated ts: the SDK keeps the last one; we refuse an ambiguous header.
    { why: 'duplicate ts', msg: { dataId: DATA, xRequestId: REQ, sig: (d, r) => `ts=1,ts=${TS},v1=${sign(`id:${d};request-id:${r};ts:${TS};`)}` } },
    // A ts that is neither 10-digit seconds nor 13-digit milliseconds.
    { why: 'ts of 8 digits', msg: { dataId: DATA, xRequestId: REQ, sig: (d, r) => `ts=17425056,v1=${sign(`id:${d};request-id:${r};ts:17425056;`)}` } },
  ];
  for (const { why, msg } of cases) {
    const input = { xSignature: msg.sig(msg.dataId, msg.xRequestId), xRequestId: msg.xRequestId, dataId: msg.dataId, secret: SECRET };
    assert.equal(sdkValid(input), true, `SDK accepts: ${why}`);
    assert.equal(await oursValid(input), false, `we refuse: ${why}`);
  }
});

test('never looser: nothing the SDK refuses is accepted by us (tampering of each signed field)', async () => {
  const base = { xSignature: good, xRequestId: REQ, dataId: DATA, secret: SECRET };
  for (const msg of [
    { ...base, dataId: '123456789013' },
    { ...base, xRequestId: 'cc56a2f1-6aae-46ac-982e-9dcd3581d08e' },
    { ...base, xSignature: good.replace(`ts=${TS}`, 'ts=1742505639') },
    { ...base, xSignature: `ts=${TS}` },
    { ...base, xSignature: '' },
  ]) {
    assert.equal(sdkValid(msg), false);
    assert.equal(await oursValid(msg), false);
  }
});
