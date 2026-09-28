// POST-SMOKE copy regressions: counts agree with their noun, and the owner-facing stage of a
// `scheduled` tournament no longer claims "Lista para comenzar" (results can already be official).
import { formatCount } from '../features/torneos/domain/countCopy';
import { getRosterProgress } from '../features/torneos/domain/teamRegistration';
import { getTournamentStage } from '../features/torneos/domain/competitionLifecycle';
import { TOURNAMENT_STATUS_LABELS } from '../features/torneos/domain/competitionCatalog';

test('formatCount agrees with its noun for 0, 1 and many', () => {
  expect(formatCount(0, 'miembro', 'miembros')).toBe('0 miembros');
  expect(formatCount(1, 'miembro', 'miembros')).toBe('1 miembro');
  expect(formatCount(2, 'miembro', 'miembros')).toBe('2 miembros');
  expect(formatCount(undefined, 'equipo', 'equipos')).toBe('0 equipos');
});

test('roster requirements use the singular for one missing goalkeeper or player', () => {
  const settings = { minimumPlayers: 5, maximumPlayers: 10, minimumGoalkeepers: 1 };
  const four = Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, isGoalkeeper: false, shirtNumber: index + 1 }));
  const { errors } = getRosterProgress(four, settings);
  expect(errors).toContain('Falta 1 jugador para el mínimo.');
  expect(errors).toContain('Falta 1 arquero.');
  expect(errors.join(' ')).not.toMatch(/Faltan 1 /);

  const two = getRosterProgress(four.slice(0, 3), { ...settings, minimumGoalkeepers: 2 }).errors;
  expect(two).toContain('Faltan 2 jugadores para el mínimo.');
  expect(two).toContain('Faltan 2 arqueros.');
});

test('the scheduled stage is named by what is always true of it', () => {
  expect(getTournamentStage('scheduled').label).toBe('Fixture publicado');
  expect(TOURNAMENT_STATUS_LABELS.scheduled).toBe('Fixture publicado');
  expect(getTournamentStage('scheduled').description).not.toMatch(/antes de iniciar/);
});
