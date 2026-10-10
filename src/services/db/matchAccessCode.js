import { supabase } from '../../lib/supabaseClient';
import { isMissingRpcError } from './publicProfiles';

// A match's access code (partidos.codigo) opens its public voting and its invitation page.
// Only its admin and the players in its roster get it (20261010133000/137000); everybody else
// sees the match without it, and a code that arrives in a link is validated by the server.
// The rule is per ROW (the table returns a match only to those involved, 20261010137000), not
// per column: reads of partidos keep select('*') like installed apps do. An explicit column
// list cannot be used here: Core Production's partidos is not the repository's (it has no
// uuid, admin_id, precio_cancha or equipos_generados, and has columns the repository lacks),
// and naming a missing column fails the whole read (42703). The schema test
// (coreProductionSchemaCompat.test.js) checks reads against Production's real columns.
export const PARTIDO_SELECT = '*';

const toMatchIds = (ids) => Array.from(new Set(
  (Array.isArray(ids) ? ids : [ids])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0),
)).slice(0, 200);

/** Map match id → code for the matches the signed-in account belongs to (others are absent). */
export async function fetchMatchAccessCodes(matchIds) {
  const ids = toMatchIds(matchIds);
  const codes = new Map();
  if (ids.length === 0) return codes;

  const { data, error } = await supabase.rpc('get_match_access_codes', { p_partido_ids: ids });
  if (error && isMissingRpcError(error)) {
    // Backend without 20261010133000 yet: the previous direct read.
    const legacy = await supabase.from('partidos').select('id, codigo').in('id', ids);
    if (legacy.error) throw legacy.error;
    (legacy.data || []).forEach((row) => { if (row?.codigo) codes.set(Number(row.id), row.codigo); });
    return codes;
  }
  if (error) throw error;
  (data || []).forEach((row) => { if (row?.codigo) codes.set(Number(row.partido_id), row.codigo); });
  return codes;
}

/** The code of one match if the signed-in account belongs to it, else null. */
export async function fetchMatchAccessCode(matchId) {
  const [id] = toMatchIds(matchId);
  if (!id) return null;
  const codes = await fetchMatchAccessCodes([id]);
  return codes.get(id) || null;
}
