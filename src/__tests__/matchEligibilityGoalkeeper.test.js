import { buildQuieroJugarMatchAudit } from '../utils/matchEligibility';

const futureDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
};

const baseMatch = {
  id: 1,
  estado: 'active',
  fecha: futureDate(),
  hora: '20:00',
};

describe('buildQuieroJugarMatchAudit — goalkeeper-only matches', () => {
  test('a match searching only for a goalkeeper is included', () => {
    const audit = buildQuieroJugarMatchAudit({
      matchRow: { ...baseMatch, falta_jugadores: false, busca_arquero: true },
    });
    expect(audit.needsGoalkeeper).toBe(true);
    expect(audit.exclusionReasons).not.toContain('no_open_slots');
    expect(audit.includedInList).toBe(true);
  });

  test('a match with neither open call is excluded', () => {
    const audit = buildQuieroJugarMatchAudit({
      matchRow: { ...baseMatch, falta_jugadores: false, busca_arquero: false },
    });
    expect(audit.exclusionReasons).toContain('no_open_slots');
    expect(audit.includedInList).toBe(false);
  });

  test('a match searching for players stays included', () => {
    const audit = buildQuieroJugarMatchAudit({
      matchRow: { ...baseMatch, falta_jugadores: true, busca_arquero: false },
    });
    expect(audit.needsPlayers).toBe(true);
    expect(audit.includedInList).toBe(true);
  });
});
