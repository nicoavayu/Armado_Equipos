const toYmdLocal = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const todayYmdLocal = () => toYmdLocal(new Date());

export const parseYmdAsLocal = (ymd) => {
  const raw = String(ymd || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

export const addDaysToYmd = (ymd, days) => {
  const base = parseYmdAsLocal(ymd);
  if (!base) return '';
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + Number(days || 0), 12, 0, 0, 0);
  return toYmdLocal(next);
};

export const nextYmdForWeekday = (weekday) => {
  const target = Number(weekday);
  if (!Number.isFinite(target) || target < 0 || target > 6) {
    return todayYmdLocal();
  }
  const now = new Date();
  const current = now.getDay();
  let delta = target - current;
  if (delta < 0) delta += 7;
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta, 12, 0, 0, 0);
  return toYmdLocal(next);
};

export const normalizeYmd = (value) => {
  if (!value) return '';
  const raw = String(value).trim();
  const directDateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (directDateMatch) {
    const maybeDate = parseYmdAsLocal(directDateMatch[1]);
    return maybeDate ? directDateMatch[1] : '';
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return toYmdLocal(parsed);
};

export const resolveNextTemplateDate = (partidoFrecuente) => {
  const todayYmd = todayYmdLocal();
  const referenceDate = normalizeYmd(partidoFrecuente?.fecha);

  if (referenceDate) {
    let targetDate = addDaysToYmd(referenceDate, 7);
    while (targetDate && targetDate <= todayYmd) {
      targetDate = addDaysToYmd(targetDate, 7);
    }
    return {
      referenceDate,
      targetDate: targetDate || nextYmdForWeekday(partidoFrecuente?.dia_semana),
    };
  }

  let targetDate = nextYmdForWeekday(partidoFrecuente?.dia_semana);
  while (targetDate && targetDate <= todayYmd) {
    targetDate = addDaysToYmd(targetDate, 7);
  }

  return {
    referenceDate: '',
    targetDate: targetDate || todayYmd,
  };
};
