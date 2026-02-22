export const FEATURE_EQUIPOS_ENABLED = process.env.REACT_APP_ENABLE_EQUIPOS_TAB === 'true';

export const QUIERO_JUGAR_TOP_TAB_STORAGE_KEY = 'quiero-jugar-top-module-tab';
export const QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY = 'quiero-jugar-equipos-subtab';

export const TEAM_FORMAT_OPTIONS = [5, 6, 7, 8, 9, 11];
export const TEAM_SKILL_OPTIONS = [
  { value: 'sin_definir', label: 'Sin definir' },
  { value: 'tranqui', label: 'Tranqui' },
  { value: 'metedor', label: 'Metedor' },
  { value: 'picante', label: 'Picante' },
  { value: 'bueno', label: 'Bueno' },
];

const LEGACY_SKILL_MAP = {
  easy: 'tranqui',
  normal: 'metedor',
  hard: 'picante',
};

export const normalizeTeamSkillLevel = (value) => {
  if (!value) return 'sin_definir';
  const mapped = LEGACY_SKILL_MAP[value] || value;
  return TEAM_SKILL_OPTIONS.some((option) => option.value === mapped) ? mapped : 'sin_definir';
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
