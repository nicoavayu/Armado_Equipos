const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getPointsEfficiencySummary = ({ cerrados = 0, puntos = 0, puntosPct = 0 } = {}) => {
  const closedMatches = Math.max(0, toFiniteNumber(cerrados));
  const earnedPoints = Math.max(0, toFiniteNumber(puntos));
  const pointsPercent = Math.max(0, toFiniteNumber(puntosPct));

  if (closedMatches <= 0) {
    return {
      hasClosedMatches: false,
      scoreText: 'Sin partidos cerrados',
      percentText: '-',
    };
  }

  return {
    hasClosedMatches: true,
    scoreText: `${earnedPoints} / ${closedMatches * 3}`,
    percentText: `${pointsPercent.toFixed(1)}%`,
  };
};

