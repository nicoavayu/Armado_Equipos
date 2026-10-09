import logger from '../utils/logger';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import LoadingSpinner from '../components/LoadingSpinner';
import { supabase } from '../supabase';
import { ensureParticipantsSnapshot } from '../services/historySnapshotService';
import { normalizeAwardType } from '../services/db/userIdentity';
import AvatarFallback from '../components/AvatarFallback';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';
import { buildHomonymHints } from '../utils/surveyRosterIdentity';

const fmtDateShort = (ymd) => {
  if (!ymd) return '—';
  try {
    const d = new Date(`${ymd}T00:00:00`);
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', year: 'numeric' });
  } catch (_e) {
    return String(ymd);
  }
};

const fmtWeekday = (ymd) => {
  if (!ymd) return 'Fecha';
  try {
    return new Date(`${ymd}T00:00:00`).toLocaleDateString('es-AR', { weekday: 'long' });
  } catch (_e) {
    return 'Fecha';
  }
};

const fmtTime = (hhmm) => {
  if (!hhmm) return '—';
  return String(hhmm).slice(0, 5);
};

const fmtDateLong = (ymd) => {
  if (!ymd) return '—';
  try {
    const d = new Date(`${ymd}T00:00:00`);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (_e) {
    return String(ymd);
  }
};

const formatSentenceCase = (value, fallback = '') => {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const compactVenueLabel = (venue) => {
  const text = String(venue || '').trim();
  if (!text) return 'Sin dato';

  const firstChunk = text.split(',')[0]?.trim() || text;
  const beforeDash = firstChunk.split(' - ')[0]?.trim() || firstChunk;
  return formatSentenceCase(beforeDash, 'Sin dato');
};

const winnerLabel = (winnerTeam) => {
  if (!winnerTeam) return 'Sin definir';
  const normalized = String(winnerTeam).trim().toLowerCase();
  if (normalized === 'equipo_a' || normalized === 'a' || normalized === 'team_a') return 'Equipo A';
  if (normalized === 'equipo_b' || normalized === 'b' || normalized === 'team_b') return 'Equipo B';
  if (normalized === 'empate' || normalized === 'draw') return 'Empate';
  return String(winnerTeam);
};

const matchStateLabel = (estado, resultStatus) => {
  const normalizedEstado = String(estado || '').trim().toLowerCase();
  if (normalizedEstado === 'finalizado' || normalizedEstado === 'finished') return 'Finalizado';
  if (normalizedEstado === 'active' || normalizedEstado === 'activo') return 'Activo';
  if (normalizedEstado === 'cancelado' || normalizedEstado === 'cancelled') return 'Cancelado';
  if (normalizedEstado === 'pendiente' || normalizedEstado === 'pending') return 'Pendiente';

  const normalizedResult = normalizeResultStatus(resultStatus);
  if (normalizedResult === 'finished') return 'Finalizado';
  if (normalizedResult === 'draw') return 'Empatado';
  if (normalizedResult === 'not_played') return 'No jugado';
  if (normalizedResult === 'pending') return 'Pendiente';

  return formatSentenceCase(estado || resultStatus, 'Pendiente');
};

const normalizeResultStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'finished' || normalized === 'played') return 'finished';
  if (normalized === 'draw' || normalized === 'empate') return 'draw';
  if (normalized === 'not_played' || normalized === 'cancelled' || normalized === 'cancelado') return 'not_played';
  if (normalized === 'pending' || normalized === 'pendiente') return 'pending';
  return null;
};

const normalizeWinnerTeam = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'equipo_a' || normalized === 'a' || normalized === 'team_a') return 'equipo_a';
  if (normalized === 'equipo_b' || normalized === 'b' || normalized === 'team_b') return 'equipo_b';
  if (normalized === 'empate' || normalized === 'draw') return 'empate';
  return null;
};

const isClosedHistoryResult = (row) => {
  const status = normalizeResultStatus(row?.result_status);
  if (status === 'pending' || status === 'not_played') return false;
  if (status === 'finished' || status === 'draw') return true;
  const winner = normalizeWinnerTeam(row?.winner_team);
  return winner === 'equipo_a' || winner === 'equipo_b' || winner === 'empate';
};

const resolveSnapshotPlayer = (value, resolveName) => {
  if (!value) return 'Sin dato';
  if (typeof value === 'object') {
    const ref = value?.player_id || value?.ref || value?.uuid || value?.usuario_id || value?.id;
    if (ref != null) return resolveName(ref);
    if (value?.nombre) return String(value.nombre);
    return 'Sin dato';
  }
  return resolveName(value);
};

const ResultStatusPill = ({ ready, fullWidth = false }) => (
  <div className={`${fullWidth ? 'w-full justify-center' : 'inline-flex'} inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border whitespace-nowrap ${ready ? 'bg-emerald-500/10 border-emerald-300/35 text-emerald-200' : 'bg-amber-500/10 border-amber-300/35 text-amber-100'}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-300' : 'bg-amber-300'}`}></span>
    <span className="font-oswald text-[11px] uppercase tracking-wide leading-none">{ready ? 'Resultados listos' : 'Resultados pendientes'}</span>
  </div>
);

const PlayerRow = ({ player, hint = null }) => (
  <div className="flex items-center gap-1.5 bg-[rgba(20,16,41,0.85)] border border-[rgba(148,134,255,0.18)] rounded-xl px-2 py-1.5">
    {player?.avatar_url ? (
      <img
        src={player.avatar_url}
        alt={player.nombre || 'Jugador'}
        className="w-6 h-6 rounded-full object-cover border border-[rgba(148,134,255,0.3)] bg-[#1d1740] shrink-0"
      />
    ) : (
      <AvatarFallback name={player?.nombre || 'Jugador'} size="w-6 h-6" className="text-[10px] bg-[#272050] border-[rgba(148,134,255,0.4)]" />
    )}
    <span className="min-w-0 flex flex-col">
      <span lang="es" className="font-oswald text-[13px] text-white/90 leading-tight break-words [hyphens:auto]">{player?.nombre || 'Jugador'}</span>
      {hint ? <span className="text-[10.5px] text-white/50 leading-tight">{hint}</span> : null}
    </span>
  </div>
);

const TeamColumn = ({ title, team = [], resolvePlayer, hintFor }) => (
  <div className="relative bg-black/25 border border-[rgba(148,134,255,0.16)] rounded-2xl p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden">
    <div className="font-bebas text-base text-white uppercase tracking-wider mb-2 flex items-center gap-2">
      <span aria-hidden="true" className="w-1 h-[14px] rounded-full bg-[linear-gradient(180deg,#ec007d,#8b5cff)] shrink-0" />
      {title}
    </div>
    {team.length === 0 ? (
      <div className="text-white/50 text-sm font-oswald">Sin equipos confirmados.</div>
    ) : (
      <div className="grid grid-cols-1 gap-1.5">
        {team.map((ref) => (
          <PlayerRow key={String(ref)} player={resolvePlayer(ref)} hint={hintFor(resolvePlayer(ref))} />
        ))}
      </div>
    )}
  </div>
);

const AwardRow = ({ title, icon, playerName }) => (
  <div className="flex items-center gap-2.5 bg-[rgba(20,16,41,0.8)] border border-[rgba(148,134,255,0.18)] rounded-xl px-2.5 py-2">
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[linear-gradient(140deg,rgba(139,92,255,0.28),rgba(106,67,255,0.08))] border border-[rgba(148,134,255,0.3)] shrink-0">
      <img src={icon} alt={title} className="w-6 h-6 object-contain" />
    </span>
    <div className="min-w-0">
      <div className="font-sans text-[10px] font-bold text-[#b0a0ff]/85 uppercase tracking-[0.14em] leading-none">{title}</div>
      <div lang="es" className="font-oswald text-[14px] font-semibold text-white mt-1 leading-tight break-words [hyphens:auto]">{playerName || 'Sin dato'}</div>
    </div>
  </div>
);

const TemplateHistoryPage = () => {
  const { templateId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [template, setTemplate] = useState(location.state?.template || null);
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState([]);
  const [snapshots, setSnapshots] = useState(new Map());
  const [results, setResults] = useState(new Map());
  const [fallbackAbsentCountByMatch, setFallbackAbsentCountByMatch] = useState(new Map());
  const [counts, setCounts] = useState(new Map());
  const [selectedId, setSelectedId] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (template || !templateId) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('partidos_frecuentes')
        .select('*')
        .eq('id', templateId)
        .single();
      if (!alive) return;
      if (!error && data) setTemplate(data);
    })();
    return () => { alive = false; };
  }, [template, templateId]);

  useEffect(() => {
    if (!templateId) return;
    let alive = true;

    const load = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        let partidos = [];
        const baseSelect = 'id, nombre, fecha, hora, sede, estado, template_id';

        const { data: byTemplate, error: byTemplateErr } = await supabase
          .from('partidos')
          .select(baseSelect)
          .eq('template_id', String(templateId))
          .order('fecha', { ascending: false })
          .limit(80);

        if (byTemplateErr) {
          const msg = String(byTemplateErr?.message || '').toLowerCase();
          const missingTemplate = msg.includes('template_id') && msg.includes('does not exist');
          if (!missingTemplate) throw byTemplateErr;

          const { data: byLegacy, error: byLegacyErr } = await supabase
            .from('partidos')
            .select('id, nombre, fecha, hora, sede, estado')
            .eq('from_frequent_match_id', String(templateId))
            .order('fecha', { ascending: false })
            .limit(80);
          if (byLegacyErr) {
            const legacyMsg = String(byLegacyErr?.message || '').toLowerCase();
            const missingLegacy = legacyMsg.includes('from_frequent_match_id') && legacyMsg.includes('does not exist');
            if (!missingLegacy) throw byLegacyErr;
            partidos = [];
          } else {
            partidos = byLegacy || [];
          }
        } else {
          partidos = byTemplate || [];
          partidos.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || String(b.hora || '').localeCompare(String(a.hora || '')));
        }

        const matchIds = partidos.map((p) => Number(p.id)).filter((n) => Number.isFinite(n));
        await Promise.all(matchIds.map((id) => ensureParticipantsSnapshot(id)));

        const snapMap = new Map();
        if (matchIds.length > 0) {
          const { data: snapRows } = await supabase
            .from('partido_team_confirmations')
            .select('partido_id, participants, team_a, team_b, teams_json, confirmed_at')
            .in('partido_id', matchIds);
          (snapRows || []).forEach((r) => snapMap.set(Number(r.partido_id), r));
        }

        const resMap = new Map();
        if (matchIds.length > 0) {
          const { data: resRows } = await supabase
            .from('survey_results')
            .select('partido_id, winner_team, scoreline, result_status, resultados_encuesta_listos, snapshot_participantes, snapshot_equipos, snapshot_resultados_encuesta')
            .in('partido_id', matchIds);
          (resRows || []).forEach((r) => resMap.set(Number(r.partido_id), r));
        }

        // Fallback for environments where survey_results is not readable by client due RLS:
        // infer "resultados listos" + premios from player_awards (which is readable).
        if (matchIds.length > 0) {
          const missingForResults = matchIds.filter((id) => !resMap.has(Number(id)));
          if (missingForResults.length > 0) {
            const { data: awardRows } = await supabase
              .from('player_awards')
              .select('partido_id, award_type, jugador_id')
              .in('partido_id', missingForResults);

            const byMatchAwards = new Map();
            (awardRows || []).forEach((row) => {
              const key = Number(row.partido_id);
              if (!byMatchAwards.has(key)) byMatchAwards.set(key, []);
              byMatchAwards.get(key).push(row);
            });

            missingForResults.forEach((id) => {
              const rows = byMatchAwards.get(Number(id)) || [];
              if (rows.length === 0) return;

              const mvp = rows.find((r) => normalizeAwardType(r?.award_type) === 'mvp')?.jugador_id || null;
              const gk = rows.find((r) => normalizeAwardType(r?.award_type) === 'best_gk')?.jugador_id || null;
              const dirty = rows.find((r) => normalizeAwardType(r?.award_type) === 'red_card')?.jugador_id || null;

              resMap.set(Number(id), {
                partido_id: Number(id),
                winner_team: null,
                scoreline: null,
                result_status: 'finished',
                resultados_encuesta_listos: true,
                snapshot_participantes: null,
                snapshot_equipos: null,
                snapshot_resultados_encuesta: {
                  version: 1,
                  mvp,
                  golden_glove: gk,
                  mas_sucio: dirty,
                  red_cards: dirty ? [dirty] : [],
                  ausentes: [],
                  source: 'player_awards_fallback',
                },
              });
            });
          }
        }

        const cntMap = new Map();
        if (matchIds.length > 0) {
          const { data: jugRows } = await supabase
            .from('jugadores')
            .select('partido_id')
            .in('partido_id', matchIds);
          (jugRows || []).forEach((r) => {
            const k = Number(r.partido_id);
            cntMap.set(k, (cntMap.get(k) || 0) + 1);
          });
        }

        const absentCountMap = new Map();
        if (matchIds.length > 0) {
          try {
            const { data: surveyRows, error: surveyRowsErr } = await supabase
              .from('post_match_surveys')
              .select('partido_id, jugadores_ausentes')
              .in('partido_id', matchIds);

            if (!surveyRowsErr) {
              const byMatch = new Map();
              (surveyRows || []).forEach((row) => {
                const mid = Number(row?.partido_id);
                if (!Number.isFinite(mid)) return;

                const absents = Array.isArray(row?.jugadores_ausentes) ? row.jugadores_ausentes : [];
                if (absents.length === 0) return;

                if (!byMatch.has(mid)) byMatch.set(mid, new Set());
                const set = byMatch.get(mid);
                absents.forEach((id) => set.add(String(id)));
              });
              byMatch.forEach((set, mid) => absentCountMap.set(mid, set.size));
            }
          } catch (_error) {
            // Non-blocking fallback.
          }
        }

        const mergedSnapshots = new Map();
        matchIds.forEach((id) => {
          const teamSnap = snapMap.get(Number(id));
          const resultRow = resMap.get(Number(id));
          const surveyParticipants = Array.isArray(resultRow?.snapshot_participantes) ? resultRow.snapshot_participantes : null;
          const surveyTeams = resultRow?.snapshot_equipos || null;

          mergedSnapshots.set(Number(id), {
            partido_id: Number(id),
            participants: surveyParticipants || teamSnap?.participants || [],
            team_a: Array.isArray(surveyTeams?.team_a) ? surveyTeams.team_a : (teamSnap?.team_a || []),
            team_b: Array.isArray(surveyTeams?.team_b) ? surveyTeams.team_b : (teamSnap?.team_b || []),
            teams_json: surveyTeams?.teams_json || teamSnap?.teams_json || null,
          });
        });

        const closedMatches = (partidos || []).filter((match) => {
          const resultRow = resMap.get(Number(match.id));
          return isClosedHistoryResult(resultRow);
        });

        if (!alive) return;
        setMatches(closedMatches);
        setResults(resMap);
        setSnapshots(mergedSnapshots);
        setFallbackAbsentCountByMatch(absentCountMap);
        setCounts(cntMap);
      } catch (error) {
        logger.error('[TemplateHistoryPage] load error', error);
        if (!alive) return;
        setLoadError(true);
        setMatches([]);
        setResults(new Map());
        setSnapshots(new Map());
        setFallbackAbsentCountByMatch(new Map());
        setCounts(new Map());
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => { alive = false; };
  }, [templateId, reloadKey]);

  const selectedMatch = useMemo(() => {
    const id = Number(selectedId);
    if (!Number.isFinite(id)) return null;
    return matches.find((m) => Number(m.id) === id) || null;
  }, [matches, selectedId]);

  const selectedSnapshot = selectedMatch ? snapshots.get(Number(selectedMatch.id)) : null;
  const selectedResult = selectedMatch ? results.get(Number(selectedMatch.id)) : null;

  const participants = Array.isArray(selectedSnapshot?.participants) ? selectedSnapshot.participants : [];
  const teamA = Array.isArray(selectedSnapshot?.team_a) ? selectedSnapshot.team_a : [];
  const teamB = Array.isArray(selectedSnapshot?.team_b) ? selectedSnapshot.team_b : [];
  const resultSnapshot = selectedResult?.snapshot_resultados_encuesta || null;
  const resultsReady = Boolean(selectedResult?.resultados_encuesta_listos);
  const teamsConfirmed = teamA.length > 0 || teamB.length > 0;

  const nameByRef = useMemo(() => {
    const map = new Map();
    participants.forEach((p) => {
      const keys = [p?.ref, p?.uuid, p?.usuario_id, p?.id].filter(Boolean).map((k) => String(k));
      keys.forEach((k) => map.set(k, p?.nombre || 'Jugador'));
    });
    return map;
  }, [participants]);

  const playerByRef = useMemo(() => {
    const map = new Map();
    participants.forEach((p) => {
      const keys = [p?.ref, p?.uuid, p?.usuario_id, p?.id].filter(Boolean).map((k) => String(k));
      keys.forEach((k) => map.set(k, p));
    });
    return map;
  }, [participants]);

  // Same name, different people: a short hint, never merged (identity = snapshot ref).
  const participantKey = (p) => String(p?.ref || p?.uuid || p?.usuario_id || p?.id || '');
  const hintsByKey = useMemo(() => buildHomonymHints(participants.map((p) => ({
    uuid: participantKey(p),
    usuario_id: p?.usuario_id || null,
    nombre: p?.nombre,
  }))), [participants]);
  const hintFor = (player) => hintsByKey.get(participantKey(player)) || null;

  const resolveName = (ref) => nameByRef.get(String(ref)) || 'Jugador';
  const resolvePlayer = (ref) => {
    const found = playerByRef.get(String(ref));
    if (found) return found;
    return { nombre: resolveName(ref), avatar_url: null };
  };
  const rawScoreline = selectedResult?.scoreline ?? resultSnapshot?.scoreline ?? null;
  const normalizedScoreline = typeof rawScoreline === 'string' ? rawScoreline.trim() : rawScoreline;
  const hasScoreline = Boolean(normalizedScoreline);
  const snapshotAusentesCount = Array.isArray(resultSnapshot?.ausentes) ? resultSnapshot.ausentes.length : null;
  const selectedMatchId = Number(selectedMatch?.id);
  const fallbackAusentesCount = Number.isFinite(selectedMatchId) ? (fallbackAbsentCountByMatch.get(selectedMatchId) || 0) : 0;
  const ausentesCount = snapshotAusentesCount ?? fallbackAusentesCount;
  const displayMatchState = matchStateLabel(
    selectedMatch?.estado,
    selectedResult?.result_status || resultSnapshot?.result_status,
  );
  const goBackSmart = useSmartBackNavigation({
    fallback: '/frecuentes',
  });

  const isDetail = Boolean(selectedMatch);

  return (
    <div
      className="w-full max-w-[650px] mx-auto flex flex-col items-center pt-24 pb-32 px-4 box-border"
      style={{ transform: 'translateZ(0)' }}
    >
      <PageTitle title="HISTORIAL" onBack={() => {
        if (isDetail) {
          setSelectedId(null);
          return;
        }
        goBackSmart();
      }}
      >
        HISTORIAL
      </PageTitle>

      <div className="relative w-full mt-1 rounded-card border border-[rgba(148,134,255,0.2)] bg-[linear-gradient(165deg,rgba(48,38,98,0.65),rgba(20,16,41,0.94))] p-4 shadow-elev-1 overflow-hidden after:content-[''] after:absolute after:top-0 after:inset-x-0 after:h-px after:bg-[linear-gradient(90deg,transparent_6%,rgba(176,160,255,0.45)_42%,rgba(236,0,125,0.3)_68%,transparent_94%)] after:pointer-events-none">
        {!isDetail && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-sans text-[10px] font-bold uppercase tracking-[0.18em] text-[#b0a0ff]/80">Plantilla</div>
              <div className="font-oswald text-[20px] font-semibold leading-tight text-white break-words mt-0.5">
                {String(template?.nombre || '').trim() || 'Plantilla'}
              </div>
            </div>
            {matches.length > 0 && (
              <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full border border-[rgba(148,134,255,0.3)] bg-[rgba(106,67,255,0.14)] font-sans text-[11px] font-bold text-[#cfc4ff] whitespace-nowrap">
                {matches.length} {matches.length === 1 ? 'partido' : 'partidos'}
              </span>
            )}
          </div>
        )}

        {loading ? (
          <div className="py-14 flex flex-col items-center justify-center gap-3" role="status">
            <LoadingSpinner size="large" />
            <span className="text-white/60 text-[13px]">Cargando el historial…</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center text-center gap-3 py-8 px-4 border border-dashed border-[rgba(244,63,94,0.35)] rounded-2xl bg-white/[0.025] mt-5" role="alert">
            <div className="text-white/85 font-oswald text-base">No pudimos cargar el historial.</div>
            <div className="text-white/55 text-[13px]">Revisá tu conexión y probá de nuevo.</div>
            <button
              type="button"
              onClick={() => setReloadKey((n) => n + 1)}
              className="min-h-[44px] px-6 rounded-xl font-bebas font-semibold text-[15px] tracking-[0.02em] whitespace-nowrap text-white bg-white/[0.06] border border-[rgba(148,134,255,0.28)] hover:bg-white/[0.12] active:scale-[0.985] transition-all"
            >
              Reintentar
            </button>
          </div>
        ) : matches.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-10 px-4 border border-dashed border-[rgba(148,134,255,0.25)] rounded-2xl bg-white/[0.025] mt-5">
            <div className="text-white/80 font-oswald text-base">Todavía no hay partidos jugados con esta plantilla.</div>
            <div className="text-white/55 text-[13px] leading-snug max-w-[300px]">Los partidos que crees desde acá aparecen cuando se cierre su encuesta.</div>
          </div>
        ) : (
          <>
            {!isDetail ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {matches.map((m) => {
                  const mid = Number(m.id);
                  const res = results.get(mid);
                  const ready = Boolean(res?.resultados_encuesta_listos);

                  return (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => setSelectedId(mid)}
                      className="group text-left rounded-2xl p-3 border border-[rgba(148,134,255,0.2)] bg-[linear-gradient(168deg,rgba(40,31,84,0.6),rgba(16,12,33,0.85))] hover:border-[rgba(148,134,255,0.5)] transition-[border-color,transform] duration-150 active:scale-[0.985] min-h-[104px] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-sans text-[9.5px] font-bold uppercase tracking-[0.18em] text-[#b0a0ff]/75">{fmtWeekday(m.fecha)}</span>
                        <span className="w-full font-bebas text-[20px] text-white leading-6 text-center truncate">
                          {fmtDateShort(m.fecha)}
                        </span>
                        <span className="font-sans text-[11.5px] text-white/55 leading-none">{fmtTime(m.hora)} hs</span>
                      </div>
                      {ready && res?.winner_team ? (
                        <div className="mt-2 text-center font-oswald text-[12.5px] text-white/85 truncate">
                          {normalizeWinnerTeam(res.winner_team) === 'empate' ? 'Empate' : `Ganó ${winnerLabel(res.winner_team)}`}
                        </div>
                      ) : null}
                      <div className="mt-2.5 w-full">
                        <div className="w-full flex">
                          <ResultStatusPill ready={ready} fullWidth />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-1 flex flex-col gap-3">
                <div className="relative rounded-2xl border border-[rgba(148,134,255,0.2)] bg-[linear-gradient(168deg,rgba(56,44,116,0.6),rgba(20,16,41,0.85))] px-3.5 py-3 overflow-hidden after:content-[''] after:absolute after:top-0 after:inset-x-0 after:h-px after:bg-[linear-gradient(90deg,transparent_6%,rgba(176,160,255,0.5)_42%,rgba(236,0,125,0.32)_68%,transparent_94%)] after:pointer-events-none">
                  <div className="font-sans text-[10px] font-bold uppercase tracking-[0.18em] text-[#b0a0ff]/80">Ficha del partido</div>
                  <div className="mt-1 font-bebas text-[24px] leading-7 text-white uppercase tracking-wide whitespace-nowrap">
                    {fmtDateLong(selectedMatch?.fecha)} · {fmtTime(selectedMatch?.hora)}
                  </div>
                  <div className="mt-1 text-white/70 text-[12.5px] font-sans font-medium truncate normal-case flex items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="12" height="12" fill="#cfc4ff" aria-hidden>
                      <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
                    </svg>
                    <span className="truncate">{compactVenueLabel(selectedMatch?.sede)}</span>
                  </div>
                </div>

                <div className="font-bebas text-base text-white uppercase tracking-wider flex items-center gap-2">
                  <span aria-hidden="true" className="w-1 h-[14px] rounded-full bg-[linear-gradient(180deg,#ec007d,#8b5cff)] shrink-0" />
                  {teamsConfirmed ? 'Equipos confirmados' : 'Participantes'}
                </div>

                {teamsConfirmed ? (
                  <div className="grid grid-cols-2 gap-2">
                    <TeamColumn title="Equipo A" team={teamA} resolvePlayer={resolvePlayer} hintFor={hintFor} />
                    <TeamColumn title="Equipo B" team={teamB} resolvePlayer={resolvePlayer} hintFor={hintFor} />
                  </div>
                ) : (
                  <>
                    {participants.length === 0 ? (
                      <div className="text-white/50 text-sm font-oswald">Sin participantes en snapshot.</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        {participants.map((p, idx) => (
                          <PlayerRow key={`${p?.ref || p?.uuid || p?.usuario_id || p?.id || idx}`} player={p} hint={hintFor(p)} />
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className="grid grid-cols-2 gap-2 items-start">
                  <div className="relative bg-black/25 border border-[rgba(148,134,255,0.16)] rounded-2xl p-2.5 self-start shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden">
                    <div className="font-bebas text-base text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                      <span aria-hidden="true" className="w-1 h-[14px] rounded-full bg-[linear-gradient(180deg,#ec007d,#8b5cff)] shrink-0" />
                      Resultado
                    </div>
                    {!resultsReady ? (
                      <div className="grid grid-cols-1 gap-1.5 text-xs font-oswald text-white/80">
                        <span className="inline-flex w-fit items-center gap-1.5 px-2 py-0.5 rounded-full border border-amber-300/35 bg-amber-500/10 text-amber-100 font-sans text-[10.5px] font-bold uppercase tracking-wide">{displayMatchState}</span>
                        <div className="text-white/60">Pendiente hasta cierre de encuesta.</div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-1.5">
                        <span className="inline-flex w-fit items-center gap-1.5 px-2 py-0.5 rounded-full border border-emerald-300/35 bg-emerald-500/10 text-emerald-200 font-sans text-[10.5px] font-bold uppercase tracking-wide">{displayMatchState}</span>
                        <div>
                          <div className="font-sans text-[10px] font-bold text-[#b0a0ff]/80 uppercase tracking-[0.14em]">Ganador</div>
                          <div className="font-bebas text-[20px] leading-6 text-white">{winnerLabel(selectedResult?.winner_team || resultSnapshot?.winner_team)}</div>
                        </div>
                        {hasScoreline ? (
                          <div>
                            <div className="font-sans text-[10px] font-bold text-[#b0a0ff]/80 uppercase tracking-[0.14em]">Marcador</div>
                            <div className="font-bebas text-[20px] leading-6 text-white">{normalizedScoreline}</div>
                          </div>
                        ) : null}
                        <div className="text-xs font-oswald text-white/70">Ausentes: {ausentesCount}</div>
                      </div>
                    )}
                  </div>

                  <div className="relative bg-black/25 border border-[rgba(148,134,255,0.16)] rounded-2xl p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden">
                    <div className="font-bebas text-base text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                      <span aria-hidden="true" className="w-1 h-[14px] rounded-full bg-[linear-gradient(180deg,#ec007d,#8b5cff)] shrink-0" />
                      Premios
                    </div>
                    {!resultsReady ? (
                      <div className="text-white/60 text-xs font-oswald">Esperando resultados.</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {[
                          { title: 'MVP', icon: '/mvp.webp', value: resultSnapshot?.mvp },
                          { title: 'Mejor arquero', icon: '/glove.webp', value: resultSnapshot?.golden_glove },
                          { title: 'Más sucio', icon: '/red_card.webp', value: resultSnapshot?.mas_sucio },
                        ].filter((award) => award.value).map((award) => (
                          <AwardRow key={award.title} title={award.title} icon={award.icon} playerName={resolveSnapshotPlayer(award.value, resolveName)} />
                        ))}
                        {!resultSnapshot?.mvp && !resultSnapshot?.golden_glove && !resultSnapshot?.mas_sucio ? (
                          <div className="text-white/60 text-xs font-oswald">No hubo premios en este partido.</div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TemplateHistoryPage;
