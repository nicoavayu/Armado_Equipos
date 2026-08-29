import { findSocialPiece } from '../socialContracts';
import { TORNEOS_URL } from '../socialProductConfig';
import {
  BRAND,
  LOGO_SRC,
  chrome,
  emptyState,
  frame,
} from './core';
import { PIECES } from './pieces';
import {
  BASE_FORMAT_IDS,
  BASE_PIECE_IDS,
  adaptSnapshotToBasePiece,
  baseAssetMap,
} from './content';

const EMPTY_TITLES = Object.freeze({
  round_results: 'Todavía no hay resultados oficiales',
  next_fixture: 'No hay una próxima fecha programada',
  standings: 'Todavía no hay tabla publicada',
  scorers: 'Todavía no hay goleadores publicados',
  discipline: 'Sin sanciones en esta fecha',
  round_summary: 'Todavía no hay un resumen oficial',
  semifinals: 'Todavía no hay semifinales programadas',
  final: 'Todavía no hay una final programada',
});

function isEmptyBasePiece(snapshot, data) {
  if (['round_results', 'next_fixture', 'semifinals', 'final', 'round_summary']
    .includes(snapshot.piece)) return data.matches.length === 0;
  if (snapshot.piece === 'standings') return data.rows.length === 0;
  if (snapshot.piece === 'scorers') return data.players.length === 0;
  return false;
}

function renderEmpty(ctx, geometry, images, snapshot, data) {
  const piece = findSocialPiece(snapshot.piece);
  const box = chrome(ctx, geometry, images, {
    kicker: data.round || data.category,
    title: piece?.label || 'Estudio Social',
    sub: data.category,
    tournament: {
      name: data.tournament,
      category: data.category,
      logo: data.tournamentLogo,
    },
    showArma2Branding: data.showArma2Branding,
  });
  emptyState(ctx, box, {
    kicker: data.round || 'Estado',
    title: EMPTY_TITLES[snapshot.piece] || 'Todavía no hay datos oficiales',
  });
}

export function renderBaseSocialPiece(ctx, {
  snapshot,
  editorial,
  assets,
  branding,
}) {
  const pieceId = BASE_PIECE_IDS[snapshot.piece];
  const piece = PIECES.find((entry) => entry.id === pieceId);
  if (!piece) return false;
  const geometry = frame(BASE_FORMAT_IDS[editorial.format]);
  const data = adaptSnapshotToBasePiece(snapshot, editorial, branding);
  const images = baseAssetMap(assets);
  images.set(LOGO_SRC, assets?.branding?.officialLockup || null);
  BRAND.torneosUrl = TORNEOS_URL;
  if (isEmptyBasePiece(snapshot, data)) {
    renderEmpty(ctx, geometry, images, snapshot, data);
  } else {
    piece.render(ctx, geometry, data, images);
  }
  return true;
}
