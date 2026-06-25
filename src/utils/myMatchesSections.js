import { parseLocalDateTime } from './dateLocal';

export const MY_MATCH_SECTION_LABELS = {
  upcoming: 'Próximos partidos',
  postMatch: 'Post partido',
};

export const getMatchSortTime = (partido) => {
  const scheduledAt = partido?.source_type === 'team_match' && partido?.scheduled_at
    ? new Date(partido.scheduled_at)
    : null;
  if (scheduledAt && !Number.isNaN(scheduledAt.getTime())) {
    return scheduledAt.getTime();
  }

  if (!partido?.fecha || !partido?.hora) return null;
  const parsed = parseLocalDateTime(partido.fecha, partido.hora);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : null;
};

const sortMatchesByTime = (matches, direction = 'asc') => matches
  .map((partido, index) => ({ partido, index }))
  .sort((a, b) => {
    const timeA = getMatchSortTime(a.partido);
    const timeB = getMatchSortTime(b.partido);

    if (timeA == null && timeB == null) return a.index - b.index;
    if (timeA == null) return 1;
    if (timeB == null) return -1;

    const delta = direction === 'desc' ? timeB - timeA : timeA - timeB;
    return delta || a.index - b.index;
  })
  .map(({ partido }) => partido);

export const buildMyMatchSections = (
  partidos = [],
  {
    isMatchFinished = () => false,
    isPostMatchCandidate = () => false,
    isPostMatchVisible = () => true,
  } = {},
) => {
  const upcomingPartidos = [];
  const postMatchPartidos = [];

  (partidos || []).forEach((partido) => {
    const matchFinished = isMatchFinished(partido);
    if (!matchFinished) {
      upcomingPartidos.push(partido);
      return;
    }

    if (isPostMatchCandidate(partido) && isPostMatchVisible(partido)) {
      postMatchPartidos.push(partido);
    }
  });

  return [
    {
      key: 'upcoming',
      title: MY_MATCH_SECTION_LABELS.upcoming,
      tone: 'default',
      partidos: sortMatchesByTime(upcomingPartidos, 'asc'),
    },
    {
      key: 'post-match',
      title: MY_MATCH_SECTION_LABELS.postMatch,
      tone: 'post-match',
      partidos: sortMatchesByTime(postMatchPartidos, 'desc'),
    },
  ].filter((section) => section.partidos.length > 0);
};
