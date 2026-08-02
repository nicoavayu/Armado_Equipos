// The geometry contract now lives in four places. This file pins the worker's
// copy to the browser's, which the DB suite already pins to PostgreSQL and the
// Edge contract test pins to the Deno module. A drift anywhere is a failure
// here rather than a variant that quietly does not match.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MEDIA_DERIVED_KINDS,
  MEDIA_SOURCE_PATH_RE,
  MEDIA_VARIANT_BOX,
  variantGeometry,
  variantObjectName,
} from '../src/contract.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
);
const browser = await import(
  path.join(ROOT, 'src', 'features', 'torneos', 'domain', 'mediaPipeline.js')
);

const CASES = [
  [4000, 3000], [3000, 4000], [1, 1], [320, 320], [321, 240],
  [12000, 3000], [1600, 1600], [1601, 900], [7, 4001], [1234, 567],
];

test('las cajas coinciden con las del navegador', () => {
  assert.deepEqual({ ...MEDIA_VARIANT_BOX }, { ...browser.MEDIA_VARIANT_BOX });
  assert.deepEqual([...MEDIA_DERIVED_KINDS], [...browser.MEDIA_DERIVED_KINDS]);
});

test('la geometría derivada coincide bit a bit con la del navegador', () => {
  for (const [width, height] of CASES) {
    for (const kind of MEDIA_DERIVED_KINDS) {
      assert.deepEqual(
        variantGeometry(kind, width, height),
        browser.variantGeometry(kind, width, height),
        `${kind} ${width}x${height}`,
      );
    }
  }
});

test('la geometría coincide con el módulo compartido de las Edge Functions', () => {
  const deno = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', '_shared', 'tournamentMediaContract.ts'),
    'utf8',
  );
  for (const [kind, box] of Object.entries(MEDIA_VARIANT_BOX)) {
    assert.match(
      deno, new RegExp(`${kind}:\\s*${box},`),
      `la caja de ${kind} difiere del contrato Deno`,
    );
  }
});

test('un nombre de variante nunca puede ser el objeto en cuarentena', () => {
  const quarantine =
    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222'
    + '/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.jpg';
  assert.ok(MEDIA_SOURCE_PATH_RE.test(quarantine));
  for (const kind of ['thumbnail', 'grid', 'detail', 'original']) {
    const derived = variantObjectName(quarantine, kind);
    assert.notEqual(derived, quarantine);
    assert.match(derived, new RegExp(`-${kind}\\.jpg$`));
    // Y un nombre derivado ya no vuelve a entrar como origen.
    assert.equal(MEDIA_SOURCE_PATH_RE.test(derived), false);
  }
});

test('un path fuera del contrato no produce ningún nombre', () => {
  assert.throws(() => variantObjectName('../../etc/passwd.jpg', 'original'), /MEDIA_PATH_INVALID/);
  assert.throws(() => variantObjectName('a/b/c/d.jpg', 'original'), /MEDIA_PATH_INVALID/);
  const valid =
    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222'
    + '/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.jpg';
  assert.throws(() => variantObjectName(valid, 'hero'), /MEDIA_KIND_INVALID/);
});
