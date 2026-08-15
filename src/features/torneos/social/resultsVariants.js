const LIMITS = Object.freeze({
  portrait: Object.freeze({ compact: 3, standard: 5, maxVisible: 8 }),
  story: Object.freeze({ compact: 4, standard: 8, maxVisible: 13 }),
});

const PORTRAIT_DENSITY_TUNING = Object.freeze({
  compact: Object.freeze({
    rowGap: 14,
    classic: Object.freeze({ maxRowHeight: 260, teamSize: 42, minTeamSize: 22, scoreSize: 82 }),
    street: Object.freeze({ maxRowHeight: 230, teamSize: 42, minTeamSize: 28, scoreSize: 108 }),
    editorial: Object.freeze({ maxRowHeight: 270, teamSize: 42, minTeamSize: 21, scoreSize: 108 }),
  }),
  standard: Object.freeze({
    rowGap: 12,
    classic: Object.freeze({ maxRowHeight: 176, teamSize: 36, minTeamSize: 24, scoreSize: 72 }),
    street: Object.freeze({ maxRowHeight: 160, teamSize: 38, minTeamSize: 26, scoreSize: 94 }),
    editorial: Object.freeze({ maxRowHeight: 198, teamSize: 36, minTeamSize: 21, scoreSize: 92 }),
  }),
  dense: Object.freeze({
    rowGap: 6,
    classic: Object.freeze({ maxRowHeight: 112, teamSize: 26, minTeamSize: 20, scoreSize: 58 }),
    street: Object.freeze({ maxRowHeight: 112, teamSize: 26, minTeamSize: 20, scoreSize: 72 }),
    editorial: Object.freeze({ maxRowHeight: 128, teamSize: 26, minTeamSize: 20, scoreSize: 70 }),
  }),
  overflow: Object.freeze({
    rowGap: 5,
    classic: Object.freeze({ maxRowHeight: 98, teamSize: 24, minTeamSize: 19, scoreSize: 54 }),
    street: Object.freeze({ maxRowHeight: 98, teamSize: 24, minTeamSize: 19, scoreSize: 66 }),
    editorial: Object.freeze({ maxRowHeight: 108, teamSize: 24, minTeamSize: 19, scoreSize: 64 }),
  }),
});

/**
 * Central density/overflow decision for the current results-list layout.
 * Overflow deliberately keeps the existing `+N más` behaviour; pagination is
 * a later product decision.
 */
export function resolveResultsVariant({ matchCount, format }) {
  const count = Math.max(0, Number(matchCount) || 0);
  const formatId = format === 'story' ? 'story' : 'portrait';
  const limits = LIMITS[formatId];
  let id = 'dense';
  if (count <= limits.compact) id = 'compact';
  else if (count <= limits.standard) id = 'standard';
  else if (count > limits.maxVisible) id = 'overflow';
  return Object.freeze({
    id,
    format: formatId,
    matchCount: count,
    maxVisible: limits.maxVisible,
    hiddenCount: Math.max(0, count - limits.maxVisible),
    minRowHeight: 96,
    maxRowHeight: 150,
  });
}

/**
 * 4:5-only drawing tokens. Story deliberately stays on its existing sizing so
 * this final Results pass cannot change that content surface by accident.
 */
export function resolveResultsDensityTuning(variant, themeId) {
  if (variant?.format !== 'portrait') return null;
  const density = PORTRAIT_DENSITY_TUNING[variant.id] || PORTRAIT_DENSITY_TUNING.dense;
  return Object.freeze({ id: variant.id, rowGap: density.rowGap, ...density[themeId] });
}
