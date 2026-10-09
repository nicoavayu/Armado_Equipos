import { SOCIAL_PIECES } from '../social/socialContracts';
import { FREE_BASE_FAMILY_IDS } from '../social/socialAccessPolicy';
import { SOCIAL_THEME_REGISTRY } from '../social/socialThemes';

// La comparación FREE vs PREMIUM sólo lista lo que hoy se usa en Production
// (todas son claves encendidas de la composición híbrida). Lo que sigue apagado
// vive aparte, en PLAN_COMING_SOON: nunca se mezcla con lo disponible.
export const PLAN_COMPARISON = Object.freeze([
  { name: 'Fixture, partidos, actas y tabla', free: 'Incluidos', premium: 'Incluidos' },
  { name: 'Página pública y comunicados', free: 'Incluidos', premium: 'Incluidos' },
  { name: 'Colaboradores por temporada', free: 'Propietario + 1', premium: 'Propietario + 10' },
].map((row) => Object.freeze(row)));

// Nombres cortos de las placas FREE tal como las nombra Mi plan; las placas
// salen del catálogo que `authorize_tournament_social_export` autoriza.
const FREE_PIECE_NAMES = Object.freeze({
  round_results: 'Resultados',
  standings: 'Tabla de posiciones',
  next_fixture: 'Próxima fecha',
});

const joinAnd = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items.join(''));

const themeNames = (tier) => SOCIAL_THEME_REGISTRY
  .filter((theme) => !tier || theme.tier === tier)
  .map((theme) => theme.name);

const freePieceNames = FREE_BASE_FAMILY_IDS.map((id) => (
  FREE_PIECE_NAMES[id] || SOCIAL_PIECES.find((piece) => piece.id === id)?.label || id
));

const allStyles = themeNames();

// Estudio Social, galería de fotos y logos y escudos pueden seguir apagados en
// Production (`social_studio`, `media` y `branding_assets` en false): Mi plan
// sólo adelanta cómo se van a repartir entre los planes. Cada uno sale de acá y
// entra a la comparación cuando está disponible (planComparisonFor).
export const PLAN_COMING_SOON = Object.freeze([
  {
    name: 'Estudio Social',
    summary: 'Placas para redes con los datos oficiales del torneo.',
    free: [...themeNames('free').map((name) => `Estilo ${name}`), ...freePieceNames],
    premium: [
      'Todas las placas',
      `${allStyles.length} estilos: ${joinAnd(allStyles)}`,
      'Posibilidad de quitar la firma Arma2',
    ],
  },
  {
    name: 'Galería de fotos',
    summary: 'Fotos de la temporada.',
    free: ['Hasta 25 archivos'],
    premium: ['Hasta 1.000 archivos'],
  },
  {
    name: 'Logos y escudos',
    summary: 'Logo del torneo y escudos de los equipos, en los dos planes.',
  },
].map((item) => Object.freeze({
  ...item,
  ...(item.free ? { free: Object.freeze(item.free), premium: Object.freeze(item.premium) } : {}),
})));

// SOCIAL-V1: la fila del Estudio Social cuando está disponible. Mismo reparto que
// autoriza la base de datos en cada descarga: FREE = estilo Base con Resultados,
// Tabla de posiciones y Próxima fecha, siempre con la firma Arma2; PREMIUM =
// todas las placas en los 5 estilos y la firma Arma2 opcional.
export const PLAN_SOCIAL_STUDIO_ROW = Object.freeze({
  name: 'Estudio Social',
  free: `Estilo Base: ${joinAnd(freePieceNames)}, con la firma Arma2`,
  premium: `Todas las placas, ${allStyles.length} estilos y la opción de quitar la firma Arma2`,
});

// MEDIA-V1: la fila de la galería cuando está disponible. Las cifras son las del
// catálogo de planes (tournament_plan_catalog.gallery_asset_limit: FREE 25,
// PREMIUM 1000 fotos por temporada), las mismas que el servidor cuenta en cada
// carga; un test las ata al catálogo.
export const PLAN_MEDIA_GALLERY_ROW = Object.freeze({
  name: 'Galería de fotos',
  free: 'Hasta 25 fotos por temporada',
  premium: 'Hasta 1.000 fotos por temporada',
});

// BRANDING-V1: logos y escudos, cuando la composición los ofrece. Están en los
// dos planes, así que la fila no suma nada a «Qué agrega Premium».
export const PLAN_BRANDING_ROW = Object.freeze({
  name: 'Logos y escudos',
  free: 'Incluidos',
  premium: 'Incluidos',
});

const compose = ({ social, media, branding }) => Object.freeze({
  comparison: Object.freeze([
    ...PLAN_COMPARISON,
    ...(social ? [PLAN_SOCIAL_STUDIO_ROW] : []),
    ...(media ? [PLAN_MEDIA_GALLERY_ROW] : []),
    ...(branding ? [PLAN_BRANDING_ROW] : []),
  ]),
  comingSoon: Object.freeze(PLAN_COMING_SOON.filter((item) => !(
    (social && item.name === 'Estudio Social')
    || (media && item.name === 'Galería de fotos')
    || (branding && item.name === 'Logos y escudos')
  ))),
});
const compositionKey = ({ social, media, branding }) => `${social === true}:${media === true}:${branding === true}`;
const NOTHING_AVAILABLE = Object.freeze({ comparison: PLAN_COMPARISON, comingSoon: PLAN_COMING_SOON });
const COMPOSITIONS = Object.freeze(Object.fromEntries([false, true].flatMap((social) => [false, true].flatMap(
  (media) => [false, true].map((branding) => {
    const key = compositionKey({ social, media, branding });
    return [key, social || media || branding ? compose({ social, media, branding }) : NOTHING_AVAILABLE];
  }),
))));

// `socialStudio` es exactamente la condición con la que el shell muestra el
// Estudio (flag + feature de la composición): Mi plan nunca lo da por disponible
// si la navegación no lo ofrece, ni lo deja como futuro si ya se puede usar.
// `media` sigue la misma regla con la galería de fotos (flag + feature `media`).
// `branding` sigue la misma regla con la feature `branding_assets` de la
// composición, la misma con la que ajustes, asistente e inscripción ofrecen subir
// logos y escudos.
export function planComparisonFor({ socialStudio = false, media = false, branding = false } = {}) {
  return COMPOSITIONS[compositionKey({ social: socialStudio, media, branding })];
}
