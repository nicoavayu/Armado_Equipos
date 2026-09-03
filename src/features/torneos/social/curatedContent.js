import {
  fallbackSocialPlayerLine,
  selectionSizeForSnapshot,
} from './socialContracts';

function normalizedTeam(candidate) {
  if (candidate?.team) {
    return {
      teamEntryId: candidate.team.teamEntryId || candidate.teamEntryId || null,
      name: candidate.team.name || '',
      shortName: candidate.team.shortName || null,
      shieldPath: candidate.team.shieldPath || null,
    };
  }
  return candidate?.teamEntryId ? {
    teamEntryId: candidate.teamEntryId,
    name: candidate.teamName || '',
    shortName: candidate.shortName || null,
    shieldPath: candidate.shieldPath || null,
  } : null;
}

function normalizedCandidate(candidate) {
  return {
    rosterPlayerId: candidate.rosterPlayerId,
    teamEntryId: candidate.teamEntryId || null,
    name: candidate.name || '',
    position: candidate.position ?? null,
    isGoalkeeper: candidate.isGoalkeeper === true,
    team: normalizedTeam(candidate),
    portraitRef: candidate.portraitRef || null,
    stats: {
      goals: candidate.goals ?? null,
      ownGoals: candidate.ownGoals ?? null,
      assists: candidate.assists ?? null,
      appearances: candidate.appearances ?? null,
      starts: candidate.starts ?? null,
      substituteAppearances: candidate.substituteAppearances ?? null,
      yellowCards: candidate.yellowCards ?? null,
      secondYellows: candidate.secondYellows ?? null,
      redCards: candidate.redCards ?? null,
      captaincies: candidate.captaincies ?? null,
    },
  };
}

/**
 * Pure adapter for the two player-curated pieces. It intentionally contains no
 * auth, Supabase, entitlement or asset-resolution behavior.
 */
export function adaptSnapshotToCuratedContent(snapshot, editorial = {}) {
  if (!['best_eleven', 'mvp'].includes(snapshot?.piece)) {
    throw new Error(`CURATED_CONTENT_PIECE_INVALID: ${String(snapshot?.piece)}`);
  }
  const candidates = (snapshot.official?.candidates || []).map(normalizedCandidate);
  const byId = new Map(candidates.map((candidate) => [candidate.rosterPlayerId, candidate]));
  const selected = (editorial.selection || []).map((id, index) => {
    const candidate = byId.get(id);
    if (!candidate) return null;
    return {
      ...candidate,
      selectedLine: editorial.selectedLines?.[id]
        || fallbackSocialPlayerLine(candidate, index),
    };
  }).filter(Boolean);
  const competition = {
    tournamentName: snapshot.competition?.tournamentName || '',
    categoryName: snapshot.competition?.categoryName || '',
    phaseName: snapshot.competition?.phaseName || '',
    roundName: snapshot.competition?.roundName || '',
  };

  if (snapshot.piece === 'best_eleven') {
    return Object.freeze({
      kind: 'teamOfRound',
      competition: Object.freeze(competition),
      sportModality: snapshot.official?.sportModality || null,
      teamSize: selectionSizeForSnapshot(snapshot),
      candidates: Object.freeze(candidates),
      selectedPlayers: Object.freeze(selected),
    });
  }
  return Object.freeze({
    kind: 'figure',
    competition: Object.freeze(competition),
    candidates: Object.freeze(candidates),
    selectedPlayer: selected[0] || null,
  });
}
