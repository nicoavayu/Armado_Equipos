import {
  drawShield,
  drawText,
  wrapText,
} from './socialRenderer';
import { resolveResultsDensityTuning } from './resultsVariants';

const EMPTY_COPY = 'Todavía no hay datos oficiales publicados para esta selección.';

function drawEmptyState(ctx, body, accent, theme) {
  ctx.save();
  ctx.fillStyle = theme.surface;
  ctx.fillRect(body.x, body.y, body.width, Math.min(220, body.height));
  ctx.restore();
  drawText(ctx, 'Sin datos', body.x + 40, body.y + 84, {
    family: theme.heading, size: 44, weight: 600, color: accent, theme,
  });
  wrapText(ctx, EMPTY_COPY, {
    family: theme.body, size: 26, maxWidth: body.width - 80, maxLines: 2,
  }).forEach((line, index) => {
    drawText(ctx, line, body.x + 40, body.y + 130 + index * 34, {
      family: theme.body, size: 26, color: theme.textMuted, theme,
    });
  });
}

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

function drawClassicTeamName(ctx, name, x, centerY, options) {
  const {
    align, maxWidth, rowHeight, theme, density,
  } = options;
  const preferredSize = density?.teamSize || (rowHeight >= 112 ? 30 : rowHeight >= 92 ? 26 : 22);
  const minSize = density?.minTeamSize || 18;
  const maxLines = density ? 2 : rowHeight >= 112 ? 2 : 1;
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
    for (const scale of [0.96, 0.92, 0.88, 0.84, 0.80, 0.76]) {
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
        family: theme.heading, size, weight: 500, align,
        maxWidth: maxWidth / horizontalScale, minSize: size, color: theme.text, theme,
      });
      ctx.restore();
      return;
    }
    drawText(ctx, line, x, baseline, {
      family: theme.heading, size, weight: 500, align,
      maxWidth, minSize: size, color: theme.text, theme,
    });
  });
}

function drawResultRow(ctx, match, x, y, width, height, {
  accent, assets, theme, density,
}) {
  ctx.save();
  ctx.fillStyle = theme.surface;
  if (Math.round(y / Math.max(height, 1)) % 2 === 0) ctx.fillRect(x, y, width, height);
  ctx.restore();
  rule(ctx, x, y, width, theme.hairline, theme.lineWidth);
  const pad = height < 96 ? 16 : 20;
  const shield = Math.min(54, Math.max(30, height * 0.36));
  const scoreWidth = density?.id === 'compact' ? 164 : density?.id === 'dense' || density?.id === 'overflow' ? 132 : 148;
  const nameWidth = (width - pad * 2 - shield * 2 - scoreWidth - 56) / 2;
  const centreY = y + height / 2;

  drawShield(
    ctx, assets.shields[match.home?.shieldPath], x + pad, centreY - shield / 2, shield,
    { name: match.home?.name, accent, theme },
  );
  drawClassicTeamName(ctx, match.home?.name || match.home?.shortName, x + pad + shield + 16, centreY, {
    align: 'left', maxWidth: nameWidth, rowHeight: height, theme, density,
  });

  const rightShieldX = x + width - pad - shield;
  drawShield(
    ctx, assets.shields[match.away?.shieldPath], rightShieldX, centreY - shield / 2, shield,
    { name: match.away?.name, accent, theme },
  );
  drawClassicTeamName(ctx, match.away?.name || match.away?.shortName, rightShieldX - 16, centreY, {
    align: 'right', maxWidth: nameWidth, rowHeight: height, theme, density,
  });

  const centreX = x + width / 2;
  ctx.save();
  ctx.fillStyle = theme.surfaceStrong;
  ctx.fillRect(centreX - 62, y + Math.max(10, height * 0.14), 124, height - Math.max(20, height * 0.28));
  ctx.restore();
  drawText(ctx, match.score ? `${match.score.home} · ${match.score.away}` : '—', centreX, centreY + Math.min(17, height * 0.16), {
    family: theme.display,
    size: density ? Math.min(density.scoreSize, height * 0.62) : Math.min(58, height * 0.62),
    weight: 700,
    align: 'center', color: theme.background, theme,
  });
  if (!match.score) return;
  if (match.score.homePenalties !== null && match.score.homePenalties !== undefined) {
    drawText(
      ctx,
      `(${match.score.homePenalties}-${match.score.awayPenalties} pen.)`,
      centreX,
      y + height - 7,
      { family: theme.body, size: 14, weight: 700, align: 'center', color: accent, theme },
    );
  }
}

/** Current Results layout, named explicitly so a second theme can reuse it. */
export function renderResultsListLayout(ctx, {
  content, body, accent, assets, theme, variant,
}) {
  const matches = content.matches || [];
  if (matches.length === 0) {
    drawEmptyState(ctx, body, accent, theme);
    return;
  }
  const visible = Math.min(matches.length, variant.maxVisible);
  const overflowReserve = variant.hiddenCount > 0 ? 42 : 0;
  const availableHeight = Math.max(0, body.height - overflowReserve);
  const density = resolveResultsDensityTuning(variant, 'classic');
  const gap = density?.rowGap ?? 14;
  const ideal = density
    ? Math.floor((availableHeight - gap * (visible - 1)) / visible)
    : Math.floor(availableHeight / visible);
  const rowHeight = Math.min(density?.maxRowHeight || variant.maxRowHeight, ideal);
  const legacyGap = rowHeight < variant.minRowHeight ? 8 : 14;
  const resolvedGap = density ? gap : legacyGap;
  const listHeight = rowHeight * visible + resolvedGap * (visible - 1);
  const listY = body.y + Math.max(0, (availableHeight - listHeight) / 2);
  matches.slice(0, visible).forEach((match, index) => {
    drawResultRow(
      ctx, match, body.x, listY + index * (rowHeight + resolvedGap), body.width,
      density ? rowHeight : Math.max(70, rowHeight - resolvedGap),
      { accent, assets, theme, density },
    );
  });
  rule(ctx, body.x, listY + listHeight, body.width, theme.hairline, theme.lineWidth);
  if (variant.hiddenCount > 0) {
    drawText(ctx, `+${variant.hiddenCount} más`, body.x + body.width, body.y + availableHeight + 31, {
      family: theme.body, size: 24, weight: 600, color: accent, align: 'right', theme,
    });
  }
}
