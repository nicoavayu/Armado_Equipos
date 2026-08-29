import {
  drawImageContain,
  drawText,
  roundedRect,
  wrapText,
} from './socialRenderer';

function initialsOf(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((word) => word[0]).join('').toUpperCase() || 'T';
}

export function drawTournamentIdentity(ctx, {
  branding, assets, x, y, width, height, accent, theme, mode = 'street',
}) {
  const logo = assets.branding?.tournamentLogo;
  const markSize = Math.min(height, mode === 'editorial' ? 72 : 82);
  ctx.save();
  ctx.fillStyle = mode === 'editorial' ? theme.surfaceStrong : theme.surfaceStrong;
  if (mode === 'street') {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + markSize, y);
    ctx.lineTo(x + markSize - 12, y + markSize);
    ctx.lineTo(x - 12, y + markSize);
    ctx.closePath();
    ctx.fill();
  } else {
    roundedRect(ctx, x, y, markSize, markSize, mode === 'classic' ? 18 : 0);
    ctx.fill();
  }
  ctx.restore();

  if (logo) {
    drawImageContain(ctx, logo, x + 9, y + 9, markSize - 18, markSize - 18);
  } else {
    drawText(ctx, initialsOf(branding.tournamentName), x + markSize / 2, y + markSize * 0.66, {
      family: theme.heading,
      size: mode === 'editorial' ? 27 : 32,
      weight: 700,
      color: mode === 'editorial' ? '#FFFFFF' : accent,
      align: 'center',
      theme,
    });
  }
  const name = branding.tournamentName || 'Torneo';
  const nameX = x + markSize + 18;
  const nameWidth = width - markSize - 18;
  const nameSize = mode === 'editorial' ? 27 : 30;
  const lineHeight = mode === 'editorial' ? 30 : 32;
  const lines = wrapText(ctx, name, {
    family: theme.heading, size: nameSize, weight: 600, maxWidth: nameWidth, maxLines: 2,
  });
  const firstBaseline = y + markSize / 2 - ((lines.length - 1) * lineHeight) / 2 + nameSize * 0.34;
  lines.forEach((line, index) => drawText(ctx, line, nameX, firstBaseline + index * lineHeight, {
    family: theme.heading,
    size: nameSize,
    weight: 600,
    color: theme.text,
    theme,
  }));
}

/**
 * Approved Arma2 Torneos lockup, drawn as the one official bitmap it is.
 * The source has intentional transparent space; contain preserves every pixel
 * and its original aspect ratio without recolouring, cropping or rebuilding.
 */
export function drawOfficialSocialLockup(ctx, {
  assets, x, y, width = 300, height = 200, opacity = 1,
}) {
  const lockup = assets.branding?.officialLockup;
  return drawImageContain(ctx, lockup, x, y, width, height, { opacity });
}
