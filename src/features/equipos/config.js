export const FEATURE_EQUIPOS_ENABLED = process.env.REACT_APP_ENABLE_EQUIPOS_TAB === 'true';

export const QUIERO_JUGAR_TOP_TAB_STORAGE_KEY = 'quiero-jugar-top-module-tab';
export const QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY = 'quiero-jugar-equipos-subtab';

export const TEAM_FORMAT_OPTIONS = [5, 6, 7, 8, 9, 11];
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
