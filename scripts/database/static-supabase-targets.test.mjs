import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  findRegisteredSupabaseCalls,
  findStaticSupabaseCalls,
} from './static-supabase-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('resolves an exported constant used as an RPC target', () => {
  const source = `
    export const QUIERO_JUGAR_OPEN_MATCHES_RPC = 'get_open_matches_for_quiero_jugar_v2';
    supabase.rpc(QUIERO_JUGAR_OPEN_MATCHES_RPC, { p_max_distance_km: 30 });
  `;

  assert.deepEqual(
    findStaticSupabaseCalls(source, 'rpc').map(({ target }) => target),
    ['get_open_matches_for_quiero_jugar_v2'],
  );
});

test('resolves literal and local-constant table targets', () => {
  const source = `
    const OPEN_MATCHES_VIEW = 'partidos_abiertos_operativos_v2';
    supabase.from(OPEN_MATCHES_VIEW).select('id');
    supabase.from('jugadores_sin_partido').select('*');
  `;

  assert.deepEqual(
    findStaticSupabaseCalls(source, 'from').map(({ target }) => target),
    ['partidos_abiertos_operativos_v2', 'jugadores_sin_partido'],
  );
});

test('does not guess computed or imported identifiers', () => {
  const source = `
    const computed = getRpcName();
    supabase.rpc(computed, {});
    supabase.rpc(IMPORTED_RPC, {});
  `;

  assert.deepEqual(findStaticSupabaseCalls(source, 'rpc'), []);
});

test('the current Quiero Jugar service is included in the RPC and view inventory', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/db/openMatches.js'), 'utf8');

  assert.deepEqual(
    findRegisteredSupabaseCalls(source, 'src/services/db/openMatches.js', 'rpc')
      .map(({ target }) => target),
    ['get_open_matches_for_quiero_jugar_v2'],
  );
  assert.deepEqual(
    findRegisteredSupabaseCalls(source, 'src/services/db/openMatches.js', 'from')
      .map(({ target }) => target),
    ['partidos_abiertos_operativos_v2'],
  );
});
