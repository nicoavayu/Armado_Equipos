import { rowLayout } from '../features/torneos/social/base/core';
import { anchorPremiumContent, PREMIUM_LIST_CAPACITY } from '../features/torneos/social/premium/premiumContentAnchoring';
import { applyPremiumLayoutHardening } from '../features/torneos/social/premium/premiumLayoutHardening';

// A Premium art the way the generated layouts build it: a column with the title on top and a body frame that fills the
// rest of the art and (in several themes) centres its content; the rows grow to fill it.
function art({ names, frameJustify = 'center', rowsGrow = true, connected = true }) {
  const node = document.createElement('div');
  node.innerHTML = `
    <div data-art style="display:flex;flex-direction:column;height:1350px">
      <div data-wrapper style="display:flex;flex-direction:column;height:1350px">
        <div style="font-size:148px">TABLA</div>
        <div data-frame style="flex:1 1 0%;display:flex;flex-direction:column;justify-content:${frameJustify}">
          <div data-list style="display:flex;flex-direction:column">
            ${names.map((name) => `<div data-row style="${rowsGrow ? 'flex:1 1 0%;' : ''}display:grid"><span>1</span><span>${name}</span><span>9</span></div>`).join('')}
          </div>
        </div>
        <div data-footer style="font-size:20px">Copa Horizonte</div>
      </div>
    </div>`;
  if (connected) document.body.appendChild(node);
  const pick = (selector) => node.querySelector(selector);
  return { node, art: pick('[data-art]'), frame: pick('[data-frame]'), list: pick('[data-list]'), rows: [...node.querySelectorAll('[data-row]')] };
}
const standings = (names) => ({ piece: 'standings', official: { rows: names.map((teamName) => ({ teamName })) } });

afterEach(() => { document.body.replaceChildren(); });

describe('Social Studio sparse pieces start under their header', () => {
  test('Base lists are anchored on top: the first row never moves with the number of rows', () => {
    const box = { x: 60, y: 300, w: 960, h: 900 };
    for (const n of [1, 2, 3, 4, 6]) expect(rowLayout(box, n, { min: 92, max: 240, gap: 12 }).y).toBe(300);
    // A short list keeps its capped rhythm and leaves the rest of the art below it.
    const short = rowLayout(box, 2, { min: 92, max: 240, gap: 12 });
    expect(short.h).toBe(240);
    expect(short.total).toBeLessThan(box.h);
  });

  test('a sparse Premium table anchors its frame on top and stops stretching its rows', () => {
    const { node, art: root, frame, rows } = art({ names: ['Alfa FC', 'Beta FC'] });
    const result = anchorPremiumContent(node, { snapshot: standings(['Alfa FC', 'Beta FC']), themeId: 'heritage', formatId: 'portrait' });
    expect(result).toMatchObject({ items: 2, capacity: PREMIUM_LIST_CAPACITY.standings.portrait });
    expect(frame.style.justifyContent).toBe('flex-start');
    rows.forEach((row) => expect(row.style.flexGrow).toBe('0'));
    // The frame keeps filling the art: the footer stays at the bottom.
    expect(frame.style.flexGrow).toBe('1');
    expect(root.dataset.premiumAnchored).toBe('sparse');
  });

  test('a single item never shrinks the frame that holds only it (it reads like the item)', () => {
    const { node, frame, list, rows } = art({ names: ['Alfa FC'] });
    anchorPremiumContent(node, { snapshot: standings(['Alfa FC']), themeId: 'street', formatId: 'story' });
    expect(frame.style.flexGrow).toBe('1');
    expect(frame.style.justifyContent).toBe('flex-start');
    expect(rows[0].style.flexGrow).toBe('0');
    expect(list.style.flexGrow).toBe('');
  });

  test('a list at its capacity keeps the theme rhythm and is only anchored', () => {
    const names = Array.from({ length: 8 }, (_unused, index) => `Club ${index + 1}`);
    const { node, art: root, frame, rows } = art({ names });
    anchorPremiumContent(node, { snapshot: standings(names), themeId: 'heritage', formatId: 'portrait' });
    expect(frame.style.justifyContent).toBe('flex-start');
    rows.forEach((row) => expect(row.style.flexGrow).toBe('1'));
    expect(root.dataset.premiumAnchored).toBe('top');
  });

  test('fixed compositions and detached art are left exactly as drawn', () => {
    const fixed = art({ names: ['Alfa FC', 'Beta FC'] });
    expect(anchorPremiumContent(fixed.node, { snapshot: { piece: 'final', official: {} }, themeId: 'heritage', formatId: 'portrait' })).toBeNull();
    expect(fixed.frame.style.justifyContent).toBe('center');
    const detached = art({ names: ['Alfa FC', 'Beta FC'], connected: false });
    expect(anchorPremiumContent(detached.node, { snapshot: standings(['Alfa FC', 'Beta FC']), themeId: 'heritage', formatId: 'portrait' })).toBeNull();
    expect(detached.frame.style.justifyContent).toBe('center');
  });

  test('Story results keep the rhythm of a four-match round and a single match never sizes the body frame', () => {
    const match = (index) => ({ home: { name: `Local ${index}` }, away: { name: `Visita ${index}` }, result: { homeScore: index, awayScore: 0 } });
    const build = (count) => {
      const root = document.createElement('div');
      root.innerHTML = `
        <div style="display:flex;flex-direction:column">
          <div style="font-size:148px">RESULTADOS</div>
          <div data-frame style="flex:1 1 0%;display:flex;flex-direction:column;justify-content:center">
            ${Array.from({ length: count }, (_unused, index) => `<div data-card style="flex:1 1 0%;min-height:230px;display:grid"><span>Local ${index}</span><span>${index} - 0</span><span>Visita ${index}</span></div>`).join('')}
          </div>
          <div>Copa Horizonte</div>
        </div>`;
      return root;
    };
    for (const count of [1, 2, 4]) {
      const root = build(count);
      applyPremiumLayoutHardening(root, {
        snapshot: { piece: 'round_results', official: { matches: Array.from({ length: count }, (_unused, index) => match(index)) } },
        themeId: 'heritage',
        formatId: 'story',
      });
      const cards = [...root.querySelectorAll('[data-card]')];
      // Detached art: the hardening uses its 1100 px body; four slots of (1100 − 40 − 3 × 18) / 4.
      cards.forEach((card) => expect(card.style.height).toBe('251px'));
      expect(root.querySelector('[data-frame]').style.height).toBe('');
    }
  });
});
