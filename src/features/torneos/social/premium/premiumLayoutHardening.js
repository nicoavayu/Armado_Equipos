import { PREMIUM_PIECE_TITLES } from './premiumDataAdapter';

const PREMIUM_THEME_IDS = new Set(['heritage', 'street', 'scoreboard', 'editorial']);
const STORY_RESULT_MAX_ROW_HEIGHT = 290;

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
  // Story: up to eight rows keep filling the 1920 px canvas the way the approved compositions do; fewer rows keep this
  // height and start under the title instead of stretching into floating bands.
  const defaultMaxRowHeight = formatId === 'story' ? 160 : 92;
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
    && withinEntrySize(root, row.parentElement)
  ) row = row.parentElement;
  unused.add(row);
  return row;
}

// A one-match list holds nothing but that match: without a size bound, "the box with the same text" would climb to
// the canvas body and the row height would be applied to the whole body (pulling the footer up).
function withinEntrySize(root, node) {
  return !(root.offsetHeight > 0) || node.offsetHeight <= root.offsetHeight * 0.4;
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
    && withinEntrySize(root, row.parentElement)
  ) row = row.parentElement;
  unused.add(row);
  return row;
}

function setLeafType(root, value, styles) {
  const leaf = leafWithText(root, value);
  if (!leaf) return;
  Object.assign(leaf.style, styles);
}

// True when one of the text's words (a run without spaces, "Tiki-Taka" included) is drawn on two lines. It needs real
// layout (Range rects); without it (jsdom) nothing is reported.
function splitsAWord(leaf) {
  const textNode = Array.from(leaf.childNodes).find((node) => node.nodeType === 3);
  if (!textNode || typeof document.createRange !== 'function') return false;
  const value = textNode.textContent;
  const pattern = /\S+/g;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    const range = document.createRange();
    range.setStart(textNode, match.index);
    range.setEnd(textNode, match.index + match[0].length);
    if (typeof range.getClientRects !== 'function') return false;
    const tops = new Set(Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0.5)
      .map((rect) => Math.round(rect.top)));
    if (tops.size > 1) return true;
  }
  return false;
}

// True when the leaf's box runs out of the nearest box that clips it sideways (a name cell with overflow hidden).
function cutSideways(leaf) {
  const box = leaf.getBoundingClientRect();
  if (!(box.width > 0)) return false;
  for (let node = leaf.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowX === 'visible') continue;
    const clip = node.getBoundingClientRect();
    return box.left < clip.left - 1 || box.right > clip.right + 1;
  }
  return false;
}

// A team name breaks only between words: the size steps down until its longest word fits the cell, no word is split
// over two lines (a hyphen is not a place to break a name) and the lines fit the row. Only a single word wider than the
// cell at the minimum size may still break (it would be clipped otherwise). Without `max` the template's own size is
// the ceiling and its line height is kept: a name that already fits is left exactly as drawn.
function fitTeamNameLeaf(leaf, { max, min, maxHeight = Number.POSITIVE_INFINITY }) {
  if (!leaf) return;
  const ceiling = Number.isFinite(max) ? max : Math.round(Number.parseFloat(getComputedStyle(leaf).fontSize));
  if (!(ceiling > 0)) return;
  Object.assign(leaf.style, {
    fontSize: `${ceiling}px`, maxWidth: '100%', overflowWrap: 'normal', wordBreak: 'normal',
  });
  if (Number.isFinite(max)) leaf.style.lineHeight = '1.02';
  leaf.dataset.premiumNameFit = 'words';
  if (!(leaf.clientWidth > 0)) return;
  const fits = () => leaf.scrollWidth <= leaf.clientWidth + 1 && leaf.scrollHeight <= maxHeight
    && !splitsAWord(leaf) && !cutSideways(leaf);
  let size = ceiling;
  while (size > min && !fits()) {
    size -= 1;
    leaf.style.fontSize = `${size}px`;
  }
  if (leaf.scrollWidth > leaf.clientWidth + 1) {
    leaf.style.overflowWrap = 'anywhere';
    leaf.dataset.premiumNameFit = 'anywhere';
  }
}

function hardenResultRows(root, matches, themeId, formatId) {
  if (formatId !== 'story' || !matches.length) return;
  const sponsorBand = root.querySelector('[data-premium-sponsor-band]');
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
  // Four results already fill the Story canvas; one to three keep that row height and start under the title instead
  // of each stretching into a third or half of the canvas.
  const rowHeight = Math.min(
    STORY_RESULT_MAX_ROW_HEIGHT,
    Math.max(72, Math.floor((available - pad * 2 - gap * (rows.length - 1)) / rows.length)),
  );
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
  const nameMin = dense ? 16 : 20;
  const templateScoreSize = dense ? (rows.length >= 8 ? 43 : 52) : 68;
  const templateCrestSize = Math.min(dense ? 58 : 82, Math.max(38, rowHeight * 0.56));
  // PREMIUM SPONSORS: Scoreboard stacks the two teams of a match in one row; with the band's shorter rows each half
  // keeps its score and its crest (a 5:6 shield) inside it. Without a band the approved sizes stand.
  const half = rowHeight / 2;
  const scoreSize = sponsorBand && themeId === 'scoreboard'
    ? Math.min(templateScoreSize, Math.floor(half * 0.62)) : templateScoreSize;
  const crestSize = sponsorBand && themeId === 'scoreboard'
    ? Math.min(templateCrestSize, Math.floor((half - 8) / 1.2)) : templateCrestSize;

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
        // The crest and score columns keep the template's widths (the crest sits inside its own padding: a narrower
        // column pushed it over the team name); only the name column becomes shrinkable.
        const [crestColumn, , scoreColumn] = getComputedStyle(half).gridTemplateColumns.split(' ')
          .map((value) => Number.parseFloat(value));
        Object.assign(half.style, {
          gridTemplateColumns: Number.isFinite(crestColumn) && Number.isFinite(scoreColumn)
            ? `${crestColumn}px minmax(0,1fr) ${scoreColumn}px`
            : (dense ? '92px minmax(0,1fr) 154px' : '118px minmax(0,1fr) 184px'),
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
          // With the band the shield is smaller: its initials follow it.
          if (crest && sponsorBand) crest.style.fontSize = `${Math.floor(crestSize * 0.4)}px`;
        }
        if (halfCells[1]) Object.assign(halfCells[1].style, {
          minWidth: '0', overflow: 'hidden', paddingLeft: '10px', paddingRight: '10px',
        });
        if (halfCells[2]) {
          Object.assign(halfCells[2].style, {
            minWidth: '0', overflow: 'hidden', fontSize: `${scoreSize}px`, lineHeight: '1',
          });
          // Each half sizes its own score. Looking the value up by its text found the first "3" of a 3–3 twice: the
          // second score of a draw kept the template size and its row cut it.
          Array.from(halfCells[2].querySelectorAll('*')).forEach((node) => Object.assign(node.style, {
            fontSize: `${scoreSize}px`, lineHeight: '1', whiteSpace: 'nowrap',
          }));
          halfCells[2].dataset.premiumScore = 'fitted';
        }
      });
      [match?.home?.name || match?.home?.teamName, match?.away?.name || match?.away?.teamName]
        .forEach((name) => fitTeamNameLeaf(leafWithText(row, name), {
          max: nameSize, min: nameMin, maxHeight: rowHeight,
        }));
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
    [match?.home?.name || match?.home?.teamName, match?.away?.name || match?.away?.teamName]
      .forEach((name) => fitTeamNameLeaf(leafWithText(row, name), {
        max: nameSize, min: nameMin, maxHeight: rowHeight,
      }));
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

// PREMIUM SPONSORS: a piece with a sponsor band gives the band its own room under the table. The rows must end where the
// table's frame ends (above the band's margin), not where the frame's viewport would let the body grow. The frame is
// anchored to the top first (as the flow below does anyway) so the body's top is where it will stay. Without a band this
// is Infinity and nothing is touched: those compositions keep their approved measurement.
function sponsorBandLimit(root, parent, frame) {
  if (!root.querySelector('[data-premium-sponsor-band]') || !frame || frame === parent) return Number.POSITIVE_INFINITY;
  Object.assign(frame.style, { justifyContent: 'flex-start', alignContent: 'start' });
  const scale = root.offsetWidth / (root.getBoundingClientRect().width || root.offsetWidth || 1);
  const paddingBottom = Number.parseFloat(getComputedStyle(frame).paddingBottom) || 0;
  // What the frame holds under the table (Disciplina's suspensions) keeps its room too.
  let below = 0;
  for (let node = parent; node && node !== frame; node = node.parentElement) {
    const holder = getComputedStyle(node.parentElement);
    const gap = holder.display.includes('flex') || holder.display.includes('grid') ? (Number.parseFloat(holder.rowGap) || 0) : 0;
    for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      const style = getComputedStyle(sibling);
      if (style.position === 'absolute' || style.position === 'fixed' || style.display === 'none') continue;
      below += sibling.getBoundingClientRect().height * scale + gap
        + (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
    }
  }
  const limit = (frame.getBoundingClientRect().bottom - parent.getBoundingClientRect().top) * scale - paddingBottom - below;
  return limit > 0 ? Math.floor(limit) : Number.POSITIVE_INFINITY;
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
  const availableBodyHeight = Math.min(
    Math.max(0, (measuredBodyHeight || fallbackBodyHeight) - footerSafetyInset),
    sponsorBandLimit(root, parent, flowFrame),
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
        scoreboard: rows.length <= 4 ? 118 : (rows.length <= 8 ? 104 : null),
        editorial: rows.length <= 4 ? 116 : (rows.length <= 8 ? 86 : null),
      }[themeId] ?? null)
      : null,
  });
  const { rowHeight } = metrics;
  // The template's own type size is the ceiling: the fit only ever shrinks a name that would escape its row.
  const templateFontSizes = nameLeaves.map((leaf) => (
    leaf ? Number.parseFloat(getComputedStyle(leaf).fontSize) : Number.NaN
  ));
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
    // A frame that only wraps the table (and its notes) inside a centering body would still float as a block.
    anchorAncestors(flowFrame, root, kind);
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
      const templateFontSize = templateFontSizes[index];
      let fittedFontSize = Number.isFinite(templateFontSize) && templateFontSize > 0
        ? Math.min(metrics.fontSizes[index], Math.round(templateFontSize))
        : metrics.fontSizes[index];
      // One measured line only where rows are too short to wrap (a dense Editorial page); a few tall rows wrap long
      // names instead of shrinking them below the rest of the table.
      const useSingleLineAutofit = kind === 'standings'
        && themeId === 'editorial'
        && formatId === 'portrait'
        && rows.length > 10;
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
    // The title block stays together over the compact hero; the player's identity and stats take the freed space
    // above them (spreading every child apart split multi-line titles such as Street's).
    if (hero.nextElementSibling) hero.nextElementSibling.style.marginTop = 'auto';
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
    // Names break between words only (they used to break at any letter): a long word shrinks the name instead.
    setLeafType(balance, match?.home?.name, { textAlign: 'right' });
    setLeafType(balance, match?.away?.name, { textAlign: 'left' });
    [match?.home?.name, match?.away?.name].forEach((name) => fitTeamNameLeaf(leafWithText(balance, name), { min: 18 }));
    balance.dataset.premiumFixtureBalance = 'true';
  });
}

// Team names of a match list (semifinals, next fixture) break between words only and shrink when a word does not fit.
function fitNamedLeaves(root, names, min) {
  const wanted = new Set(names.map(text).filter(Boolean));
  if (!wanted.size) return;
  Array.from(root.querySelectorAll('*'))
    .filter((node) => node.children.length === 0 && wanted.has(text(node.textContent)))
    .forEach((leaf) => fitTeamNameLeaf(leaf, { min }));
}

function fitMatchNames(root, matches) {
  fitNamedLeaves(root, matches.flatMap((match) => [
    match?.home?.name || match?.home?.teamName, match?.away?.name || match?.away?.teamName,
  ]), 18);
}

// A one-line display title ("SEMIFINALES" at the size the sample's shorter title had) that runs past the canvas is
// scaled down until it ends as far from the right edge as it starts from the left one. A title that fits is untouched.
function fitCanvasTitle(root, title) {
  const expected = text(title);
  if (!expected || typeof document.createRange !== 'function') return;
  // `root` is the composition itself: the 1080 px canvas.
  const canvas = root.getBoundingClientRect();
  if (!(canvas.width > 0)) return;
  Array.from(root.querySelectorAll('*'))
    .filter((node) => node.children.length === 0 && text(node.textContent) === expected)
    .forEach((leaf) => {
      const range = document.createRange();
      range.selectNodeContents(leaf);
      if (typeof range.getBoundingClientRect !== 'function') return;
      const run = () => range.getBoundingClientRect();
      if (run().right <= canvas.right + 1) return;
      const limit = canvas.right - Math.max(0, run().left - canvas.left);
      let size = Number.parseFloat(getComputedStyle(leaf).fontSize);
      for (let guard = 0; guard < 6 && run().right > limit + 1 && size > 24; guard += 1) {
        size = Math.max(24, Math.floor(size * ((limit - run().left) / (run().right - run().left))));
        leaf.style.fontSize = `${size}px`;
      }
      leaf.dataset.premiumTitleFit = String(Math.round(size));
    });
}

// Without a photo the Figura shows the player's first name, whole: it shrinks until it fits the frame that holds it
// (Editorial: inside the inner rule), never a three-letter stub that reads as a cut name.
function fitFigureName(root, name) {
  const expected = text(name);
  if (!expected) return;
  Array.from(root.querySelectorAll('*'))
    .filter((node) => node.children.length === 0 && text(node.textContent) === expected)
    // The display name only (180–230 px in the templates), never the player's name label (at most 82 px).
    .filter((node) => Number.parseFloat(getComputedStyle(node).fontSize) >= 150)
    .forEach((leaf) => {
      leaf.dataset.premiumFigureName = 'fit';
      leaf.style.whiteSpace = 'nowrap';
      let frame = leaf.parentElement;
      while (frame && frame !== root) {
        const style = getComputedStyle(frame);
        if (style.position === 'absolute' || style.overflow !== 'visible' || style.borderTopStyle !== 'none') break;
        frame = frame.parentElement;
      }
      if (!frame || frame === root || typeof document.createRange !== 'function') return;
      const range = document.createRange();
      range.selectNodeContents(leaf);
      if (typeof range.getBoundingClientRect !== 'function') return;
      const frameStyle = getComputedStyle(frame);
      const box = frame.getBoundingClientRect();
      const scale = box.width / (frame.offsetWidth || box.width || 1);
      const inset = (Number.parseFloat(frameStyle.paddingLeft) || 0) + (Number.parseFloat(frameStyle.borderLeftWidth) || 0);
      const insetRight = (Number.parseFloat(frameStyle.paddingRight) || 0) + (Number.parseFloat(frameStyle.borderRightWidth) || 0);
      // A margin of 6 % of the frame on each side keeps an italic or skewed face clear of the frame's edge.
      const margin = box.width * 0.06;
      const left = box.left + inset * scale + margin;
      const right = box.right - insetRight * scale - margin;
      let size = Number.parseFloat(getComputedStyle(leaf).fontSize);
      for (let guard = 0; guard < 8 && size > 40; guard += 1) {
        const run = range.getBoundingClientRect();
        if (run.width <= 0 || (run.left >= left - 1 && run.right <= right + 1)) break;
        size = Math.max(40, Math.floor(size * Math.min(0.97, (right - left) / run.width)));
        leaf.style.fontSize = `${size}px`;
      }
      leaf.dataset.premiumFigureNameSize = String(Math.round(size));
    });
}

function hardenHeritageSemifinalScores(root, matches) {
  const used = new Set();
  matches.slice(0, 2).forEach((match) => {
    const result = match?.result || match?.score;
    if (!result) return;
    const score = `${result.homeScore ?? result.home} - ${result.awayScore ?? result.away}`;
    // Two semifinals with the same score: each match takes its own leaf.
    const leaf = Array.from(root.querySelectorAll('*')).find((node) => (
      node.children.length === 0 && text(node.textContent) === score && !used.has(node)
    ));
    if (leaf) {
      used.add(leaf);
      leaf.style.color = '#EFE6D8';
      leaf.dataset.premiumContrast = 'heritage-score';
    }
  });
}

// Match lists (results, next fixture, semifinals) with only a few entries: each entry keeps the height it has on a full
// list and the list starts right under the title, instead of floating in the middle of the canvas or stretching every
// entry into a band. Only wrappers between the list and the canvas body are re-anchored; the page column that places
// the header and the footer is never touched.
// [floor, ceiling] of an entry's height. The ceiling is the height an entry has on a full list (four results, a round
// of fixtures, both semifinals): up to it, the entry is left exactly as the template draws it. A taller, stretched
// entry shrinks to its own content, never below the floor (it keeps the presence of an entry of a full list).
const SPARSE_MATCH_HEIGHT = Object.freeze({
  round_results: { portrait: [250, 250], story: [STORY_RESULT_MAX_ROW_HEIGHT, STORY_RESULT_MAX_ROW_HEIGHT] },
  next_fixture: { portrait: [250, 250], story: [STORY_RESULT_MAX_ROW_HEIGHT, STORY_RESULT_MAX_ROW_HEIGHT] },
  semifinals: { portrait: [200, 330], story: [260, 460] },
});
const DISTRIBUTED = /center|space-|end/;

function anchorTop(node, kind) {
  const style = getComputedStyle(node);
  let changed = false;
  if (style.display.includes('flex') && style.flexDirection.startsWith('column') && DISTRIBUTED.test(style.justifyContent)) {
    const spread = style.justifyContent.startsWith('space-');
    node.style.justifyContent = 'flex-start';
    // Entries that were separated by the distributed space keep a separation of their own.
    if (spread && !(Number.parseFloat(style.rowGap) > 0)) node.style.rowGap = '18px';
    changed = true;
  }
  if (style.display.includes('grid') && DISTRIBUTED.test(style.alignContent)) {
    node.style.alignContent = 'start';
    changed = true;
  }
  if (changed) node.dataset.premiumSparseAnchor = kind;
  return style;
}

// The entry of one match: the smallest box holding both team names, widened only to wrappers that hold nothing else
// and stay well below the canvas (never the body frame of a one-match list).
function entryForMatch(root, match, unused) {
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
    && withinEntrySize(root, row.parentElement)
  ) row = row.parentElement;
  unused.add(row);
  return row;
}

function anchorMatchList(root, matches, kind, formatId) {
  if (!matches.length) return;
  const unused = new Set();
  const rows = matches.map((match) => entryForMatch(root, match, unused)).filter(Boolean);
  if (rows.length !== matches.length) return;
  let parent;
  let items;
  if (rows.length === 1) {
    items = rows;
    parent = rows[0].parentElement;
  } else {
    parent = commonParent(rows);
    items = rows.map((row) => {
      let item = row;
      while (item.parentElement && item.parentElement !== parent) item = item.parentElement;
      return item;
    });
    if (new Set(items).size !== items.length) return;
  }
  if (!parent || parent === root) return;
  const [minHeight, maxHeight] = SPARSE_MATCH_HEIGHT[kind][formatId === 'story' ? 'story' : 'portrait'];
  const parentStyle = getComputedStyle(parent);
  items.forEach((item) => {
    const stretched = item.offsetHeight;
    if (stretched <= maxHeight) return;
    // The entry's own content height, measured with nothing stretching it.
    const saved = item.getAttribute('style');
    Object.assign(item.style, { flex: '0 0 auto', height: 'auto', minHeight: '0', maxHeight: 'none' });
    const natural = item.offsetHeight;
    if (saved === null) item.removeAttribute('style'); else item.setAttribute('style', saved);
    const target = Math.min(maxHeight, Math.max(natural, minHeight));
    Object.assign(item.style, {
      flex: '0 0 auto',
      height: `${target}px`,
      minHeight: '0',
      maxHeight: `${target}px`,
      boxSizing: 'border-box',
    });
    item.dataset.premiumSparseItem = kind;
  });
  if (parentStyle.display.includes('grid')) {
    // Equal fractional tracks spread a short list over the whole body: tracks follow the entries instead.
    parent.style.gridTemplateRows = 'none';
    parent.style.gridAutoRows = 'auto';
  }
  anchorTop(parent, kind);
  parent.dataset.premiumSparseList = kind;
  parent.dataset.rowCount = String(items.length);
  // A column beside the list (the date of the round next to its matches) starts where the list starts, whether it
  // sits next to the list or inside it, next to the entries.
  const besideList = Array.from(parent.parentElement?.children || []).filter((sibling) => (
    sibling !== parent && Math.abs(sibling.offsetHeight - parent.offsetHeight) <= 4 && sibling.offsetLeft !== parent.offsetLeft
  ));
  const besideEntries = Array.from(parent.children).filter((child) => (
    !items.includes(child) && child.offsetHeight >= parent.offsetHeight - 4
  ));
  [...besideList, ...besideEntries].forEach((column) => anchorTop(column, kind));
  // A list centered across a grid track or a row of columns starts at the top of that track.
  const outer = parent.parentElement ? getComputedStyle(parent.parentElement) : null;
  if (outer && (outer.display.includes('grid') || (outer.display.includes('flex') && outer.flexDirection.startsWith('row')))
    && /center|end/.test(parentStyle.alignSelf === 'auto' ? outer.alignItems : parentStyle.alignSelf)) {
    parent.style.alignSelf = 'start';
    parent.dataset.premiumSparseAnchor = kind;
  }
  // A list drawn on its own panel (a dark card under the title) wraps its entries instead of stretching an empty
  // panel down to the footer.
  const ownBackground = rgba(parentStyle.backgroundColor);
  const paintsPanel = (ownBackground && ownBackground.a > 0.01) || parentStyle.backgroundImage !== 'none'
    || parentStyle.clipPath !== 'none';
  if (paintsPanel) {
    const stretched = parent.offsetHeight;
    const saved = parent.getAttribute('style');
    Object.assign(parent.style, { flex: '0 0 auto', height: 'auto', minHeight: '0' });
    const natural = parent.offsetHeight;
    if (natural < stretched * 0.7) {
      // A cut-out panel (a clip-path with a jagged edge) keeps its entries clear of the edges it cuts.
      if (parentStyle.clipPath !== 'none') {
        parent.style.paddingTop = `${(Number.parseFloat(parentStyle.paddingTop) || 0) + 56}px`;
        parent.style.paddingBottom = `${(Number.parseFloat(parentStyle.paddingBottom) || 0) + 40}px`;
      }
      parent.dataset.premiumSparsePanel = kind;
    } else if (saved === null) parent.removeAttribute('style');
    else parent.setAttribute('style', saved);
  }
  anchorAncestors(parent, root, kind);
  clearTitle(root, parent, items, kind);
}

// Wrappers that hold nothing but the list, up to the body frame that grows to fill the canvas (included): each starts
// its content at the top. The page column that places the header and the footer is above that frame, never touched.
function anchorAncestors(node, root, kind) {
  for (let current = node.parentElement; current && current !== root; current = current.parentElement) {
    if (current.children.length !== 1) break;
    const style = anchorTop(current, kind);
    if (Number.parseFloat(style.flexGrow) > 0) break;
  }
}

// Some compositions let the title overlap the top of the body on purpose (a badge over a panel): a list that now
// starts at the top of the body is pushed just below the lowest line of the title it would touch.
function clearTitle(root, list, items, kind) {
  const first = items[0]?.getBoundingClientRect();
  if (!first || !(first.height > 0)) return;
  let titleBottom = Number.NEGATIVE_INFINITY;
  root.querySelectorAll('*').forEach((node) => {
    if (node.children.length || list.contains(node) || !text(node.textContent)) return;
    const box = node.getBoundingClientRect();
    if (!(box.height > 0) || box.top >= first.top || box.bottom <= first.top) return;
    if (box.right <= first.left || box.left >= first.right) return;
    titleBottom = Math.max(titleBottom, box.bottom);
  });
  if (!Number.isFinite(titleBottom)) return;
  const scale = root.getBoundingClientRect().height / (root.offsetHeight || 1) || 1;
  const push = Math.ceil((titleBottom - first.top) / scale) + 18;
  list.style.paddingTop = `${(Number.parseFloat(getComputedStyle(list).paddingTop) || 0) + push}px`;
  list.dataset.premiumSparseClearTitle = kind;
}

// PREMIUM SPONSORS: a panel the composition gives a fixed minimum height (Figura's photo and its stats) can still reach
// into the band. Its minimum gives way by exactly what crosses the band's top margin, outermost panel first, so the
// panel keeps its proportions and nothing is drawn under the logos. Pieces without a band never get here.
function reflowAboveSponsorBand(root) {
  const band = root.querySelector('[data-premium-sponsor-band]');
  if (!band) return;
  const scale = root.offsetWidth / (root.getBoundingClientRect().width || root.offsetWidth || 1);
  const inFlow = (node) => {
    for (let current = node; current && current !== root; current = current.parentElement) {
      const { position } = getComputedStyle(current);
      if (position === 'absolute' || position === 'fixed') return false;
    }
    return true;
  };
  for (let pass = 0; pass < 4; pass += 1) {
    const limit = band.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(band).marginTop) || 0) / scale;
    const crossing = Array.from(root.querySelectorAll('*')).filter((node) => {
      if (band.contains(node) || node.contains(band)) return false;
      const box = node.getBoundingClientRect();
      return box.height > 0 && box.top < limit && box.bottom > limit + 0.5 && inFlow(node);
    });
    if (!crossing.length) break;
    const over = Math.ceil((Math.max(...crossing.map((node) => node.getBoundingClientRect().bottom)) - limit) * scale);
    const panel = crossing.find((node) => Number.parseFloat(node.style.minHeight) > 0);
    if (!panel) break;
    panel.style.minHeight = `${Math.max(0, Number.parseFloat(panel.style.minHeight) - over)}px`;
    panel.dataset.premiumSponsorReflow = String(over);
  }
  // A column of fixed-size panels (Figura in Historia) is pushed past the canvas by the band instead: the panel above
  // the band with the most room to spare inside it gives up exactly the overflow, so the footer stays on the canvas.
  const column = band.parentElement;
  const overflow = column ? Math.ceil(column.scrollHeight - column.clientHeight) : 0;
  if (!(overflow > 0)) return;
  const spare = (node) => {
    const box = node.getBoundingClientRect();
    const inside = Array.from(node.querySelectorAll('*')).map((child) => child.getBoundingClientRect())
      .filter((child) => child.height > 0);
    if (!inside.length) return 0;
    const top = Math.min(...inside.map((child) => child.top));
    const bottom = Math.max(...inside.map((child) => child.bottom));
    return ((box.height - (bottom - top)) * scale);
  };
  const panels = [];
  for (let node = band.previousElementSibling; node; node = node.previousElementSibling) {
    const basis = (node.style.flex || '').match(/^0 0 (\d+(?:\.\d+)?)px$/);
    if (basis && inFlow(node)) panels.push({ node, basis: Number(basis[1]), room: spare(node) });
  }
  const panel = panels.filter((entry) => entry.room >= overflow + 8).sort((a, b) => b.room - a.room)[0];
  if (!panel) return;
  const size = `${panel.basis - overflow}px`;
  Object.assign(panel.node.style, { flex: `0 0 ${size}`, height: size, minHeight: size });
  panel.node.dataset.premiumSponsorReflow = String(overflow);
}

export function applyPremiumLayoutHardening(root, {
  snapshot,
  editorial = {},
  themeId,
  formatId,
  pagination = null,
  figureName = '',
  figureTeamName = '',
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
    anchorMatchList(root, official.matches || [], 'round_results', formatId);
    // The feed keeps the template's sizes; a name with a word wider than its cell shrinks instead of breaking it.
    if (formatId !== 'story') fitMatchNames(root, official.matches || []);
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
  } else if (piece === 'next_fixture') {
    if (themeId === 'editorial') hardenEditorialFixtures(root, official.matches || []);
    anchorMatchList(root, official.matches || [], 'next_fixture', formatId);
    fitMatchNames(root, official.matches || []);
  } else if (piece === 'semifinals') {
    if (themeId === 'heritage') hardenHeritageSemifinalScores(root, official.matches || []);
    anchorMatchList(root, official.matches || [], 'semifinals', formatId);
    fitMatchNames(root, official.matches || []);
  } else if (piece === 'mvp') {
    hardenNoPhotoFigure(root, themeId, formatId);
    fitFigureName(root, figureName);
    fitNamedLeaves(root, [figureTeamName], 18);
  } else if (piece === 'best_eleven') {
    // Player names on the pitch break between words too ("Santiago Roldán", never "Santia/go").
    fitNamedLeaves(root, (official.candidates || []).map((player) => player?.name), 12);
  }
  fitCanvasTitle(root, PREMIUM_PIECE_TITLES[piece]?.[0]);
  if (piece === 'standings' && themeId === 'editorial') {
    hardenEditorialPagination(root, pagination, formatId);
  }
  reflowAboveSponsorBand(root);
  return root;
}
