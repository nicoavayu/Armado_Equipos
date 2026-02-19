import { notifyBlockingError } from 'utils/notifyBlockingError';
// src/components/TeamDisplay.js
import React, { useEffect, useRef, useState } from 'react';
import { TeamDisplayContext } from './PlayerCardTrigger';
import { saveTeamsToDatabase, getTeamsFromDatabase, subscribeToTeamsChanges, unsubscribeFromTeamsChanges, supabase } from '../supabase';
import ChatButton from './ChatButton';
import PageTitle from './PageTitle';
import MatchInfoSection from './MatchInfoSection';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import WhatsappIcon from './WhatsappIcon';
import LoadingSpinner from './LoadingSpinner';
import { AvatarFallback } from './ProfileComponents';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import InlineNotice from './ui/InlineNotice';
import useInlineNotice from '../hooks/useInlineNotice';

// Safe wrappers to prevent runtime crashes if any import resolves undefined
const safeComp = (Comp, name) => {
  if (!Comp) {
    console.error(`[TeamDisplay] Undefined component: ${name}`);
    const Fallback = ({ children }) => <>{children ?? null}</>;
    Fallback.displayName = `SafeFallback(${name})`;
    return Fallback;
  }
  return Comp;
};

const SafeTeamDisplayContext = safeComp(TeamDisplayContext, 'TeamDisplayContext');
const SafeChatButton = safeComp(ChatButton, 'ChatButton');
const SafePageTitle = safeComp(PageTitle, 'PageTitle');
const SafeMatchInfoSection = safeComp(MatchInfoSection, 'MatchInfoSection');
const SafeWhatsappIcon = safeComp(WhatsappIcon, 'WhatsappIcon');
const SafeLoadingSpinner = safeComp(LoadingSpinner, 'LoadingSpinner');

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const TeamDisplay = ({ teams, players, onTeamsChange, onBackToHome, isAdmin = false, partidoId = null, nombre: _nombre, fecha, hora, sede, modalidad, tipo }) => {
  const [showAverages, setShowAverages] = useState(false);
  const [lockedPlayers, setLockedPlayers] = useState([]);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [realtimeTeams, setRealtimeTeams] = useState(teams);
  const [realtimePlayers, setRealtimePlayers] = useState(players);
  const teamsSubscriptionRef = useRef(null);
  const [teamsConfirmed, setTeamsConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unconfirming, setUnconfirming] = useState(false);
  const [templateId, setTemplateId] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [activeDragId, setActiveDragId] = useState(null);
  const lastDragEndAtRef = useRef(0);
  const { notice, showInlineNotice, clearInlineNotice } = useInlineNotice();

  // [TEAM_BALANCER_EDIT] Para jugadores no-admin, ocultar promedios por defecto
  useEffect(() => {
    if (!isAdmin) {
      setShowAverages(false);
    }
  }, [isAdmin]);

  // Load teams from database on mount
  useEffect(() => {
    const loadTeamsFromDatabase = async () => {
      if (!partidoId) return;

      try {
        const savedTeams = await getTeamsFromDatabase(partidoId);
        if (savedTeams && Array.isArray(savedTeams) && savedTeams.length === 2) {
          console.log('[TEAMS_LOAD] Loading teams from database:', savedTeams);
          setRealtimeTeams(savedTeams);
          onTeamsChange(savedTeams);
        } else {
          // Fallback to props if no saved teams
          setRealtimeTeams(teams);
        }
      } catch (error) {
        console.error('[TEAMS_LOAD] Error loading teams:', error);
        setRealtimeTeams(teams);
      }
    };

    loadTeamsFromDatabase();
  }, [partidoId]);

  // Load "teams_confirmed" + template_id (best-effort; doesn't break if columns don't exist)
  useEffect(() => {
    const loadConfirmState = async () => {
      if (!partidoId) return;
      try {
        const { data, error } = await supabase
          .from('partidos')
          .select('teams_confirmed, template_id, from_frequent_match_id')
          .eq('id', Number(partidoId))
          .maybeSingle();
        if (error) throw error;
        setTeamsConfirmed(Boolean(data?.teams_confirmed));
        setTemplateId(data?.template_id || data?.from_frequent_match_id || null);
      } catch (e) {
        // Older DBs may not have these columns yet.
        console.warn('[TEAMS_CONFIRM] could not load teams_confirmed/template_id (non-blocking)', e?.message || e);
      }
    };
    loadConfirmState();
  }, [partidoId]);

  // Update teams when props change
  useEffect(() => {
    setRealtimeTeams(teams);
  }, [teams]);

  // Update players when props change
  useEffect(() => {
    setRealtimePlayers(players);
  }, [players]);

  // Subscribe to real-time team changes
  useEffect(() => {
    if (!partidoId) return;

    const subscription = subscribeToTeamsChanges(partidoId, (newTeams) => {
      console.log('[TEAMS_REALTIME] Received team update:', newTeams);
      if (newTeams && Array.isArray(newTeams) && newTeams.length === 2) {
        setRealtimeTeams(newTeams);
        onTeamsChange(newTeams);
      }
    });

    teamsSubscriptionRef.current = subscription;

    return () => {
      if (subscription) unsubscribeFromTeamsChanges(subscription);
    };
  }, [partidoId, onTeamsChange]);

  // Helper functions for player key normalization and matching
  const normalizeKey = (v) => {
    if (v == null) return null;
    if (typeof v === 'object') return String(v.uuid ?? v.id ?? v.player_id ?? v.user_id ?? '');
    const s = String(v).trim();
    return s ? s : null;
  };

  const matchesKey = (p, key) => {
    if (!p || !key) return false;
    return (
      String(p.uuid ?? '') === key ||
      String(p.id ?? '') === key ||
      String(p.player_id ?? '') === key
    );
  };

  const getPlayerDetails = (raw) => {
    const key = normalizeKey(raw);
    if (!key) return {};
    return realtimePlayers.find((p) => matchesKey(p, key)) || {};
  };

  // Robust player array extraction from team object
  const getPlayersArrayFromTeam = (team) => {
    const candidates = [
      'players',
      'player_ids',
      'players_ids',
      'team_players',
      'jugadores',
      'members',
      'roster',
    ];
    for (const k of candidates) {
      const v = team?.[k];
      if (Array.isArray(v) && v.length) return v;
    }
    return Array.isArray(team?.players) ? team.players : [];
  };

  const getNormalizedTeamPlayers = (team) =>
    getPlayersArrayFromTeam(team)
      .map(normalizeKey)
      .filter(Boolean);

  const calculateTeamScore = (teamPlayers) =>
    teamPlayers.reduce((acc, playerId) => acc + (getPlayerDetails(playerId).score || 0), 0);

  const persistTeams = async (newTeams) => {
    setRealtimeTeams(newTeams);
    onTeamsChange(newTeams);

    if (isAdmin && partidoId) {
      try {
        await saveTeamsToDatabase(partidoId, newTeams);
      } catch (error) {
        console.error('[TEAMS_SAVE] Error saving teams:', error);
      }
    }
  };

  const makeDraggableId = (teamId, playerKey) => `${teamId}::${normalizeKey(playerKey)}`;

  const parseDraggableId = (draggableId) => {
    const [teamId, ...rest] = String(draggableId || '').split('::');
    return { teamId, playerKey: rest.join('::') };
  };

  if (
    !Array.isArray(realtimeTeams) ||
    realtimeTeams.length < 2 ||
    !realtimeTeams.find((t) => t.id === 'equipoA') ||
    !realtimeTeams.find((t) => t.id === 'equipoB')
  ) {
    return (
      <div className="min-h-[60dvh] w-full flex items-center justify-center">
        <SafeLoadingSpinner size="large" />
      </div>
    );
  }

  // Función para obtener color basado en el puntaje (1-10)
  const getScoreColor = (score) => {
    const normalizedScore = Math.max(1, Math.min(10, score || 5)); // Clamp entre 1-10

    if (normalizedScore <= 3) {
      // Rojo para puntajes bajos (1-3)
      const intensity = (normalizedScore - 1) / 2; // 0 a 1
      return `rgba(222, 28, 73, ${0.7 + intensity * 0.3})`; // Más intenso para más bajo
    } else if (normalizedScore <= 5) {
      // Naranja para puntajes medio-bajos (3-5)
      return 'rgba(255, 165, 0, 0.9)';
    } else if (normalizedScore <= 7) {
      // Azul para puntajes medio-altos (5-7)
      return 'rgba(14, 169, 198, 0.9)';
    } else {
      // Verde para puntajes altos (7-10)
      const intensity = (normalizedScore - 7) / 3; // 0 a 1
      return `rgba(0, 212, 155, ${0.7 + intensity * 0.3})`; // Más intenso para más alto
    }
  };

  const isPlayerLocked = (playerId) =>
    lockedPlayers.includes(playerId) ||
    lockedPlayers.includes(Number(playerId));


  const togglePlayerLock = (playerId) => {
    // [TEAM_BALANCER_EDIT] Solo admin puede bloquear/desbloquear jugadores
    if (!isAdmin) {
      return;
    }
    if (teamsConfirmed) return;

    if (lockedPlayers.includes(playerId)) {
      setLockedPlayers(lockedPlayers.filter((id) => id !== playerId));
    } else {
      setLockedPlayers([...lockedPlayers, playerId]);
    }
  };

  const randomizeTeams = async () => {
    // [TEAM_BALANCER_EDIT] Solo admin puede randomizar equipos
    if (!isAdmin) {
      showInlineNotice({
        key: 'teams_randomize_not_admin',
        type: 'warning',
        message: 'Solo el admin puede randomizar los equipos.',
      });
      return;
    }
    if (teamsConfirmed) {
      showInlineNotice({
        key: 'teams_randomize_already_confirmed',
        type: 'info',
        message: 'Los equipos ya están confirmados.',
      });
      return;
    }

    // Don't include locked players in randomization
    let allPlayers = realtimeTeams.flatMap((t) => getNormalizedTeamPlayers(t));
    const lockedPlayersMap = {};

    // Create a map of locked players with their current team
    lockedPlayers.forEach((playerId) => {
      const teamIndex = realtimeTeams.findIndex((team) => getNormalizedTeamPlayers(team).includes(normalizeKey(playerId)));
      if (teamIndex !== -1) {
        lockedPlayersMap[normalizeKey(playerId)] = realtimeTeams[teamIndex].id;
      }
    });

    // Filter out locked players for randomization
    const playersToRandomize = allPlayers.filter((playerId) => !isPlayerLocked(playerId));
    playersToRandomize.sort(() => Math.random() - 0.5);

    // Create new teams with locked players in their original positions
    const newTeamA = { ...realtimeTeams.find((t) => t.id === 'equipoA'), players: [] };
    const newTeamB = { ...realtimeTeams.find((t) => t.id === 'equipoB'), players: [] };

    // First, place locked players in their teams
    lockedPlayers.forEach((playerId) => {
      const normalizedPlayerId = normalizeKey(playerId);
      if (!normalizedPlayerId) return;

      if (lockedPlayersMap[normalizedPlayerId] === 'equipoA') {
        newTeamA.players.push(normalizedPlayerId);
      } else if (lockedPlayersMap[normalizedPlayerId] === 'equipoB') {
        newTeamB.players.push(normalizedPlayerId);
      }
    });

    // Then distribute remaining players
    const teamANeeds = Math.ceil(allPlayers.length / 2) - newTeamA.players.length;

    newTeamA.players = [...newTeamA.players, ...playersToRandomize.slice(0, teamANeeds)];
    newTeamB.players = [...newTeamB.players, ...playersToRandomize.slice(teamANeeds)];

    // Calculate scores
    newTeamA.score = calculateTeamScore(newTeamA.players);
    newTeamB.score = calculateTeamScore(newTeamB.players);

    const newTeams = realtimeTeams.map((team) => {
      if (team.id === 'equipoA') {
        return newTeamA;
      } else if (team.id === 'equipoB') {
        return newTeamB;
      }
      return team;
    });

    await persistTeams(newTeams);
  };

  const buildConfirmationSnapshot = () => {
    const teamA = realtimeTeams.find((t) => t.id === 'equipoA');
    const teamB = realtimeTeams.find((t) => t.id === 'equipoB');
    const teamAKeys = getPlayersArrayFromTeam(teamA).map(normalizeKey).filter(Boolean);
    const teamBKeys = getPlayersArrayFromTeam(teamB).map(normalizeKey).filter(Boolean);

    const toPlayerUuid = (key) => {
      const p = getPlayerDetails(key);
      const u = p?.uuid || p?.usuario_id;
      return isUuid(u) ? u : null;
    };

    const teamAUuid = teamAKeys.map(toPlayerUuid).filter(Boolean);
    const teamBUuid = teamBKeys.map(toPlayerUuid).filter(Boolean);

    // participants snapshot includes all team members with stable info
    const allKeys = Array.from(new Set([...teamAKeys, ...teamBKeys]));
    const participants = allKeys.map((key) => {
      const p = getPlayerDetails(key);
      return {
        uuid: isUuid(p?.uuid) ? p.uuid : (isUuid(p?.usuario_id) ? p.usuario_id : null),
        usuario_id: isUuid(p?.usuario_id) ? p.usuario_id : null,
        nombre: p?.nombre || null,
        avatar_url: p?.avatar_url || p?.foto_url || null,
        score: typeof p?.score === 'number' ? p.score : null,
        is_goalkeeper: Boolean(p?.is_goalkeeper),
      };
    }).filter((p) => p.nombre);

    return {
      teamAUuid,
      teamBUuid,
      participants,
      teamsJson: realtimeTeams,
    };
  };

  const confirmTeams = async () => {
    if (!isAdmin) return;
    if (!partidoId) return;
    if (teamsConfirmed) return;
    if (confirming) return;

    setConfirming(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const snapshot = buildConfirmationSnapshot();

      if (snapshot.teamAUuid.length === 0 || snapshot.teamBUuid.length === 0) {
        showInlineNotice({
          key: 'teams_confirm_missing_players',
          type: 'warning',
          message: 'No se pudieron resolver los jugadores de los equipos.',
        });
        return;
      }
      if (snapshot.teamAUuid.length !== snapshot.teamBUuid.length) {
        showInlineNotice({
          key: 'teams_confirm_unbalanced_count',
          type: 'warning',
          message: 'Los equipos no tienen la misma cantidad de jugadores.',
        });
        return;
      }

      const payload = {
        partido_id: Number(partidoId),
        template_id: templateId,
        confirmed_by: auth?.user?.id || null,
        participants: snapshot.participants,
        team_a: snapshot.teamAUuid,
        team_b: snapshot.teamBUuid,
        teams_json: snapshot.teamsJson,
      };

      // Upsert snapshot (idempotent)
      const { error: snapErr } = await supabase
        .from('partido_team_confirmations')
        .upsert(payload, { onConflict: 'partido_id' });
      if (snapErr) throw snapErr;

      // Mark match as confirmed (best-effort if columns exist)
      try {
        await supabase
          .from('partidos')
          .update({ teams_confirmed: true, teams_confirmed_at: new Date().toISOString() })
          .eq('id', Number(partidoId));
      } catch (_e) {
        // non-blocking
      }

      setTeamsConfirmed(true);
      showInlineNotice({
        key: 'teams_confirmed_success',
        type: 'success',
        message: 'Equipos confirmados.',
      });
    } catch (e) {
      console.error('[TEAMS_CONFIRM] confirmTeams error', e);
      notifyBlockingError('No se pudieron confirmar los equipos');
    } finally {
      setConfirming(false);
    }
  };

  const unconfirmTeams = async () => {
    if (!isAdmin) return;
    if (!partidoId) return;
    if (!teamsConfirmed) return;
    if (unconfirming) return;

    setUnconfirming(true);
    try {
      // Delete snapshot (best-effort)
      try {
        await supabase
          .from('partido_team_confirmations')
          .delete()
          .eq('partido_id', Number(partidoId));
      } catch (_e) {
        // non-blocking
      }

      // Reset flag (best-effort)
      try {
        await supabase
          .from('partidos')
          .update({ teams_confirmed: false, teams_confirmed_at: null })
          .eq('id', Number(partidoId));
      } catch (_e) {
        // non-blocking
      }

      setTeamsConfirmed(false);
      showInlineNotice({
        key: 'teams_unconfirmed_info',
        type: 'info',
        message: 'Equipos desconfirmados.',
      });
    } catch (e) {
      console.error('[TEAMS_CONFIRM] unconfirmTeams error', e);
      notifyBlockingError('No se pudo desconfirmar');
    } finally {
      setUnconfirming(false);
    }
  };

  const handleDragStart = (start) => {
    if (!isAdmin || teamsConfirmed) return;
    setActiveDragId(start?.draggableId || null);
    setDragTarget(null);
  };

  const handleDragUpdate = (update) => {
    if (!isAdmin || teamsConfirmed) return;

    const { source, destination, combine } = update || {};
    if (!source) {
      setDragTarget(null);
      return;
    }

    if (combine?.draggableId) {
      const parsedCombine = parseDraggableId(combine.draggableId);
      const combineTeam = realtimeTeams.find((team) => team.id === parsedCombine.teamId);
      const combinePlayers = getNormalizedTeamPlayers(combineTeam);
      const combineIndex = combinePlayers.findIndex((key) => key === parsedCombine.playerKey);

      if (combineIndex !== -1) {
        setDragTarget({
          teamId: parsedCombine.teamId,
          index: combineIndex,
          sourceTeamId: source.droppableId,
          sourceIndex: source.index,
        });
        return;
      }
    }

    if (destination) {
      setDragTarget({
        teamId: destination.droppableId,
        index: destination.index,
        sourceTeamId: source.droppableId,
        sourceIndex: source.index,
      });
      return;
    }

    setDragTarget(null);
  };

  const handleDragEnd = async (result) => {
    setActiveDragId(null);
    setDragTarget(null);
    lastDragEndAtRef.current = Date.now();

    if (!isAdmin || teamsConfirmed) return;

    const { source, destination, combine } = result || {};
    if (!source) return;
    if (!destination && !combine) return;

    const sourceTeam = realtimeTeams.find((team) => team.id === source.droppableId);
    if (!sourceTeam) return;

    const sourcePlayers = getNormalizedTeamPlayers(sourceTeam);
    const sourcePlayer = sourcePlayers[source.index];
    if (!sourcePlayer) return;

    let targetTeamId = destination?.droppableId || null;
    let targetIndex = destination?.index ?? null;

    if (combine?.draggableId) {
      const parsedCombine = parseDraggableId(combine.draggableId);
      targetTeamId = parsedCombine.teamId;

      const combineTeam = realtimeTeams.find((team) => team.id === targetTeamId);
      const combinePlayers = getNormalizedTeamPlayers(combineTeam);
      targetIndex = combinePlayers.findIndex((key) => key === parsedCombine.playerKey);
    }

    if (!targetTeamId || targetIndex === null || targetIndex < 0) return;

    const targetTeam = realtimeTeams.find((team) => team.id === targetTeamId);
    if (!targetTeam) return;

    const targetPlayers = getNormalizedTeamPlayers(targetTeam);
    const targetPlayer = targetPlayers[targetIndex];
    if (!targetPlayer) return;

    if (sourcePlayer === targetPlayer && source.droppableId === targetTeamId) return;

    if (isPlayerLocked(sourcePlayer) || isPlayerLocked(targetPlayer)) {
      showInlineNotice({
        key: 'teams_locked_players_move_blocked',
        type: 'warning',
        message: 'No se pueden mover jugadores bloqueados.',
      });
      return;
    }

    const nextTeams = realtimeTeams.map((team) => ({
      ...team,
      players: getNormalizedTeamPlayers(team),
    }));

    if (source.droppableId === targetTeamId) {
      const reordered = [...sourcePlayers];
      const [moved] = reordered.splice(source.index, 1);
      reordered.splice(targetIndex, 0, moved);

      for (let i = 0; i < nextTeams.length; i += 1) {
        if (nextTeams[i].id !== source.droppableId) continue;
        nextTeams[i] = {
          ...nextTeams[i],
          players: reordered,
          score: calculateTeamScore(reordered),
        };
      }
    } else {
      const nextSourcePlayers = [...sourcePlayers];
      const nextTargetPlayers = [...targetPlayers];

      [nextSourcePlayers[source.index], nextTargetPlayers[targetIndex]] = [
        nextTargetPlayers[targetIndex],
        nextSourcePlayers[source.index],
      ];

      for (let i = 0; i < nextTeams.length; i += 1) {
        if (nextTeams[i].id === source.droppableId) {
          nextTeams[i] = {
            ...nextTeams[i],
            players: nextSourcePlayers,
            score: calculateTeamScore(nextSourcePlayers),
          };
        } else if (nextTeams[i].id === targetTeamId) {
          nextTeams[i] = {
            ...nextTeams[i],
            players: nextTargetPlayers,
            score: calculateTeamScore(nextTargetPlayers),
          };
        }
      }
    }

    await persistTeams(nextTeams);
  };

  const handleWhatsAppShare = () => {
    if (!teamsConfirmed) {
      showInlineNotice({
        key: 'teams_share_requires_confirmation',
        type: 'warning',
        message: 'Antes de compartir, confirmá los equipos.',
      });
      return;
    }

    const teamA = realtimeTeams.find((t) => t.id === 'equipoA');
    const teamB = realtimeTeams.find((t) => t.id === 'equipoB');
    if (!teamA || !teamB) {
      showInlineNotice({
        key: 'teams_share_missing_data',
        type: 'warning',
        message: 'No se pudieron preparar los equipos para compartir.',
      });
      return;
    }

    const playersToText = (team) =>
      (team.players || [])
        .map((pId) => `- ${getPlayerDetails(pId).nombre}`)
        .join('\n');

    const teamAText = `*EQUIPO A* (Puntaje: ${(teamA.score ?? 0).toFixed(2)})\n${playersToText(teamA)}`;
    const teamBText = `*EQUIPO B* (Puntaje: ${(teamB.score ?? 0).toFixed(2)})\n${playersToText(teamB)}`;

    // WhatsApp friendly: no header, clear spacing, real line breaks.
    const message = `${teamAText}\n\n${teamBText}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <SafeTeamDisplayContext.Provider value={true}>
      {/* Chat button para todos los usuarios - Hide floating trigger as it is in the header */}
      <SafeChatButton partidoId={partidoId} hideTrigger={true} />
      <SafePageTitle onBack={onBackToHome}>EQUIPOS ARMADOS</SafePageTitle>
      <div className="relative left-1/2 w-screen -translate-x-1/2">
        <SafeMatchInfoSection
          partido={normalizePartidoForHeader(typeof partidoId === 'object' ? partidoId : undefined)}
          fecha={fecha}
          hora={hora}
          sede={sede}
          modalidad={modalidad}
          tipo={tipo}
          precio={(typeof partidoId === 'object' && partidoId?.valor_cancha) ? partidoId?.valor_cancha : undefined}
          rightActions={null}
        />
      </div>

      <div data-debug="TEAMDISPLAY_ACTIVE" className="w-[90vw] max-w-[90vw] mx-auto flex flex-col gap-3 overflow-x-hidden mt-4 pb-6">
        {/* Team cards */}
        <DragDropContext
          onDragStart={handleDragStart}
          onDragUpdate={handleDragUpdate}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-row gap-3 w-full mb-0 box-border">
            {realtimeTeams.map((team) => {
              const teamPlayerKeys = getNormalizedTeamPlayers(team);

              return (
                <Droppable
                  key={team.id}
                  droppableId={team.id}
                  isDropDisabled={!isAdmin || teamsConfirmed}
                  isCombineEnabled={isAdmin && !teamsConfirmed}
                >
                  {(dropProvided) => (
                    <div
                      ref={dropProvided.innerRef}
                      {...dropProvided.droppableProps}
                      className="relative bg-white/10 border border-white/20 rounded-xl p-2.5 w-[calc(50%-6px)] box-border transition-all shadow-xl flex flex-col min-h-0 hover:bg-white/[0.12] hover:border-white/25"
                    >
                      {editingTeamId === team.id && isAdmin ? (
                        <input
                          type="text"
                          className="font-bebas text-lg text-[#333] bg-white/95 border-2 border-[#0EA9C6] rounded-lg px-3 py-2 text-center tracking-widest uppercase w-full box-border shadow-sm md:text-xl lg:text-2xl"
                          value={editingTeamName}
                          onChange={(e) => setEditingTeamName(e.target.value)}
                          onBlur={async () => {
                            if (editingTeamName.trim()) {
                              const newTeams = realtimeTeams.map((t) =>
                                t.id === team.id ? { ...t, name: editingTeamName.trim() } : t,
                              );
                              setRealtimeTeams(newTeams);
                              onTeamsChange(newTeams);

                              // Save changes to database
                              if (isAdmin && partidoId) {
                                try {
                                  await saveTeamsToDatabase(partidoId, newTeams);
                                } catch (error) {
                                  console.error('[TEAMS_SAVE] Error saving teams:', error);
                                }
                              }
                            }
                            setEditingTeamId(null);
                          }}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              if (editingTeamName.trim()) {
                                const newTeams = realtimeTeams.map((t) =>
                                  t.id === team.id ? { ...t, name: editingTeamName.trim() } : t,
                                );
                                setRealtimeTeams(newTeams);
                                onTeamsChange(newTeams);

                                // Save changes to database
                                if (isAdmin && partidoId) {
                                  try {
                                    await saveTeamsToDatabase(partidoId, newTeams);
                                  } catch (error) {
                                    console.error('[TEAMS_SAVE] Error saving teams:', error);
                                  }
                                }
                              }
                              setEditingTeamId(null);
                            } else if (e.key === 'Escape') {
                              setEditingTeamId(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <h3
                          className="font-bebas text-xl text-white m-0 tracking-wide uppercase cursor-pointer px-0 py-2 rounded-lg transition-all bg-transparent break-words text-center block w-full hover:bg-white/5 mb-2 flex justify-center items-center"
                          onClick={isAdmin ? () => {
                            if (teamsConfirmed) return;
                            setEditingTeamId(team.id);
                            setEditingTeamName(team.name);
                          } : undefined}
                          style={{ cursor: isAdmin ? 'pointer' : 'default' }}
                        >
                          {team.name}
                        </h3>
                      )}

                      <div className="flex flex-col gap-1 mb-1 w-full flex-1 min-h-0 overflow-y-auto max-h-[52vh] md:max-h-[60vh] pr-1">
                        {teamPlayerKeys.length === 0 && (
                          <div className="text-white/60 text-sm p-3 border border-white/10 rounded bg-black/20">
                            No hay jugadores cargados en este equipo (players vacío).
                          </div>
                        )}
                        {teamPlayerKeys.map((playerKey, _index) => {
                          const player = getPlayerDetails(playerKey);
                          const isLocked = isPlayerLocked(playerKey);
                          const draggableId = makeDraggableId(team.id, playerKey);
                          const isReplacementTarget = Boolean(dragTarget) &&
                            dragTarget.sourceTeamId !== team.id &&
                            dragTarget.teamId === team.id &&
                            dragTarget.index === _index;
                          const isActiveDraggedPlayer = activeDragId === draggableId;

                          if (!player?.nombre) {
                            return (
                              <div
                                key={`missing-${team.id}-${playerKey}-${_index}`}
                                className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-white/70"
                              >
                                Jugador desconocido ({playerKey})
                              </div>
                            );
                          }

                          return (
                            <Draggable
                              key={draggableId}
                              draggableId={draggableId}
                              index={_index}
                              isDragDisabled={!isAdmin || teamsConfirmed || isLocked}
                            >
                              {(dragProvided, dragSnapshot) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  onClick={isAdmin ? () => {
                                    if (Date.now() - lastDragEndAtRef.current < 180) return;
                                    togglePlayerLock(playerKey);
                                  } : undefined}
                                  className={`bg-slate-900 border border-slate-800 rounded-lg p-2 flex items-center gap-1.5 text-white transition-all min-h-[36px] relative w-full box-border overflow-hidden select-none hover:bg-slate-800 hover:border-slate-700
                                    ${isLocked ? 'bg-[#FFC107]/20 border-[#FFC107]/60 shadow-[0_0_8px_rgba(255,193,7,0.3)]' : ''}
                                    ${!isAdmin ? 'cursor-default pointer-events-none' : (teamsConfirmed || isLocked ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing')}
                                    ${dragSnapshot.isDragging ? 'ring-2 ring-[#128BE9] border-[#128BE9]/60 z-20' : ''}
                                    ${isReplacementTarget ? 'ring-2 ring-[#0EA9C6] border-[#0EA9C6]/70 bg-slate-700/70' : ''}
                                    ${isActiveDraggedPlayer ? 'shadow-[0_0_0_1px_rgba(14,169,198,0.45)]' : ''}
                                  `}
                                >
                                  <div className="flex items-center gap-1.5 w-full h-full min-w-0">
                                    {player.avatar_url ? (
                                      <img
                                        src={player.avatar_url}
                                        alt={player.nombre}
                                        className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
                                      />
                                    ) : (
                                      <AvatarFallback name={player.nombre} size="w-8 h-8" />
                                    )}
                                    <span
                                      className={`font-oswald text-sm font-semibold text-white flex-1 tracking-wide min-w-0 leading-tight pr-1 ${
                                        showAverages && isAdmin ? 'whitespace-normal break-words' : 'overflow-hidden text-ellipsis whitespace-nowrap'
                                      }`}
                                    >
                                      {player.nombre}
                                    </span>

                                    {showAverages && isAdmin && (
                                      <span
                                        className="font-bebas text-xs font-bold text-white bg-slate-800 px-2 py-1 rounded-md border border-slate-700 shrink-0 whitespace-nowrap"
                                        style={{
                                          background: getScoreColor(player.score),
                                          borderColor: getScoreColor(player.score).replace('0.9', '0.5'),
                                        }}
                                      >
                                        {(player.score || 0).toFixed(2)}
                                      </span>
                                    )}

                                    {isLocked && isAdmin && (
                                      <span className="text-base text-[#FFC107] shrink-0 p-1 rounded bg-[#FFC107]/20 border border-[#FFC107]/40 animate-pulse">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                                          <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
                                        </svg>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {dropProvided.placeholder}
                      </div>

                      <div className="bg-slate-900 rounded-lg text-center px-3 py-2 w-full box-border mt-2" style={{
                        borderWidth: '2px',
                        borderStyle: 'solid',
                        borderColor: (() => {
                          const teamA = realtimeTeams.find((t) => t.id === 'equipoA');
                          const teamB = realtimeTeams.find((t) => t.id === 'equipoB');
                          const diff = Math.abs((teamA?.score ?? 0) - (teamB?.score ?? 0));
                          if (diff === 0 || diff <= 2) return '#10B981';
                          if (diff <= 5) return '#84CC16';
                          if (diff <= 8) return '#F59E0B';
                          return '#EF4444';
                        })(),
                      }}>
                        <div className="text-white/70 text-xs font-oswald uppercase tracking-wide mb-0.5">PUNTAJE</div>
                        <div className="text-white font-bebas text-xl font-bold">{(team.score ?? 0).toFixed(1)}</div>
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>

        {/* Balance summary block - placed after team cards */}
        {(() => {
          const teamA = realtimeTeams.find((t) => t.id === 'equipoA');
          const teamB = realtimeTeams.find((t) => t.id === 'equipoB');
          const scoreA = teamA?.score ?? 0;
          const scoreB = teamB?.score ?? 0;
          const diff = Math.abs(scoreA - scoreB);

          let balanceStatus = '';
          let balanceColor = '';

          if (diff === 0) {
            balanceStatus = 'MATCH PERFECTO';
            balanceColor = '#10B981'; // green
          } else if (diff <= 2) {
            balanceStatus = 'MUY PAREJO';
            balanceColor = '#10B981';
          } else if (diff <= 5) {
            balanceStatus = 'PAREJO';
            balanceColor = '#84CC16'; // yellow/lime
          } else if (diff <= 8) {
            balanceStatus = 'DESBALANCEADO';
            balanceColor = '#F59E0B'; // orange
          } else {
            balanceStatus = 'MUY DESBALANCEADO';
            balanceColor = '#EF4444'; // red
          }

          return (
            <div className="w-full bg-slate-900 border-2 rounded-xl px-4 py-2.5 mt-2" style={{ borderColor: balanceColor }}>
              <div className="text-center">
                <div className="font-bebas text-base text-white/90 tracking-wider mb-0.5">BALANCE DEL PARTIDO</div>
                <div className="font-bebas text-2xl text-white font-bold mb-0.5">DIF: {diff.toFixed(1)}</div>
                <div className="font-oswald text-xs font-semibold tracking-wide" style={{ color: balanceColor }}>{balanceStatus}</div>
              </div>
            </div>
          );
        })()}

        {/* Botones de acción con helper copy (mobile-first) */}
        <div className="w-full mt-0.5 box-border flex flex-col gap-2">
          <div className={`w-full ${notice?.message ? 'min-h-[52px]' : 'min-h-0'}`}>
            <InlineNotice
              type={notice?.type}
              message={notice?.message}
              autoHideMs={notice?.type === 'warning' ? null : 3000}
              onClose={clearInlineNotice}
            />
          </div>
          {isAdmin && (
            <>
              <div className="flex flex-col gap-3">
                {/* Row 1: Randomizar + Promedios */}
                <div className="grid grid-cols-2 gap-2 w-full">
                  <button
                    className="w-full font-oswald text-[15px] px-3 border-none rounded-xl cursor-pointer transition-all text-white h-[44px] min-h-[44px] flex items-center justify-center font-semibold tracking-[0.01em] whitespace-nowrap bg-[#128BE9] hover:brightness-110 active:scale-95 disabled:opacity-50"
                    onClick={randomizeTeams}
                    disabled={teamsConfirmed}
                  >
                    Randomizar
                  </button>
                  <button
                    className="w-full font-oswald text-[15px] px-3 border border-slate-600 rounded-xl cursor-pointer transition-all text-white/80 h-[44px] min-h-[44px] flex items-center justify-center font-semibold tracking-[0.01em] whitespace-nowrap hover:border-slate-500 hover:text-white/90 bg-transparent active:scale-95 disabled:opacity-50"
                    onClick={() => setShowAverages(!showAverages)}
                  >
                    {showAverages ? 'Ocultar' : 'Promedios'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full">
                  <div className="text-white/50 text-xs font-oswald text-center leading-tight px-1 min-h-[36px] flex items-start justify-center">
                    Recalcula los equipos para dejarlos lo más parejos posible.
                  </div>
                  <div className="text-white/50 text-xs font-oswald text-center leading-tight px-1 min-h-[36px] flex items-start justify-center">
                    Mirá los promedios y métricas usadas para armar los equipos.
                  </div>
                </div>

                {/* Row 2: Confirmar/Editar full width */}
                <div className="w-full flex flex-col gap-1">
                  <button
                    className="w-full font-oswald text-[15px] px-4 border-none rounded-xl cursor-pointer transition-all text-white h-[44px] min-h-[44px] flex items-center justify-center font-semibold tracking-[0.01em] whitespace-nowrap bg-primary hover:brightness-110 active:scale-95 disabled:opacity-50"
                    onClick={teamsConfirmed ? unconfirmTeams : confirmTeams}
                    disabled={confirming || unconfirming}
                  >
                    {teamsConfirmed ? (unconfirming ? 'Desconfirmando…' : 'Editar equipos') : (confirming ? 'Confirmando…' : 'Confirmar equipos')}
                  </button>
                  <div className="text-white/50 text-xs font-oswald text-center leading-tight px-1 min-h-[18px]">
                    {teamsConfirmed ? 'Los equipos están confirmados.' : 'Guarda los equipos de este partido y bloquea cambios.'}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Share button with helper */}
          <div className="flex flex-col gap-2">
            <button
              className="w-full font-oswald text-[15px] px-4 border border-slate-700/50 rounded-xl cursor-pointer transition-all text-white/70 h-[44px] min-h-[44px] flex items-center justify-center font-semibold tracking-[0.01em] hover:border-slate-600 hover:text-white/80 bg-transparent active:scale-95 disabled:opacity-50"
              onClick={handleWhatsAppShare}
            >
              <SafeWhatsappIcon size={16} style={{ marginRight: 8 }} />
              Compartir
            </button>
            <div className="text-white/50 text-xs font-oswald text-center leading-tight px-1">Comparte los equipos armados al grupo de WhatsApp.</div>
          </div>
        </div>
      </div>
    </SafeTeamDisplayContext.Provider>
  );
};

export default TeamDisplay;
