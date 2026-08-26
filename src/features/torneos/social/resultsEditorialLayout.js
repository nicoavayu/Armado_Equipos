import {
  drawShield,
  drawText,
  wrapText,
} from './socialRenderer';
import { drawOfficialSocialLockup, drawTournamentIdentity } from './resultsBranding';
import { resolveResultsLayoutTuning } from './resultsLayoutTuning';
import { resolveResultsDensityTuning } from './resultsVariants';

function rule(ctx, x, y, width, color, lineWidth = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
  ctx.restore();
}

function drawEditorialTeamName(ctx, name, x, centerY, options) {
  const {
    align, maxWidth, rowHeight, theme, density,
  } = options;
  const preferredSize = density?.teamSize || (rowHeight >= 180 ? 27 : rowHeight >= 132 ? 25 : 23);
  const minSize = density?.minTeamSize || 21;
  const maxLines = rowHeight >= 92 ? 2 : 1;
  let size = preferredSize;
  let lines = [];
  let horizontalScale = 1;
  while (size >= minSize) {
    lines = wrapText(ctx, name || '—', {
      family: theme.heading, size, weight: 500, maxWidth, maxLines,
    });
    if (!lines.some((line) => line.endsWith('…'))) break;
    size -= 1;
  }
  if (lines.some((line) => line.endsWith('…'))) {
    size = minSize;
    const condensationSteps = density
      ? [0.96, 0.92, 0.88, 0.84, 0.80, 0.76]
      : [0.96, 0.92, 0.88, 0.84, 0.80, 0.76, 0.72, 0.68, 0.64, 0.60];
    for (const scale of condensationSteps) {
      horizontalScale = scale;
      lines = wrapText(ctx, name || '—', {
        family: theme.heading,
        size,
        weight: 500,
        maxWidth: maxWidth / horizontalScale,
        maxLines,
      });
      if (!lines.some((line) => line.endsWith('…'))) break;
    }
  }
  const lineHeight = density ? Math.round(size * 0.94) : size + 3;
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2 + size * 0.34;
  lines.forEach((line, index) => {
    const baseline = firstY + index * lineHeight;
    if (horizontalScale < 1) {
      ctx.save();
      ctx.translate(x, baseline);
      ctx.scale(horizontalScale, 1);
      drawText(ctx, line, 0, 0, {
        family: theme.heading,
        size,
        weight: 500,
        align,
        maxWidth: maxWidth / horizontalScale,
        minSize: size,
        color: theme.text,
        theme,
      });
      ctx.restore();
      return;
    }
    drawText(ctx, line, x, baseline, {
      family: theme.heading,
      size,
      weight: 500,
      align,
      maxWidth,
      minSize: size,
      color: theme.text,
      theme,
    });
  });
}

function drawEditorialMatch(ctx, match, x, y, width, height, context) {
  const {
    accent, assets, theme, density,
  } = context;
  rule(ctx, x, y, width, theme.hairline);
  const centerY = y + height / 2;
  const shield = Math.min(48, Math.max(28, height * 0.27));
  const scoreHalfSpan = density?.id === 'compact' ? 58 : density?.id === 'standard' ? 52 : 46;
  const nameWidth = density
    ? Math.max(128, width / 2 - shield - 15 - scoreHalfSpan)
    : Math.max(128, width / 2 - 160);
  drawShield(ctx, assets.shields[match.home?.shieldPath], x, centerY - shield / 2, shield, {
    name: match.home?.name, accent, theme,
  });
  drawEditorialTeamName(ctx, match.home?.name, x + shield + 14, centerY, {
    align: 'left', maxWidth: nameWidth, rowHeight: height, theme, density,
  });

  const awayShieldX = x + width - shield;
  drawShield(ctx, assets.shields[match.away?.shieldPath], awayShieldX, centerY - shield / 2, shield, {
    name: match.away?.name, accent, theme,
  });
  drawEditorialTeamName(ctx, match.away?.name, awayShieldX - 14, centerY, {
    align: 'right', maxWidth: nameWidth, rowHeight: height, theme, density,
  });

  const scoreX = x + width / 2;
  const scoreOffset = density?.id === 'compact' ? 50 : density?.id === 'standard' ? 44 : 40;
  if (match.score) {
    drawText(ctx, match.score.home, scoreX - scoreOffset, centerY + Math.min(30, height * 0.2), {
      family: theme.display,
      size: density
        ? Math.min(density.scoreSize, height * 0.58)
        : Math.min(88, Math.max(52, height * 0.56)),
      weight: 700,
      align: 'center',
      color: theme.text,
      theme,
    });
    drawText(ctx, ':', scoreX, centerY + Math.min(20, height * 0.14), {
      family: theme.heading, size: 26, weight: 500, align: 'center', color: accent, theme,
    });
    drawText(ctx, match.score.away, scoreX + scoreOffset, centerY + Math.min(30, height * 0.2), {
      family: theme.display,
      size: density
        ? Math.min(density.scoreSize, height * 0.58)
        : Math.min(88, Math.max(52, height * 0.56)),
      weight: 700,
      align: 'center',
      color: theme.text,
      theme,
    });
    if (match.score.homePenalties !== null && match.score.homePenalties !== undefined) {
      drawText(ctx, `Penales ${match.score.homePenalties}–${match.score.awayPenalties}`, scoreX, y + height - 12, {
        family: theme.body, size: 13, weight: 700, align: 'center', color: accent, theme,
      });
    }
  } else {
    drawText(ctx, 'Pendiente', scoreX, centerY + 6, {
      family: theme.body, size: 15, weight: 700, align: 'center', color: theme.textMuted, theme,
    });
  }
}

function normalizedLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
}

function resolveRailDetail(content, editorial) {
  const round = normalizedLabel(content.competition.roundName);
  const subtitle = String(editorial.subtitle || '').trim();
  if (subtitle && normalizedLabel(subtitle) !== round) return subtitle;
  const stage = String(content.competition.stageName || '').trim();
  return normalizedLabel(stage) !== round ? stage : '';
}

export function renderResultsEditorialLayout(ctx, context) {
  const {
    content, editorial, assets, format, theme, variant, branding, accent,
  } = context;
  const tuning = resolveResultsLayoutTuning('editorial');
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, format.width, format.height);
  ctx.fillStyle = theme.surfaceStrong;
  ctx.fillRect(0, 0, tuning.rail.width, format.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 10, format.height);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.08;
  ctx.fillRect(832, 0, 248, 248);
  ctx.globalAlpha = 1;

  drawText(ctx, 'EDICIÓN DEPORTIVA', tuning.rail.contentX, 76, {
    family: theme.body, size: 14, weight: 700, color: '#FFFFFF', letterSpacing: 2.4, theme,
  });
  drawText(ctx, content.competition.roundName || 'FECHA', tuning.rail.contentX, 208, {
    family: theme.display, size: 70, weight: 700, color: '#FFFFFF',
    maxWidth: tuning.rail.contentWidth, minSize: 38, theme,
  });
  drawText(ctx, content.competition.categoryName, tuning.rail.contentX, 248, {
    family: theme.body, size: 18, weight: 600, color: 'rgba(255,255,255,0.66)',
    maxWidth: tuning.rail.contentWidth, minSize: 14, theme,
  });
  rule(ctx, tuning.rail.contentX, 286, tuning.rail.contentWidth, 'rgba(255,255,255,0.24)');
  const railDetail = resolveRailDetail(content, editorial);
  wrapText(ctx, railDetail, {
    family: theme.heading, size: 25, maxWidth: tuning.rail.contentWidth, maxLines: 3,
  }).forEach((line, index) => drawText(ctx, line, tuning.rail.contentX, 336 + index * 32, {
    family: theme.heading, size: 25, weight: 500, color: '#FFFFFF', theme,
  }));
  if (content.additionalNote) {
    wrapText(ctx, content.additionalNote, {
      family: theme.body, size: 17, maxWidth: tuning.rail.contentWidth, maxLines: 5,
    }).forEach((line, index) => drawText(ctx, line, tuning.rail.contentX, 520 + index * 24, {
      family: theme.body, size: 17, color: 'rgba(255,255,255,0.62)', theme,
    }));
  }
  drawText(ctx, editorial.cta, tuning.rail.contentX, 1058, {
    family: theme.body, size: 14, weight: 600, color: 'rgba(255,255,255,0.62)',
    maxWidth: tuning.rail.contentWidth, minSize: 12, theme,
  });
  drawOfficialSocialLockup(ctx, { assets, ...tuning.footer.lockup });

  drawTournamentIdentity(ctx, {
    branding, assets, ...tuning.identity, accent, theme, mode: 'editorial',
  });
  drawText(ctx, editorial.title || 'Resultados', tuning.title.x, tuning.title.y, {
    family: theme.display, size: tuning.title.size, weight: 700,
    maxWidth: tuning.title.width, minSize: tuning.title.minSize,
    color: theme.text, theme,
  });
  rule(ctx, tuning.title.x, tuning.title.y + 18, tuning.title.width, accent, 4);

  const matches = content.matches || [];
  const visible = Math.min(matches.length, variant.maxVisible);
  const body = { ...tuning.body, height: tuning.body.bottom - tuning.body.y };
  if (visible === 0) {
    rule(ctx, body.x, body.y, body.width, theme.hairline);
    drawText(ctx, 'Sin datos oficiales', body.x, body.y + 86, {
      family: theme.heading, size: 42, weight: 500, color: theme.text, theme,
    });
    wrapText(ctx, 'La selección todavía no tiene resultados publicados.', {
      family: theme.body, size: 23, maxWidth: body.width, maxLines: 2,
    }).forEach((line, index) => drawText(ctx, line, body.x, body.y + 132 + index * 30, {
      family: theme.body, size: 23, color: theme.textMuted, theme,
    }));
  } else {
    const density = resolveResultsDensityTuning(variant, 'editorial');
    const rowHeight = Math.min(
      density?.maxRowHeight || 220,
      Math.floor(body.height / visible),
    );
    const listHeight = rowHeight * visible;
    const listY = body.y + Math.max(0, (body.height - listHeight) / 2);
    matches.slice(0, visible).forEach((match, index) => {
      drawEditorialMatch(
        ctx, match, body.x, listY + index * rowHeight, body.width, rowHeight,
        { ...context, density },
      );
    });
    rule(ctx, body.x, listY + listHeight, body.width, theme.hairline);
  }
  if (variant.hiddenCount > 0) {
    drawText(ctx, `Continúa · ${variant.hiddenCount} partidos más`, 1008, 1238, {
      family: theme.body, size: 17, weight: 600, align: 'right', color: accent, theme,
    });
  }
  drawText(ctx, branding.tournamentName || content.competition.tournamentName,
    tuning.footer.tournament.x, tuning.footer.tournament.y, {
      family: theme.body, size: tuning.footer.tournament.size, weight: 700,
      align: 'right', color: theme.textMuted, maxWidth: tuning.footer.tournament.width,
      minSize: tuning.footer.tournament.minSize, letterSpacing: 0.5, theme,
  });
}
