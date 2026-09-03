const PREMIUM_THEME_IDS = new Set(['heritage', 'street', 'scoreboard', 'editorial']);

function text(value) {
  return String(value ?? '').trim();
}

function compact(value) {
  return text(value).replace(/\s+/g, '');
}

function directElements(node) {
  return Array.from(node?.children || []);
}

function leafWithText(root, value) {
  const expected = text(value);
  if (!expected) return null;
  return Array.from(root.querySelectorAll('*')).find((node) => (
    node.children.length === 0 && text(node.textContent) === expected
  )) || null;
}

function smallestContainer(root, values, { unused = new Set() } = {}) {
  const expected = values.map(text).filter(Boolean);
  const anchorValue = compact(expected.at(-1));
  const anchors = Array.from(root.querySelectorAll('*')).filter((node) => (
    compact(node.textContent) === anchorValue
    && !Array.from(node.children).some((child) => compact(child.textContent) === anchorValue)
  ));
  for (const candidateAnchor of anchors) {
    if (Array.from(unused).some((used) => used.contains(candidateAnchor))) continue;
    let node = candidateAnchor;
    while (node && node !== root) {
      const content = compact(node.textContent);
      if (!unused.has(node) && expected.every((value) => content.includes(compact(value)))) return node;
      node = node.parentElement;
    }
  }
  return null;
}

function commonParent(nodes) {
  if (!nodes.length) return null;
  let parent = nodes[0].parentElement;
  while (parent) {
    let containsAll = true;
    for (const node of nodes) {
      if (!parent.contains(node)) {
        containsAll = false;
        break;
      }
    }
    if (containsAll) break;
    parent = parent.parentElement;
  }
  return parent;
}

function clamp(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateWrappedLines(value) {
  const normalized = text(value);
  if (!normalized) return 1;
  if (normalized.length > 38) return 3;
  if (normalized.length > 20) return 2;
  return 1;
}

export function resolveAdaptiveTableMetrics({
  rowCount,
  availableBodyHeight,
  headerHeight = 46,
  formatId = 'portrait',
  wrappedLineCounts = [],
  maxRowHeightOverride = null,
}) {
  const count = Math.max(0, Number(rowCount) || 0);
  const available = Math.max(0, Number(availableBodyHeight) || 0);
  const minRowHeight = formatId === 'story' ? 38 : 28;
  const idealRowHeight = formatId === 'story' ? 76 : 66;
  const defaultMaxRowHeight = formatId === 'story' ? 104 : 92;
  const maxRowHeight = Number.isFinite(maxRowHeightOverride)
    ? Math.max(minRowHeight, maxRowHeightOverride)
    : defaultMaxRowHeight;
  if (!count) {
    return {
      rowHeight: 0,
      minRowHeight,
      idealRowHeight,
      maxRowHeight,
      fontSizes: [],
      contentHeight: headerHeight,
    };
  }
  const safeRowHeight = Math.max(18, Math.floor((available - headerHeight) / count));
  const rowHeight = Math.min(
    safeRowHeight,
    clamp(minRowHeight, safeRowHeight, maxRowHeight),
  );
  const baseFontSize = formatId === 'story' ? 28 : 26;
  const fontSizes = Array.from({ length: count }, (_unused, index) => {
    const lines = clamp(1, Number(wrappedLineCounts[index]) || 1, 3);
    const fit = Math.floor((rowHeight - 4) / (lines * 1.08));
    return clamp(11, fit, baseFontSize);
  });
  return {
    rowHeight,
    minRowHeight,
    idealRowHeight,
    maxRowHeight,
    fontSizes,
    contentHeight: headerHeight + rowHeight * count,
  };
}

function findVerticalFlowFrame(parent, root) {
  let node = parent?.parentElement;
  while (node && node !== root) {
    const style = getComputedStyle(node);
    if (style.display === 'flex' && style.flexDirection === 'column') return node;
    node = node.parentElement;
  }
  return parent;
}

function rowForMatch(root, match, scoreText, unused) {
  const home = text(match?.home?.name || match?.home?.teamName);
  const away = text(match?.away?.name || match?.away?.teamName);
  const found = smallestContainer(root, [home, away, scoreText], { unused });
  if (!found) return null;
  let row = found;
  while (
    row.parentElement
    && row.parentElement !== root
    && text(row.parentElement.textContent) === text(row.textContent)
  ) row = row.parentElement;
  unused.add(row);
  return row;
}

function rowForScoreboardMatch(root, match, unused) {
  const home = text(match?.home?.name || match?.home?.teamName);
  const away = text(match?.away?.name || match?.away?.teamName);
  const found = smallestContainer(root, [home, away], { unused });
  if (!found) return null;
  let row = found;
  while (
    row.parentElement
    && row.parentElement !== root
    && text(row.parentElement.textContent) === text(row.textContent)
    && directElements(row.parentElement).length <= 2
  ) row = row.parentElement;
  unused.add(row);
  return row;
}

function setLeafType(root, value, styles) {
  const leaf = leafWithText(root, value);
  if (!leaf) return;
  Object.assign(leaf.style, styles);
}

function hardenResultRows(root, matches, themeId, formatId) {
  if (formatId !== 'story' || !matches.length) return;
  const unused = new Set();
  const rows = matches.map((match) => {
    const result = match?.result || match?.score;
    const scoreText = result
      ? `${result.homeScore ?? result.home ?? '—'} - ${result.awayScore ?? result.away ?? '—'}`
      : '—';
    return themeId === 'scoreboard'
      ? rowForScoreboardMatch(root, match, unused)
      : rowForMatch(root, match, scoreText, unused);
  }).filter(Boolean);
  if (!rows.length) return;

  const parent = commonParent(rows);
  if (!parent) return;
  const dense = rows.length > 4;
  const gap = dense ? (rows.length >= 8 ? 10 : 14) : 18;
  const pad = dense ? 10 : 20;
  const available = parent.clientHeight || Number.parseFloat(getComputedStyle(parent).height) || 1100;
  const rowHeight = Math.max(72, Math.floor((available - pad * 2 - gap * (rows.length - 1)) / rows.length));
  Object.assign(parent.style, {
    justifyContent: 'flex-start',
    alignContent: 'start',
    gap: `${gap}px`,
    paddingTop: `${pad}px`,
    paddingBottom: `${pad}px`,
    overflow: 'hidden',
  });
  parent.dataset.premiumFlow = 'results';
  parent.dataset.rowCount = String(rows.length);

  const columns = {
    heritage: dense ? '92px minmax(0,1fr) 170px minmax(0,1fr) 92px' : '118px minmax(0,1fr) 216px minmax(0,1fr) 118px',
    street: dense ? '88px minmax(0,1fr) 166px minmax(0,1fr) 88px' : '112px minmax(0,1fr) 204px minmax(0,1fr) 112px',
    scoreboard: dense ? '76px minmax(0,1fr) 154px minmax(0,1fr) 76px' : '96px minmax(0,1fr) 184px minmax(0,1fr) 96px',
    editorial: dense ? '72px minmax(0,1fr) 150px minmax(0,1fr) 72px' : '88px minmax(0,1fr) 176px minmax(0,1fr) 88px',
  }[themeId];
  const nameSize = dense ? (rows.length >= 8 ? 23 : 27) : 34;
  const scoreSize = dense ? (rows.length >= 8 ? 43 : 52) : 68;
  const crestSize = Math.min(dense ? 58 : 82, Math.max(38, rowHeight * 0.56));

  rows.forEach((row, index) => {
    Object.assign(row.style, {
      flex: `0 0 ${rowHeight}px`,
      height: `${rowHeight}px`,
      minHeight: '0',
      maxHeight: `${rowHeight}px`,
      gridTemplateColumns: columns,
      columnGap: dense ? '10px' : '14px',
      boxSizing: 'border-box',
      overflow: 'hidden',
    });
    row.dataset.premiumRow = 'result';
    const match = matches[index];
    if (themeId === 'scoreboard') {
      const halves = directElements(row).filter((child) => getComputedStyle(child).display === 'grid');
      halves.forEach((half) => {
        Object.assign(half.style, {
          gridTemplateColumns: dense
            ? '92px minmax(0,1fr) 154px'
            : '118px minmax(0,1fr) 184px',
          minHeight: '0',
          overflow: 'hidden',
        });
        const halfCells = directElements(half);
        if (halfCells[0]) {
          halfCells[0].style.minWidth = '0';
          const crest = halfCells[0].firstElementChild;
          if (crest) Object.assign(crest.style, {
            width: `${crestSize}px`, maxWidth: '100%', margin: '0 auto',
          });
        }
        if (halfCells[1]) Object.assign(halfCells[1].style, {
          minWidth: '0', overflow: 'hidden', paddingLeft: '10px', paddingRight: '10px',
        });
        if (halfCells[2]) Object.assign(halfCells[2].style, {
          minWidth: '0', overflow: 'hidden', fontSize: `${scoreSize}px`, lineHeight: '1',
        });
      });
      setLeafType(row, match?.home?.name || match?.home?.teamName, {
        fontSize: `${nameSize}px`, lineHeight: '1.02', overflowWrap: 'anywhere', maxWidth: '100%',
      });
      setLeafType(row, match?.away?.name || match?.away?.teamName, {
        fontSize: `${nameSize}px`, lineHeight: '1.02', overflowWrap: 'anywhere', maxWidth: '100%',
      });
      const result = match?.result || match?.score;
      [result?.homeScore ?? result?.home, result?.awayScore ?? result?.away].forEach((value) => {
        const leaf = leafWithText(row, String(value));
        if (leaf) Object.assign(leaf.style, {
          fontSize: `${scoreSize}px`, lineHeight: '1', whiteSpace: 'nowrap',
        });
      });
      return;
    }
    const contentRow = themeId === 'street'
      ? Array.from(row.querySelectorAll('*')).find((node) => (
        getComputedStyle(node).display === 'grid'
        && node.children.length >= 5
        && compact(node.textContent).includes(compact(match?.home?.name || match?.home?.teamName))
        && compact(node.textContent).includes(compact(match?.away?.name || match?.away?.teamName))
      )) || row
      : row;
    if (contentRow !== row) Object.assign(contentRow.style, {
      width: '100%',
      height: '100%',
      minHeight: '0',
      gridTemplateColumns: columns,
      columnGap: dense ? '10px' : '14px',
      boxSizing: 'border-box',
      overflow: 'hidden',
    });
    const cells = directElements(contentRow);
    if (cells.length >= 5) {
      cells.forEach((cell) => Object.assign(cell.style, {
        boxSizing: 'border-box', width: '100%', maxWidth: '100%', minWidth: '0',
      }));
      [cells[0], cells[4]].forEach((cell) => {
        Object.assign(cell.style, { minWidth: '0', overflow: 'hidden' });
        const crest = cell.firstElementChild;
        if (crest) Object.assign(crest.style, { width: `${crestSize}px`, maxWidth: '100%', margin: '0 auto' });
      });
      [cells[1], cells[3]].forEach((cell) => Object.assign(cell.style, {
        minWidth: '0',
        overflow: 'hidden',
        paddingLeft: dense ? '8px' : cell.style.paddingLeft,
        paddingRight: dense ? '8px' : cell.style.paddingRight,
      }));
      Object.assign(cells[2].style, { minWidth: '0', overflow: 'hidden', maxWidth: '100%' });
    }
    setLeafType(row, match?.home?.name || match?.home?.teamName, {
      fontSize: `${nameSize}px`, lineHeight: '1.02', overflowWrap: 'anywhere', maxWidth: '100%',
    });
    setLeafType(row, match?.away?.name || match?.away?.teamName, {
      fontSize: `${nameSize}px`, lineHeight: '1.02', overflowWrap: 'anywhere', maxWidth: '100%',
    });
    const result = match?.result || match?.score;
    if (result) {
      const scoreText = `${result.homeScore ?? result.home} - ${result.awayScore ?? result.away}`;
      const scoreGroup = Array.from(row.querySelectorAll('*')).find((node) => (
        compact(node.textContent) === compact(scoreText)
        && !Array.from(node.children).some((child) => compact(child.textContent) === compact(scoreText))
      ));
      if (scoreGroup) {
        Object.assign(scoreGroup.style, {
          fontSize: `${scoreSize}px`, lineHeight: '1', whiteSpace: 'nowrap', maxWidth: '100%',
        });
        Array.from(scoreGroup.querySelectorAll('*')).forEach((node) => {
          node.style.fontSize = `${scoreSize}px`;
          node.style.lineHeight = '1';
        });
      }
    }
  });
}

function gridRowForName(root, name, unused) {
  const leaves = Array.from(root.querySelectorAll('*')).filter((node) => (
    node.children.length === 0 && text(node.textContent) === text(name)
  ));
  for (const leaf of leaves) {
    if (Array.from(unused).some((used) => used.contains(leaf))) continue;
    let row = leaf;
    while (row && row !== root) {
      const display = getComputedStyle(row).display;
      if (!unused.has(row) && display === 'grid' && row.children.length >= 3) {
        unused.add(row);
        return row;
      }
      row = row.parentElement;
    }
  }
  return null;
}

function hardenTabularFlow(root, rowsData, kind, formatId, themeId) {
  if (!rowsData.length) return;
  const unused = new Set();
  const rows = rowsData.map((entry) => gridRowForName(
    root,
    entry?.team?.name || entry?.teamName || entry?.name,
    unused,
  )).filter(Boolean);
  if (!rows.length) return;
  const parent = commonParent(rows);
  if (!parent) return;
  const header = rows[0].previousElementSibling;
  const headerHeight = header && header.parentElement === parent ? header.offsetHeight : 0;
  const flowFrame = findVerticalFlowFrame(parent, root);
  const fallbackBodyHeight = formatId === 'story' ? 1210 : 760;
  // The themes do not all expose the same wrapper hierarchy. The common row
  // parent is the actual table viewport; a higher flex column can be the full
  // 1080x1920 canvas and would overestimate the space available to the rows.
  const parentDisplay = getComputedStyle(parent).display;
  const intrinsicRowContainer = parentDisplay !== 'flex' && parentDisplay !== 'grid';
  const stableViewport = parent.parentElement;
  const preserveApprovedEditorialStory = themeId === 'editorial' && formatId === 'story';
  // Block table bodies grow to their content. Reading them again after the
  // layout effect has run creates a row-count feedback loop (notably in
  // Editorial 4:5). Measure their fixed viewport instead. Editorial Story is
  // already approved and deliberately retains its current geometry.
  const measuredBodyHeight = !preserveApprovedEditorialStory
    && intrinsicRowContainer
    && stableViewport?.clientHeight
    ? stableViewport.clientHeight
    : parent.clientHeight;
  const footerSafetyInset = themeId === 'editorial'
    && formatId === 'portrait'
    && kind === 'standings'
    ? 18
    : 0;
  const availableBodyHeight = Math.max(
    0,
    (measuredBodyHeight || fallbackBodyHeight) - footerSafetyInset,
  );
  const nameLeaves = rowsData.map((entry, index) => leafWithText(
    rows[index],
    entry?.team?.name || entry?.teamName || entry?.name,
  ));
  const wrappedLineCounts = nameLeaves.map((leaf, index) => {
    if (!leaf) return estimateWrappedLines(
      rowsData[index]?.team?.name || rowsData[index]?.teamName || rowsData[index]?.name,
    );
    const style = getComputedStyle(leaf);
    const lineHeight = Number.parseFloat(style.lineHeight)
      || Number.parseFloat(style.fontSize) * 1.08;
    if (leaf.scrollHeight > 0 && lineHeight > 0) {
      return clamp(1, Math.ceil(leaf.scrollHeight / lineHeight), 3);
    }
    return estimateWrappedLines(leaf.textContent);
  });
  const metrics = resolveAdaptiveTableMetrics({
    rowCount: rows.length,
    availableBodyHeight,
    headerHeight: headerHeight || 46,
    formatId,
    wrappedLineCounts,
    maxRowHeightOverride: kind === 'standings' && formatId === 'portrait'
      ? ({
        heritage: rows.length <= 4 ? 136 : (rows.length <= 8 ? 98 : null),
        street: rows.length <= 4 ? 136 : (rows.length <= 8 ? 98 : null),
        scoreboard: rows.length <= 4 ? 118 : (rows.length <= 8 ? 88 : null),
        editorial: rows.length <= 4 ? 116 : (rows.length <= 8 ? 86 : null),
      }[themeId] ?? null)
      : null,
  });
  const { rowHeight } = metrics;
  Object.assign(parent.style, {
    justifyContent: 'flex-start',
    alignContent: 'start',
    overflow: 'visible',
    width: '100%',
  });
  if (flowFrame) {
    Object.assign(flowFrame.style, {
      justifyContent: 'flex-start',
      alignContent: 'start',
    });
    flowFrame.dataset.premiumFlowFrame = kind;
  }
  parent.dataset.premiumFlow = kind;
  parent.dataset.rowCount = String(rows.length);
  parent.dataset.availableBodyHeight = String(availableBodyHeight);
  parent.dataset.contentHeight = String(metrics.contentHeight);
  parent.dataset.minRowHeight = String(metrics.minRowHeight);
  parent.dataset.idealRowHeight = String(metrics.idealRowHeight);
  parent.dataset.maxRowHeight = String(metrics.maxRowHeight);
  rows.forEach((row, index) => {
    Object.assign(row.style, {
      flex: `0 0 ${rowHeight}px`,
      height: `${rowHeight}px`,
      minHeight: '0',
      maxHeight: `${rowHeight}px`,
      boxSizing: 'border-box',
      overflow: 'visible',
    });
    row.dataset.premiumRow = kind;
    row.dataset.wrappedLines = String(wrappedLineCounts[index]);
    Array.from(row.querySelectorAll('*')).forEach((node) => {
      const current = Number.parseFloat(getComputedStyle(node).fontSize);
      if (Number.isFinite(current) && current > Math.max(13, rowHeight * 0.52)) {
        node.style.fontSize = `${Math.max(13, Math.floor(rowHeight * 0.52))}px`;
      }
    });
    const nameLeaf = nameLeaves[index];
    if (nameLeaf) {
      let fittedFontSize = metrics.fontSizes[index];
      const useSingleLineAutofit = kind === 'standings'
        && themeId === 'editorial'
        && formatId === 'portrait';
      Object.assign(nameLeaf.style, {
        fontSize: `${fittedFontSize}px`,
        lineHeight: '1.08',
        overflow: 'visible',
        overflowWrap: useSingleLineAutofit ? 'normal' : 'break-word',
        textWrap: useSingleLineAutofit ? 'nowrap' : 'wrap',
        whiteSpace: useSingleLineAutofit ? 'nowrap' : 'normal',
      });
      // Editorial 4:5 prioritizes a measured single line. Other tables retain
      // wrapping and only step down when their rendered lines escape the row.
      while (fittedFontSize > 11 && (
        useSingleLineAutofit
          ? nameLeaf.scrollWidth > nameLeaf.clientWidth
          : nameLeaf.scrollHeight > rowHeight - 4
      )) {
        fittedFontSize -= 1;
        nameLeaf.style.fontSize = `${fittedFontSize}px`;
      }
      nameLeaf.dataset.premiumFittedFontSize = String(fittedFontSize);
      if (useSingleLineAutofit) nameLeaf.dataset.premiumSingleLineAutofit = 'true';
    }
    const crest = row.querySelector('img')?.parentElement;
    if (crest) Object.assign(crest.style, {
      width: `${Math.max(16, Math.min(34, rowHeight * 0.58))}px`, maxHeight: `${rowHeight - 6}px`,
    });
    if (themeId === 'scoreboard' && kind === 'standings') {
      const pointsCell = row.lastElementChild;
      if (pointsCell) {
        const background = resolvedBackgroundColor(row, root);
        const tone = contrastToneForBackground(background);
        // A dedicated opaque points chip removes the former dependency on the
        // alternating row fill and survives DOM cloning during PNG export.
        Object.assign(pointsCell.style, {
          color: '#F4F1E8',
          backgroundColor: '#06462F',
          borderRadius: '3px',
          padding: '4px 3px 3px',
          margin: '0 2px',
          lineHeight: '1',
          position: 'relative',
          zIndex: '2',
          opacity: '1',
          mixBlendMode: 'normal',
          isolation: 'isolate',
        });
        pointsCell.style.fontWeight = '800';
        pointsCell.dataset.premiumContrast = 'scoreboard-points';
        pointsCell.dataset.premiumContrastTone = tone;
        pointsCell.dataset.premiumRowBackground = background;
      }
    }
  });
}

function hardenEditorialPagination(root, pagination, formatId) {
  if (!pagination?.enabled || pagination.pageCount < 2) return;
  const marker = root.querySelector('[data-premium-pagination="editorial-standings"]')
    || document.createElement('div');
  marker.dataset.premiumPagination = 'editorial-standings';
  marker.textContent = `PÁGINA ${pagination.page} DE ${pagination.pageCount}`;
  Object.assign(marker.style, {
    position: 'absolute',
    left: '50%',
    bottom: formatId === 'story' ? '72px' : '49px',
    transform: 'translateX(-50%)',
    zIndex: '8',
    padding: '3px 18px 2px',
    background: '#F1EAD8',
    color: '#9A3B2E',
    fontFamily: "'IBM Plex Sans Condensed', sans-serif",
    fontSize: formatId === 'story' ? '17px' : '15px',
    fontWeight: '700',
    letterSpacing: '0.18em',
    lineHeight: '1.1',
    whiteSpace: 'nowrap',
  });
  if (!marker.parentElement) root.appendChild(marker);
  root.dataset.premiumPage = String(pagination.page);
  root.dataset.premiumPageCount = String(pagination.pageCount);
  const flow = root.querySelector('[data-premium-flow="standings"]');
  if (flow) {
    // Every Editorial standings page shares the same table origin. Sparse
    // continuation pages may use the bounded adaptive row height above, but
    // the table block itself must never be vertically balanced or centered.
    flow.style.transform = 'none';
    flow.style.transformOrigin = 'top left';
    flow.dataset.premiumContinuationAnchor = 'top';
  }
}

function rgba(value) {
  const match = text(value).match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] == null ? 1 : Number(match[4]),
  };
}

function resolvedBackgroundColor(node, boundary) {
  let current = node;
  while (current) {
    const value = getComputedStyle(current).backgroundColor;
    const parsed = rgba(value);
    if (parsed && parsed.a > 0.01) return `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`;
    if (current === boundary) break;
    current = current.parentElement;
  }
  return 'rgb(255, 255, 255)';
}

function contrastToneForBackground(value) {
  const parsed = rgba(value) || { r: 255, g: 255, b: 255 };
  const channels = [parsed.r, parsed.g, parsed.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance < 0.42 ? 'light' : 'dark';
}

function tableHeaderForLabels(root, labels) {
  const anchor = leafWithText(root, labels[0]);
  if (!anchor) return null;
  let node = anchor;
  while (node && node !== root) {
    const content = compact(node.textContent);
    if (getComputedStyle(node).display === 'grid'
      && labels.every((label) => content.includes(compact(label)))) return node;
    node = node.parentElement;
  }
  return null;
}

function hardenEmptyDiscipline(root, themeId) {
  const header = tableHeaderForLabels(root, ['EQUIPO', 'TA', 'TR', 'PTS'])
    || tableHeaderForLabels(root, ['CLUB', 'TA', 'TR', 'PTS']);
  if (!header) return;
  const parent = header.parentElement;
  const flowFrame = findVerticalFlowFrame(parent, root);
  header.style.display = 'none';
  header.dataset.premiumEmptyHeader = 'hidden';
  const emptyState = document.createElement('div');
  emptyState.dataset.premiumEmptyState = 'discipline';
  const themeStyle = {
    heritage: {
      color: '#7C1C2E', borderLeft: '8px solid #7C1C2E',
      fontFamily: 'Anton, sans-serif', fontSize: '28px', letterSpacing: '0.12em',
    },
    street: {
      color: '#09090B', background: '#F51D2C',
      fontFamily: "'Arial Narrow', sans-serif", fontSize: '27px', fontStyle: 'italic',
      fontWeight: '900', letterSpacing: '0.08em', transform: 'skewX(-8deg)',
    },
    scoreboard: {
      color: '#F4F1E8', background: '#06462F',
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: '27px', letterSpacing: '0.1em',
    },
    editorial: {
      color: '#1B2A46', borderTop: '2px solid #1B2A46', borderBottom: '1px solid #1B2A46',
      fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: '24px', letterSpacing: '0.16em',
    },
  }[themeId];
  emptyState.textContent = 'SIN SANCIONES REGISTRADAS';
  Object.assign(emptyState.style, {
    marginTop: '18px',
    width: 'max-content',
    maxWidth: '100%',
    boxSizing: 'border-box',
    padding: themeId === 'street' ? '10px 22px 9px' : '12px 20px 11px',
    flex: 'none',
    lineHeight: '1',
    fontWeight: '800',
    whiteSpace: 'nowrap',
    ...themeStyle,
  });
  parent.insertBefore(emptyState, header);
  Object.assign(parent.style, { width: '100%', overflow: 'visible' });
  if (flowFrame) {
    Object.assign(flowFrame.style, { justifyContent: 'flex-start', alignContent: 'start' });
    flowFrame.dataset.premiumFlowFrame = 'discipline-empty';
    let placement = flowFrame.parentElement;
    while (placement && placement !== root) {
      const style = getComputedStyle(placement);
      if (style.display === 'flex' && style.flexDirection === 'column'
        && Number.parseFloat(style.flexGrow) > 0) {
        placement.style.justifyContent = 'flex-start';
        placement.dataset.premiumEmptyPlacement = 'below-title';
        break;
      }
      placement = placement.parentElement;
    }
  }
}

function hardenNoPhotoFigure(root, themeId, formatId) {
  if (formatId !== 'story') return;
  const fallback = root.querySelector(`[data-premium-figure-fallback="${themeId}"]`);
  const frame = fallback?.closest('[data-premium-figure-frame="true"]');
  if (!frame) return;

  let hero = frame.parentElement;
  while (hero && hero !== root) {
    const style = getComputedStyle(hero);
    if (Number.parseFloat(style.flexGrow) > 0 && style.position === 'relative') break;
    hero = hero.parentElement;
  }
  if (!hero || hero === root) return;

  const compactHeight = {
    heritage: 520,
    street: 620,
    scoreboard: 520,
    editorial: 500,
  }[themeId];
  Object.assign(hero.style, {
    flex: `0 0 ${compactHeight}px`,
    height: `${compactHeight}px`,
    minHeight: `${compactHeight}px`,
    maxHeight: `${compactHeight}px`,
    overflow: 'hidden',
  });
  hero.dataset.premiumFigureNoPhoto = 'compact';

  let layer = frame;
  while (layer && layer !== hero) {
    Object.assign(layer.style, {
      width: '100%',
      height: '100%',
      minHeight: '100%',
      maxHeight: '100%',
    });
    layer = layer.parentElement;
  }
  const monogram = fallback.querySelector('strong');
  if (monogram) monogram.style.fontSize = themeId === 'street' ? '230px' : '210px';

  const column = hero.parentElement;
  if (column && getComputedStyle(column).display === 'flex') {
    column.style.justifyContent = 'space-between';
    column.dataset.premiumFigureComposition = 'no-photo-compact';
  }

  if (themeId === 'scoreboard') {
    const identity = hero.nextElementSibling;
    const stats = identity?.nextElementSibling;
    if (identity) Object.assign(identity.style, {
      flex: '0 0 500px',
      height: '500px',
      minHeight: '500px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    });
    if (stats) Object.assign(stats.style, {
      flex: '0 0 250px',
      height: '250px',
      minHeight: '250px',
      alignItems: 'center',
    });
  }
}

function hideEmptySuspensions(root, players) {
  const hasSuspensions = players.some((player) => (player?.suspensions || []).length > 0);
  if (hasSuspensions) return;
  const label = leafWithText(root, 'SANCIONADOS');
  if (!label) return;
  let block = label.parentElement;
  while (block?.parentElement && text(block.parentElement.textContent) === text(block.textContent)) {
    block = block.parentElement;
  }
  if (block) {
    block.style.display = 'none';
    block.dataset.premiumEmptyBlock = 'hidden';
  }
}

function hardenEditorialFixtures(root, matches) {
  if (!matches.length) return;
  const vsLeaves = Array.from(root.querySelectorAll('*')).filter((node) => (
    node.children.length === 0 && text(node.textContent).toUpperCase() === 'VS'
  ));
  vsLeaves.forEach((vs, index) => {
    const match = matches[index];
    let balance = vs.parentElement;
    while (balance && balance !== root) {
      const content = text(balance.textContent);
      if (content.includes(text(match?.home?.name)) && content.includes(text(match?.away?.name))) break;
      balance = balance.parentElement;
    }
    if (!balance || balance === root) return;
    if (getComputedStyle(balance).display === 'grid') {
      balance.style.gridTemplateColumns = 'minmax(0,1fr) 72px minmax(0,1fr)';
      balance.style.alignItems = 'center';
      balance.style.columnGap = '18px';
    }
    setLeafType(balance, match?.home?.name, { textAlign: 'right', maxWidth: '100%', overflowWrap: 'anywhere' });
    setLeafType(balance, match?.away?.name, { textAlign: 'left', maxWidth: '100%', overflowWrap: 'anywhere' });
    balance.dataset.premiumFixtureBalance = 'true';
  });
}

function hardenHeritageSemifinalScores(root, matches) {
  matches.slice(0, 2).forEach((match) => {
    const result = match?.result || match?.score;
    if (!result) return;
    const score = `${result.homeScore ?? result.home} - ${result.awayScore ?? result.away}`;
    const leaf = leafWithText(root, score);
    if (leaf) {
      leaf.style.color = '#EFE6D8';
      leaf.dataset.premiumContrast = 'heritage-score';
    }
  });
}

export function applyPremiumLayoutHardening(root, {
  snapshot,
  editorial = {},
  themeId,
  formatId,
  pagination = null,
} = {}) {
  if (!root || !PREMIUM_THEME_IDS.has(themeId)) return root;
  const piece = snapshot?.piece;
  const official = snapshot?.official || {};
  root.dataset.premiumPiece = piece || '';
  root.dataset.premiumTheme = themeId;
  root.dataset.premiumFormat = formatId;
  root.style.setProperty('--figura-zoom', String(Math.max(1, Math.min(3, editorial.figuraZoom || 1))));

  if (piece === 'round_results') {
    hardenResultRows(root, official.matches || [], themeId, formatId);
  } else if (piece === 'standings') {
    hardenTabularFlow(root, official.rows || [], 'standings', formatId, themeId);
  } else if (piece === 'scorers') {
    hardenTabularFlow(root, official.players || [], 'scorers', formatId, themeId);
  } else if (piece === 'discipline') {
    if ((official.players || []).length) {
      hardenTabularFlow(root, official.players || [], 'discipline', formatId, themeId);
    } else {
      hardenEmptyDiscipline(root, themeId);
    }
    hideEmptySuspensions(root, official.players || []);
  } else if (piece === 'next_fixture' && themeId === 'editorial') {
    hardenEditorialFixtures(root, official.matches || []);
  } else if (piece === 'semifinals' && themeId === 'heritage') {
    hardenHeritageSemifinalScores(root, official.matches || []);
  } else if (piece === 'mvp') {
    hardenNoPhotoFigure(root, themeId, formatId);
  }
  if (piece === 'standings' && themeId === 'editorial') {
    hardenEditorialPagination(root, pagination, formatId);
  }
  return root;
}
