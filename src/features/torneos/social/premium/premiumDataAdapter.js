import { PREMIUM_V2_GEOMETRY } from './generated/premiumGeometry';
import { fitPremiumLines, fitPremiumWords } from './premiumAutofit';

const TITLES = Object.freeze({
  round_results: ['RESULTADOS', 'DE LA FECHA'],
  next_fixture: ['PRÓXIMA', 'FECHA'],
  standings: ['TABLA', 'DE POSICIONES'],
  mvp: ['FIGURA', 'DE LA FECHA'],
  scorers: ['GOLEADORES', 'DE LA FECHA'],
  discipline: ['DISCIPLINA', 'Y FAIR PLAY'],
  best_eleven: ['EQUIPO', 'IDEAL'],
  round_summary: ['RESUMEN', 'DE LA FECHA'],
  semifinals: ['SEMIFINALES', 'IDA Y VUELTA'],
});

const FAMILY_KICKERS = Object.freeze({
  scorers: 'TABLA DE GOLEADORES',
  discipline: 'DISCIPLINA · FAIR PLAY',
  best_eleven: 'SELECCIÓN DE LA FECHA',
  round_summary: 'JORNADA COMPLETA',
  semifinals: 'FASE FINAL · LLAVES',
});

const THEME_TEXT = Object.freeze({
  heritage: { family: 'Barlow Condensed', weight: 700, rowBox: 220, rowBase: 38 },
  street: { family: 'Archivo Black', weight: 400, rowBox: 208, rowBase: 38 },
  scoreboard: { family: 'Oswald', weight: 600, rowBox: 250, rowBase: 42 },
  editorial: { family: 'Libre Franklin', weight: 600, rowBox: 230, rowBase: 34 },
});

const LINE_LABELS = Object.freeze({
  DEL: 'DELANTEROS', MED: 'MEDIOCAMPO', DEF: 'DEFENSA', ARQ: 'ARQUERO',
});
const LINE_ORDER = Object.freeze(['DEL', 'MED', 'DEF', 'ARQ']);

function text(value, fallback = '—') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function initials(value) {
  const normalized = text(value, 'EQ');
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.slice(0, 3).map((part) => part[0]).join('').toUpperCase();
}

function assetSource(asset) {
  if (!asset) return null;
  if (typeof asset === 'string') return asset;
  if (typeof asset.src === 'string' && asset.src) return asset.src;
  if (typeof document === 'undefined' || !asset.width || !asset.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = asset.width;
  canvas.height = asset.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(asset, 0, 0);
  return canvas.toDataURL('image/png');
}

function teamModel(raw, assets, crestAssets) {
  const source = raw || {};
  const name = text(source.name || source.teamName || source.shortName, 'EQUIPO');
  const ini = initials(source.shortName || name);
  const shieldPath = source.shieldPath || source.crest || null;
  const src = assetSource(shieldPath ? assets?.shields?.[shieldPath] : null);
  if (src) crestAssets[ini] = src;
  return {
    id: source.teamEntryId || source.participantId || source.id || ini,
    ini,
    name,
    kind: source.crestKind || 'shield',
    c1: source.primaryColor || '#1B4E8C',
    c2: source.secondaryColor || '#F2F2F2',
    fb: !src && source.crestKind === null,
  };
}

function pickSkeleton(skeletons, key, index) {
  const list = skeletons?.[key] || [];
  if (!list.length) return {};
  return list[index] || list[index % list.length] || {};
}

function score(match) {
  const result = match?.result || match?.score || null;
  if (!result) return { home: '—', away: '—', joined: '—' };
  const home = result.homeScore ?? result.home ?? '—';
  const away = result.awayScore ?? result.away ?? '—';
  return { home: String(home), away: String(away), joined: `${home} - ${away}` };
}

function dateParts(match, timezone) {
  if (!match?.scheduledAt) {
    return { date: 'FECHA A CONFIRMAR', time: 'HORARIO A CONFIRMAR' };
  }
  const instant = new Date(match.scheduledAt);
  if (!Number.isFinite(instant.getTime())) {
    return { date: 'FECHA A CONFIRMAR', time: 'HORARIO A CONFIRMAR' };
  }
  const date = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: timezone,
  }).format(instant).replaceAll('.', '').toUpperCase();
  const time = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  }).format(instant);
  return { date, time };
}

function matchRows(matches, assets, crestAssets, skeletons, themeId, formatId, timezone) {
  const font = THEME_TEXT[themeId];
  const nextBox = themeId === 'street' && formatId === 'story' ? 272 : font.rowBox;
  return (matches || []).map((match, index) => {
    const style = pickSkeleton(skeletons, 'rows', index);
    const fixtureStyle = pickSkeleton(skeletons, 'fixtures', index);
    const home = teamModel(match.home, assets, crestAssets);
    const away = teamModel(match.away, assets, crestAssets);
    const result = score(match);
    const when = dateParts(match, timezone);
    const homeSize = fitPremiumLines(home.name, {
      family: font.family, weight: font.weight, width: nextBox,
      base: style.hFS || fixtureStyle.hFS || font.rowBase, min: 20, maxLines: 3,
    });
    const awaySize = fitPremiumLines(away.name, {
      family: font.family, weight: font.weight, width: nextBox,
      base: style.aFS || fixtureStyle.aFS || font.rowBase, min: 20, maxLines: 3,
    });
    return {
      id: match.id || `match-${index}`,
      ...style,
      ...fixtureStyle,
      h: home,
      a: away,
      s: result.joined,
      hs: result.home,
      as: result.away,
      d: when.date,
      t: when.time,
      v: text(match.venueName || match.venue?.name, 'SEDE A DEFINIR'),
      hFS: homeSize,
      aFS: awaySize,
    };
  });
}

function standingRows(rawRows, heads, assets, crestAssets, skeletons) {
  return (rawRows || []).map((row, index) => {
    const style = pickSkeleton(skeletons, 'std', index);
    const team = teamModel(row.team || row, assets, crestAssets);
    const values = {
      PJ: row.played ?? row.pj ?? 0,
      PG: row.won ?? row.pg ?? 0,
      PE: row.drawn ?? row.pe ?? 0,
      PP: row.lost ?? row.pp ?? 0,
      GF: row.goalsFor ?? row.gf ?? 0,
      GC: row.goalsAgainst ?? row.gc ?? 0,
      DG: row.goalDifference ?? row.dg ?? 0,
      PTS: row.points ?? row.pts ?? 0,
    };
    const cells = (heads || []).map((head, cellIndex) => {
      const cellStyle = style.cells?.[cellIndex] || {};
      const value = values[head.k];
      return { ...cellStyle, v: head.k === 'DG' && value > 0 ? `+${value}` : String(value ?? '—') };
    });
    return {
      id: row.teamEntryId || row.participantId || row.id || `standing-${index}`,
      ...style,
      pos: String(row.position ?? index + 1),
      t: team,
      cells,
    };
  });
}

function scorerRows(players, assets, crestAssets, skeletons) {
  return (players || []).map((player, index) => {
    const style = pickSkeleton(skeletons, 'scorers', index);
    const team = teamModel(player.team || player, assets, crestAssets);
    return {
      id: player.rosterPlayerId || player.id || `scorer-${index}`,
      ...style,
      pos: String(index + 1),
      name: text(player.name),
      team: team.name,
      t: team,
      g: String(player.goals ?? player.stats?.goals ?? 0),
      pj: String(player.appearances ?? player.stats?.appearances ?? 0),
    };
  });
}

function disciplineRows(players, assets, crestAssets, skeletons) {
  return (players || []).map((player, index) => {
    const style = pickSkeleton(skeletons, 'disc', index);
    const team = teamModel(player.team || player, assets, crestAssets);
    const yellows = player.yellowCards ?? player.yellows ?? player.stats?.yellowCards ?? 0;
    const reds = player.directReds ?? player.redCards ?? player.stats?.redCards ?? 0;
    return {
      id: player.rosterPlayerId || player.id || `discipline-${index}`,
      ...style,
      pos: String(index + 1), t: team, name: team.name,
      ta: String(yellows), tr: String(reds), pts: String(yellows + reds * 3),
    };
  });
}

function suspensionRows(players) {
  return (players || []).filter((player) => (player.suspensions || []).length).slice(0, 3)
    .map((player, index) => ({
      id: player.rosterPlayerId || `suspension-${index}`,
      p: text(player.name),
      tm: text(player.team?.name || player.teamName, ''),
      d: player.suspensions[0]?.remainingMatches
        ? `${player.suspensions[0].remainingMatches} FECHA${player.suspensions[0].remainingMatches === 1 ? '' : 'S'}`
        : 'A CONFIRMAR',
    }));
}

function pitchRows(players, themeId, formatId, skeletons) {
  const groups = Object.fromEntries(LINE_ORDER.map((position) => [position, []]));
  (players || []).forEach((player, index) => {
    const position = LINE_ORDER.includes(player.selectedLine) ? player.selectedLine
      : player.isGoalkeeper ? 'ARQ'
        : LINE_ORDER.includes(player.position) ? player.position
          : ['DEF', 'MED', 'DEL'][index % 3];
    groups[position].push(player);
  });
  const box = formatId === 'story' ? (themeId === 'street' ? 846 : 860) : 800;
  const gap = formatId === 'story' ? 18 : 14;
  const maxWidth = formatId === 'story' ? 280 : 250;
  const padding = formatId === 'story' ? 34 : 28;
  const base = formatId === 'story' ? 30 : 28;
  return LINE_ORDER.filter((position) => groups[position].length).map((position, lineIndex) => {
    const line = groups[position];
    const style = pickSkeleton(skeletons, 'pitch', lineIndex);
    const slot = Math.floor((box - (line.length - 1) * gap) / line.length);
    const width = Math.min(slot, maxWidth);
    return {
      id: position,
      ...style,
      l: LINE_LABELS[position],
      n: line.length,
      fl: line.length === 1 ? 0.74 : (style.fl || 1),
      players: line.map((player, playerIndex) => ({
        id: player.rosterPlayerId || `${position}-${playerIndex}`,
        n: text(player.name),
        ini: initials(player.team?.shortName || player.team?.name || player.teamName),
        w: width,
        nFS: fitPremiumWords(player.name, {
          family: THEME_TEXT[themeId].family,
          weight: THEME_TEXT[themeId].weight,
          width: Math.max(60, width - padding), base, min: formatId === 'story' ? 20 : 18,
        }),
      })),
    };
  });
}

function summaryModel(matches, timezone) {
  const played = (matches || []).filter((match) => match.result || match.score);
  const goals = played.reduce((total, match) => {
    const result = score(match);
    return total + (Number(result.home) || 0) + (Number(result.away) || 0);
  }, 0);
  const biggest = [...played].sort((left, right) => {
    const l = score(left); const r = score(right);
    return (Number(r.home) + Number(r.away)) - (Number(l.home) + Number(l.away));
  })[0];
  const biggestText = biggest
    ? `${text(biggest.home?.name)} ${score(biggest).joined} ${text(biggest.away?.name)}`
    : 'SIN PARTIDOS FINALIZADOS';
  const next = (matches || []).find((match) => !match.result && !match.score);
  const nextDate = next ? dateParts(next, timezone).date : 'A CONFIRMAR';
  return {
    stats: [
      { v: String(goals), l: 'GOLES' },
      { v: played.length ? (goals / played.length).toFixed(1).replace('.', ',') : '—', l: 'PROMEDIO' },
      { v: String(played.length), l: 'PARTIDOS' },
      { v: '—', l: 'ASISTENCIA' },
    ],
    notes: [
      { l: 'PARTIDO DESTACADO', v: biggestText },
      { l: 'JORNADA', v: `${played.length} PARTIDOS FINALIZADOS` },
      { l: 'ESTADO', v: played.length ? 'RESULTADOS OFICIALES PUBLICADOS' : 'SIN RESULTADOS' },
      { l: 'PRÓXIMA FECHA', v: nextDate },
    ],
  };
}

function finalMetadata(match, timezone) {
  const when = dateParts(match, timezone);
  return {
    date: when.date,
    time: when.time,
    venue: text(match?.venueName || match?.venue?.name, 'SEDE A DEFINIR'),
    items: [
      { l: 'FECHA', v: when.date, bd: true },
      { l: 'HORA', v: when.time, bd: true },
      { l: 'SEDE', v: text(match?.venueName || match?.venue?.name, 'SEDE A DEFINIR'), bd: false },
    ],
  };
}

function selectedPlayers(snapshot, content, editorial) {
  if (content?.selectedPlayers) return content.selectedPlayers;
  const candidates = snapshot?.official?.candidates || [];
  const selected = new Set(editorial?.selection || []);
  const players = selected.size
    ? candidates.filter((candidate) => selected.has(candidate.rosterPlayerId))
    : candidates;
  return players.map((player, index) => ({
    ...player,
    selectedLine: editorial?.selectedLines?.[player.rosterPlayerId]
      || player.selectedLine
      || (player.isGoalkeeper ? 'ARQ' : LINE_ORDER.includes(player.position) ? player.position : ['DEF', 'MED', 'DEL'][index % 3]),
  }));
}

function selectedPlayer(snapshot, content, editorial) {
  if (content?.selectedPlayer) return content.selectedPlayer;
  return selectedPlayers(snapshot, content, editorial)[0] || null;
}

function resolveVariant(snapshot, formatId, editorial, photoSrc) {
  const piece = snapshot?.piece;
  const official = snapshot?.official || {};
  if (piece === 'round_results') {
    if (formatId === 'story') return 'res4';
    const matches = official.matches || [];
    const hasLongName = matches.some((match) => (
      text(match.home?.name, '').length > 34 || text(match.away?.name, '').length > 34
    ));
    if (hasLongName && matches.length <= 4) return 'resLong';
    return matches.length > 4 ? 'res8' : 'res4';
  }
  if (piece === 'next_fixture') return 'next';
  if (piece === 'standings') {
    return formatId === 'story' || (official.rows || []).length > 8 ? 'table18' : 'table8';
  }
  if (piece === 'mvp') return formatId === 'story' ? 'mvp' : (photoSrc ? 'figuraFoto' : 'figuraSin');
  if (piece === 'final') return 'final';
  if (piece === 'champion') return photoSrc ? 'campeonFoto' : 'campeon';
  return {
    scorers: 'scorers', discipline: 'discipline', best_eleven: 'best11',
    round_summary: 'summary', semifinals: 'semis',
  }[piece] || 'res4';
}

export function createPremiumViewModel({
  snapshot, content, editorial = {}, assets = {}, branding = {}, sponsors = [],
  themeId, formatId,
}) {
  const crestAssets = {};
  const tournamentLogo = assetSource(assets?.branding?.tournamentLogo);
  if (tournamentLogo) crestAssets.CH = tournamentLogo;
  const photoSrc = assetSource(assets?.photo);
  const variant = resolveVariant(snapshot, formatId, editorial, photoSrc);
  const geometry = PREMIUM_V2_GEOMETRY[`${themeId}:${formatId}`]?.[variant];
  if (!geometry) throw new Error(`PREMIUM_V2_LAYOUT_MISSING: ${themeId}/${formatId}/${variant}`);
  const visibleSponsors = (sponsors || []).map((sponsor, index) => ({
    id: sponsor.id || `sponsor-${index}`,
    name: sponsor.name || '',
    src: assetSource(sponsor.image || sponsor.src),
  })).filter((sponsor) => sponsor.src).slice(0, 3);
  const geometryValues = {
    ...geometry,
    ...(visibleSponsors.length ? geometry.withSponsors : null),
  };
  delete geometryValues.withSponsors;
  const competition = snapshot?.competition || content?.competition || {};
  const official = snapshot?.official || {};
  const timezone = competition.timezone || 'America/Argentina/Buenos_Aires';
  const matches = official.matches || content?.matches || [];
  const rows = matchRows(matches, assets, crestAssets, geometry.skeletons, themeId, formatId, timezone);
  const fixtures = rows;
  const tableHeads = geometry.tHeads || [];
  const standings = standingRows(official.rows || [], tableHeads, assets, crestAssets, geometry.skeletons);
  const scorers = scorerRows(official.players || [], assets, crestAssets, geometry.skeletons);
  const discipline = disciplineRows(official.players || [], assets, crestAssets, geometry.skeletons);
  const pitch = pitchRows(selectedPlayers(snapshot, content, editorial), themeId, formatId, geometry.skeletons);
  const summary = summaryModel(matches, timezone);
  const semis = rows.slice(0, 2).map((match, index) => ({
    ...match,
    ...pickSkeleton(geometry.skeletons, 'semis', index),
    n: `SEMIFINAL ${index + 1}`,
    ida: match.s,
    idaL: `IDA · ${match.d}`,
    vuelta: `VUELTA · ${match.t}`,
    sede: match.v,
  }));
  const figure = selectedPlayer(snapshot, content, editorial) || {};
  const figureTeam = teamModel(figure.team || {}, assets, crestAssets);
  const championRaw = official.officialChampion
    || selectedPlayer(snapshot, content, editorial)?.team
    || official.candidates?.[0]
    || {};
  const champion = teamModel(championRaw.team || championRaw, assets, crestAssets);
  const finalMatch = matches[0] || {};
  const finalHome = teamModel(finalMatch.home, assets, crestAssets);
  const finalAway = teamModel(finalMatch.away, assets, crestAssets);
  const finalMeta = finalMetadata(finalMatch, timezone);
  const [titleTop, titleBottom] = TITLES[snapshot?.piece] || ['RESULTADOS', 'DE LA FECHA'];
  const year = text(competition.seasonName || competition.seasonYear || '', '')
    || text(competition.tournamentName, '').match(/\b20\d{2}\b/)?.[0]
    || text(snapshot?.generatedAt, '').slice(0, 4)
    || '';
  const round = text(competition.roundName, 'FECHA');
  const roundNumber = competition.roundNumber ?? round.match(/\d+/)?.[0] ?? '—';
  const tournamentName = text(branding.tournamentName || competition.tournamentName, 'TORNEO');
  const tournamentSeason = year && !tournamentName.includes(year)
    ? `${tournamentName} ${year}`
    : tournamentName;
  const categoryName = text(competition.categoryName, 'CATEGORÍA');
  const figureName = text(figure.name, 'JUGADOR DESTACADO').split(/\s+/);
  const figFirst = figureName.slice(0, -1).join(' ') || figureName[0];
  const figLast = figureName.length > 1 ? figureName.at(-1) : '';
  return {
    ...geometryValues,
    crestAssets,
    tournamentName,
    tournamentSeason,
    seasonLabel: year ? `TEMPORADA ${year}` : 'TEMPORADA',
    categoryName,
    round,
    roundNo: String(roundNumber),
    roundNum: String(roundNumber),
    nextRound: round,
    nextRoundIt: round,
    nextRoundNum: String(roundNumber),
    nextCount: String(matches.length),
    t1: titleTop,
    t2: titleBottom,
    kicker: FAMILY_KICKERS[snapshot?.piece] || round,
    famKicker: FAMILY_KICKERS[snapshot?.piece] || round,
    foot: `${tournamentName} · ${round}`,
    rows,
    fixtures,
    std: standings,
    tHeads: tableHeads,
    scorers,
    disc: discipline,
    sanc: suspensionRows(official.players || []),
    pitch,
    xi: pitch,
    sumStats: summary.stats,
    sumNotes: summary.notes,
    semis,
    sponsors: visibleSponsors,
    hasSponsors: visibleSponsors.length > 0,
    figuraSrc: photoSrc,
    championPhotoSrc: photoSrc,
    figuraFocalX: Number.isFinite(editorial.figuraFocalX) ? editorial.figuraFocalX : 0.5,
    figuraFocalY: Number.isFinite(editorial.figuraFocalY)
      ? editorial.figuraFocalY
      : (Number.isFinite(editorial.photoOffsetY) ? editorial.photoOffsetY : 0.5),
    figuraZoom: Number.isFinite(editorial.figuraZoom)
      ? Math.max(1, Math.min(3, editorial.figuraZoom)) : 1,
    showFigureSafeGuides: false,
    figFirst,
    figLast,
    figIni: initials(figure.name),
    figPos: LINE_LABELS[figure.position] || text(figure.position, 'JUGADOR'),
    figTeamIni: figureTeam.ini,
    figTeamKind: figureTeam.kind,
    figTeamC1: figureTeam.c1,
    figTeamC2: figureTeam.c2,
    figTeamName: figureTeam.name,
    figStats: [
      { v: String(figure.goals ?? figure.stats?.goals ?? '—'), l: 'GOLES' },
      { v: String(figure.appearances ?? figure.stats?.appearances ?? '—'), l: 'PARTIDOS' },
    ],
    fA: finalHome,
    fB: finalAway,
    finalMeta: finalMeta.items,
    finalDate: finalMeta.date,
    finalTime: finalMeta.time,
    finalVenue: finalMeta.venue,
    cT: champion,
    campHasCrest: Boolean(crestAssets[champion.ini]),
    campNoCrest: !crestAssets[champion.ini],
    campNameFS: fitPremiumLines(champion.name, {
      family: THEME_TEXT[themeId].family, weight: THEME_TEXT[themeId].weight,
      width: formatId === 'story' ? 900 : 620, base: formatId === 'story' ? 92 : 78,
      min: 36, maxLines: 3,
    }),
    campFotoNameFS: fitPremiumLines(champion.name, {
      family: THEME_TEXT[themeId].family, weight: THEME_TEXT[themeId].weight,
      width: formatId === 'story' ? 780 : 620, base: formatId === 'story' ? 54 : 58,
      min: 30, maxLines: 3,
    }),
    campStats: [
      { v: String(championRaw.points ?? '—'), l: 'PUNTOS' },
      { v: String(championRaw.goalDifference ?? '—'), l: 'DIFERENCIA' },
      { v: String(championRaw.played ?? '—'), l: 'FECHAS' },
    ],
  };
}

export function premiumVariantForSnapshot(options) {
  return resolveVariant(options.snapshot, options.formatId, options.editorial, options.photoSrc);
}
