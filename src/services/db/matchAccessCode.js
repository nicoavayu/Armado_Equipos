import { supabase } from '../../lib/supabaseClient';
import { isMissingRpcError } from './publicProfiles';

// A match's access code (partidos.codigo) opens its public voting and its invitation page.
// Only its admin and the players in its roster get it (20261010133000); everybody else sees
// the match without it, and a code that arrives in a link is validated by the server.
// Phase B revokes the column on the table itself, so this client never reads partidos with
// '*' (nor insert/update ... select()): it lists the columns and asks for the code here.

// Every partidos column except codigo. A new column must be added here to be read.
export const PARTIDO_COLUMNS = [
  'id', 'uuid', 'match_ref', 'nombre', 'fecha', 'hora', 'sede', 'sedeMaps', 'modalidad',
  'tipo_partido', 'cupo_jugadores', 'falta_jugadores', 'precio_cancha', 'creado_por', 'admin_id',
  'equipos_json', 'equipos_generados', 'teams_confirmed', 'awards_status', 'awards_resolved_at',
  'estado', 'deleted_at', 'created_at', 'updated_at', 'surveys_sent', 'reminder_sent_at',
  'final_team_a', 'final_team_b', 'final_teams_updated_at', 'final_teams_updated_by',
  'survey_team_a', 'survey_team_b', 'teams_source', 'teams_locked', 'teams_locked_by_user_id',
  'teams_locked_at', 'result_status', 'winner_team', 'finished_at', 'survey_opened_at',
  'survey_closes_at', 'survey_expected_voters', 'survey_status', 'sede_place_id',
  'sede_direccion_normalizada', 'sede_latitud', 'sede_longitud', 'player_invites_enabled',
  'busca_arquero', 'precio_cancha_por_persona', 'equipos',
].join(', ');

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
