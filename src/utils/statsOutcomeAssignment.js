export const normalizeIdentity = (value) => String(value || '').trim().toLowerCase();

export const dedupeMatchesById = (matches = []) => {
  const byId = new Map();
  (Array.isArray(matches) ? matches : []).forEach((match) => {
    const id = Number(match?.id);
    if (!Number.isFinite(id)) return;
    if (!byId.has(id)) byId.set(id, match);
  });
  return Array.from(byId.values());
};

export const dedupeMatchesWithDebug = (matches = []) => {
  const byId = new Map();
  const duplicateEntries = [];

  (Array.isArray(matches) ? matches : []).forEach((match) => {
    const id = Number(match?.id);
    if (!Number.isFinite(id)) return;
    if (!byId.has(id)) {
      byId.set(id, match);
      return;
    }
    duplicateEntries.push({
      match_id: id,
      nombre: String(match?.nombre || `Partido ${id}`),
      dedupe: {
        is_duplicate: true,
        duplicate_of_match_id: id,
      },
      result_application: {
        counted_as_played: false,
        applied_outcome: 'excluded',
        excluded_reason: 'duplicate_match',
      },
    });
  });

  return {
    uniqueMatches: Array.from(byId.values()),
    duplicateEntries,
  };
};

export const normalizeTeamEntry = (entry) => {
  if (entry && typeof entry === 'object') {
    return normalizeIdentity(entry.ref || entry.uuid || entry.usuario_id || entry.id || '');
  }
  return normalizeIdentity(entry);
};

export const normalizeSurveyWinner = (value) => {
  const token = normalizeIdentity(value);
  if (!token) return null;
  if (token === 'equipo_a' || token === 'a' || token === 'team_a') return 'equipo_a';
  if (token === 'equipo_b' || token === 'b' || token === 'team_b') return 'equipo_b';
  if (token === 'empate' || token === 'draw') return 'empate';
  return null;
};

export const normalizeSurveyResultStatus = (value) => {
  const token = normalizeIdentity(value);
  if (!token) return null;
  if (token === 'finished' || token === 'played') return 'finished';
  if (token === 'draw' || token === 'empate') return 'draw';
  if (token === 'not_played' || token === 'cancelled' || token === 'cancelado') return 'not_played';
  if (token === 'pending' || token === 'pendiente') return 'pending';
  return null;
};

export const isNotPlayedOutcomeToken = (value) => {
  const token = normalizeIdentity(value);
  if (!token) return false;
  return (
    token === 'not_played'
    || token === 'cancelled'
    || token === 'cancelado'
    || token === 'no_jugado'
    || token === 'notplayed'
  );
};

export const isClosedPlayedSurveyOutcome = ({ resultStatus, winnerTeam, finishedAt }) => {
  const normalizedStatus = normalizeSurveyResultStatus(resultStatus);
  const normalizedWinner = normalizeSurveyWinner(winnerTeam);

  if (normalizedStatus === 'not_played' || isNotPlayedOutcomeToken(winnerTeam)) {
    return false;
  }

  if (normalizedStatus === 'finished' || normalizedStatus === 'draw') {
    return true;
  }

  if (normalizedWinner === 'equipo_a' || normalizedWinner === 'equipo_b' || normalizedWinner === 'empate') {
    return true;
  }

  if (finishedAt && normalizedStatus !== 'pending') {
    return true;
  }

  return false;
};

const toNormalizedTeamRefs = (team = []) => (
  [...new Set(
    (Array.isArray(team) ? team : [])
      .map(normalizeTeamEntry)
      .filter(Boolean),
  )]
);

const getStableMatchPlayerRef = (player) => normalizeIdentity(
  player?.uuid || player?.usuario_id || player?.id || '',
);

export const evaluateTeamPairQuality = ({ teamA = [], teamB = [], expectedRosterRefs = new Set(), source = 'unknown' }) => {
  const normalizedA = toNormalizedTeamRefs(teamA);
  const normalizedB = toNormalizedTeamRefs(teamB);
  if (normalizedA.length === 0 || normalizedB.length === 0) {
    return {
      source,
      valid_pair: false,
      team_a_count: normalizedA.length,
      team_b_count: normalizedB.length,
      overlap: 0,
      union_size: 0,
      expected_roster_size: Number(expectedRosterRefs?.size || 0),
      coverage: 0,
      is_complete: false,
      score: -Infinity,
      teamA: normalizedA,
      teamB: normalizedB,
    };
  }

  const teamBSet = new Set(normalizedB);
  const overlap = normalizedA.filter((ref) => teamBSet.has(ref)).length;
  const union = new Set([...normalizedA, ...normalizedB]);
  const expectedSize = Math.max(0, Number(expectedRosterRefs?.size || 0));
  const coverage = expectedSize > 0 ? (union.size / expectedSize) : 1;
  const isComplete = expectedSize > 0
    ? (union.size >= expectedSize && overlap === 0)
    : overlap === 0;
  const score = (coverage * 1000) - (overlap * 100) + union.size;

  return {
    source,
    valid_pair: true,
    team_a_count: normalizedA.length,
    team_b_count: normalizedB.length,
    overlap,
    union_size: union.size,
    expected_roster_size: expectedSize,
    coverage,
    is_complete: isComplete,
    score,
    teamA: normalizedA,
    teamB: normalizedB,
  };
};

export const selectBestTeamPair = ({ candidates = [], expectedRosterRefs = new Set() }) => {
  let best = null;
  const evaluations = [];

  for (const candidate of candidates) {
    const quality = evaluateTeamPairQuality({
      teamA: candidate?.teamA,
      teamB: candidate?.teamB,
      expectedRosterRefs,
      source: String(candidate?.source || 'unknown'),
    });
    evaluations.push({
      source: quality.source,
      valid_pair: quality.valid_pair,
      team_a_count: quality.team_a_count,
      team_b_count: quality.team_b_count,
      overlap: quality.overlap,
      union_size: quality.union_size,
      expected_roster_size: quality.expected_roster_size,
      coverage: quality.coverage,
      is_complete: quality.is_complete,
      score: quality.score,
    });

    if (!quality.valid_pair) continue;
    if (quality.is_complete) {
      return {
        teamA: quality.teamA,
        teamB: quality.teamB,
        source: quality.source,
        reason: 'complete',
        evaluations,
      };
    }
    if (!best || quality.score > best.score) {
      best = quality;
    }
  }

  if (best) {
    return {
      teamA: best.teamA,
      teamB: best.teamB,
      source: best.source,
      reason: 'best_score',
      evaluations,
    };
  }

  return {
    teamA: [],
    teamB: [],
    source: null,
    reason: 'none',
    evaluations,
  };
};

export const resolveUserTeam = ({
  participants = [],
  teamA = [],
  teamB = [],
  matchPlayers = [],
  userIdentitySet = new Set(),
  isCurrentUserPlayer = () => false,
  getPlayerIdentityCandidates = () => [],
}) => {
  const teamARefs = new Set((Array.isArray(teamA) ? teamA : []).map(normalizeTeamEntry).filter(Boolean));
  const teamBRefs = new Set((Array.isArray(teamB) ? teamB : []).map(normalizeTeamEntry).filter(Boolean));
  if (teamARefs.size === 0 && teamBRefs.size === 0) {
    return { resolvedTeam: null, foundInFinalRoster: false };
  }

  const candidateRefs = new Set(Array.from(userIdentitySet || []));

  (Array.isArray(participants) ? participants : []).forEach((participant) => {
    const refs = [
      participant?.ref,
      participant?.uuid,
      participant?.usuario_id,
      participant?.id,
      participant?.email,
      participant?.nombre,
    ]
      .map(normalizeIdentity)
      .filter(Boolean);

    if (refs.some((ref) => candidateRefs.has(ref))) {
      refs.forEach((ref) => candidateRefs.add(ref));
    }
  });

  let hasCurrentUserMatchPlayer = false;
  (Array.isArray(matchPlayers) ? matchPlayers : []).forEach((player) => {
    if (!isCurrentUserPlayer(player)) return;
    hasCurrentUserMatchPlayer = true;
    (getPlayerIdentityCandidates(player) || []).forEach((ref) => candidateRefs.add(normalizeIdentity(ref)));
  });

  const inA = [...candidateRefs].some((ref) => teamARefs.has(ref));
  if (inA) return { resolvedTeam: 'equipo_a', foundInFinalRoster: true };
  const inB = [...candidateRefs].some((ref) => teamBRefs.has(ref));
  if (inB) return { resolvedTeam: 'equipo_b', foundInFinalRoster: true };

  if (hasCurrentUserMatchPlayer && teamARefs.size > 0 && teamBRefs.size === 0) {
    return { resolvedTeam: 'equipo_a', foundInFinalRoster: false };
  }
  if (hasCurrentUserMatchPlayer && teamBRefs.size > 0 && teamARefs.size === 0) {
    return { resolvedTeam: 'equipo_b', foundInFinalRoster: false };
  }

  return { resolvedTeam: null, foundInFinalRoster: false };
};

export const buildSurveyOutcomeStats = ({
  rawUserMatches = [],
  surveyRows = [],
  teamRows = [],
  lifecycleRows = [],
  userIdentitySet = new Set(),
  isCurrentUserPlayer = () => false,
  getPlayerIdentityCandidates = () => [],
  includeDebug = false,
}) => {
  const empty = {
    ganados: 0,
    empatados: 0,
    perdidos: 0,
    pendientes: 0,
    sinEquipoDetectado: 0,
    recientes: [],
    debugEntries: [],
  };

  const { uniqueMatches, duplicateEntries } = dedupeMatchesWithDebug(rawUserMatches || []);
  if (uniqueMatches.length === 0) {
    return {
      ...empty,
      debugEntries: includeDebug ? duplicateEntries : [],
    };
  }

  const bySurvey = new Map((surveyRows || []).map((row) => [Number(row?.partido_id), row]));
  const byTeams = new Map((teamRows || []).map((row) => [Number(row?.partido_id), row]));
  const byLifecycle = new Map((lifecycleRows || []).map((row) => [Number(row?.id), row]));

  let ganados = 0;
  let empatados = 0;
  let perdidos = 0;
  let pendientes = 0;
  let sinEquipoDetectado = 0;
  const recientes = [];
  const debugEntries = [];

  uniqueMatches.forEach((match) => {
    const matchId = Number(match?.id);
    if (!Number.isFinite(matchId)) return;

    const survey = bySurvey.get(matchId);
    const teamConfirm = byTeams.get(matchId);
    const lifecycle = byLifecycle.get(matchId);
    const winnerRaw = survey?.winner_team ?? lifecycle?.winner_team ?? match?.winner_team ?? null;
    const resultStatus = normalizeSurveyResultStatus(
      survey?.result_status ?? lifecycle?.result_status ?? match?.result_status,
    );
    const winner = normalizeSurveyWinner(winnerRaw);
    const hasWinner = winner === 'equipo_a' || winner === 'equipo_b' || winner === 'empate';

    const snapshotTeams = survey?.snapshot_equipos || null;
    const participants = Array.isArray(survey?.snapshot_participantes)
      ? survey.snapshot_participantes
      : (Array.isArray(teamConfirm?.participants) ? teamConfirm.participants : []);

    const expectedRosterRefs = new Set();
    (Array.isArray(participants) ? participants : []).forEach((participant) => {
      const ref = normalizeTeamEntry(participant);
      if (ref) expectedRosterRefs.add(ref);
    });
    (Array.isArray(match?.jugadores) ? match.jugadores : []).forEach((player) => {
      const ref = getStableMatchPlayerRef(player);
      if (ref) expectedRosterRefs.add(ref);
    });

    const selectedTeams = selectBestTeamPair({
      candidates: [
        {
          source: 'snapshot_equipos',
          teamA: Array.isArray(snapshotTeams?.team_a) ? snapshotTeams.team_a : [],
          teamB: Array.isArray(snapshotTeams?.team_b) ? snapshotTeams.team_b : [],
        },
        {
          source: 'survey_team',
          teamA: Array.isArray(lifecycle?.survey_team_a) ? lifecycle.survey_team_a : [],
          teamB: Array.isArray(lifecycle?.survey_team_b) ? lifecycle.survey_team_b : [],
        },
        {
          source: 'final_team',
          teamA: Array.isArray(lifecycle?.final_team_a) ? lifecycle.final_team_a : [],
          teamB: Array.isArray(lifecycle?.final_team_b) ? lifecycle.final_team_b : [],
        },
        {
          source: 'team_confirmations',
          teamA: Array.isArray(teamConfirm?.team_a) ? teamConfirm.team_a : [],
          teamB: Array.isArray(teamConfirm?.team_b) ? teamConfirm.team_b : [],
        },
      ],
      expectedRosterRefs,
    });
    const teamA = selectedTeams.teamA;
    const teamB = selectedTeams.teamB;
    const finishedAt = survey?.finished_at ?? lifecycle?.finished_at ?? match?.finished_at ?? null;
    const closedPlayed = isClosedPlayedSurveyOutcome({
      resultStatus,
      winnerTeam: winnerRaw,
      finishedAt,
    });

    let countedAsPlayed = false;
    let appliedOutcome = 'excluded';
    let excludedReason = null;

    if (resultStatus === 'not_played' || isNotPlayedOutcomeToken(winnerRaw)) {
      excludedReason = 'not_played';
    } else if (!closedPlayed && !hasWinner) {
      pendientes += 1;
      recientes.push({
        id: `survey-${matchId}`,
        ts: match?.fecha ? new Date(`${match.fecha}T${String(match?.hora || '00:00').slice(0, 5)}`).getTime() : 0,
        fecha: match?.fecha || null,
        tipoLabel: match?.tipo_partido || match?.modalidad || 'Partido',
        nombre: match?.nombre || 'Partido',
        source: 'encuesta',
        resultKey: 'pendiente',
        label: 'Pendiente',
      });
      appliedOutcome = 'pending';
      excludedReason = 'match_not_closed';
    } else if (resultStatus === 'draw' || winner === 'empate') {
      empatados += 1;
      countedAsPlayed = true;
      appliedOutcome = 'draw';
      recientes.push({
        id: `survey-${matchId}`,
        ts: match?.fecha ? new Date(`${match.fecha}T${String(match?.hora || '00:00').slice(0, 5)}`).getTime() : 0,
        fecha: match?.fecha || null,
        tipoLabel: match?.tipo_partido || match?.modalidad || 'Partido',
        nombre: match?.nombre || 'Partido',
        source: 'encuesta',
        resultKey: 'empate',
        label: 'Empate',
      });
    } else if (!hasWinner) {
      pendientes += 1;
      appliedOutcome = 'pending';
      excludedReason = 'missing_result';
      recientes.push({
        id: `survey-${matchId}`,
        ts: match?.fecha ? new Date(`${match.fecha}T${String(match?.hora || '00:00').slice(0, 5)}`).getTime() : 0,
        fecha: match?.fecha || null,
        tipoLabel: match?.tipo_partido || match?.modalidad || 'Partido',
        nombre: match?.nombre || 'Partido',
        source: 'encuesta',
        resultKey: 'pendiente',
        label: 'Pendiente',
      });
    } else {
      const userTeamInfo = resolveUserTeam({
        participants,
        teamA,
        teamB,
        matchPlayers: match?.jugadores || [],
        userIdentitySet,
        isCurrentUserPlayer,
        getPlayerIdentityCandidates,
      });

      if (!userTeamInfo.resolvedTeam) {
        sinEquipoDetectado += 1;
        appliedOutcome = 'excluded';
        excludedReason = selectedTeams.source ? 'user_not_in_final_roster' : 'team_unresolved';
        recientes.push({
          id: `survey-${matchId}`,
          ts: match?.fecha ? new Date(`${match.fecha}T${String(match?.hora || '00:00').slice(0, 5)}`).getTime() : 0,
          fecha: match?.fecha || null,
          tipoLabel: match?.tipo_partido || match?.modalidad || 'Partido',
          nombre: match?.nombre || 'Partido',
          source: 'encuesta',
          resultKey: 'sin_equipo',
          label: 'Sin equipo detectado',
        });
      } else if (winner === userTeamInfo.resolvedTeam) {
        ganados += 1;
        countedAsPlayed = true;
        appliedOutcome = 'win';
        recientes.push({
          id: `survey-${matchId}`,
          ts: match?.fecha ? new Date(`${match.fecha}T${String(match?.hora || '00:00').slice(0, 5)}`).getTime() : 0,
          fecha: match?.fecha || null,
          tipoLabel: match?.tipo_partido || match?.modalidad || 'Partido',
          nombre: match?.nombre || 'Partido',
          source: 'encuesta',
          resultKey: 'ganaste',
          label: 'Ganaste',
        });
      } else {
        perdidos += 1;
        countedAsPlayed = true;
        appliedOutcome = 'loss';
        recientes.push({
          id: `survey-${matchId}`,
          ts: match?.fecha ? new Date(`${match.fecha}T${String(match?.hora || '00:00').slice(0, 5)}`).getTime() : 0,
          fecha: match?.fecha || null,
          tipoLabel: match?.tipo_partido || match?.modalidad || 'Partido',
          nombre: match?.nombre || 'Partido',
          source: 'encuesta',
          resultKey: 'perdiste',
          label: 'Perdiste',
        });
      }
    }

    if (includeDebug) {
      const userTeamInfo = resolveUserTeam({
        participants,
        teamA,
        teamB,
        matchPlayers: match?.jugadores || [],
        userIdentitySet,
        isCurrentUserPlayer,
        getPlayerIdentityCandidates,
      });
      debugEntries.push({
        match_id: matchId,
        nombre: String(match?.nombre || `Partido ${matchId}`),
        estado: match?.estado ?? null,
        survey_status: match?.survey_status ?? lifecycle?.survey_status ?? null,
        result_status: resultStatus || null,
        winner_team: winnerRaw ?? null,
        finished_at: finishedAt ?? null,
        team_selection: {
          selected_source: selectedTeams.source || null,
          selected_reason: selectedTeams.reason || null,
          team_a_count: teamA.length,
          team_b_count: teamB.length,
          candidates: selectedTeams.evaluations || [],
        },
        user_resolution: {
          user_ref: Array.from(userIdentitySet || [])[0] || null,
          resolved_team: userTeamInfo.resolvedTeam === 'equipo_a'
            ? 'A'
            : userTeamInfo.resolvedTeam === 'equipo_b'
              ? 'B'
              : 'none',
          found_in_final_roster: Boolean(userTeamInfo.foundInFinalRoster),
        },
        dedupe: {
          is_duplicate: false,
          duplicate_of_match_id: null,
        },
        result_application: {
          counted_as_played: countedAsPlayed,
          applied_outcome: appliedOutcome,
          excluded_reason: excludedReason,
        },
      });
    }
  });

  return {
    ganados,
    empatados,
    perdidos,
    pendientes,
    sinEquipoDetectado,
    recientes,
    debugEntries: includeDebug ? [...debugEntries, ...duplicateEntries] : [],
  };
};
