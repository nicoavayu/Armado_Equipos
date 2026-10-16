// The sponsor band matrix (`/sponsor-band.html` of the offline harness): every Premium composition, rendered by the
// real DOM renderer exactly as the Studio prepares it (fonts first, each logo turned into a bitmap first), with 0–3 of
// the harness's fictional sponsors, and measured in export pixels by sponsorBandMeasure.js. browser-check.cjs drives it
// through `window.__sponsorBand.render(spec)`; nothing here talks to a network.
import '../../../src/styles.css';
import {
  createPremiumDomRender,
  ensurePremiumSocialFonts,
  premiumDomToPngBlob,
  releasePremiumDomRender,
  waitForPremiumDomAssets,
} from '../../../src/features/torneos/social/premiumRenderer';
import { SOCIAL_FORMATS, createEditorialState } from '../../../src/features/torneos/social/socialContracts';
import { socialQaSelection, socialQaSnapshot, socialQaTeam } from '../../../src/testUtils/socialStudioSnapshots';
import { measurePremium } from './sponsorBandMeasure';
import logoTornillo from './sponsor-logos/ferreteria-el-tornillo.png';
import logoEspiga from './sponsor-logos/panaderia-la-espiga.png';
import logoFenix from './sponsor-logos/gimnasio-fenix.png';
import logoFaro from './sponsor-logos/libreria-el-faro.png';

const LOGOS = [
  ['70000000-0000-4000-8000-000000000001', 'Ferretería El Tornillo', logoTornillo],
  ['70000000-0000-4000-8000-000000000002', 'Panadería La Espiga', logoEspiga],
  ['70000000-0000-4000-8000-000000000003', 'Gimnasio Fénix', logoFenix],
  ['70000000-0000-4000-8000-000000000004', 'Librería El Faro', logoFaro],
];
// `light` is a logo drawn in white on a transparent background (the case E2E demo D4 reported): the band must give it
// a dark tile so it still reads.
function lightLogo() {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 420;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(200, 210, 150, 0, Math.PI * 2); ctx.fill();
  ctx.font = '700 150px Arial, sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText('NIEVE', 420, 215);
  return new Promise((resolve) => { canvas.toBlob(resolve, 'image/png'); });
}

async function bitmap(source) {
  const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
  return createImageBitmap(blob);
}

async function sponsorsFor(count, { light = false } = {}) {
  const entries = await Promise.all(LOGOS.slice(0, count).map(async ([id, name, url]) => ({ id, name, image: await bitmap(url) })));
  if (light && entries.length) entries[entries.length - 1] = { id: 'light', name: 'Heladería Nieve', image: await bitmap(await lightLogo()) };
  return entries;
}

// `matches`: "eight" gives a round of eight results (Feed 4:5 switches to its dense layout), "long" four results with the
// longest club names of the fixture (Feed 4:5 switches to its long-name layout).
function withMatches(snapshot, matches) {
  const list = snapshot.official?.matches;
  if (!matches || !list?.length) return snapshot;
  const pairs = matches === 'eight'
    ? Array.from({ length: 8 }, (_unused, index) => [index * 2, index * 2 + 1])
    : [[6, 4], [0, 6], [4, 2], [1, 3]];
  const built = pairs.map(([home, away], index) => ({
    ...list[index % list.length],
    id: `m-${matches}-${index + 1}`,
    matchNumber: index + 1,
    home: socialQaTeam(home),
    away: socialQaTeam(away),
  }));
  return { ...snapshot, official: { ...snapshot.official, matches: built } };
}

let current = null;
const stage = document.getElementById('root');

async function render({
  theme, format = 'portrait', piece = 'standings', count = 0, light = false, page = null, png = false,
  standingsRows = 8, listSize = null, teamSize = 5, photo = false, matches = null,
}) {
  if (current) { releasePremiumDomRender(current); current = null; }
  await ensurePremiumSocialFonts(theme);
  const snapshot = withMatches(socialQaSnapshot(piece, { standingsRows, listSize, teamSize }), matches);
  const editorial = {
    ...createEditorialState(snapshot, { format }),
    selection: socialQaSelection(snapshot),
    ...(page ? { page } : {}),
  };
  const sponsors = await sponsorsFor(count, { light });
  const assets = photo ? { photo: await bitmap(logoFaro) } : {};
  const prepared = createPremiumDomRender({
    snapshot, content: null, editorial, assets, branding: {}, theme: { id: theme }, sponsors,
  });
  current = prepared;
  stage.replaceChildren(prepared.node);
  await waitForPremiumDomAssets(prepared.node);
  await document.fonts.ready;
  await new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });
  const measure = measurePremium(prepared.node);
  let image = null;
  if (png) {
    const blob = await premiumDomToPngBlob(prepared.node, SOCIAL_FORMATS[format] || SOCIAL_FORMATS.portrait);
    image = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }
  sponsors.forEach((entry) => entry.image.close?.());
  return { measure, image };
}

window.__sponsorBand = { render, names: LOGOS.map(([, name]) => name) };
