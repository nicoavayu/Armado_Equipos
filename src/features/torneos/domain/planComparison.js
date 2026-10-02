import { SOCIAL_FORMATS, SOCIAL_PIECES } from '../social/socialContracts';
import { FREE_BASE_FAMILY_IDS } from '../social/socialAccessPolicy';
import { SOCIAL_THEME_REGISTRY } from '../social/socialThemes';

// Lo que Mi plan promete del Estudio Social sale del catálogo que el Estudio
// realmente dibuja y que `authorize_tournament_social_export` autoriza: si una
// placa o un estilo cambia allá, la página del plan cambia con él.
const FREE_PIECES = new Set(FREE_BASE_FAMILY_IDS);

export const SOCIAL_STUDIO_PLAN = Object.freeze({
  freePieces: Object.freeze(SOCIAL_PIECES
    .filter((piece) => FREE_PIECES.has(piece.id))
    .map((piece) => piece.label)),
  premiumPieces: Object.freeze(SOCIAL_PIECES
    .filter((piece) => !FREE_PIECES.has(piece.id))
    .map((piece) => piece.label)),
  freeStyles: Object.freeze(SOCIAL_THEME_REGISTRY
    .filter((theme) => theme.tier === 'free')
    .map((theme) => theme.name)),
  premiumStyles: Object.freeze(SOCIAL_THEME_REGISTRY
    .filter((theme) => theme.tier === 'premium')
    .map((theme) => theme.name)),
  formats: Object.freeze(Object.values(SOCIAL_FORMATS).map((format) => format.label)),
});

const count = (items, singular, plural) => `${items.length} ${items.length === 1 ? singular : plural}`;

// `soon` marca lo que hoy no se puede usar en la app: Multimedia, la carga de
// logos y escudos y el Estudio Social siguen apagados fuera del laboratorio.
// `included` es lo que "Qué incluye tu plan" muestra como disponible hoy.
export const PLAN_COMPARISON = Object.freeze([
  { name: 'Fixture, partidos, actas y tabla', free: 'Incluidos', premium: 'Incluidos', included: true },
  { name: 'Página pública y comunicados', free: 'Incluidos', premium: 'Incluidos', included: true },
  { name: 'Colaboradores por temporada', free: 'Propietario + 1', premium: 'Propietario + 10', included: true },
  { name: 'Logo del torneo y escudos', free: 'Incluidos', premium: 'Incluidos', soon: true },
  { name: 'Galería de fotos', free: '25 archivos', premium: '1.000 archivos', soon: true },
  {
    name: 'Estudio Social',
    free: `${count(SOCIAL_STUDIO_PLAN.freePieces, 'placa', 'placas')} · estilo ${SOCIAL_STUDIO_PLAN.freeStyles.join(', ')} · con firma Arma2`,
    premium: `Todas las placas · ${count([...SOCIAL_STUDIO_PLAN.freeStyles, ...SOCIAL_STUDIO_PLAN.premiumStyles], 'estilo', 'estilos')} · firma Arma2 opcional`,
    soon: true,
  },
].map((row) => Object.freeze(row)));
