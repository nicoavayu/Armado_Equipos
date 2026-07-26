import {
  drawGroups,
  generateKnockoutBracket,
  generateRoundRobin,
  instantToZonedLocalInput,
  participantFingerprint,
  seededShuffle,
  zonedLocalDateTimeToIso,
} from '../features/torneos/domain/fixtureAlgorithms';

const ids = (count) => Array.from({ length: count }, (_, index) => `team-${index + 1}`);
const realMatches = (rounds) => rounds.flatMap((round) => round.matches)
  .filter((match) => !match.bye);
const pairKey = (match) => [match.home, match.away].sort().join(':');

describe('fixtureAlgorithms round robin', () => {
  test.each([2, 3, 4, 5, 6, 7, 10, 16])(
    'covers every pairing exactly once with %i teams',
    (count) => {
    const participants = ids(count);
    const rounds = generateRoundRobin(participants);
    const matches = realMatches(rounds);

    expect(rounds).toHaveLength(count % 2 === 0 ? count - 1 : count);
    expect(matches).toHaveLength((count * (count - 1)) / 2);
    expect(new Set(matches.map(pairKey)).size).toBe(matches.length);
    rounds.forEach((round) => {
      const appearances = round.matches
        .flatMap((match) => [match.home, match.away])
        .filter(Boolean);
      expect(new Set(appearances).size).toBe(appearances.length);
    });
    participants.forEach((participant) => {
      expect(matches.filter((match) => (
        match.home === participant || match.away === participant
      ))).toHaveLength(count - 1);
      if (count % 2 === 1) {
        expect(rounds.filter((round) => round.matches.some((match) => (
          match.bye && (match.home === participant || match.away === participant)
        )))).toHaveLength(1);
      }
    });
  },
  );

  test('builds a mirrored second leg with localities inverted', () => {
    const firstAndSecond = generateRoundRobin(ids(6), { doubleRound: true });
    const first = firstAndSecond.slice(0, 5);
    const second = firstAndSecond.slice(5);

    expect(second).toHaveLength(first.length);
    first.forEach((round, roundIndex) => {
      round.matches.forEach((match, matchIndex) => {
        expect(second[roundIndex].matches[matchIndex]).toEqual({
          home: match.away,
          away: match.home,
          bye: match.bye,
        });
      });
    });
  });
});

describe('fixtureAlgorithms knockout', () => {
  test.each([2, 3, 4, 5, 6, 7, 8, 10, 12, 16])(
    'creates only playable matches for a power-of-two bracket with %i teams',
    (count) => {
    const participants = ids(count).map((id, index) => ({ id, seedNumber: index + 1 }));
    const stages = generateKnockoutBracket(participants);
    const bracketSize = 2 ** Math.ceil(Math.log2(count));

    expect(stages.at(0).matches).toHaveLength(count - (bracketSize / 2));
    expect(stages.at(-1).matches).toHaveLength(1);
    expect(stages.flatMap((stage) => stage.matches)).toHaveLength(count - 1);
    expect(stages.at(0).autoAdvances).toHaveLength(bracketSize - count);
    stages.forEach((stage) => {
      stage.matches.forEach((match) => {
        expect(match.homeSource.type).not.toBe('bye');
        expect(match.awaySource.type).not.toBe('bye');
      });
    });
  },
  );

  test('protects the highest seeds and exposes structured third-place sources', () => {
    const stages = generateKnockoutBracket(
      ids(8).map((id, index) => ({ id, seedNumber: index + 1 })),
      { thirdPlace: true },
    );
    const firstRound = stages[0].matches.map((match) => [
      match.home.id,
      match.away.id,
    ]);
    expect(firstRound).toEqual([
      ['team-1', 'team-8'],
      ['team-2', 'team-7'],
      ['team-3', 'team-6'],
      ['team-4', 'team-5'],
    ]);
    expect(stages.at(-2).thirdPlace).toBe(true);
    expect(stages.at(-2).matches[0]).toEqual(expect.objectContaining({
      homeSource: expect.objectContaining({ type: 'loser_of_match' }),
      awaySource: expect.objectContaining({ type: 'loser_of_match' }),
    }));
  });

  test('marks two legs before the final when requested', () => {
    const stages = generateKnockoutBracket(ids(8), { doubleLeg: true });
    expect(stages[0].matches.every((match) => match.legs === 2)).toBe(true);
    expect(stages[1].matches.every((match) => match.legs === 2)).toBe(true);
    expect(stages.at(-1).matches[0].legs).toBe(1);
    expect(stages[1].matches[0].homeSource.type).toBe('winner_of_tie');
    expect(stages[1].matches[0].awaySource.type).toBe('winner_of_tie');
  });
});

describe('fixtureAlgorithms deterministic draw', () => {
  const participants = ids(12).map((id, index) => ({
    id,
    potNumber: (index % 3) + 1,
    seedNumber: index + 1,
  }));

  test('repeats exactly with the same seed and balances group sizes', () => {
    const first = drawGroups(participants, { groupCount: 4, seed: 'apertura-2026' });
    const second = drawGroups([...participants].reverse(), {
      groupCount: 4,
      seed: 'apertura-2026',
    });
    expect(first).toEqual(second);
    expect(first.map((group) => group.participants.length)).toEqual([3, 3, 3, 3]);
    first.forEach((group) => {
      expect(new Set(group.participants.map((participant) => participant.potNumber)).size).toBe(3);
    });
  });

  test('requires an explicit seed and valid group count', () => {
    expect(() => seededShuffle(ids(4), '')).toThrow('TORNEOS_DRAW_SEED_REQUIRED');
    expect(() => seededShuffle(ids(4), '   ')).toThrow('TORNEOS_DRAW_SEED_REQUIRED');
    expect(() => drawGroups(participants, { groupCount: 1, seed: 'x' }))
      .toThrow('TORNEOS_INVALID_GROUP_COUNT');
  });

  test.each([
    [4, 2], [6, 2], [7, 2], [8, 2], [10, 3], [12, 3], [16, 4],
  ])('balances %i participants across %i groups', (count, groupCount) => {
    const values = ids(count).map((id, index) => ({
      id,
      potNumber: (index % Math.max(1, Math.floor(count / groupCount))) + 1,
    }));
    const groups = drawGroups(values, { groupCount, seed: 'á-seed-非常-larga' });
    const sizes = groups.map((group) => group.participants.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(groups.flatMap((group) => group.participants)).toHaveLength(count);
  });

  test('fingerprints participant identity and competitive ordering', () => {
    const fingerprint = participantFingerprint(participants);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(participantFingerprint([...participants].reverse())).toBe(fingerprint);
    expect(participantFingerprint(
      participants.map((participant, index) => (
        index === 0 ? { ...participant, seedNumber: 99 } : participant
      )),
    )).not.toBe(fingerprint);
  });
});

describe('fixtureAlgorithms scheduling time zones', () => {
  test('converts venue-local time without depending on the browser time zone', () => {
    expect(zonedLocalDateTimeToIso(
      '2030-06-01T12:00',
      'America/Argentina/Buenos_Aires',
    )).toBe('2030-06-01T15:00:00.000Z');
    expect(zonedLocalDateTimeToIso(
      '2030-06-01T12:00',
      'Europe/Madrid',
    )).toBe('2030-06-01T10:00:00.000Z');
  });

  test('round-trips instants and rejects missing or ambiguous DST times', () => {
    expect(instantToZonedLocalInput(
      '2030-06-01T15:00:00.000Z',
      'America/Argentina/Buenos_Aires',
    )).toBe('2030-06-01T12:00');
    expect(() => zonedLocalDateTimeToIso(
      '2030-03-10T02:30',
      'America/New_York',
    )).toThrow('TORNEOS_INVALID_LOCAL_SCHEDULE');
    expect(() => zonedLocalDateTimeToIso(
      '2025-11-02T01:30',
      'America/New_York',
    )).toThrow('TORNEOS_INVALID_LOCAL_SCHEDULE');
  });
});
