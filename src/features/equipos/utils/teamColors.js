const DEFAULT_PALETTE = {
  primary: '#128BE9',
  secondary: '#1E293B',
  accent: '#9ED3FF',
  backgroundFrom: '#1E293B',
  backgroundTo: '#0F172A',
  tintFrom: '#128BE9',
  tintTo: '#0EA9C6',
  tintStrength: 0.09,
  chipBg: 'rgba(15, 23, 42, 0.58)',
  chipText: '#E2E8F0',
};

const HEX_6_RE = /^#?[0-9a-f]{6}$/i;

const clampColor = (value) => Math.max(0, Math.min(255, value));

const normalizeHex = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX_6_RE.test(trimmed)) return null;
  return trimmed.startsWith('#') ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
};

const hexToRgb = (hex) => {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
};

const rgbToHex = ({ r, g, b }) => {
  const toHex = (channel) => clampColor(channel).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbToRgba = ({ r, g, b }, alpha = 1) => {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${clampColor(r)}, ${clampColor(g)}, ${clampColor(b)}, ${safeAlpha})`;
};

const mixHex = (hexA, hexB, weight = 0.5) => {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  if (!rgbA || !rgbB) return null;

  const safeWeight = Math.max(0, Math.min(1, weight));
  return rgbToHex({
    r: Math.round(rgbA.r * (1 - safeWeight) + rgbB.r * safeWeight),
    g: Math.round(rgbA.g * (1 - safeWeight) + rgbB.g * safeWeight),
    b: Math.round(rgbA.b * (1 - safeWeight) + rgbB.b * safeWeight),
  });
};

const getRelativeLuminance = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const toLinear = (channel) => {
    const normalized = channel / 255;
    if (normalized <= 0.03928) return normalized / 12.92;
    return ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
};

const normalizeAccentColor = (hex) => {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;

  const luminance = getRelativeLuminance(normalized);
  if (luminance < 0.2) {
    return mixHex(normalized, '#FFFFFF', 0.42) || normalized;
  }

  if (luminance > 0.82) {
    return mixHex(normalized, '#0F172A', 0.32) || normalized;
  }

  return normalized;
};

const toRgba = (hex, alpha) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(18, 139, 233, ${alpha})`;
  return rgbToRgba(rgb, alpha);
};

const getProvidedColors = (team) => [
  normalizeHex(team?.color_primary),
  normalizeHex(team?.color_secondary),
  normalizeHex(team?.color_accent),
].filter(Boolean);

export const getTeamPalette = (team) => {
  const colors = getProvidedColors(team);

  if (colors.length === 0) {
    return { ...DEFAULT_PALETTE };
  }

  if (colors.length === 1) {
    const primary = normalizeAccentColor(colors[0]) || DEFAULT_PALETTE.primary;
    return {
      primary,
      secondary: mixHex(primary, '#0F172A', 0.45) || DEFAULT_PALETTE.secondary,
      accent: mixHex(primary, '#FFFFFF', 0.25) || DEFAULT_PALETTE.accent,
      backgroundFrom: DEFAULT_PALETTE.backgroundFrom,
      backgroundTo: DEFAULT_PALETTE.backgroundTo,
      tintFrom: primary,
      tintTo: mixHex(primary, '#0F172A', 0.35) || primary,
      tintStrength: 0.18,
      chipBg: 'rgba(15, 23, 42, 0.62)',
      chipText: '#F8FAFC',
    };
  }

  if (colors.length === 2) {
    const primary = normalizeAccentColor(colors[0]) || DEFAULT_PALETTE.primary;
    const secondary = normalizeAccentColor(colors[1]) || DEFAULT_PALETTE.secondary;
    return {
      primary,
      secondary,
      accent: normalizeAccentColor(mixHex(primary, secondary, 0.5)) || DEFAULT_PALETTE.accent,
      backgroundFrom: DEFAULT_PALETTE.backgroundFrom,
      backgroundTo: DEFAULT_PALETTE.backgroundTo,
      tintFrom: primary,
      tintTo: secondary,
      tintStrength: 0.14,
      chipBg: 'rgba(15, 23, 42, 0.62)',
      chipText: '#F8FAFC',
    };
  }

  const primary = normalizeAccentColor(colors[0]) || DEFAULT_PALETTE.primary;
  const secondary = normalizeAccentColor(colors[1]) || DEFAULT_PALETTE.secondary;
  const accent = normalizeAccentColor(colors[2]) || DEFAULT_PALETTE.accent;

  return {
    primary,
    secondary,
    accent,
    backgroundFrom: DEFAULT_PALETTE.backgroundFrom,
    backgroundTo: DEFAULT_PALETTE.backgroundTo,
    tintFrom: primary,
    tintTo: secondary,
    tintStrength: 0.14,
    chipBg: 'rgba(15, 23, 42, 0.62)',
    chipText: '#F8FAFC',
  };
};

export const getTeamGradientStyle = (team) => {
  const palette = getTeamPalette(team);
  const tintStrength = Number.isFinite(Number(palette.tintStrength))
    ? Math.max(0, Math.min(0.24, Number(palette.tintStrength)))
    : 0.1;
  return {
    borderColor: `${palette.primary}80`,
    boxShadow: `0 0 18px ${palette.primary}22`,
    background: [
      `linear-gradient(135deg, ${toRgba(palette.tintFrom, tintStrength)} 0%, ${toRgba(palette.tintTo, tintStrength * 0.66)} 100%)`,
      `linear-gradient(145deg, ${toRgba(palette.backgroundFrom, 0.92)} 0%, ${toRgba(palette.backgroundTo, 0.95)} 100%)`,
    ].join(', '),
  };
};

export const getTeamBadgeStyle = (team) => {
  const palette = getTeamPalette(team);
  return {
    backgroundColor: palette.chipBg,
    color: palette.chipText,
    borderColor: `${palette.primary}66`,
  };
};

export const getTeamAccent = (team) => getTeamPalette(team).accent;

export const formatSkillLevelLabel = (skillLevel) => {
  if (skillLevel === 'easy') return 'Easy';
  if (skillLevel === 'hard') return 'Hard';
  return 'Normal';
};
