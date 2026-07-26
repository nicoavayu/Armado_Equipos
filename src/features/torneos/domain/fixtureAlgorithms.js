const BYE = null;

function normalizeSeed(seed) {
  const value = String(seed ?? '').trim();
  if (!value) throw new Error('TORNEOS_DRAW_SEED_REQUIRED');
  return value;
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(initialState) {
  let state = initialState >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(values, seed) {
  if (!Array.isArray(values)) throw new Error('TORNEOS_INVALID_DRAW_INPUT');
  const result = [...values];
  const random = mulberry32(hashSeed(normalizeSeed(seed)));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function participantId(participant) {
  return typeof participant === 'string' ? participant : participant?.id;
}

function compareStable(left, right) {
  const leftValue = String(left);
  const rightValue = String(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function assertParticipants(participants) {
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new Error('TORNEOS_NOT_ENOUGH_PARTICIPANTS');
  }
  const ids = participants.map(participantId);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error('TORNEOS_INVALID_PARTICIPANTS');
  }
}

function orientPair(left, right, roundIndex, pairIndex) {
  if (left === BYE || right === BYE) {
    return { home: left, away: right, bye: true };
  }
  const invert = (roundIndex + pairIndex) % 2 === 1;
  return invert
    ? { home: right, away: left, bye: false }
    : { home: left, away: right, bye: false };
}

export function generateRoundRobin(participants, { doubleRound = false } = {}) {
  assertParticipants(participants);
  const rotation = [...participants];
  if (rotation.length % 2 === 1) rotation.push(BYE);
  const teamCount = rotation.length;
  const firstLeg = [];

  for (let roundIndex = 0; roundIndex < teamCount - 1; roundIndex += 1) {
    const matches = [];
    for (let pairIndex = 0; pairIndex < teamCount / 2; pairIndex += 1) {
      matches.push(orientPair(
        rotation[pairIndex],
        rotation[teamCount - 1 - pairIndex],
        roundIndex,
        pairIndex,
      ));
    }
    firstLeg.push({
      number: roundIndex + 1,
      matches,
    });
    rotation.splice(1, 0, rotation.pop());
  }

  if (!doubleRound) return firstLeg;
  const secondLeg = firstLeg.map((round, index) => ({
    number: firstLeg.length + index + 1,
    matches: round.matches.map((match) => ({
      home: match.away,
      away: match.home,
      bye: match.bye,
    })),
  }));
  return [...firstLeg, ...secondLeg];
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export function generateKnockoutBracket(participants, {
  doubleLeg = false,
  thirdPlace = false,
} = {}) {
  assertParticipants(participants);
  const ordered = [...participants].sort((left, right) => {
    const leftSeed = left?.seedNumber == null ? Number.POSITIVE_INFINITY : Number(left.seedNumber);
    const rightSeed = right?.seedNumber == null ? Number.POSITIVE_INFINITY : Number(right.seedNumber);
    const seedDifference = leftSeed - rightSeed;
    if (seedDifference) return seedDifference;
    return compareStable(participantId(left), participantId(right));
  });
  const bracketSize = nextPowerOfTwo(ordered.length);
  const slots = Array.from({ length: bracketSize }, () => BYE);
  const seedOrder = [];
  const buildSeedOrder = (start, end) => {
    if (start > end) return;
    if (start === end) {
      seedOrder.push(start);
      return;
    }
    seedOrder.push(start, end);
    buildSeedOrder(start + 1, end - 1);
  };
  buildSeedOrder(1, bracketSize);
  ordered.forEach((participant, index) => {
    const slot = seedOrder.indexOf(index + 1);
    slots[slot === -1 ? index : slot] = participant;
  });

  const stages = [];
  let sourceCount = bracketSize;
  let sequence = 1;
  let previousSources = [];
  let semifinalLoserSources = [];
  while (sourceCount >= 2) {
    const matchCount = sourceCount / 2;
    const stageMatches = [];
    const nextSources = [];
    const autoAdvances = [];
    for (let index = 0; index < matchCount; index += 1) {
      const firstStage = stages.length === 0;
      const home = firstStage ? slots[index * 2] : null;
      const away = firstStage ? slots[index * 2 + 1] : null;
      const homeSource = firstStage
        ? (home ? { type: 'participant', participantId: participantId(home) } : { type: 'bye' })
        : previousSources[index * 2];
      const awaySource = firstStage
        ? (away ? { type: 'participant', participantId: participantId(away) } : { type: 'bye' })
        : previousSources[index * 2 + 1];
      if (homeSource.type === 'bye' || awaySource.type === 'bye') {
        const advancing = homeSource.type === 'bye' ? awaySource : homeSource;
        if (advancing.type !== 'bye') {
          nextSources.push(advancing);
          autoAdvances.push(advancing);
        }
        continue;
      }
      const legs = doubleLeg && sourceCount > 2 ? 2 : 1;
      const tieKey = `tie-${stages.length + 1}-${index + 1}`;
      const matchNumber = sequence;
      stageMatches.push({
        number: matchNumber,
        home,
        away,
        homeSource,
        awaySource,
        legs,
        tieKey,
      });
      sequence += legs;
      const advancementSource = legs === 2
        ? { type: 'winner_of_tie', tieKey }
        : { type: 'winner_of_match', matchNumber };
      const loserSource = legs === 2
        ? { type: 'loser_of_tie', tieKey }
        : { type: 'loser_of_match', matchNumber };
      nextSources.push(advancementSource);
      if (sourceCount === 4) semifinalLoserSources.push(loserSource);
    }
    stages.push({
      size: sourceCount,
      matches: stageMatches,
      autoAdvances,
    });
    previousSources = nextSources;
    sourceCount /= 2;
  }

  if (thirdPlace && semifinalLoserSources.length === 2) {
    const thirdPlaceStage = {
      size: 2,
      thirdPlace: true,
      matches: [{
        number: sequence,
        home: null,
        away: null,
        homeSource: semifinalLoserSources[0],
        awaySource: semifinalLoserSources[1],
        legs: 1,
      }],
    };
    stages.splice(stages.length - 1, 0, thirdPlaceStage);
  }
  return stages;
}

export function drawGroups(participants, {
  groupCount,
  seed,
} = {}) {
  assertParticipants(participants);
  if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > participants.length) {
    throw new Error('TORNEOS_INVALID_GROUP_COUNT');
  }
  const groups = Array.from({ length: groupCount }, (_, index) => ({
    index,
    code: String.fromCharCode(65 + index),
    participants: [],
  }));
  const byPot = new Map();
  participants.forEach((participant) => {
    const pot = Number(participant?.potNumber || 0);
    const values = byPot.get(pot) || [];
    values.push(participant);
    byPot.set(pot, values);
  });
  const orderedPots = [...byPot.keys()].sort((left, right) => left - right);

  orderedPots.forEach((potNumber) => {
    const pot = seededShuffle(
      byPot.get(potNumber).sort((left, right) => (
        compareStable(participantId(left), participantId(right))
      )),
      `${normalizeSeed(seed)}:pot:${potNumber}`,
    );
    const groupOrder = seededShuffle(
      groups.map((group) => group.index),
      `${normalizeSeed(seed)}:pot:${potNumber}:groups`,
    );
    const assignedForPot = new Set();
    pot.forEach((participant) => {
      const eligible = groupOrder
        .filter((groupIndex) => !assignedForPot.has(groupIndex))
        .sort((left, right) => (
          groups[left].participants.length - groups[right].participants.length
          || groupOrder.indexOf(left) - groupOrder.indexOf(right)
        ));
      const fallback = groupOrder
        .slice()
        .sort((left, right) => (
          groups[left].participants.length - groups[right].participants.length
          || groupOrder.indexOf(left) - groupOrder.indexOf(right)
        ));
      const groupIndex = (eligible.length ? eligible : fallback)[0];
      groups[groupIndex].participants.push(participant);
      assignedForPot.add(groupIndex);
      if (assignedForPot.size === groupCount) assignedForPot.clear();
    });
  });

  const sizes = groups.map((group) => group.participants.length);
  if (Math.max(...sizes) - Math.min(...sizes) > 1) {
    throw new Error('TORNEOS_GROUP_DRAW_IMPOSSIBLE');
  }
  return groups;
}

export function participantFingerprint(participants) {
  assertParticipants(participants);
  const canonical = participants
    .map((participant) => [
      participantId(participant),
      participant?.seedNumber || '',
      participant?.potNumber || '',
    ].join(':'))
    .sort()
    .join('|');
  return Array.from({ length: 8 }, (_, index) => (
    hashSeed(`${index}:${canonical}`).toString(16).padStart(8, '0')
  )).join('');
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

export function instantToZonedLocalInput(value, timeZone) {
  const parts = zonedParts(new Date(value), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function zonedLocalDateTimeToIso(value, timeZone) {
  const match = String(value || '').match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!match || !timeZone) throw new Error('TORNEOS_INVALID_LOCAL_SCHEDULE');
  const desired = match.slice(1).map(Number);
  const desiredUtc = Date.UTC(
    desired[0],
    desired[1] - 1,
    desired[2],
    desired[3],
    desired[4],
  );
  const candidateOffsets = new Set(
    [-48, -24, 0, 24, 48].map((hours) => {
      const instant = desiredUtc + (hours * 60 * 60 * 1000);
      const parts = zonedParts(new Date(instant), timeZone);
      const representedAsUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      return representedAsUtc - instant;
    }),
  );
  const candidates = [...candidateOffsets]
    .map((offset) => new Date(desiredUtc - offset))
    .filter((candidate) => (
      instantToZonedLocalInput(candidate, timeZone) === value
    ));
  const uniqueInstants = [...new Set(candidates.map((candidate) => candidate.toISOString()))];
  if (uniqueInstants.length !== 1) {
    throw new Error('TORNEOS_INVALID_LOCAL_SCHEDULE');
  }
  return uniqueInstants[0];
}

export function formatInstantInTimeZone(value, timeZone, locale = 'es-AR') {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
