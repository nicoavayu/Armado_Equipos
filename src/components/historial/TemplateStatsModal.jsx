import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import LoadingSpinner from '../LoadingSpinner';
import { CalendarClock, Users, Trophy, X, ChevronRight } from 'lucide-react';
import { ensureParticipantsSnapshot } from '../../services/historySnapshotService';

const fmtDateShort = (ymd) => {
  if (!ymd) return '—';
  try {
    const d = new Date(`${ymd}T00:00:00`);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  } catch (_e) {
    return String(ymd);
  }
};

const fmtTime = (hhmm) => {
  if (!hhmm) return '—';
  return String(hhmm).slice(0, 5);
};

function ResultPill({ winnerTeam, scoreline, resultsReady = false }) {
  if (!resultsReady) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-300/30">
        <Trophy size={16} className="text-amber-300" />
        <div className="font-oswald text-xs text-amber-100 uppercase tracking-wide">
          Resultados pendientes
        </div>
      </div>
    );
  }

  let label = 'Sin resultado';
  if (winnerTeam === 'equipo_a') label = 'Ganó A';
  if (winnerTeam === 'equipo_b') label = 'Ganó B';
  if (winnerTeam === 'empate') label = 'Empate';
  const sub = scoreline ? String(scoreline).trim() : '';

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
      <Trophy size={16} className="text-[#f4d03f]" />
      <div className="font-oswald text-xs text-white/85 uppercase tracking-wide">
        {label}{sub ? ` · ${sub}` : ''}
      </div>
    </div>
  );
}

function MatchDetailsModal({ open, match, snapshot, resultRow, onClose }) {
  const participants = Array.isArray(snapshot?.participants) ? snapshot.participants : [];
  const teamA = Array.isArray(snapshot?.team_a) ? snapshot.team_a : [];
  const teamB = Array.isArray(snapshot?.team_b) ? snapshot.team_b : [];

  const nameByRef = useMemo(() => {
    const m = new Map();
    participants.forEach((p) => {
      const keys = [p?.ref, p?.uuid, p?.usuario_id, p?.id].filter(Boolean).map((v) => String(v));
      keys.forEach((k) => m.set(k, p?.nombre || 'Jugador'));
    });
    return m;
  }, [participants]);
  const resolveName = (ref) => nameByRef.get(String(ref)) || 'Jugador';
  const surveySnapshot = resultRow?.snapshot_resultados_encuesta || null;
  const resultsReady = Boolean(resultRow?.resultados_encuesta_listos);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[5200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2rem] shadow-[0_32px_64px_rgba(0,0,0,0.5)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div>
            <div className="font-bebas text-2xl text-white uppercase tracking-wider truncate">{match?.nombre || 'Partido'}</div>
            <div className="flex items-center gap-2 text-white/60 text-xs font-oswald uppercase tracking-widest mt-1">
              <CalendarClock size={16} className="text-white/50" />
              {fmtDateShort(match?.fecha)} · {fmtTime(match?.hora)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
              <Users size={16} className="text-[#0EA9C6]" />
              <div className="font-oswald text-xs text-white/85 uppercase tracking-wide">
                {participants.length ? `${participants.length} jugadores` : 'Participantes no disponibles'}
              </div>
            </div>
            <ResultPill winnerTeam={resultRow?.winner_team} scoreline={resultRow?.scoreline} resultsReady={resultsReady} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-black/20 border border-white/10 rounded-2xl p-4">
              <div className="font-bebas text-lg text-white uppercase tracking-wider mb-2">Equipo A</div>
              {teamA.length === 0 ? (
                <div className="text-white/50 text-sm font-oswald">Sin equipos confirmados.</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {teamA.map((u) => (
                    <div key={u} className="text-white/80 text-sm font-oswald truncate">
                      {resolveName(u)}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-black/20 border border-white/10 rounded-2xl p-4">
              <div className="font-bebas text-lg text-white uppercase tracking-wider mb-2">Equipo B</div>
              {teamB.length === 0 ? (
                <div className="text-white/50 text-sm font-oswald">Sin equipos confirmados.</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {teamB.map((u) => (
                    <div key={u} className="text-white/80 text-sm font-oswald truncate">
                      {resolveName(u)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {participants.length > 0 && (
            <div className="bg-black/20 border border-white/10 rounded-2xl p-4">
              <div className="font-bebas text-lg text-white uppercase tracking-wider mb-2">Participantes</div>
              <div className="grid grid-cols-2 gap-2">
                {participants.map((p, idx) => (
                  <div key={`${p?.uuid || p?.usuario_id || idx}`} className="text-white/75 text-sm font-oswald truncate">
                    {p?.nombre || 'Jugador'}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-black/20 border border-white/10 rounded-2xl p-4">
            <div className="font-bebas text-lg text-white uppercase tracking-wider mb-2">Resultados de Encuesta</div>
            {!resultsReady ? (
              <div className="text-white/60 text-sm font-oswald">
                Resultados pendientes. La encuesta todavía no cerró.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1 text-sm font-oswald text-white/80">
                <div>MVP: {surveySnapshot?.mvp ? resolveName(surveySnapshot.mvp?.player_id || surveySnapshot.mvp) : 'Sin dato'}</div>
                <div>Más sucio: {surveySnapshot?.mas_sucio?.player_id ? resolveName(surveySnapshot.mas_sucio.player_id) : (surveySnapshot?.mas_sucio ? resolveName(surveySnapshot.mas_sucio) : 'Sin dato')}</div>
                <div>Ausentes: {Array.isArray(surveySnapshot?.ausentes) ? surveySnapshot.ausentes.length : 0}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TemplateStatsModal({ isOpen, template, onClose }) {
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState([]);
  const [snapshots, setSnapshots] = useState(new Map());
  const [results, setResults] = useState(new Map());
  const [counts, setCounts] = useState(new Map());
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!isOpen || !template?.id) return;

    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const templateId = String(template.id);

        // 1) Fetch matches for this template (new column preferred, legacy fallback)
        let partidos = [];
        const baseSelect = 'id, nombre, fecha, hora, sede, estado, template_id';

        const { data: byTemplate, error: byTemplateErr } = await supabase
          .from('partidos')
          .select(baseSelect)
          .eq('template_id', templateId)
          .order('fecha', { ascending: false })
          .limit(80);

        if (byTemplateErr) {
          // Most likely "column template_id does not exist" on old DBs.
          const { data: byLegacy, error: byLegacyErr } = await supabase
            .from('partidos')
            .select('id, nombre, fecha, hora, sede, estado')
            .eq('from_frequent_match_id', templateId)
            .order('fecha', { ascending: false })
            .limit(80);
          if (byLegacyErr) {
            const fallbackMsg = String(byLegacyErr?.message || '').toLowerCase();
            const missingLegacy = fallbackMsg.includes('from_frequent_match_id') && fallbackMsg.includes('does not exist');
            if (!missingLegacy) throw byLegacyErr;
            partidos = [];
          } else {
            partidos = byLegacy || [];
          }
        } else {
          partidos = byTemplate || [];
          // Add legacy matches too (if any) without duplicates
          const { data: byLegacy, error: byLegacyErr } = await supabase
            .from('partidos')
            .select('id, nombre, fecha, hora, sede, estado')
            .eq('from_frequent_match_id', templateId)
            .order('fecha', { ascending: false })
            .limit(80);
          if (byLegacyErr) {
            const fallbackMsg = String(byLegacyErr?.message || '').toLowerCase();
            const missingLegacy = fallbackMsg.includes('from_frequent_match_id') && fallbackMsg.includes('does not exist');
            if (!missingLegacy) throw byLegacyErr;
          }
          const seen = new Set(partidos.map((p) => p.id));
          ((byLegacyErr ? [] : byLegacy) || []).forEach((p) => { if (!seen.has(p.id)) partidos.push(p); });
          partidos.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || String(b.hora || '').localeCompare(String(a.hora || '')));
        }

        const matchIds = (partidos || []).map((p) => Number(p.id)).filter((n) => Number.isFinite(n));

        // Best-effort backfill for phase 1 snapshots (non-blocking for UI).
        await Promise.all(matchIds.map((id) => ensureParticipantsSnapshot(id)));

        // 2) Fetch snapshots (optional)
        const snapMap = new Map();
        try {
          if (matchIds.length > 0) {
            const { data: snapRows, error: snapErr } = await supabase
              .from('partido_team_confirmations')
              .select('partido_id, participants, team_a, team_b, confirmed_at')
              .in('partido_id', matchIds);
            if (!snapErr) {
              (snapRows || []).forEach((r) => snapMap.set(Number(r.partido_id), r));
            }
          }
        } catch (_e) {
          // non-blocking
        }

        // 3) Fetch survey_results (includes historical snapshot flags)
        const resMap = new Map();
        if (matchIds.length > 0) {
          const { data: resRows } = await supabase
            .from('survey_results')
            .select('partido_id, winner_team, scoreline, results_ready, resultados_encuesta_listos, snapshot_participantes, snapshot_equipos, snapshot_resultados_encuesta')
            .in('partido_id', matchIds);
          (resRows || []).forEach((r) => resMap.set(Number(r.partido_id), r));
        }

        // 4) Participants count fallback: jugadores rows grouped by partido_id
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

        if (!alive) return;
        setMatches(partidos || []);
        setSnapshots(mergedSnapshots);
        setResults(resMap);
        setCounts(cntMap);
      } catch (e) {
        console.error('[TemplateStatsModal] load error', e);
        if (alive) {
          setMatches([]);
          setSnapshots(new Map());
          setResults(new Map());
          setCounts(new Map());
        }
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => { alive = false; };
  }, [isOpen, template?.id]);

  const close = () => {
    setSelected(null);
    onClose?.();
  };

  if (!isOpen || !template) return null;

  return (
    <>
      <div className="fixed inset-0 z-[5100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl" onClick={close}>
        <div
          className="w-full max-w-3xl bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-6 shadow-[0_32px_64px_rgba(0,0,0,0.5)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
            <div className="min-w-0">
              <div className="font-bebas text-3xl text-white uppercase tracking-wider truncate">Estadísticas</div>
              <div className="font-oswald text-white/60 text-sm uppercase tracking-widest mt-1 truncate">
                {template.nombre || 'Plantilla'}
              </div>
            </div>
            <button
              onClick={close}
              className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 active:scale-95 flex items-center justify-center shrink-0"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>

          <div className="pt-5">
            {loading ? (
              <div className="py-16 flex items-center justify-center">
                <LoadingSpinner size="large" />
              </div>
            ) : matches.length === 0 ? (
              <div className="py-16 text-center text-white/60 font-oswald">
                Todavía no hay partidos creados desde esta plantilla.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[70vh] overflow-y-auto pr-1">
                {matches.map((m) => {
                  const mid = Number(m.id);
                  const snap = snapshots.get(mid);
                  const res = results.get(mid);
                  const participantsCount = Array.isArray(snap?.participants) ? snap.participants.length : (counts.get(mid) || 0);
                  const resultsReady = Boolean(res?.resultados_encuesta_listos);

                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelected(m)}
                      className="text-left bg-black/20 border border-white/10 rounded-2xl p-4 hover:bg-black/25 hover:border-white/15 active:scale-[0.99] transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-2 text-white/80">
                          <CalendarClock size={18} className="text-white/50" />
                          <div className="font-oswald text-xs uppercase tracking-widest">
                            {fmtDateShort(m.fecha)} · {fmtTime(m.hora)}
                          </div>
                        </div>
                        <ChevronRight size={16} className="text-white/35" />
                      </div>

                      <div className="font-bebas text-xl text-white uppercase tracking-wide mt-2 truncate">
                        {m.nombre || 'Partido'}
                      </div>

                      <div className="mt-3 flex flex-col gap-2">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 w-fit">
                          <Users size={16} className="text-[#0EA9C6]" />
                          <div className="font-oswald text-xs text-white/80 uppercase tracking-wide">
                            {participantsCount ? `${participantsCount} jugadores` : 'Sin jugadores'}
                          </div>
                        </div>
                        <ResultPill winnerTeam={res?.winner_team} scoreline={res?.scoreline} resultsReady={resultsReady} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <MatchDetailsModal
        open={Boolean(selected)}
        match={selected}
        snapshot={selected ? snapshots.get(Number(selected.id)) : null}
        resultRow={selected ? results.get(Number(selected.id)) : null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
