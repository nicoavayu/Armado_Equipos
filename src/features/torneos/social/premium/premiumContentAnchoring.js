import { resolveEditorialStandingsPagination } from './premiumPagination';

// How many items each list layout was drawn for, per format. A shorter list keeps the rhythm of a full one: no item
// grows taller than it would with this many items. 0 = the items keep their natural height (a bracket is always
// complete, so a semifinal tie is never stretched to fill the art).
export const PREMIUM_LIST_CAPACITY = Object.freeze({
  round_results: Object.freeze({ portrait: 4, story: 4 }),
  next_fixture: Object.freeze({ portrait: 4, story: 4 }),
  standings: Object.freeze({ portrait: 8, story: 12 }),
  scorers: Object.freeze({ portrait: 8, story: 10 }),
  discipline: Object.freeze({ portrait: 8, story: 10 }),
  semifinals: Object.freeze({ portrait: 0, story: 0 }),
});

const PULLS_DOWN = /center|end|space-/;

function norm(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

// The names that identify each official item on the art: a team, a player, or both sides of a match. The discipline
// table lists each player's club (its recap of suspended players, lower on the art, lists the players themselves).
function itemKeys(piece, official) {
  if (piece === 'standings') return (official.rows || []).map((row) => [row.teamName || row.team?.name || row.name]);
  if (piece === 'scorers') return (official.players || []).map((player) => [player.name]);
  if (piece === 'discipline') {
    return (official.players || []).map((player) => [player.team?.name || player.teamName || player.name]);
  }
  return (official.matches || []).map((match) => [
    match.home?.name || match.home?.teamName,
    match.away?.name || match.away?.teamName,
  ]);
}

// The smallest element carrying all the item's names. A wrapper holding nothing but the item (a frame with a single
// card) reads the same, so on equal text the deepest element wins. Between separate elements the first in reading
// order wins: the list comes before any recap of the same names lower on the art (the suspended players).
function locate(art, keys, taken) {
  const wanted = keys.map(norm).filter(Boolean);
  if (!wanted.length) return null;
  let best = null;
  let bestLength = Infinity;
  for (const element of art.querySelectorAll('*')) {
    if (taken.some((used) => used === element || used.contains(element) || element.contains(used))) continue;
    const content = norm(element.textContent);
    if (content.length > bestLength || !wanted.every((key) => content.includes(key))) continue;
    if (content.length === bestLength && !best.contains(element)) continue;
    best = element;
    bestLength = content.length;
  }
  return best;
}

function commonAncestor(elements) {
  const holdsAll = (candidate) => elements.every((element) => candidate.contains(element));
  let ancestor = elements[0]?.parentElement || null;
  while (ancestor && !holdsAll(ancestor)) ancestor = ancestor.parentElement;
  return ancestor;
}

function isColumn(style) {
  return style.display.includes('flex') && style.flexDirection.startsWith('column');
}

function growsInColumn(element) {
  const parent = element.parentElement;
  return Boolean(parent) && isColumn(getComputedStyle(parent))
    && Number.parseFloat(getComputedStyle(element).flexGrow) > 0;
}

// The piece's title: the biggest type on the art. The body of the piece is everything under it.
function titleOf(art, leaves) {
  let title = null;
  let size = 0;
  for (const element of art.querySelectorAll('*')) {
    if (element.children.length || !element.textContent.trim()) continue;
    if (leaves.some((leaf) => leaf.contains(element))) continue;
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || 0;
    if (fontSize > size) {
      size = fontSize;
      title = element;
    }
  }
  return title;
}

// Where the body starts and how far the pass may climb from an item: `stop` is the first ancestor that also holds the
// title (never touched); `frame` is the body section right under it when that section fills the art's remaining
// height. The frame keeps filling (the footer stays in place); only the alignment inside it changes.
function bodyBounds(leaf, art, title) {
  let stop = art;
  for (let element = leaf.parentElement; element && element !== art; element = element.parentElement) {
    if (title && element.contains(title)) {
      stop = element;
      break;
    }
  }
  let section = leaf;
  while (section.parentElement && section.parentElement !== stop) section = section.parentElement;
  return { stop, frame: section !== leaf && growsInColumn(section) ? section : null };
}

/**
 * Sparse pieces start under their header, exactly where a full list starts.
 *
 * The Premium layouts were drawn for a full round. With fewer items their frames centred the block, or stretched each
 * item to fill the art. On the ATTACHED art (it needs real layout; see settlePremiumDomLayout), this anchors the list
 * to the top of its frame and lets no item grow beyond the height it would have in a list of the layout's capacity.
 * Padding, gaps and type stay the theme's own. Fixed compositions (final, champion, figure, team, summary) and lists
 * that reach their capacity are left exactly as drawn. Preview and export share the node, so both get the same art.
 */
export function anchorPremiumContent(node, {
  snapshot,
  editorial = {},
  themeId,
  formatId,
} = {}) {
  const piece = snapshot?.piece;
  const capacity = PREMIUM_LIST_CAPACITY[piece]?.[formatId];
  if (capacity === undefined || !node?.isConnected) return null;
  const rendered = piece === 'standings'
    ? resolveEditorialStandingsPagination(snapshot, editorial, themeId).snapshot
    : snapshot;
  const keys = itemKeys(piece, rendered?.official || {});
  const art = node.firstElementChild || node;
  const leaves = [];
  for (const itemKey of keys) {
    const leaf = locate(art, itemKey, leaves);
    if (leaf) leaves.push(leaf);
  }
  if (!leaves.length) return null;
  const title = titleOf(art, leaves);
  const { stop, frame } = bodyBounds(leaves[0], art, title);
  const ceiling = frame || stop;

  // Items that stretch: elements between an item and the body frame that grow inside a column (the rows or cards, and
  // a list that grows to push them apart). The frame itself keeps filling the art.
  const sparse = capacity === 0 || leaves.length < capacity;
  const groups = new Map();
  if (sparse) {
    for (const leaf of leaves) {
      for (let element = leaf; element && element !== ceiling && element !== art; element = element.parentElement) {
        if (!growsInColumn(element)) continue;
        const siblings = groups.get(element.parentElement) || new Set();
        siblings.add(element);
        groups.set(element.parentElement, siblings);
      }
    }
  }
  // The list: what holds every item. With one item, the column it stretched in (or, if nothing stretched, the frame).
  let list = leaves.length > 1 ? commonAncestor(leaves) : null;
  if (!list) {
    let item = null;
    for (let element = leaves[0]; element && element !== ceiling; element = element.parentElement) {
      if (growsInColumn(element)) { item = element; break; }
    }
    list = item ? item.parentElement : (frame || leaves[0].parentElement);
  }
  if (!list || !art.contains(list) || (stop !== art && !stop.contains(list))) return null;

  // Measure everything first, then write: one layout pass, and every height comes from the art as drawn.
  const plans = [];
  for (const siblings of groups.values()) {
    const count = siblings.size;
    for (const element of siblings) {
      const height = element.offsetHeight;
      const target = capacity > count && height > 0 ? Math.floor((height * count) / capacity) : 0;
      plans.push([element, target]);
    }
  }
  const anchors = [];
  for (let element = list; element && element !== stop && element !== art; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (isColumn(style) && PULLS_DOWN.test(style.justifyContent)) anchors.push([element, 'justifyContent', 'flex-start']);
    if (style.display.includes('grid') && PULLS_DOWN.test(style.alignContent)) anchors.push([element, 'alignContent', 'start']);
    if (element === frame) break;
  }
  if (!sparse && !anchors.length) return null;
  anchors.forEach(([element, property, value]) => { element.style[property] = value; });
  plans.forEach(([element, target]) => {
    element.style.flexGrow = '0';
    element.style.flexBasis = 'auto';
    if (target) element.style.minHeight = `${target}px`;
  });
  art.dataset.premiumAnchored = sparse ? 'sparse' : 'top';
  return { items: leaves.length, capacity, anchored: anchors.length, unstretched: plans.length };
}
