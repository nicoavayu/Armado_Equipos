export const FEATURE_EQUIPOS_ENABLED = process.env.REACT_APP_ENABLE_EQUIPOS_TAB === 'true';

export const QUIERO_JUGAR_TOP_TAB_STORAGE_KEY = 'quiero-jugar-top-module-tab';
export const QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY = 'quiero-jugar-equipos-subtab';

export const TEAM_FORMAT_OPTIONS = [5, 6, 7, 8, 9, 11];
export const TEAM_ROSTER_LIMIT_BY_FORMAT = Object.freeze({
  5: 10,
  6: 12,
  7: 14,
  8: 16,
  9: 18,
  11: 22,
});

export const CHALLENGE_SQUAD_LIMIT_BY_FORMAT = Object.freeze({
  5: { starters: 5, substitutes: 3, selected: 8 },
  6: { starters: 6, substitutes: 3, selected: 9 },
  7: { starters: 7, substitutes: 4, selected: 11 },
  8: { starters: 8, substitutes: 4, selected: 12 },
  9: { starters: 9, substitutes: 4, selected: 13 },
  11: { starters: 11, substitutes: 5, selected: 16 },
});
export const TEAM_MODE_OPTIONS = [
  { value: 'Masculino', label: 'Masculino' },
  { value: 'Femenino', label: 'Femenino' },
  { value: 'Mixto', label: 'Mixto' },
];
export const TEAM_SKILL_OPTIONS = [
  { value: 'sin_definir', label: 'Sin definir' },
  { value: 'inicial', label: 'Inicial' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'competitivo', label: 'Competitivo' },
  { value: 'avanzado', label: 'Avanzado' },
  { value: 'elite', label: 'Elite' },
];

const LEGACY_SKILL_MAP = {
  easy: 'inicial',
  normal: 'intermedio',
  hard: 'competitivo',
  tranqui: 'inicial',
  metedor: 'competitivo',
  picante: 'avanzado',
  bueno: 'elite',
};

export const normalizeTeamSkillLevel = (value) => {
  if (!value) return 'sin_definir';
  const mapped = LEGACY_SKILL_MAP[value] || value;
  return TEAM_SKILL_OPTIONS.some((option) => option.value === mapped) ? mapped : 'sin_definir';
};

const TEAM_MODE_ALIASES = {
  masculino: 'Masculino',
  male: 'Masculino',
  hombre: 'Masculino',
  femenino: 'Femenino',
  female: 'Femenino',
  mujer: 'Femenino',
  mixto: 'Mixto',
  mixed: 'Mixto',
  unisex: 'Mixto',
};

export const normalizeTeamMode = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Masculino';
  if (TEAM_MODE_OPTIONS.some((option) => option.value === normalized)) return normalized;
  const alias = TEAM_MODE_ALIASES[normalized.toLowerCase()];
  return alias || 'Masculino';
};

export const resolveTeamRosterLimit = (format, persistedLimit = null) => {
  const normalizedPersisted = Number(persistedLimit);
  if (Number.isFinite(normalizedPersisted) && normalizedPersisted > 0) {
    return normalizedPersisted;
  }

  const normalizedFormat = Number(format);
  if (Number.isFinite(normalizedFormat) && TEAM_ROSTER_LIMIT_BY_FORMAT[normalizedFormat]) {
    return TEAM_ROSTER_LIMIT_BY_FORMAT[normalizedFormat];
  }

  return TEAM_ROSTER_LIMIT_BY_FORMAT[5];
};

export const resolveChallengeSquadLimits = (format) => {
  const normalizedFormat = Number(format);
  return CHALLENGE_SQUAD_LIMIT_BY_FORMAT[normalizedFormat] || CHALLENGE_SQUAD_LIMIT_BY_FORMAT[5];
};

export const TEAM_SKILL_LABEL_BY_VALUE = TEAM_SKILL_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});

export const CHALLENGE_STATUS_LABELS = {
  open: 'Abierto',
  accepted: 'Aceptado',
  confirmed: 'Confirmado',
  completed: 'Finalizado',
  canceled: 'Cancelado',
};
