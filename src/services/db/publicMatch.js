// Same entry point as the public pages that call this (and their tests' mocks).
import { supabase } from '../../supabase';

const isMissingFunctionError = (error) => {
  const code = String(error?.code || '').trim();
  return code === 'PGRST202' || code === '42883';
};

/**
 * One match and its roster, read with the match code (public links: WhatsApp voting,
 * guest invitations). Without a session this is the only read anon has on matches
 * (20261010125000): a code opens its own match, never the list.
 * @returns {Promise<{ partido: object|null, jugadores: Array<object>, error: object|null, unsupported: boolean }>}
 *   `unsupported` = the backend predates the RPC (callers may fall back to table reads).
 */
export async function fetchPublicMatchByCode({ codigo, partidoId = null } = {}) {
  const code = String(codigo || '').trim();
  if (!code) return { partido: null, jugadores: [], error: null, unsupported: false };

  const numericId = Number(partidoId);
  const { data, error } = await supabase.rpc('public_get_match_by_code', {
    p_codigo: code,
    p_partido_id: Number.isInteger(numericId) && numericId > 0 ? numericId : null,
  });

  if (error) {
    return { partido: null, jugadores: [], error, unsupported: isMissingFunctionError(error) };
  }

  return {
    partido: data?.partido || null,
    jugadores: Array.isArray(data?.jugadores) ? data.jugadores : [],
    error: null,
    unsupported: false,
  };
}
