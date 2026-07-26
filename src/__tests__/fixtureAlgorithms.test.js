import {
  drawGroups,
  generateKnockoutBracket,
  generateRoundRobin,
  participantFingerprint,
  seededShuffle,
} from '../features/torneos/domain/fixtureAlgorithms';

const ids = (count) => Array.from({ length: count }, (_, index) => `team-${index + 1}`);
const realMatches = (rounds) => rounds.flatMap((round) => round.matches)
  .filter((match) => !match.bye);
const pairKey = (match) => [match.home, match.away].sort().join(':');

describe('fixtureAlgorithms round robin', () => {
  test.each([2, 3, 4, 5, 10])('covers every pairing exactly once with %i teams', (count) => {
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
  });

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
  test.each([2, 3, 4, 5, 6, 8, 10, 16])('creates a complete power-of-two bracket for %i teams', (count) => {
    const participants = ids(count).map((id, index) => ({ id, seedNumber: index + 1 }));
    const stages = generateKnockoutBracket(participants);
    const bracketSize = 2 ** Math.ceil(Math.log2(count));

    expect(stages.at(0).matches).toHaveLength(bracketSize / 2);
    expect(stages.at(-1).matches).toHaveLength(1);
    expect(stages.flatMap((stage) => stage.matches)).toHaveLength(bracketSize - 1);
    expect(stages.at(0).matches.filter((match) => match.autoAdvance)).toHaveLength(bracketSize - count);
    stages.slice(1).forEach((stage) => {
      stage.matches.forEach((match) => {
        expect(match.homeSource.type).toBe('winner_of_match');
        expect(match.awaySource.type).toBe('winner_of_match');
      });
    });
  });

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
    expect(() => drawGroups(participants, { groupCount: 1, seed: 'x' }))
      .toThrow('TORNEOS_INVALID_GROUP_COUNT');
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
