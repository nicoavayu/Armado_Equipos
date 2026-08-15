import {
  drawShield,
  drawText,
  wrapText,
} from './socialRenderer';
import { drawOfficialSocialLockup, drawTournamentIdentity } from './resultsBranding';
import { resolveResultsLayoutTuning } from './resultsLayoutTuning';
import { resolveResultsDensityTuning } from './resultsVariants';

function drawStreetBackdrop(ctx, format, accent, theme, tuning) {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, format.width, format.height);

  // Deterministic paper fibres, halftone and misregistered ink. Nothing here
  // is random, so preview and PNG stay pixel-identical.
  ctx.save();
  ctx.fillStyle = 'rgba(247,241,229,0.08)';
  for (let index = 0; index < 150; index += 1) {
    const x = (index * 83 + 31) % format.width;
    const y = (index * 157 + 19) % format.height;
    ctx.fillRect(x, y, 1 + (index % 5), 1);
  }
  ctx.fillStyle = 'rgba(247,241,229,0.13)';
  for (let row = 0; row < 13; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      ctx.beginPath();
      ctx.arc(744 + column * 29, 36 + row * 25, 3 + ((row + column) % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(22, tuning.gesture.top + 28);
  ctx.lineTo(934, tuning.gesture.top - 8);
  ctx.lineTo(1008, tuning.gesture.top + 14);
  ctx.lineTo(912, tuning.gesture.bottom - 4);
  ctx.lineTo(34, tuning.gesture.bottom + 8);
  ctx.lineTo(78, tuning.gesture.bottom - 18);
  ctx.lineTo(18, tuning.gesture.bottom - 32);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = theme.surfaceStrong;
  ctx.globalAlpha = 0.16;
  ctx.fillRect(0, 398, format.width, 5);
  ctx.restore();
}

function fitPosterTeamName(ctx, name, width, rowHeight, theme, density) {
  const preferredSize = density?.teamSize
    || (rowHeight >= 138 ? 38 : rowHeight >= 116 ? 34 : rowHeight >= 96 ? 30 : 26);
  const minSize = density?.minTeamSize || (rowHeight >= 116 ? 28 : 24);
  const maxLines = density ? 2 : rowHeight >= 96 ? 2 : 1;
  let size = preferredSize;
  let lines = [];
  while (size >= minSize) {
    lines = wrapText(ctx, String(name || '—').toUpperCase(), {
      family: theme.heading, size, weight: 600, maxWidth: width, maxLines,
    });
    if (!lines.some((line) => line.endsWith('…'))) break;
    size -= 1;
  }
  return { lines, size, maxLines };
}

function drawPosterTeamName(ctx, name, x, centerY, width, rowHeight, theme, density) {
  const { lines, size } = fitPosterTeamName(ctx, name, width, rowHeight, theme, density);
  const lineHeight = Math.round(size * 0.88);
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2 + size * 0.34;
  lines.forEach((line, index) => drawText(ctx, line, x, firstY + index * lineHeight, {
    family: theme.heading,
    size,
    weight: 600,
    maxWidth: width,
    minSize: size,
    color: theme.background,
    theme,
  }));
}

function drawStreetMatch(ctx, match, index, x, y, width, height, context) {
  const {
    accent, assets, theme, density,
  } = context;
  const shifts = [0, 26, 9, 38, 16, 31, 4, 22, 12];
  const trims = [26, 0, 42, 16, 8, 34, 12, 24, 4];
  const shift = shifts[index % shifts.length];
  const rowX = x + shift;
  const rowWidth = width - shift - trims[index % trims.length];
  const notch = 9 + (index % 3) * 4;
  ctx.save();
  ctx.fillStyle = index % 3 === 1 ? theme.surfaceStrong : theme.surface;
  ctx.beginPath();
  ctx.moveTo(rowX + notch, y);
  ctx.lineTo(rowX + rowWidth, y + (index % 2 ? 5 : 0));
  ctx.lineTo(rowX + rowWidth - notch, y + height);
  ctx.lineTo(rowX, y + height - (index % 2 ? 0 : 6));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(rowX - 7, y + 12, 12, Math.max(20, height - 24));
  ctx.restore();

  const shieldSize = Math.min(46, Math.max(28, height * 0.28));
  const teamX = rowX + 30;
  const homeY = y + height * 0.29;
  const awayY = y + height * 0.72;
  drawShield(ctx, assets.shields[match.home?.shieldPath], teamX, homeY - shieldSize * 0.65, shieldSize, {
    name: match.home?.name, accent, theme,
  });
  drawShield(ctx, assets.shields[match.away?.shieldPath], teamX, awayY - shieldSize * 0.65, shieldSize, {
    name: match.away?.name, accent, theme,
  });
  const nameX = teamX + shieldSize + 14;
  const scorePanelWidth = 204;
  const nameWidth = rowWidth - scorePanelWidth - (nameX - rowX) - 24;
  drawPosterTeamName(ctx, match.home?.name, nameX, homeY, nameWidth, height, theme, density);
  drawPosterTeamName(ctx, match.away?.name, nameX, awayY, nameWidth, height, theme, density);

  const scoreX = rowX + rowWidth - scorePanelWidth;
  ctx.save();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(scoreX + 28, y);
  ctx.lineTo(rowX + rowWidth, y);
  ctx.lineTo(rowX + rowWidth - notch, y + height);
  ctx.lineTo(scoreX, y + height - 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (match.score) {
    drawText(ctx, match.score.home, scoreX + 68, y + height * 0.68, {
      family: theme.display,
      size: density ? Math.min(density.scoreSize, height * 0.72) : Math.min(94, height * 0.72),
      weight: 700,
      align: 'center', color: theme.background, theme,
    });
    drawText(ctx, ':', scoreX + 103, y + height * 0.62, {
      family: theme.display, size: Math.min(48, height * 0.36),
      align: 'center', color: 'rgba(17,16,14,0.42)', theme,
    });
    drawText(ctx, match.score.away, scoreX + 140, y + height * 0.68, {
      family: theme.display,
      size: density ? Math.min(density.scoreSize, height * 0.72) : Math.min(94, height * 0.72),
      weight: 700,
      align: 'center', color: theme.background, theme,
    });
    if (match.score.homePenalties !== null && match.score.homePenalties !== undefined) {
      drawText(ctx, `${match.score.homePenalties}-${match.score.awayPenalties} PEN`, scoreX + 103, y + height - 10, {
        family: theme.body, size: 14, weight: 700, align: 'center',
        color: theme.background, theme,
      });
    }
  } else {
    drawText(ctx, '—', scoreX + 103, y + height * 0.64, {
      family: theme.display, size: 68, align: 'center', color: theme.background, theme,
    });
  }
}

export function renderResultsStreetLayout(ctx, context) {
  const {
    content, editorial, assets, format, theme, variant, branding, accent,
  } = context;
  const tuning = resolveResultsLayoutTuning('street');
  drawStreetBackdrop(ctx, format, accent, theme, tuning);
  drawTournamentIdentity(ctx, {
    branding, assets, ...tuning.identity, accent, theme, mode: 'street',
  });
  drawText(ctx, content.competition.organizationName.toUpperCase(),
    tuning.organization.x, tuning.organization.y, {
      family: theme.body, size: tuning.organization.size, weight: 700,
      letterSpacing: 1.8, color: theme.textMuted, maxWidth: tuning.organization.width,
      minSize: tuning.organization.minSize, theme,
    });
  drawText(ctx, editorial.title || 'Resultados', tuning.title.x + 5, tuning.title.y + 5, {
    family: theme.display, size: tuning.title.size, weight: 700,
    maxWidth: tuning.title.width, minSize: tuning.title.minSize,
    color: 'rgba(247,241,229,0.18)', theme,
  });
  drawText(ctx, editorial.title || 'Resultados', tuning.title.x, tuning.title.y, {
    family: theme.display, size: tuning.title.size, weight: 700,
    maxWidth: tuning.title.width, minSize: tuning.title.minSize,
    color: theme.text, theme,
  });
  drawText(ctx, [content.competition.roundName, content.competition.categoryName]
    .filter(Boolean).join('  /  ').toUpperCase(), tuning.instance.x, tuning.instance.y, {
    family: theme.body, size: tuning.instance.size, weight: 700, letterSpacing: 2,
    color: theme.surfaceStrong, maxWidth: tuning.instance.width,
    minSize: tuning.instance.minSize, theme,
  });

  const matches = content.matches || [];
  const visible = Math.min(matches.length, variant.maxVisible);
  const body = { ...tuning.body, height: tuning.body.bottom - tuning.body.y };
  if (visible === 0) {
    ctx.fillStyle = theme.surface;
    ctx.fillRect(body.x, body.y, body.width, 190);
    drawText(ctx, 'SIN RESULTADOS', body.x + 36, body.y + 84, {
      family: theme.display, size: 62, color: accent, theme,
    });
    wrapText(ctx, 'Todavía no hay datos oficiales publicados para esta selección.', {
      family: theme.body, size: 24, maxWidth: body.width - 72, maxLines: 2,
    }).forEach((line, lineIndex) => drawText(ctx, line, body.x + 36, body.y + 132 + lineIndex * 30, {
      family: theme.body, size: 24, color: theme.background, theme,
    }));
  } else {
    const density = resolveResultsDensityTuning(variant, 'street');
    const gap = density?.rowGap ?? (visible > 6 ? 7 : 11);
    const rowHeight = Math.min(
      density?.maxRowHeight || 150,
      Math.floor((body.height - gap * (visible - 1)) / visible),
    );
    const listHeight = rowHeight * visible + gap * (visible - 1);
    const listY = body.y + Math.max(0, (body.height - listHeight) / 2);
    matches.slice(0, visible).forEach((match, index) => {
      drawStreetMatch(
        ctx, match, index, body.x, listY + index * (rowHeight + gap), body.width, rowHeight,
        { ...context, density },
      );
    });
  }
  if (variant.hiddenCount > 0) {
    drawText(ctx, `+${variant.hiddenCount} PARTIDOS`, 1018, tuning.footer.noteY, {
      family: theme.body, size: 20, weight: 700, align: 'right', color: accent, theme,
    });
  }
  if (content.additionalNote) {
    drawText(ctx, content.additionalNote, 58, tuning.footer.noteY, {
      family: theme.body, size: 20, color: theme.textMuted, maxWidth: 580, minSize: 14, theme,
    });
  }
  ctx.save();
  ctx.fillStyle = accent;
  ctx.fillRect(52, tuning.footer.ruleY, 976, 3);
  ctx.fillRect(52, tuning.footer.ruleY + 8, 132, 2);
  ctx.fillRect(944, tuning.footer.ruleY + 8, 84, 2);
  ctx.restore();
  drawText(ctx, editorial.cta, tuning.footer.cta.x, tuning.footer.cta.y, {
    family: theme.body, size: tuning.footer.cta.size, weight: 700, color: theme.textMuted,
    maxWidth: tuning.footer.cta.width, minSize: tuning.footer.cta.minSize,
    letterSpacing: 1.2, theme,
  });
  drawOfficialSocialLockup(ctx, { assets, ...tuning.footer.lockup });
}
