import { supabase } from '../../lib/supabaseClient';

const CLOSED_MATCH_STATUSES = new Set(['cancelado', 'deleted', 'finalizado']);
const DEFAULT_MATCH_DURATION_MINUTES = 120;

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const parseLocalDateTime = (fecha, hora) => {
  const dateRaw = String(fecha || '').trim();
  const timeRaw = String(hora || '').trim();
  if (!dateRaw || !timeRaw) return null;

  const [y, m, d] = dateRaw.split('-').map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  const timeParts = timeRaw.split(':').map((v) => Number(v));
  const hh = Number.isFinite(timeParts[0]) ? timeParts[0] : 0;
  const mm = Number.isFinite(timeParts[1]) ? timeParts[1] : 0;
  const ss = Number.isFinite(timeParts[2]) ? timeParts[2] : 0;

  const dt = new Date(y, m - 1, d, hh, mm, ss, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
};

const buildInterval = (matchLike, durationMinutes = DEFAULT_MATCH_DURATION_MINUTES) => {
  const start = parseLocalDateTime(matchLike?.fecha, matchLike?.hora);
  if (!start) return null;
  const end = new Date(start.getTime() + Math.max(1, Number(durationMinutes) || DEFAULT_MATCH_DURATION_MINUTES) * 60000);
  return { start, end };
};

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

const isClosedMatch = (estado) => CLOSED_MATCH_STATUSES.has(normalizeText(estado));

export const findDuplicateTemplateMatch = async ({
  templateId,
  fecha,
  hora,
  sede,
}) => {
  if (!templateId || !fecha || !hora) return null;

  const sedeNorm = normalizeText(sede);

  const queryTemplateOnly = async () => {
    return supabase
      .from('partidos')
      .select('id, nombre, fecha, hora, sede, estado, template_id')
      .eq('template_id', templateId)
      .eq('fecha', fecha)
      .eq('hora', hora)
      .limit(50);
  };

  const queryLegacyOnly = async () => {
    return supabase
      .from('partidos')
      .select('id, nombre, fecha, hora, sede, estado, from_frequent_match_id')
      .eq('from_frequent_match_id', templateId)
      .eq('fecha', fecha)
      .eq('hora', hora)
      .limit(50);
  };

  let data = null;
  let error = null;

  ({ data, error } = await queryTemplateOnly());
  if (error) {
    const msg = String(error?.message || '').toLowerCase();
    const missingTemplate = msg.includes('template_id') && msg.includes('does not exist');
    if (!missingTemplate) throw error;

    ({ data, error } = await queryLegacyOnly());
    if (error) {
      const fallbackMsg = String(error?.message || '').toLowerCase();
      const missingLegacy = fallbackMsg.includes('from_frequent_match_id') && fallbackMsg.includes('does not exist');
      if (!missingLegacy) throw error;
      // Schema has no template linkage columns yet; skip duplicate guard gracefully.
      return null;
    }
  }

  const duplicate = (data || []).find((row) => {
    if (isClosedMatch(row?.estado)) return false;
    return normalizeText(row?.sede) === sedeNorm;
  });

  return duplicate || null;
};

export const findUserScheduleConflicts = async ({
  userId,
  targetMatch,
  excludeMatchId = null,
  durationMinutes = DEFAULT_MATCH_DURATION_MINUTES,
}) => {
  if (!userId || !targetMatch?.fecha || !targetMatch?.hora) return [];

  const targetInterval = buildInterval(targetMatch, durationMinutes);
  if (!targetInterval) return [];

  const { data: rosterRows, error: rosterError } = await supabase
    .from('jugadores')
    .select('partido_id')
    .eq('usuario_id', userId);

  if (rosterError) throw rosterError;

  const matchIds = [...new Set((rosterRows || []).map((r) => Number(r.partido_id)).filter((id) => Number.isFinite(id)))];
  if (matchIds.length === 0) return [];

  const { data: matches, error: matchesError } = await supabase
    .from('partidos')
    .select('id, nombre, fecha, hora, sede, estado')
    .in('id', matchIds);

  if (matchesError) throw matchesError;

  const conflicts = (matches || []).filter((matchRow) => {
    if (!matchRow?.fecha || !matchRow?.hora) return false;
    if (excludeMatchId && Number(matchRow.id) === Number(excludeMatchId)) return false;
    if (isClosedMatch(matchRow?.estado)) return false;
    const interval = buildInterval(matchRow, durationMinutes);
    if (!interval) return false;
    return overlaps(targetInterval, interval);
  });

  return conflicts;
};
