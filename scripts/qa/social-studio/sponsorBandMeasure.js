// Measures a Premium composition in export pixels (1080 wide), whatever the preview scale: the sponsor band, its label,
// tiles and the logo each tile really draws (object-fit: contain), and what the band would break — text or rows that
// overlap it and text cut by the canvas or by a clipping box. Shared by the Studio harness (offline.jsx) and the band
// matrix (sponsor-band.jsx); browser-check.cjs reads it as `window.__measurePremium(root)`.

function textRects(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    const parent = node.parentElement;
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) continue;
    const left = Math.min(...rects.map((r) => r.left)); const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right)); const bottom = Math.max(...rects.map((r) => r.bottom));
    found.push({ value, parent, rect: { left, top, right, bottom } });
  }
  return found;
}

// How far (screen px) a text box runs out of the nearest box that clips it; 0 when nothing cuts it.
function clippedBy(element, rect, root) {
  let excess = 0;
  for (let node = element; node && node !== root.parentElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    const clipsX = style.overflowX !== 'visible'; const clipsY = style.overflowY !== 'visible';
    if (!clipsX && !clipsY) continue;
    const box = node.getBoundingClientRect();
    if (clipsY) excess = Math.max(excess, box.top - rect.top, rect.bottom - box.bottom);
    if (clipsX) excess = Math.max(excess, box.left - rect.left, rect.right - box.right);
  }
  return excess > 1.5 ? excess : 0;
}

export function measurePremium(root) {
  const box = root.getBoundingClientRect();
  const k = root.offsetWidth / box.width;
  const rel = (r) => ({
    x: Math.round((r.left - box.left) * k), y: Math.round((r.top - box.top) * k),
    w: Math.round((r.right - r.left) * k), h: Math.round((r.bottom - r.top) * k),
  });
  const canvas = { w: root.offsetWidth, h: root.offsetHeight };
  const band = root.querySelector('[data-premium-sponsor-band]');
  const bandRect = band ? band.getBoundingClientRect() : null;
  const tiles = [...root.querySelectorAll('[data-premium-sponsor-tile]')].map((tile) => {
    const image = tile.querySelector('img');
    const frame = image.getBoundingClientRect();
    const nw = image.naturalWidth || 1; const nh = image.naturalHeight || 1;
    const scale = Math.min(frame.width / nw, frame.height / nh);
    const dw = nw * scale; const dh = nh * scale;
    const drawn = {
      left: frame.left + (frame.width - dw) / 2, top: frame.top + (frame.height - dh) / 2,
      right: frame.left + (frame.width + dw) / 2, bottom: frame.top + (frame.height + dh) / 2,
    };
    return {
      name: image.alt, tone: tile.dataset.tone || null, tile: rel(tile.getBoundingClientRect()),
      logoBox: rel(frame), logo: rel(drawn), background: getComputedStyle(tile).backgroundColor,
    };
  });
  const labelNode = root.querySelector('[data-premium-sponsor-label]');
  const label = labelNode ? {
    text: labelNode.textContent.trim(), box: rel(labelNode.getBoundingClientRect()),
    fontSize: Number.parseFloat(getComputedStyle(labelNode).fontSize), color: getComputedStyle(labelNode).color,
  } : null;
  const texts = textRects(root);
  const inBand = (element) => Boolean(band && band.contains(element));
  const intersects = (r) => bandRect && r.left < bandRect.right - 1 && r.right > bandRect.left + 1
    && r.top < bandRect.bottom - 1 && r.bottom > bandRect.top + 1;
  const overlaps = [];
  texts.filter((entry) => !inBand(entry.parent) && intersects(entry.rect))
    .forEach((entry) => overlaps.push({ text: entry.value.slice(0, 40), box: rel(entry.rect) }));
  // Boxes too (a photo frame, a row, a panel): any in-flow element that is neither the band, inside it, nor one of its
  // ancestors. Absolutely positioned layers are the compositions' decoration (stripes, grain) and may run under it.
  if (band) {
    [...root.querySelectorAll('*')].filter((node) => !inBand(node) && !node.contains(band))
      .filter((node) => {
        for (let current = node; current && current !== root; current = current.parentElement) {
          const position = getComputedStyle(current).position;
          if (position === 'absolute' || position === 'fixed') return false;
        }
        return true;
      })
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && intersects(rect))
      .forEach(({ node, rect }) => overlaps.push({
        element: node.dataset.premiumRow ? `row:${node.dataset.premiumRow}` : node.tagName.toLowerCase(), box: rel(rect),
      }));
  }
  const clipped = texts.map((entry) => {
    const excess = Math.max(
      entry.rect.bottom - box.bottom, box.top - entry.rect.top, clippedBy(entry.parent, entry.rect, root),
    );
    return excess > 1.5 ? { text: entry.value.slice(0, 40), box: rel(entry.rect), by: Math.round(excess * k) } : null;
  }).filter(Boolean);
  const rows = [...root.querySelectorAll('[data-premium-row]')].map((row) => rel(row.getBoundingClientRect()));
  const lastRowBottom = rows.length ? Math.max(...rows.map((row) => row.y + row.h)) : null;
  const composition = root.firstElementChild;
  return {
    canvas,
    band: band ? { count: Number(band.dataset.premiumSponsorBand), box: rel(bandRect) } : null,
    label,
    tiles,
    rows: rows.length,
    rowHeight: rows.length ? Math.min(...rows.map((row) => row.h)) : null,
    lastRowBottom,
    overlaps,
    clipped,
    overflowY: composition ? Math.max(0, composition.scrollHeight - composition.clientHeight) : 0,
  };
}

if (typeof window !== 'undefined') window.__measurePremium = measurePremium;
