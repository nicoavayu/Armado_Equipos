/**
 * The eleven pieces.
 *
 * Each template receives the frame's body rectangle and draws inside it. None
 * of them reads anything but the validated snapshot and the editorial state, so
 * a template cannot accidentally reach for a draft table or a private note.
 *
 * The list-shaped pieces (standings, scorers, discipline) share one row engine:
 * a tournament with twenty teams and long club names has to stay legible in
 * both aspect ratios, and solving that once is the difference between a studio
 * and eleven bespoke layouts.
 */

import { findSocialPiece } from './socialContracts';
import { formatSocialDateTime } from './socialDateTime';
import { renderResultsListLayout } from './resultsListLayout';
import {
  SOCIAL_THEME,
  drawPhoto,
  drawShield,
  drawText,
  fontOf,
  glassCard,
  roundedRect,
  wrapText,
} from './socialRenderer';

const EMPTY_COPY = 'Todavía no hay datos oficiales publicados para esta selección.';

function drawEmptyState(ctx, body, accent) {
  glassCard(ctx, body.x, body.y, body.width, Math.min(220, body.height));
  drawText(ctx, 'Sin datos', body.x + 40, body.y + 84, {
    family: SOCIAL_THEME.heading, size: 44, weight: 600, color: accent,
  });
  wrapText(ctx, EMPTY_COPY, {
    family: SOCIAL_THEME.body, size: 26, maxWidth: body.width - 80, maxLines: 2,
  }).forEach((line, index) => {
    drawText(ctx, line, body.x + 40, body.y + 130 + index * 34, {
      family: SOCIAL_THEME.body, size: 26, color: SOCIAL_THEME.textMuted,
    });
  });
}

/**
 * Fits `count` rows into the available height, with a floor. Beyond what fits
 * the list is truncated and says so, rather than shrinking into unreadability.
 */
function rowMetrics(body, count, { min = 62, max = 108 } = {}) {
  if (count < 1) return { rowHeight: min, visible: 0, hidden: 0 };
  const ideal = Math.floor(body.height / count);
  const rowHeight = Math.max(min, Math.min(max, ideal));
  const visible = Math.max(1, Math.min(count, Math.floor(body.height / rowHeight)));
  return { rowHeight, visible, hidden: count - visible };
}

function drawTruncationNote(ctx, body, hidden, accent) {
  if (hidden < 1) return;
  drawText(ctx, `+${hidden} más`, body.x + body.width, body.y + body.height + 34, {
    family: SOCIAL_THEME.body, size: 24, weight: 600, color: accent, align: 'right',
  });
}

// ---------------------------------------------------------------------------
// Match-shaped pieces
// ---------------------------------------------------------------------------

function drawMatchRow(ctx, match, x, y, width, height, {
  accent, assets, showResult, timezone,
}) {
  glassCard(ctx, x, y, width, height, { radius: 22 });
  const pad = 22;
  const shield = Math.min(56, height - pad * 2);
  const scoreWidth = showResult ? 150 : 132;
  const nameWidth = (width - pad * 2 - shield * 2 - scoreWidth - 40) / 2;
  const centreY = y + height / 2;

  drawShield(ctx, assets.shields[match.home?.shieldPath], x + pad, centreY - shield / 2, shield, {
    name: match.home?.name, accent,
  });
  drawText(ctx, match.home?.shortName || match.home?.name || '—',
    x + pad + shield + 14, centreY + 10, {
      family: SOCIAL_THEME.heading, size: 34, weight: 600,
      maxWidth: nameWidth, minSize: 18,
    });

  const rightShieldX = x + width - pad - shield;
  drawShield(ctx, assets.shields[match.away?.shieldPath], rightShieldX, centreY - shield / 2, shield, {
    name: match.away?.name, accent,
  });
  drawText(ctx, match.away?.shortName || match.away?.name || '—',
    rightShieldX - 14, centreY + 10, {
      family: SOCIAL_THEME.heading, size: 34, weight: 600,
      align: 'right', maxWidth: nameWidth, minSize: 18,
    });

  const centreX = x + width / 2;
  if (showResult && match.result) {
    drawText(ctx, `${match.result.homeScore} - ${match.result.awayScore}`, centreX, centreY + 14, {
      family: SOCIAL_THEME.display, size: 52, weight: 700, align: 'center', color: accent,
    });
    if (match.result.homePenalties !== null && match.result.homePenalties !== undefined) {
      drawText(
        ctx,
        `(${match.result.homePenalties}-${match.result.awayPenalties} pen.)`,
        centreX, centreY + 42,
        { family: SOCIAL_THEME.body, size: 20, align: 'center', color: SOCIAL_THEME.textFaint },
      );
    }
  } else {
    const when = formatSocialDateTime(match.scheduledAt, match.timezone || timezone);
    drawText(ctx, when, centreX, centreY + 4, {
      family: SOCIAL_THEME.body, size: 24, weight: 600, align: 'center',
      color: SOCIAL_THEME.textMuted, maxWidth: scoreWidth, minSize: 16,
    });
    if (match.venueName) {
      drawText(ctx, match.venueName, centreX, centreY + 30, {
        family: SOCIAL_THEME.body, size: 19, align: 'center',
        color: SOCIAL_THEME.textFaint, maxWidth: scoreWidth + 40, minSize: 14,
      });
    }
  }
}

function matchesTemplate({ showResult, emphasis = 1 }) {
  return (ctx, { snapshot, editorial, body, accent, assets }) => {
    const matches = snapshot.official.matches || [];
    if (matches.length === 0) {
      drawEmptyState(ctx, body, accent);
      return;
    }
    if (emphasis === 1 && matches.length === 1) {
      // A single decisive match gets the whole body, not a one-row list.
      drawMatchRow(ctx, matches[0], body.x, body.y, body.width,
        Math.min(280, body.height), {
          accent, assets, showResult, timezone: snapshot.competition?.timezone,
        });
      return;
    }
    const { rowHeight, visible, hidden } = rowMetrics(body, matches.length, {
      min: 96, max: 150,
    });
    matches.slice(0, visible).forEach((match, index) => {
      drawMatchRow(
        ctx, match, body.x, body.y + index * rowHeight, body.width, rowHeight - 14,
        { accent, assets, showResult, timezone: snapshot.competition?.timezone },
      );
    });
    drawTruncationNote(ctx, body, hidden, accent);
    if (editorial) { /* editorial chrome is drawn by the frame */ }
  };
}

// ---------------------------------------------------------------------------
// List-shaped pieces
// ---------------------------------------------------------------------------

function listTemplate({ columns, rowsOf, emptyWhen }) {
  return (ctx, { snapshot, body, accent, assets }) => {
    const rows = rowsOf(snapshot);
    if (rows.length === 0 || emptyWhen?.(snapshot)) {
      drawEmptyState(ctx, body, accent);
      return;
    }
    const headerHeight = 46;
    const listBody = {
      ...body, y: body.y + headerHeight, height: body.height - headerHeight,
    };
    const { rowHeight, visible, hidden } = rowMetrics(listBody, rows.length);

    const columnX = (column) => (
      column.align === 'right'
        ? body.x + body.width - 24 - column.offset
        : body.x + 24 + column.offset
    );
    columns.forEach((column) => {
      drawText(ctx, column.label.toUpperCase(), columnX(column), body.y + 22, {
        family: SOCIAL_THEME.body, size: 20, weight: 700,
        color: SOCIAL_THEME.textFaint, align: column.align || 'left', letterSpacing: 1,
      });
    });

    rows.slice(0, visible).forEach((row, index) => {
      const y = listBody.y + index * rowHeight;
      const height = rowHeight - 10;
      glassCard(ctx, body.x, y, body.width, height, { radius: 18, strong: index === 0 });
      if (index === 0) {
        ctx.save();
        ctx.fillStyle = accent;
        roundedRect(ctx, body.x, y, 8, height, 4);
        ctx.fill();
        ctx.restore();
      }
      const centreY = y + height / 2 + 10;
      columns.forEach((column) => {
        const value = column.value(row, index);
        if (column.kind === 'shield') {
          const size = Math.min(46, height - 16);
          drawShield(ctx, assets.shields[value], columnX(column) - (column.align === 'right' ? size : 0),
            y + (height - size) / 2, size, { name: column.name?.(row) || '', accent });
          return;
        }
        drawText(ctx, value, columnX(column), centreY, {
          family: column.family || SOCIAL_THEME.heading,
          size: column.size || 32,
          weight: column.weight || 500,
          color: column.color || SOCIAL_THEME.text,
          align: column.align || 'left',
          maxWidth: column.maxWidth || 320,
          minSize: 16,
        });
      });
    });
    drawTruncationNote(ctx, listBody, hidden, accent);
  };
}

// ---------------------------------------------------------------------------
// Curated pieces
// ---------------------------------------------------------------------------

function drawCuratedFigure(ctx, { body, accent, assets, editorial, name, detail }) {
  const photoHeight = Math.round(body.height * 0.62);
  const hasPhoto = drawPhoto(
    ctx, assets.photo, body.x, body.y, body.width, photoHeight,
    { offsetY: editorial.photoOffsetY },
  );
  if (!hasPhoto) {
    glassCard(ctx, body.x, body.y, body.width, photoHeight, { radius: 28 });
    drawText(ctx, '—', body.x + body.width / 2, body.y + photoHeight / 2 + 30, {
      family: SOCIAL_THEME.display, size: 96, weight: 700, align: 'center', color: accent,
    });
  }
  drawText(ctx, name, body.x, body.y + photoHeight + 78, {
    family: SOCIAL_THEME.display, size: 84, weight: 700,
    maxWidth: body.width, minSize: 40,
  });
  if (detail) {
    drawText(ctx, detail, body.x, body.y + photoHeight + 124, {
      family: SOCIAL_THEME.body, size: 28, color: SOCIAL_THEME.textMuted,
      maxWidth: body.width, minSize: 18,
    });
  }
}

function selectedFrom(snapshot, editorial, key = 'rosterPlayerId') {
  const candidates = snapshot.official.candidates || [];
  return (editorial.selection || [])
    .map((id) => candidates.find((candidate) => candidate[key] === id))
    .filter(Boolean);
}

const TEMPLATES = {
  next_fixture: matchesTemplate({ showResult: false, emphasis: 0 }),
  round_results: renderResultsListLayout,
  semifinals: matchesTemplate({ showResult: true, emphasis: 0 }),
  final: matchesTemplate({ showResult: true, emphasis: 1 }),

  standings: listTemplate({
    rowsOf: (snapshot) => snapshot.official.rows || [],
    columns: [
      {
        label: '#', offset: 0, size: 30, family: SOCIAL_THEME.display, weight: 700,
        maxWidth: 46, value: (row) => String(row.position),
      },
      { label: '', offset: 52, kind: 'shield', value: (row) => row.shieldPath, name: (row) => row.teamName },
      {
        label: 'Equipo', offset: 112, maxWidth: 430,
        value: (row) => row.teamName || row.shortName || '—',
      },
      {
        label: 'Pts', offset: 0, align: 'right', size: 34, weight: 700,
        family: SOCIAL_THEME.display, maxWidth: 80, value: (row) => String(row.points ?? 0),
      },
      {
        label: 'DG', offset: 92, align: 'right', size: 26, maxWidth: 70,
        color: SOCIAL_THEME.textMuted, value: (row) => String(row.goalDifference ?? 0),
      },
      {
        label: 'PJ', offset: 168, align: 'right', size: 26, maxWidth: 70,
        color: SOCIAL_THEME.textMuted, value: (row) => String(row.played ?? 0),
      },
    ],
  }),

  scorers: listTemplate({
    rowsOf: (snapshot) => snapshot.official.players || [],
    columns: [
      {
        label: '#', offset: 0, size: 30, family: SOCIAL_THEME.display, weight: 700,
        maxWidth: 46, value: (_row, index) => String(index + 1),
      },
      { label: 'Jugador', offset: 60, maxWidth: 520, value: (row) => row.name || '—' },
      {
        label: 'Goles', offset: 0, align: 'right', size: 38, weight: 700,
        family: SOCIAL_THEME.display, maxWidth: 90, value: (row) => String(row.goals ?? 0),
      },
      {
        label: 'Asist.', offset: 112, align: 'right', size: 26, maxWidth: 80,
        color: SOCIAL_THEME.textMuted, value: (row) => String(row.assists ?? 0),
      },
    ],
  }),

  discipline: listTemplate({
    rowsOf: (snapshot) => snapshot.official.players || [],
    columns: [
      { label: 'Jugador', offset: 0, maxWidth: 520, value: (row) => row.name || '—' },
      {
        label: 'Amarillas', offset: 210, align: 'right', size: 30, maxWidth: 80,
        color: '#FDB022', value: (row) => String(row.yellowCards ?? 0),
      },
      {
        label: 'Rojas', offset: 110, align: 'right', size: 30, maxWidth: 80,
        color: '#F97066', value: (row) => String(row.directReds ?? 0),
      },
      {
        label: 'Fechas', offset: 0, align: 'right', size: 30, weight: 700,
        family: SOCIAL_THEME.display, maxWidth: 90,
        value: (row) => String(
          (row.suspensions || []).reduce(
            (total, entry) => total + (entry.remainingMatches || 0), 0,
          ),
        ),
      },
    ],
  }),

  round_summary: (ctx, context) => {
    const { snapshot, body, accent, assets } = context;
    const matches = snapshot.official.matches || [];
    const leaders = snapshot.official.leaders || [];
    if (matches.length === 0 && leaders.length === 0) {
      drawEmptyState(ctx, body, accent);
      return;
    }
    const matchesHeight = Math.round(body.height * (leaders.length ? 0.6 : 1));
    const matchBody = { ...body, height: matchesHeight };
    matchesTemplate({ showResult: true, emphasis: 0 })(ctx, { ...context, body: matchBody });
    if (leaders.length === 0) return;

    const leadersTop = body.y + matchesHeight + 24;
    drawText(ctx, 'GOLEADORES DE LA FECHA', body.x, leadersTop, {
      family: SOCIAL_THEME.body, size: 22, weight: 700, color: accent, letterSpacing: 2,
    });
    leaders.slice(0, 3).forEach((player, index) => {
      const y = leadersTop + 34 + index * 56;
      glassCard(ctx, body.x, y, body.width, 48, { radius: 16 });
      drawText(ctx, player.name || '—', body.x + 20, y + 33, {
        family: SOCIAL_THEME.heading, size: 28, weight: 500, maxWidth: body.width - 140,
      });
      drawText(ctx, String(player.goals ?? 0), body.x + body.width - 20, y + 34, {
        family: SOCIAL_THEME.display, size: 34, weight: 700, align: 'right', color: accent,
      });
    });
    if (assets) { /* shields already drawn by the match rows */ }
  },

  best_eleven: (ctx, {
    snapshot, content, editorial, body, accent, assets,
  }) => {
    const chosen = content?.kind === 'teamOfRound'
      ? content.selectedPlayers.map((player) => ({
        ...player.stats, ...player,
      }))
      : selectedFrom(snapshot, editorial);
    if (chosen.length === 0) {
      drawEmptyState(ctx, body, accent);
      return;
    }
    const columns = 2;
    const rows = Math.ceil(chosen.length / columns);
    const cellHeight = Math.min(96, Math.floor(body.height / Math.max(rows, 1)) - 10);
    const cellWidth = (body.width - 18) / columns;
    chosen.forEach((player, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = body.x + column * (cellWidth + 18);
      const y = body.y + row * (cellHeight + 10);
      glassCard(ctx, x, y, cellWidth, cellHeight, { radius: 18 });
      ctx.save();
      ctx.fillStyle = accent;
      ctx.font = fontOf(SOCIAL_THEME.display, 30, 700);
      ctx.textAlign = 'left';
      ctx.fillText(String(index + 1).padStart(2, '0'), x + 18, y + cellHeight / 2 + 10);
      ctx.restore();
      drawText(ctx, player.name || '—', x + 62, y + cellHeight / 2 + 4, {
        family: SOCIAL_THEME.heading, size: 28, weight: 500,
        maxWidth: cellWidth - 84, minSize: 16,
      });
      drawText(ctx, `${player.goals ?? 0}G · ${player.assists ?? 0}A`, x + 62, y + cellHeight / 2 + 30, {
        family: SOCIAL_THEME.body, size: 20, color: SOCIAL_THEME.textFaint,
        maxWidth: cellWidth - 84, minSize: 14,
      });
    });
    if (assets) { /* the ideal eleven is text-first by design */ }
  },

  mvp: (ctx, context) => {
    const {
      snapshot, content, editorial, body, accent,
    } = context;
    const player = content?.kind === 'figure'
      ? (content.selectedPlayer ? {
        ...content.selectedPlayer.stats, ...content.selectedPlayer,
      } : null)
      : selectedFrom(snapshot, editorial)[0];
    if (!player) {
      drawEmptyState(ctx, body, accent);
      return;
    }
    drawCuratedFigure(ctx, {
      ...context,
      name: player.name || '—',
      detail: `${player.goals ?? 0} goles · ${player.assists ?? 0} asistencias · ${player.appearances ?? 0} PJ`,
    });
  },

  champion: (ctx, context) => {
    const { snapshot, editorial, body, accent, assets } = context;
    const official = snapshot.official.officialChampion;
    const [manual] = (editorial.selection || [])
      .map((id) => (snapshot.official.candidates || []).find(
        (candidate) => candidate.participantId === id,
      ))
      .filter(Boolean);
    const champion = manual || official;
    if (!champion) {
      drawEmptyState(ctx, body, accent);
      return;
    }
    const shieldSize = Math.min(320, Math.round(body.height * 0.42));
    drawShield(
      ctx, assets.shields[champion.shieldPath],
      body.x + (body.width - shieldSize) / 2, body.y, shieldSize,
      { name: champion.teamName, accent },
    );
    drawText(ctx, champion.teamName || champion.shortName || '—',
      body.x + body.width / 2, body.y + shieldSize + 96, {
        family: SOCIAL_THEME.display, size: 96, weight: 700, align: 'center',
        maxWidth: body.width, minSize: 44,
      });
    drawText(
      ctx,
      official ? 'Campeón oficial' : 'Campeón confirmado por la organización',
      body.x + body.width / 2, body.y + shieldSize + 146,
      {
        family: SOCIAL_THEME.body, size: 26, align: 'center',
        color: SOCIAL_THEME.textMuted, maxWidth: body.width, minSize: 16,
      },
    );
  },
};

export function getSocialTemplate(pieceId) {
  return TEMPLATES[pieceId] || null;
}

export function listSocialTemplates() {
  return Object.keys(TEMPLATES).map((id) => ({ id, label: findSocialPiece(id)?.label || id }));
}
