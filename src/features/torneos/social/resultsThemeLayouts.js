import {
  drawBackdrop,
  drawText,
  wrapText,
} from './socialRenderer';
import { renderResultsListLayout } from './resultsListLayout';
import { renderResultsStreetLayout } from './resultsStreetLayout';
import { renderResultsEditorialLayout } from './resultsEditorialLayout';
import { drawOfficialSocialLockup, drawTournamentIdentity } from './resultsBranding';
import { resolveResultsLayoutTuning } from './resultsLayoutTuning';

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

function renderResultsClassicLayout(ctx, context) {
  const {
    content, editorial, assets, format, theme, accent, variant, branding,
  } = context;
  const tuning = resolveResultsLayoutTuning('classic');
  drawBackdrop(ctx, format.width, format.height, accent, theme);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let x = 72; x <= 1008; x += 156) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1164);
    ctx.stroke();
  }
  ctx.restore();
  drawTournamentIdentity(ctx, {
    branding, assets, ...tuning.identity, accent, theme, mode: 'classic',
  });

  const metadata = [
    content.competition.organizationName,
    content.competition.categoryName,
  ].filter(Boolean).join('  ·  ').toUpperCase();
  const metadataLines = wrapText(ctx, metadata, {
    family: theme.body,
    size: tuning.metadata.size,
    weight: 600,
    maxWidth: tuning.metadata.width,
    maxLines: tuning.metadata.maxLines,
  });
  metadataLines.forEach((line, index) => drawText(
    ctx, line, tuning.metadata.x, tuning.metadata.y + index * tuning.metadata.lineHeight, {
      family: theme.body, size: tuning.metadata.size, weight: 600,
      color: theme.textFaint, letterSpacing: 0.8, theme,
    },
  ));
  const metadataLastBaseline = tuning.metadata.y
    + (metadataLines.length - 1) * tuning.metadata.lineHeight;
  const titleY = Math.max(tuning.title.y, metadataLastBaseline + 104);
  const subtitleY = Math.max(tuning.subtitle.y, titleY + 80);
  const bodyY = Math.max(tuning.body.y, subtitleY + 50);
  drawText(ctx, editorial.title || 'Resultados', tuning.title.x, titleY, {
    family: theme.display, size: tuning.title.size, weight: 700,
    maxWidth: tuning.title.width, minSize: tuning.title.minSize, theme,
  });
  rule(ctx, tuning.title.x, titleY + 20, 108, accent, 7);
  drawText(ctx, editorial.subtitle || content.competition.roundName, tuning.subtitle.x, subtitleY, {
    family: theme.heading, size: tuning.subtitle.size, weight: 500,
    color: theme.textMuted, maxWidth: tuning.subtitle.width, minSize: tuning.subtitle.minSize, theme,
  });

  const noteReserve = content.additionalNote ? 68 : 0;
  const body = {
    ...tuning.body,
    y: bodyY,
    height: tuning.body.bottom - bodyY - noteReserve,
  };
  renderResultsListLayout(ctx, {
    content, editorial, body, accent, assets, format, theme, variant,
  });

  if (content.additionalNote) {
    wrapText(ctx, content.additionalNote, {
      family: theme.body, size: 22, maxWidth: tuning.body.width, maxLines: 2,
    }).forEach((line, index) => drawText(
      ctx, line, tuning.body.x, tuning.body.bottom - 38 + index * 27, {
        family: theme.body, size: 22, color: theme.textFaint, theme,
      },
    ));
  }
  rule(ctx, tuning.body.x, tuning.footer.ruleY, tuning.body.width, theme.hairline, theme.lineWidth);
  drawText(ctx, editorial.cta, tuning.footer.cta.x, tuning.footer.cta.y, {
    family: theme.body, size: tuning.footer.cta.size, weight: 600,
    color: theme.textMuted, maxWidth: tuning.footer.cta.width,
    minSize: tuning.footer.cta.minSize, theme,
  });
  drawText(ctx, 'DATOS OFICIALES', tuning.body.x, tuning.footer.ruleY + 32, {
    family: theme.body, size: 14, weight: 700, letterSpacing: 2.6,
    color: theme.textFaint, theme,
  });
  drawOfficialSocialLockup(ctx, { assets, ...tuning.footer.lockup });
}

const RESULTS_LAYOUTS = Object.freeze({
  classic: renderResultsClassicLayout,
  street: renderResultsStreetLayout,
  editorial: renderResultsEditorialLayout,
});

/** Layout fallback deliberately mirrors invalid-theme fallback: Classic. */
export function getResultsThemeLayout(themeId) {
  return RESULTS_LAYOUTS[themeId] || RESULTS_LAYOUTS.classic;
}
