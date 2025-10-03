export function getMatchEndAt(dateISO, timeHHmm, minutes = 90) {
  const [hh, mm] = String(timeHHmm || '00:00').split(':').map(Number);
  const d = new Date(dateISO);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return new Date(d.getTime() + (minutes * 60 * 1000));
}