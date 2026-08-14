export const GENDER_OPTIONS = Object.freeze([
  { code: 'male', name: 'Masculino' },
  { code: 'female', name: 'Femenino' },
  { code: 'mixed', name: 'Mixto' },
  { code: 'open', name: 'Abierto' },
]);

export const TIEBREAK_OPTIONS = Object.freeze([
  {
    code: 'goal_difference',
    name: 'Diferencia de gol',
    description: 'Goles a favor menos goles en contra.',
  },
  {
    code: 'goals_for',
    name: 'Goles a favor',
    description: 'Prioriza al equipo que convirtió más goles.',
  },
  {
    code: 'head_to_head',
    name: 'Resultado entre sí',
    description: 'Considerará los partidos entre los equipos empatados.',
  },
  {
    code: 'matches_won',
    name: 'Partidos ganados',
    description: 'Prioriza la mayor cantidad de victorias.',
  },
  {
    code: 'fair_play',
    name: 'Fair play',
    description: 'Usará los puntos disciplinarios configurados.',
  },
  {
    code: 'playoff_match',
    name: 'Partido desempate',
    description: 'Reserva una definición deportiva futura.',
  },
  {
    code: 'draw',
    name: 'Sorteo',
    description: 'Último recurso administrado por la organización.',
  },
]);

export const DEFAULT_TIEBREAKS = Object.freeze([
  'goal_difference',
  'goals_for',
  'head_to_head',
  'fair_play',
]);

export const SEASON_STATUS_LABELS = Object.freeze({
  draft: 'Borrador',
  active: 'Activa',
  completed: 'Completada',
  archived: 'Archivada',
});

export const TOURNAMENT_STATUS_LABELS = Object.freeze({
  draft: 'Borrador',
  registration: 'Inscripción de equipos',
  scheduled: 'Lista para comenzar',
  active: 'En juego',
  completed: 'Finalizada',
  archived: 'Archivada',
});

export const COMPETITION_FORMAT_LABELS = Object.freeze({
  league: 'Liga',
  knockout: 'Eliminación directa',
  groups: 'Fase de grupos',
  groups_and_playoffs: 'Grupos y eliminatorias',
  league_and_playoffs: 'Liga y eliminatorias',
});

export function getCompetitionFormatName(code, fallback = 'Formato competitivo') {
  return COMPETITION_FORMAT_LABELS[code] || fallback;
}

export const CHECKLIST_ITEMS = Object.freeze([
  { key: 'information', label: 'Información general completa' },
  { key: 'season', label: 'Temporada disponible' },
  { key: 'modality', label: 'Modalidad definida' },
  { key: 'format', label: 'Formato definido' },
  { key: 'categories', label: 'Categorías creadas' },
  { key: 'scoring', label: 'Puntuación definida' },
  { key: 'tiebreaks', label: 'Desempates definidos' },
  { key: 'discipline', label: 'Disciplina configurada' },
]);

export function normalizeCompetitionSlug(value = '') {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getOptionName(options, code, fallback = 'Sin definir') {
  return options.find((option) => option.code === code)?.name || fallback;
}

export function getGenderName(code) {
  return getOptionName(GENDER_OPTIONS, code);
}

export function getTiebreakName(code) {
  return getOptionName(TIEBREAK_OPTIONS, code);
}

export function getDefaultFormatSettings(format) {
  const settings = {
    league: { rounds: 'single', qualifiers: 0 },
    knockout: { legs: 'single', thirdPlace: false },
    groups: { groupCount: 2, qualifiersPerGroup: 1, rounds: 'single' },
    groups_and_playoffs: {
      groupCount: 2,
      qualifiersPerGroup: 1,
      groupRounds: 'single',
      knockoutLegs: 'single',
    },
    league_and_playoffs: {
      leagueRounds: 'single',
      qualifiers: 2,
      knockoutLegs: 'single',
    },
  };
  return settings[format] || {};
}

export function buildTournamentDraft({
  seasonId = '',
  modality = null,
  format = null,
} = {}) {
  return {
    name: '',
    slug: '',
    description: '',
    seasonId,
    startDate: '',
    endDate: '',
    genderCategory: 'open',
    sportModality: modality?.code || 'football_7',
    teamSize: modality?.teamSize || 7,
    substitutesLimit: modality?.recommendedSubstitutes ?? 5,
    competitionFormat: format?.code || 'league',
    formatSettings: getDefaultFormatSettings(format?.code || 'league'),
    registrationOpensAt: '',
    registrationClosesAt: '',
    scoring: {
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      pointsWalkoverWin: '',
      pointsWalkoverLoss: '',
      allowManualPointsAdjustment: false,
      allowAdministrativeResult: false,
    },
    tiebreaks: [...DEFAULT_TIEBREAKS],
    discipline: {
      yellowsForSuspension: 5,
      suspensionMatches: 1,
      directRedSuggestedMatches: '',
      doubleYellowCountsAsRed: true,
      resetYellowsEachStage: false,
      fairPlayEnabled: true,
      yellowFairPlayPoints: 1,
      redFairPlayPoints: 3,
    },
  };
}

export function validateSeasonDraft(values) {
  const errors = {};
  if (values.name.trim().length < 3) errors.name = 'Ingresá al menos 3 caracteres.';
  if (normalizeCompetitionSlug(values.slug || values.name).length < 3) {
    errors.slug = 'El identificador debe tener al menos 3 caracteres.';
  }
  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    errors.endDate = 'La fecha final no puede ser anterior a la inicial.';
  }
  return errors;
}

export function validateTournamentStep(step, draft, categories = []) {
  const errors = {};
  if (step === 0) {
    if (draft.name.trim().length < 3) errors.name = 'Ingresá el nombre del torneo.';
    if (!draft.seasonId) errors.seasonId = 'Seleccioná una temporada.';
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      errors.endDate = 'La fecha final no puede ser anterior a la inicial.';
    }
  }
  if (step === 1) {
    if (!draft.sportModality) errors.sportModality = 'Seleccioná una modalidad.';
    if (Number(draft.teamSize) < 5 || Number(draft.teamSize) > 11) {
      errors.teamSize = 'La cantidad debe estar entre 5 y 11.';
    }
  }
  if (step === 2 && !draft.competitionFormat) {
    errors.competitionFormat = 'Seleccioná un formato.';
  }
  if (step === 3) {
    const points = [
      draft.scoring.pointsWin,
      draft.scoring.pointsDraw,
      draft.scoring.pointsLoss,
    ].map(Number);
    if (points.some((value) => !Number.isInteger(value) || value < -10 || value > 20)) {
      errors.scoring = 'Los puntos deben ser enteros entre -10 y 20.';
    }
    if (!draft.tiebreaks.length || new Set(draft.tiebreaks).size !== draft.tiebreaks.length) {
      errors.tiebreaks = 'Elegí criterios sin repetirlos.';
    }
  }
  if (step === 4 && categories.filter((category) => category.status !== 'archived').length < 1) {
    errors.categories = 'Creá al menos una categoría activa.';
  }
  return errors;
}

export function toNullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
