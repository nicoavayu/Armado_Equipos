import { supabase } from '../../lib/supabaseClient';
import logger from '../../utils/logger';

// Accent/case-insensitive identity for manual player names: "Fede" and "fedé"
// are the same person in a pasted WhatsApp roster.
export const nameKey = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

// Rows for the creator + the imported manual players. Deduplicates names and
// drops the creator if they also appear among the confirmed list.
export const buildImportedPlayerRows = ({
  partido,
  userId,
  creatorName,
  creatorAvatarUrl = null,
  confirmedNames = [],
}) => {
  const seen = new Set([nameKey(creatorName)]);
  const rows = [{
    partido_id: partido.id,
    match_ref: partido.match_ref,
    usuario_id: userId,
    nombre: creatorName,
    avatar_url: creatorAvatarUrl,
    score: 5,
    is_goalkeeper: false,
  }];

  for (const rawName of confirmedNames) {
    const nombre = String(rawName || '').trim();
    const key = nameKey(nombre);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      partido_id: partido.id,
      match_ref: partido.match_ref,
      usuario_id: null,
      nombre,
      avatar_url: null,
      score: 5,
      is_goalkeeper: false,
    });
  }

  return rows;
};

const fetchRosterKeys = async (partidoId) => {
  const { data, error } = await supabase
    .from('jugadores')
    .select('nombre, usuario_id')
    .eq('partido_id', partidoId);
  if (error) return null;
  return {
    names: new Set((data || []).map((row) => nameKey(row.nombre))),
    userIds: new Set((data || []).map((row) => row.usuario_id).filter(Boolean)),
  };
};

const isRowInRoster = (row, roster) => (
  row.usuario_id ? roster.userIds.has(row.usuario_id) : roster.names.has(nameKey(row.nombre))
);

// Insert the roster and report exactly what landed. The batch insert is
// atomic, so on failure we re-check the actual roster (the request may have
// been applied even if the response was lost) and salvage row by row without
// ever double-inserting. Returns { savedRows, failedRows, verified }:
// `verified` is false only when we could not re-read the roster to confirm.
// Pass `retry: true` on any attempt after the first one — manual players have
// no unique constraint, so a blind re-insert would duplicate the rows that
// did land the first time.
export const saveImportedPlayers = async ({ partidoId, rows, retry = false }) => {
  let pending = rows;
  if (retry) {
    const existing = await fetchRosterKeys(partidoId);
    if (!existing) return { savedRows: [], failedRows: rows, verified: false };
    pending = rows.filter((row) => !isRowInRoster(row, existing));
    if (pending.length === 0) return { savedRows: rows, failedRows: [], verified: true };
  }

  const { error: batchError } = await supabase.from('jugadores').insert(pending);
  if (!batchError) {
    return { savedRows: rows, failedRows: [], verified: true };
  }

  logger.error('[WHATSAPP_IMPORT] batch insert failed, salvaging row by row', {
    code: batchError?.code || null,
    message: batchError?.message || null,
    partidoId,
    rows: rows.length,
  });

  let roster = await fetchRosterKeys(partidoId);
  if (!roster) {
    // Can't see the current roster (offline?): retrying blindly could
    // duplicate players, so report everything as unconfirmed.
    return { savedRows: [], failedRows: rows, verified: false };
  }

  const failedRows = [];
  for (const row of rows) {
    if (isRowInRoster(row, roster)) continue;
    const { error: rowError } = await supabase.from('jugadores').insert(row);
    if (rowError) {
      logger.error('[WHATSAPP_IMPORT] player insert failed', {
        code: rowError?.code || null,
        message: rowError?.message || null,
        partidoId,
        nombre: row.nombre,
        usuarioId: row.usuario_id || null,
      });
      failedRows.push(row);
    }
  }

  // Final read so the report reflects the database, not our bookkeeping.
  roster = await fetchRosterKeys(partidoId);
  if (roster) {
    const confirmedFailed = rows.filter((row) => !isRowInRoster(row, roster));
    return {
      savedRows: rows.filter((row) => isRowInRoster(row, roster)),
      failedRows: confirmedFailed,
      verified: true,
    };
  }

  return {
    savedRows: rows.filter((row) => !failedRows.includes(row)),
    failedRows,
    verified: false,
  };
};
