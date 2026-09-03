export const EDITORIAL_STANDINGS_PAGE_SIZE = 15;

function themeIdOf(theme) {
  return typeof theme === 'string' ? theme : theme?.id;
}

export function resolveEditorialStandingsPagination(snapshot, editorial = {}, theme = null) {
  const rows = snapshot?.official?.rows || [];
  const enabled = themeIdOf(theme) === 'editorial'
    && snapshot?.piece === 'standings'
    && rows.length > EDITORIAL_STANDINGS_PAGE_SIZE;
  const pageCount = enabled
    ? Math.ceil(rows.length / EDITORIAL_STANDINGS_PAGE_SIZE)
    : 1;
  const requestedPage = Number.parseInt(editorial?.page, 10) || 1;
  const page = Math.max(1, Math.min(pageCount, requestedPage));
  const start = enabled ? (page - 1) * EDITORIAL_STANDINGS_PAGE_SIZE : 0;
  const pageRows = enabled
    ? rows.slice(start, start + EDITORIAL_STANDINGS_PAGE_SIZE)
    : rows;

  return {
    enabled,
    page,
    pageCount,
    pageSize: EDITORIAL_STANDINGS_PAGE_SIZE,
    totalRows: rows.length,
    start,
    end: start + pageRows.length,
    snapshot: enabled ? {
      ...snapshot,
      official: { ...snapshot.official, rows: pageRows },
    } : snapshot,
  };
}

export function editorialStandingsPageCount(snapshot, theme = null) {
  return resolveEditorialStandingsPagination(snapshot, {}, theme).pageCount;
}
