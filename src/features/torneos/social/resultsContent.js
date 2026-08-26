/**
 * Pure boundary between the official snapshot and the Results presentation.
 * No renderer, asset or theme concerns belong in this model.
 */
export function adaptSnapshotToResultsContent(snapshot, editorialSelection = {}) {
  if (snapshot?.piece !== 'round_results') {
    throw new Error(`RESULTS_CONTENT_PIECE_INVALID: ${String(snapshot?.piece)}`);
  }

  const competition = snapshot.competition || {};
  return {
    kind: 'results',
    competition: {
      organizationName: competition.organizationName || '',
      tournamentName: competition.tournamentName || '',
      competitionName: competition.competitionName || competition.phaseName || '',
      categoryName: competition.categoryName || '',
      stageName: competition.stageName || competition.phaseName || '',
      roundName: competition.roundName || '',
      roundNumber: competition.roundNumber ?? null,
      // Existing snapshots do not always project this yet. The explicit
      // fallback preserves the current Argentina presentation deterministically.
      timezone: competition.timezone || snapshot.timezone || 'America/Argentina/Buenos_Aires',
    },
    matches: (snapshot.official?.matches || []).map((match) => ({
      id: match.id,
      home: match.home ? { ...match.home } : null,
      away: match.away ? { ...match.away } : null,
      score: match.result ? {
        home: match.result.homeScore,
        away: match.result.awayScore,
        homePenalties: match.result.homePenalties ?? null,
        awayPenalties: match.result.awayPenalties ?? null,
      } : null,
      status: match.status || null,
    })),
    additionalNote: String(editorialSelection.note || ''),
  };
}
