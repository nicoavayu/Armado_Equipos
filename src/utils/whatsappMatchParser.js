const ALLOWED_FORMATS = ['F5', 'F6', 'F7', 'F8', 'F9', 'F11'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

const stripAccents = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const normalizeSpaces = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const pad2 = (value) => String(value).padStart(2, '0');

const toYmd = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const parseSpeakerLine = (line) => {
  const cleaned = normalizeSpaces(line)
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:-|–)?\s*/, '');
  const match = cleaned.match(/^([^:]{2,40}):\s*(.+)$/);
  if (!match) return { speaker: null, message: cleaned };
  return { speaker: normalizeSpaces(match[1]), message: normalizeSpaces(match[2]) };
};

const nextWeekday = (now, weekdayIndex) => {
  const result = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  let daysAhead = (weekdayIndex - result.getDay() + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;
  result.setDate(result.getDate() + daysAhead);
  return result;
};

const parseDate = (normalizedText, now) => {
  const base = new Date(now);
  const lower = stripAccents(normalizedText).toLowerCase();

  if (/\bmanana\b/.test(lower)) {
    base.setDate(base.getDate() + 1);
    return { value: toYmd(base), confidence: 'high' };
  }
  if (/\bhoy\b/.test(lower)) {
    return { value: toYmd(base), confidence: 'high' };
  }

  const numeric = lower.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    let year = numeric[3] ? Number(numeric[3]) : base.getFullYear();
    if (year < 100) year += 2000;
    let candidate = new Date(year, month, day, 12, 0, 0, 0);
    if (!numeric[3] && candidate < new Date(base.getFullYear(), base.getMonth(), base.getDate())) {
      candidate = new Date(year + 1, month, day, 12, 0, 0, 0);
    }
    if (!Number.isNaN(candidate.getTime()) && candidate.getDate() === day && candidate.getMonth() === month) {
      return { value: toYmd(candidate), confidence: 'high' };
    }
  }

  const namedMonth = lower.match(/\b(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (namedMonth) {
    const day = Number(namedMonth[1]);
    const month = MONTHS[namedMonth[2]];
    let candidate = new Date(base.getFullYear(), month, day, 12, 0, 0, 0);
    if (candidate < new Date(base.getFullYear(), base.getMonth(), base.getDate())) {
      candidate = new Date(base.getFullYear() + 1, month, day, 12, 0, 0, 0);
    }
    return { value: toYmd(candidate), confidence: 'high' };
  }

  for (let index = 0; index < WEEKDAYS.length; index += 1) {
    if (new RegExp(`\\b${WEEKDAYS[index]}\\b`).test(lower)) {
      return { value: toYmd(nextWeekday(base, index)), confidence: 'medium' };
    }
  }

  return { value: '', confidence: 'missing' };
};

const normalizeHour = (hour, minute, period) => {
  let normalizedHour = Number(hour);
  if (!Number.isFinite(normalizedHour) || normalizedHour > 23 || Number(minute) > 59) return '';
  const normalizedPeriod = stripAccents(period || '').toLowerCase();
  if (normalizedPeriod === 'pm' && normalizedHour < 12) normalizedHour += 12;
  if (normalizedPeriod === 'am' && normalizedHour === 12) normalizedHour = 0;
  if (!normalizedPeriod && normalizedHour >= 7 && normalizedHour <= 11) normalizedHour += 12;
  return `${pad2(normalizedHour)}:${pad2(Number(minute) || 0)}`;
};

const parseTime = (normalizedText) => {
  const lower = stripAccents(normalizedText).toLowerCase();
  const explicit = lower.match(/(?:a\s+las\s+|tipo\s+)?\b(\d{1,2})[:.](\d{2})\s*(am|pm|hs?|h)?\b/);
  if (explicit) {
    return { value: normalizeHour(explicit[1], explicit[2], explicit[3]), confidence: 'high' };
  }
  const half = lower.match(/(?:a\s+las\s+|tipo\s+)\b(\d{1,2})\s+y\s+media\b/);
  if (half) {
    return { value: normalizeHour(half[1], 30, ''), confidence: 'medium' };
  }
  const bare = lower.match(/(?:a\s+las\s+|tipo\s+)\b(\d{1,2})\s*(am|pm|hs?|h)?\b/);
  if (bare) {
    return { value: normalizeHour(bare[1], 0, bare[2]), confidence: bare[2] ? 'high' : 'medium' };
  }
  return { value: '', confidence: 'missing' };
};

const parseFormat = (normalizedText) => {
  const lower = stripAccents(normalizedText).toLowerCase();
  const match = lower.match(/\b(?:f|futbol\s*)(5|6|7|8|9|11)\b/);
  const value = match ? `F${match[1]}` : '';
  return { value: ALLOWED_FORMATS.includes(value) ? value : 'F5', confidence: match ? 'high' : 'low' };
};

const parsePrice = (normalizedText) => {
  const lower = stripAccents(normalizedText).toLowerCase();
  const lucas = lower.match(/\b(\d+(?:[.,]\d+)?)\s*(?:lucas?|k)\b/);
  if (lucas) return Math.round(Number(lucas[1].replace(',', '.')) * 1000);
  const pesos = lower.match(/(?:\$|sale|precio|por\s+(?:cabeza|persona))\s*[:=]?\s*([\d.]{3,})/);
  if (pesos) return Number(pesos[1].replace(/\./g, ''));
  return null;
};

const parseVenue = (normalizedText) => {
  const candidates = normalizedText.split(/\n|\.|;/).map(normalizeSpaces).filter(Boolean);
  for (const candidate of candidates) {
    const match = candidate.match(/\ben\s+([^,]+?)(?=\s+(?:f(?:utbol)?\s*\d+|sale|somos|a\s+las|\d{1,2}[:.]\d{2}|$))/i);
    if (match && normalizeSpaces(match[1]).length >= 3) return normalizeSpaces(match[1]);
  }
  return '';
};

const splitNames = (value) => String(value || '')
  .replace(/\b(?:y|e)\b/gi, ',')
  .split(/[,;\n]/)
  .map((name) => normalizeSpaces(name.replace(/^(?:van|somos|confirmados?|se\s+suman?|sum[aá]|agreg[aá])\s*:?(?:\s+a)?\s*/i, '')))
  .filter((name) => name.length >= 2 && name.length <= 45);

const uniqueNames = (values) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = stripAccents(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const parsePlayers = (lines) => {
  const confirmed = [];
  const doubtful = [];
  const declined = [];

  lines.forEach((line) => {
    const { speaker, message } = parseSpeakerLine(line);
    const lower = stripAccents(message).toLowerCase();

    if (speaker && /^(voy|me\s+sumo|confirmo|estoy|cuenten\s+conmigo)\b/.test(lower)) confirmed.push(speaker);
    if (speaker && /^(no\s+voy|no\s+puedo|me\s+bajo|baja)\b/.test(lower)) declined.push(speaker);
    if (speaker && /^(en\s+duda|veo|te\s+confirmo|quizas|puede\s+ser)\b/.test(lower)) doubtful.push(speaker);

    const confirmedGroup = message.match(/\b(?:van|somos|confirmados?|se\s+suman?)\s*:?[\s-]+(.+)/i);
    if (confirmedGroup) confirmed.push(...splitNames(confirmedGroup[1]));

    const addOne = message.match(/\b(?:suma|sumá|agrega|agregá|anota|anotá)\s+a\s+(.+)/i);
    if (addOne) confirmed.push(...splitNames(addOne[1]));

    const doubtGroup = message.match(/\b(?:en\s+duda|dudosos?)\s*:?[\s-]+(.+)/i);
    if (doubtGroup) doubtful.push(...splitNames(doubtGroup[1]));

    const declinedGroup = message.match(/\b(?:no\s+pueden|no\s+van|se\s+bajan?)\s*:?[\s-]+(.+)/i);
    if (declinedGroup) declined.push(...splitNames(declinedGroup[1]));
  });

  const normalizedDeclined = new Set(uniqueNames(declined).map((name) => stripAccents(name).toLowerCase()));
  const normalizedDoubtful = new Set(uniqueNames(doubtful).map((name) => stripAccents(name).toLowerCase()));

  return {
    confirmed: uniqueNames(confirmed).filter((name) => !normalizedDeclined.has(stripAccents(name).toLowerCase()) && !normalizedDoubtful.has(stripAccents(name).toLowerCase())),
    doubtful: uniqueNames(doubtful).filter((name) => !normalizedDeclined.has(stripAccents(name).toLowerCase())),
    declined: uniqueNames(declined),
  };
};

const inferType = (normalizedText) => {
  const lower = stripAccents(normalizedText).toLowerCase();
  if (/\bmixto\b/.test(lower)) return 'Mixto';
  if (/\bfemenino\b|\bchicas\b/.test(lower)) return 'Femenino';
  return 'Masculino';
};

export const parseWhatsAppMatchText = (rawText, options = {}) => {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('Pegá algunos mensajes de WhatsApp para analizarlos.');

  const now = options.now ? new Date(options.now) : new Date();
  const lines = text.split(/\r?\n/).map(normalizeSpaces).filter(Boolean);
  const joined = lines.map((line) => parseSpeakerLine(line).message).join('\n');
  const date = parseDate(joined, now);
  const time = parseTime(joined);
  const format = parseFormat(joined);
  const players = parsePlayers(lines);
  const venue = parseVenue(joined);
  const price = parsePrice(joined);
  const warnings = [];

  if (!date.value) warnings.push('No encontramos una fecha clara.');
  if (!time.value) warnings.push('No encontramos un horario claro.');
  if (!venue) warnings.push('No encontramos una cancha o lugar claro.');
  if (players.confirmed.length === 0) warnings.push('No encontramos jugadores confirmados con suficiente seguridad.');

  return {
    nombre: date.value ? `Partido ${date.value.slice(8, 10)}/${date.value.slice(5, 7)}` : 'Partido importado',
    fecha: date.value,
    hora: time.value,
    sede: venue,
    modalidad: format.value,
    tipoPartido: inferType(joined),
    precioPorPersona: price,
    confirmedPlayers: players.confirmed,
    doubtfulPlayers: players.doubtful,
    declinedPlayers: players.declined,
    confidence: {
      fecha: date.confidence,
      hora: time.confidence,
      modalidad: format.confidence,
      sede: venue ? 'medium' : 'missing',
    },
    warnings,
    rawText: text,
  };
};

export { ALLOWED_FORMATS as WHATSAPP_ALLOWED_FORMATS };
