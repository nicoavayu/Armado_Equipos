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

// Estudio Social, galería de fotos y logos y escudos siguen apagados en
// Production (`social_studio`, `media` y `branding_assets` en false): Mi plan
// sólo adelanta cómo se van a repartir entre los planes.
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
