// "1 miembro", "2 miembros": a count in UI copy always agrees with its noun.
export function formatCount(count, singular, plural) {
  const value = Number(count) || 0;
  return `${value} ${value === 1 ? singular : plural}`;
}
