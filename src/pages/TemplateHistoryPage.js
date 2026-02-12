import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import LoadingSpinner from '../components/LoadingSpinner';
import { supabase } from '../supabase';
import { ensureParticipantsSnapshot } from '../services/historySnapshotService';
import AvatarFallback from '../components/AvatarFallback';

const fmtDateShort = (ymd) => {
  if (!ymd) return '—';
  try {
    const d = new Date(`${ymd}T00:00:00`);
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', year: 'numeric' });
  } catch (_e) {
    return String(ymd);
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

const winnerLabel = (winnerTeam) => {
  if (!winnerTeam) return 'Sin definir';
  if (winnerTeam === 'equipo_a') return 'Ganó Equipo A';
  if (winnerTeam === 'equipo_b') return 'Ganó Equipo B';
  if (winnerTeam === 'empate') return 'Empate';
  return String(winnerTeam);
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

const PlayerRow = ({ player }) => (
  <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5">
    {player?.avatar_url ? (
      <img
        src={player.avatar_url}
        alt={player.nombre || 'Jugador'}
        className="w-6 h-6 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
      />
    ) : (
      <AvatarFallback name={player?.nombre || 'Jugador'} size="w-6 h-6" className="text-[10px] bg-slate-700 border-slate-500" />
    )}
    <span className="font-oswald text-[13px] text-white/90 truncate">{player?.nombre || 'Jugador'}</span>
  </div>
);

const TeamColumn = ({ title, team = [], resolvePlayer }) => (
  <div className="bg-black/20 border border-white/10 rounded-xl p-2.5">
    <div className="font-bebas text-base text-white uppercase tracking-wider mb-1.5">{title}</div>
    {team.length === 0 ? (
      <div className="text-white/50 text-sm font-oswald">Sin equipos confirmados.</div>
    ) : (
      <div className="grid grid-cols-1 gap-1.5">
        {team.map((ref) => (
          <PlayerRow key={String(ref)} player={resolvePlayer(ref)} />
        ))}
      </div>
    )}
  </div>
);

const AwardRow = ({ title, icon, playerName }) => (
  <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-700 rounded-lg px-2.5 py-2">
    <img src={icon} alt={title} className="w-7 h-7 object-contain shrink-0" />
    <div className="min-w-0">
      <div className="font-bebas text-[12px] text-white/70 uppercase tracking-wide leading-none">{title}</div>
      <div className="font-oswald text-[13px] text-white mt-0.5 leading-tight break-words">{playerName || 'Sin dato'}</div>
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
  const [counts, setCounts] = useState(new Map());
  const [selectedId, setSelectedId] = useState(null);

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
          }
          const seen = new Set(partidos.map((p) => p.id));
          ((byLegacyErr ? [] : byLegacy) || []).forEach((p) => { if (!seen.has(p.id)) partidos.push(p); });
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
            .select('partido_id, winner_team, scoreline, resultados_encuesta_listos, snapshot_participantes, snapshot_equipos, snapshot_resultados_encuesta')
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

              const mvp = rows.find((r) => String(r.award_type) === 'mvp')?.jugador_id || null;
              const gk = rows.find((r) => String(r.award_type) === 'goalkeeper')?.jugador_id || null;
              const dirty = rows.find((r) => String(r.award_type) === 'negative_fair_play')?.jugador_id || null;

              resMap.set(Number(id), {
                partido_id: Number(id),
                winner_team: null,
                scoreline: null,
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
        setMatches(partidos);
        setResults(resMap);
        setSnapshots(mergedSnapshots);
        setCounts(cntMap);
      } catch (error) {
        console.error('[TemplateHistoryPage] load error', error);
        if (!alive) return;
        setMatches([]);
        setResults(new Map());
        setSnapshots(new Map());
        setCounts(new Map());
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => { alive = false; };
  }, [templateId]);

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

  const resolveName = (ref) => nameByRef.get(String(ref)) || 'Jugador';
  const resolvePlayer = (ref) => {
    const found = playerByRef.get(String(ref));
    if (found) return found;
    return { nombre: resolveName(ref), avatar_url: null };
  };
  const redCards = Array.isArray(resultSnapshot?.red_cards) ? resultSnapshot.red_cards : [];

  const isDetail = Boolean(selectedMatch);

  return (
    <div className="w-full max-w-[650px] mx-auto flex flex-col items-center pt-24 pb-32 px-4 box-border">
      <PageTitle title="HISTORIAL" onBack={() => {
        if (isDetail) {
          setSelectedId(null);
          return;
        }
        navigate(-1);
      }}
      >
        HISTORIAL
      </PageTitle>

      <div className="w-full mt-1 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        {!isDetail && (
          <>
            <div className="font-bebas text-[28px] leading-7 text-white uppercase tracking-wide truncate">
              {template?.nombre || 'Plantilla'}
            </div>
          </>
        )}

        {loading ? (
          <div className="py-14 flex items-center justify-center"><LoadingSpinner size="large" /></div>
        ) : matches.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-3 py-10 border border-dashed border-white/10 rounded-xl bg-slate-900/40 mt-5">
            <div className="text-white/70 font-oswald text-base">Todavía no hay partidos creados desde esta plantilla.</div>
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
                      className="text-left rounded-xl p-2.5 border border-slate-700 bg-slate-800/60 hover:border-slate-500 transition-all min-h-[100px] overflow-hidden"
                    >
                      <div className="w-full font-bebas text-[18px] text-white leading-6 text-center truncate">
                        {fmtDateShort(m.fecha)}
                      </div>
                      <div className="mt-2 w-full">
                        <div className="w-full flex">
                          <ResultStatusPill ready={ready} fullWidth />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-1 flex flex-col gap-2.5">
                <div className="flex items-start">
                  <div className="min-w-0 w-full">
                    <div className="font-bebas text-[21px] leading-6 text-white uppercase tracking-wide whitespace-nowrap">
                      {fmtDateLong(selectedMatch?.fecha)} · {fmtTime(selectedMatch?.hora)}
                    </div>
                  </div>
                </div>

                <div className="font-bebas text-base text-white uppercase tracking-wider">
                  {teamsConfirmed ? 'Equipos confirmados' : 'Participantes'}
                </div>

                {teamsConfirmed ? (
                  <div className="grid grid-cols-2 gap-2">
                    <TeamColumn title="Equipo A" team={teamA} resolvePlayer={resolvePlayer} />
                    <TeamColumn title="Equipo B" team={teamB} resolvePlayer={resolvePlayer} />
                  </div>
                ) : (
                  <>
                    {participants.length === 0 ? (
                      <div className="text-white/50 text-sm font-oswald">Sin participantes en snapshot.</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        {participants.map((p, idx) => (
                          <PlayerRow key={`${p?.ref || p?.uuid || p?.usuario_id || p?.id || idx}`} player={p} />
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className="grid grid-cols-2 gap-2 items-stretch">
                  <div className="bg-black/20 border border-white/10 rounded-xl p-2.5">
                    <div className="font-bebas text-base text-white uppercase tracking-wider mb-1.5">Resultado</div>
                    {!resultsReady ? (
                      <div className="text-white/60 text-xs font-oswald">Pendiente hasta cierre de encuesta.</div>
                    ) : (
                      <div className="grid grid-cols-1 gap-1 text-xs font-oswald text-white/80">
                        <div>Ganador: {winnerLabel(selectedResult?.winner_team || resultSnapshot?.winner_team)}</div>
                        <div>Marcador: {selectedResult?.scoreline || resultSnapshot?.scoreline || 'Sin dato'}</div>
                        <div>Ausentes: {Array.isArray(resultSnapshot?.ausentes) ? resultSnapshot.ausentes.length : 0}</div>
                      </div>
                    )}
                  </div>

                  <div className="bg-black/20 border border-white/10 rounded-xl p-2.5">
                    <div className="font-bebas text-base text-white uppercase tracking-wider mb-1.5">Premios</div>
                    {!resultsReady ? (
                      <div className="text-white/60 text-xs font-oswald">Esperando resultados.</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <AwardRow title="MVP" icon="/mvp.png" playerName={resolveSnapshotPlayer(resultSnapshot?.mvp, resolveName)} />
                        <AwardRow title="Guante" icon="/glove.png" playerName={resolveSnapshotPlayer(resultSnapshot?.golden_glove, resolveName)} />
                        <AwardRow title="Roja" icon="/red_card.png" playerName={resolveSnapshotPlayer(resultSnapshot?.mas_sucio, resolveName)} />
                        <div className="text-[11px] font-oswald text-white/70 break-words">
                          Rojas: {redCards.length > 0 ? redCards.map((r) => resolveSnapshotPlayer(r, resolveName)).join(', ') : 'Sin dato'}
                        </div>
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
