import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { renderBaseSocialPiece } from '../torneos/social/base';
import { BASE_LOCKUP_DATA_URL } from '../torneos/social/base/brandAsset';
import {
  ensurePremiumSocialFonts,
  premiumDomToPngBlob,
} from '../torneos/social/premiumRenderer';
import PremiumRenderer from '../torneos/social/premium/PremiumRenderer';
import { ensureSocialFonts } from '../torneos/social/socialRenderer';
import {
  BASE_SOCIAL_THEME,
  EDITORIAL_SOCIAL_THEME,
  HERITAGE_SOCIAL_THEME,
  SCOREBOARD_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
} from '../torneos/social/socialThemes';
import { QA_TOURNAMENT_REVIEW_PATH } from './qaRoleSwitcher';
import styles from './SocialStudioBaseGalleryPage.module.css';

const FORMATS = Object.freeze([
  { id: 'portrait', label: '4:5', width: 1080, height: 1350 },
  { id: 'story', label: '9:16', width: 1080, height: 1920 },
]);

const CATALOG_THEMES = Object.freeze([
  BASE_SOCIAL_THEME,
  HERITAGE_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
  SCOREBOARD_SOCIAL_THEME,
  EDITORIAL_SOCIAL_THEME,
]);

const svgDataUrl = (body) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`;
const QA_TOURNAMENT_LOGO = svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
    <path fill="#6E2BFF" d="M90 8 160 34v52c0 43-28 72-70 86-42-14-70-43-70-86V34z"/>
    <path fill="none" stroke="#D9CCFF" stroke-width="7" d="M90 22 145 43v42c0 33-20 57-55 70-35-13-55-37-55-70V43z"/>
    <text x="90" y="106" fill="white" font-family="Arial" font-size="48" font-weight="800" text-anchor="middle">CH</text>
  </svg>
`);
const QA_SHIELD_A = svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="160" height="190" viewBox="0 0 160 190">
    <path fill="#6E2BFF" d="M8 12h144v94c0 39-29 61-72 76-43-15-72-37-72-76z"/>
    <path fill="#A98BFF" d="M65 12h30v145H65z"/>
    <text x="80" y="104" fill="white" font-family="Arial" font-size="34" font-weight="900" text-anchor="middle">DH</text>
  </svg>
`);
const QA_SHIELD_B = svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="160" height="190" viewBox="0 0 160 190">
    <path fill="#0B8F84" d="M8 12h144v94c0 39-29 61-72 76-43-15-72-37-72-76z"/>
    <path fill="#13B8A6" d="m22 38 116 116V98L78 38z"/>
    <text x="80" y="104" fill="white" font-family="Arial" font-size="28" font-weight="900" text-anchor="middle">ADS</text>
  </svg>
`);
const QA_PLAYER_PHOTO = svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900">
    <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#241250"/><stop offset="1" stop-color="#07070C"/></linearGradient></defs>
    <rect width="720" height="900" fill="url(#g)"/>
    <circle cx="360" cy="285" r="130" fill="#D8A57B"/>
    <path fill="#191527" d="M215 260c15-134 275-154 292 16-72-48-193-61-292-16z"/>
    <path fill="#6E2BFF" d="M96 900c19-235 136-340 264-340s245 105 264 340z"/>
    <path fill="#A98BFF" d="m320 560 40 86 40-86 55 30-95 175-95-175z"/>
  </svg>
`);

const TEAM_A = Object.freeze({
  participantId: 'team-a', name: 'Deportivo Horizonte', primaryColor: '#6E2BFF',
  shieldPath: 'qa/team-a.svg',
});
const TEAM_B = Object.freeze({
  participantId: 'team-b', name: 'Atlético del Sur', primaryColor: '#13B8A6',
  shieldPath: 'qa/team-b.svg',
});
const TEAM_C = Object.freeze({
  participantId: 'team-c', name: 'Biblioteca Popular Central', primaryColor: '#F59E0B',
});
const TEAM_D = Object.freeze({
  participantId: 'team-d', name: 'Social y Deportivo Constitución', primaryColor: '#EF476F',
});
const TEAM_E = Object.freeze({
  participantId: 'team-e', name: 'Defensores de Villa Constitución del Norte', primaryColor: '#2563EB',
});
const TEAMS = Object.freeze([TEAM_A, TEAM_B, TEAM_C, TEAM_D, TEAM_E]);

const PLAYERS = Object.freeze(Array.from({ length: 11 }, (_unused, index) => ({
  rosterPlayerId: `player-${index + 1}`,
  name: [
    'Valentina Ferreyra', 'Martín Quiroga', 'Lucía Benítez', 'Santiago Roldán',
    'Camila Álvarez', 'Tomás Sosa', 'Julieta Núñez', 'Facundo Giménez',
    'Agustina Pereyra', 'Mateo Cabrera', 'Renata Fernández',
  ][index],
  position: index === 0 ? 'ARQ' : index < 5 ? 'DEF' : index < 8 ? 'MED' : 'DEL',
  team: TEAMS[index % TEAMS.length],
  goals: Math.max(0, 8 - index),
  assists: Math.max(0, 6 - Math.floor(index / 2)),
  appearances: 9,
})));

function match(id, home, away, homeScore, awayScore, scheduledAt) {
  return {
    id,
    scheduledAt,
    timezone: 'America/Argentina/Buenos_Aires',
    venueName: 'Estadio Parque Metropolitano',
    home,
    away,
    result: homeScore == null ? null : { homeScore, awayScore },
  };
}

const PLAYED_MATCHES = Object.freeze([
  match('m-1', TEAM_A, TEAM_B, 3, 1, '2026-08-22T18:30:00.000Z'),
  match('m-2', TEAM_C, TEAM_D, 2, 2, '2026-08-22T20:30:00.000Z'),
  match('m-3', TEAM_B, TEAM_C, 0, 1, '2026-08-23T18:30:00.000Z'),
  match('m-4', TEAM_D, TEAM_A, 1, 4, '2026-08-23T20:30:00.000Z'),
]);

const DENSE_MATCHES = Object.freeze(Array.from({ length: 8 }, (_unused, index) => (
  match(
    `dense-${index + 1}`,
    TEAMS[index % TEAMS.length],
    TEAMS[(index + 1) % TEAMS.length],
    (index + 3) % 5,
    index % 3,
    `2026-08-${String(12 + index).padStart(2, '0')}T18:30:00.000Z`,
  )
)));

const NEXT_MATCHES = Object.freeze([
  match('n-1', TEAM_A, TEAM_C, null, null, '2026-08-29T18:30:00.000Z'),
  match('n-2', TEAM_B, TEAM_D, null, null, '2026-08-29T20:30:00.000Z'),
  match('n-3', TEAM_C, TEAM_B, null, null, '2026-08-30T18:30:00.000Z'),
  match('n-4', TEAM_D, TEAM_A, null, null, '2026-08-30T20:30:00.000Z'),
]);

const STANDINGS = Object.freeze(TEAMS.map((team, index) => ({
  ...team,
  position: index + 1,
  played: 9,
  won: 7 - index,
  drawn: index,
  lost: 2,
  goalsFor: 22 - index * 2,
  goalsAgainst: 8 + index,
  goalDifference: 14 - index * 3,
  points: 22 - index * 3,
})));

const standingsFor = (count) => Object.freeze(Array.from({ length: count }, (_unused, index) => ({
  participantId: `dense-team-${index + 1}`,
  teamName: [
    'Defensores de Villa Constitución del Norte',
    'Social y Deportivo Constitución',
    'Biblioteca Popular Central',
    'Atlético Metropolitano del Oeste',
    'Club Unión de los Trabajadores del Sur',
  ][index % 5] + ` ${index + 1}`,
  position: index + 1,
  played: 15,
  won: Math.max(0, 13 - index),
  drawn: index % 4,
  lost: Math.min(9, index),
  goalsFor: 38 - index,
  goalsAgainst: 12 + index,
  goalDifference: 26 - index * 2,
  points: 39 - index * 2,
})));

const DISCIPLINE = Object.freeze(PLAYERS.slice(2, 10).map((player, index) => ({
  ...player,
  yellowCards: 4 - Math.min(index, 3),
  directReds: index === 0 ? 1 : 0,
  suspensions: index < 2 ? [{ remainingMatches: 2 - index }] : [],
})));

function snapshot(piece, official) {
  return {
    piece,
    competition: {
      tournamentName: 'Copa Horizonte 2026',
      categoryName: 'Primera División',
      phaseName: 'Fase regular',
      roundName: 'Fecha 9',
      timezone: 'America/Argentina/Buenos_Aires',
      teamSize: 11,
    },
    official,
  };
}

const GALLERY = Object.freeze([
  { id: 'round_results', label: 'Resultados', snapshot: snapshot('round_results', { matches: PLAYED_MATCHES }) },
  { id: 'next_fixture', label: 'Próximos partidos', snapshot: snapshot('next_fixture', { matches: NEXT_MATCHES }) },
  { id: 'mvp', label: 'Figura', snapshot: snapshot('mvp', { candidates: PLAYERS }) },
  { id: 'best_eleven', label: 'Equipo ideal', snapshot: snapshot('best_eleven', { candidates: PLAYERS, teamSize: 11 }) },
  { id: 'standings', label: 'Tabla', snapshot: snapshot('standings', { rows: STANDINGS }) },
  { id: 'scorers', label: 'Goleadores', snapshot: snapshot('scorers', { players: PLAYERS.slice(0, 8) }) },
  { id: 'discipline', label: 'Sancionados', snapshot: snapshot('discipline', { players: DISCIPLINE }) },
  {
    id: 'round_summary',
    label: 'Resumen de fecha',
    snapshot: snapshot('round_summary', { matches: PLAYED_MATCHES, leaders: PLAYERS.slice(0, 3) }),
  },
  { id: 'semifinals', label: 'Semifinales', snapshot: snapshot('semifinals', { matches: PLAYED_MATCHES.slice(0, 2) }) },
  { id: 'final', label: 'Final', snapshot: snapshot('final', { matches: PLAYED_MATCHES.slice(0, 1) }) },
  { id: 'champion', label: 'Campeón', snapshot: snapshot('champion', { officialChampion: TEAM_A, candidates: [] }) },
]);

const RESULT_REVIEW_STATES = Object.freeze([4, 6, 8].map((count) => ({
  id: 'round_results', state: `matches-${count}`, label: `Resultados · ${count} partidos`,
  snapshot: snapshot('round_results', { matches: DENSE_MATCHES.slice(0, count) }), formats: FORMATS,
})));

const TABLE_REVIEW_STATES = Object.freeze([4, 8, 12, 15, 16, 18, 20, 24].map((count) => ({
  id: 'standings', state: `teams-${count}`, label: `Tabla · ${count} equipos + nombres largos`,
  snapshot: snapshot('standings', { rows: standingsFor(count) }), formats: FORMATS,
})));

const EDITORIAL_PAGINATION_REVIEW_STATES = Object.freeze([
  { count: 16, page: 2 },
  { count: 18, page: 2 },
  { count: 24, page: 2 },
  { count: 31, page: 3 },
].map(({ count, page }) => ({
  id: 'standings',
  state: `teams-${count}-page-${page}`,
  label: `Tabla · ${count} equipos · continuación página ${page}`,
  snapshot: snapshot('standings', { rows: standingsFor(count) }),
  formats: FORMATS,
  page,
  themes: [EDITORIAL_SOCIAL_THEME],
})));

const DISCIPLINE_REVIEW_STATES = Object.freeze([0, 1, 3].map((count) => ({
  id: 'discipline', state: `sanctioned-${count}`, label: `Disciplina · ${count} sancionados`,
  snapshot: snapshot('discipline', {
    players: DISCIPLINE.slice(0, count).map((player, index) => ({
      ...player,
      suspensions: [{ remainingMatches: Math.max(1, 3 - index) }],
    })),
  }),
  formats: FORMATS,
})));

const REVIEW_STATES = Object.freeze([
  {
    id: 'next_fixture', state: 'empty', label: 'Próximos · vacío',
    snapshot: snapshot('next_fixture', { matches: [] }), formats: FORMATS,
  },
  {
    id: 'champion', state: 'fallback', label: 'Campeón · sin assets opcionales',
    snapshot: snapshot('champion', { officialChampion: TEAM_C, candidates: [] }),
    formats: [FORMATS[0]], withoutAssets: true,
  },
]);

const XI_REVIEW_STATES = Object.freeze([5, 6, 7, 8, 9, 11].map((teamSize) => ({
  id: 'best_eleven',
  state: `football-${teamSize}`,
  label: `Equipo ideal · Fútbol ${teamSize}`,
  snapshot: snapshot('best_eleven', {
    candidates: PLAYERS.slice(0, teamSize), teamSize, sportModality: `football_${teamSize}`,
  }),
  formats: FORMATS,
  selectionSize: teamSize,
})));

const XI_RARE_LINES = Object.freeze([
  { id: 'only-def', label: 'sólo DEF + ARQ', lines: ['ARQ', 'DEF', 'DEF', 'DEF', 'DEF'] },
  { id: 'without-med', label: 'sin MED', lines: ['ARQ', 'DEF', 'DEF', 'DEL', 'DEL'] },
  { id: 'without-del', label: 'sin DEL', lines: ['ARQ', 'DEF', 'DEF', 'MED', 'MED'] },
  { id: 'mostly-del', label: 'mayoría DEL', lines: ['ARQ', 'DEL', 'DEL', 'DEL', 'DEF'] },
  { id: 'mostly-def', label: 'mayoría DEF', lines: ['ARQ', 'DEF', 'DEF', 'DEF', 'DEL'] },
].map(({ id, label, lines }) => ({
  id: 'best_eleven',
  state: `rare-${id}`,
  label: `Equipo ideal F5 · ${label}`,
  snapshot: snapshot('best_eleven', {
    candidates: PLAYERS.slice(0, 5), teamSize: 5, sportModality: 'football_5',
  }),
  formats: FORMATS,
  selectionSize: 5,
  selectedLines: Object.fromEntries(PLAYERS.slice(0, 5).map((player, index) => (
    [player.rosterPlayerId, lines[index]]
  ))),
})));

const SPONSOR_REVIEW_STATES = Object.freeze([0, 1, 2, 3].map((sponsorCount) => ({
  ...GALLERY[0],
  state: `sponsors-${sponsorCount}`,
  label: `Resultados · ${sponsorCount} sponsors`,
  formats: FORMATS,
  sponsorCount,
})));

const FIGURE_REVIEW_STATES = Object.freeze([
  { id: 'default', label: 'default / reset', withPhoto: true, focalX: 0.5, focalY: 0.5, zoom: 1 },
  { id: 'without-photo', label: 'sin foto', withPhoto: false, focalX: 0.5, focalY: 0.5, zoom: 1 },
  { id: 'drag-left', label: 'drag izquierda', withPhoto: true, focalX: 0.12, focalY: 0.5, zoom: 1 },
  { id: 'drag-right', label: 'drag derecha', withPhoto: true, focalX: 0.88, focalY: 0.5, zoom: 1 },
  { id: 'drag-up', label: 'drag arriba', withPhoto: true, focalX: 0.5, focalY: 0.12, zoom: 1 },
  { id: 'drag-down', label: 'drag abajo', withPhoto: true, focalX: 0.5, focalY: 0.88, zoom: 1 },
  { id: 'zoom', label: 'zoom 2×', withPhoto: true, focalX: 0.67, focalY: 0.3, zoom: 2 },
].map(({ id: state, ...variant }) => ({
  ...GALLERY.find(({ id }) => id === 'mvp'),
  state,
  label: `Figura · ${variant.label}`,
  formats: FORMATS,
  ...variant,
})));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo cargar uno de los assets de QA.'));
    image.src = src;
  });
}

function GalleryCanvas({ entry, format, qaAssets, theme }) {
  const canvasRef = useRef(null);
  const premiumRef = useRef(null);
  const [error, setError] = useState('');
  const [binary, setBinary] = useState(null);
  const selection = useMemo(() => (
    entry.id === 'champion'
      ? []
      : PLAYERS.slice(0, entry.selectionSize || PLAYERS.length)
        .map((player) => player.rosterPlayerId)
  ), [entry.id, entry.selectionSize]);
  const state = entry.state || (
    entry.id === 'mvp' ? (format.id === 'portrait' ? 'with-photo' : 'without-photo') : 'default'
  );
  const label = entry.id === 'mvp'
    ? `${entry.label} · ${entry.withPhoto === false ? 'sin foto' : 'con foto'}`
    : entry.label;

  useEffect(() => {
    if (!qaAssets || theme.id !== 'base' || !canvasRef.current) return;
    try {
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      const assets = {
        shields: entry.withoutAssets ? {} : qaAssets.shields,
        photo: entry.withoutAssets ? null : qaAssets.photo,
        branding: {
          officialLockup: qaAssets.lockup,
          tournamentLogo: entry.withoutAssets ? null : qaAssets.tournamentLogo,
        },
      };
      const branding = {
        tournamentName: entry.snapshot.competition.tournamentName,
        tournamentLogo: entry.withoutAssets ? null : 'qa-tournament-logo',
        showArma2Branding: theme.id === 'base',
      };
      const renderOptions = {
        snapshot: entry.snapshot,
        editorial: {
          format: format.id,
          selection,
          selectedLines: entry.selectedLines || {},
          photoAssetId: entry.id === 'mvp' && entry.withPhoto !== false ? 'qa-photo' : null,
          figuraFocalX: entry.focalX ?? 0.5,
          figuraFocalY: entry.focalY ?? 0.5,
          figuraZoom: entry.zoom ?? 1,
        },
        assets,
        branding,
      };
      renderBaseSocialPiece(context, renderOptions);
      const encoded = canvas.toDataURL('image/png').split(',')[1];
      const bytes = window.atob(encoded);
      setBinary({
        bytes: bytes.length,
        png: bytes.slice(0, 8).split('').map((character) => (
          character.charCodeAt(0)
        )).join(',') === '137,80,78,71,13,10,26,10',
      });
      setError('');
    } catch (renderError) {
      setError(renderError?.message || 'Falló el render.');
    }
  }, [entry, format, qaAssets, selection, theme]);

  const download = async () => {
    try {
      const anchor = document.createElement('a');
      let objectUrl = null;
      if (theme.id === 'base') {
        anchor.href = canvasRef.current.toDataURL('image/png');
      } else {
        const blob = await premiumDomToPngBlob(premiumRef.current, format);
        setBinary({ bytes: blob.size, png: blob.type === 'image/png' && blob.size > 8 });
        objectUrl = URL.createObjectURL(blob);
        anchor.href = objectUrl;
      }
      anchor.download = `arma2-${theme.id}-${entry.id}-${state}-${format.id}.png`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setError('');
    } catch (exportError) {
      setError(exportError?.message || 'Falló la exportación PNG real.');
    }
  };

  const editorial = {
    format: format.id,
    selection,
    photoAssetId: entry.id === 'mvp'
      && (entry.withPhoto === true || (entry.withPhoto !== false && format.id === 'portrait'))
      ? 'qa-photo'
      : null,
    figuraFocalX: entry.focalX ?? 0.5,
    figuraFocalY: entry.focalY ?? 0.5,
    figuraZoom: entry.zoom ?? 1,
    selectedLines: entry.selectedLines || {},
    page: entry.page || 1,
  };
  const assets = qaAssets ? {
    shields: entry.withoutAssets ? {} : qaAssets.shields,
    photo: entry.withoutAssets || !editorial.photoAssetId ? null : qaAssets.photo,
    branding: {
      officialLockup: qaAssets.lockup,
      tournamentLogo: entry.withoutAssets ? null : qaAssets.tournamentLogo,
    },
  } : null;

  return (
    <article
      className={styles.card}
      data-piece={entry.id}
      data-format={format.id}
      data-state={state}
      data-theme={theme.id}
    >
      <header className={styles.cardHeader}>
        <div>
          <h2>{theme.name} · {label}</h2>
          <p>{format.label} · {format.width} × {format.height} · {theme.id === 'base' ? 'Arma2 visible' : 'white-label'}</p>
        </div>
        <button type="button" onClick={download} disabled={Boolean(error) || !qaAssets}>
          Exportar PNG
        </button>
      </header>
      <div className={styles.canvasShell}>
        {theme.id === 'base' ? (
          <canvas
            ref={canvasRef}
            width={format.width}
            height={format.height}
            aria-label={`${theme.name} ${entry.label} ${format.label}`}
          />
        ) : (
          <div className={styles.premiumViewport}>
            <div ref={premiumRef} className={styles.premiumSurface}>
              {qaAssets ? (
                <PremiumRenderer
                  snapshot={entry.snapshot}
                  editorial={editorial}
                  assets={assets}
                  branding={{
                    tournamentName: entry.snapshot.competition.tournamentName,
                    tournamentLogo: entry.withoutAssets ? null : 'qa-tournament-logo',
                    showArma2Branding: false,
                  }}
                  theme={theme}
                  sponsors={qaAssets.sponsors.slice(0, entry.sponsorCount || 0)}
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
      {binary ? (
        <p
          className={styles.binary}
          data-png-valid={binary.png ? 'true' : 'false'}
          data-png-bytes={binary.bytes}
        >
          PNG verificado · {(binary.bytes / 1024).toFixed(0)} KB
        </p>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </article>
  );
}

export default function SocialStudioBaseGalleryPage() {
  const [qaAssets, setQaAssets] = useState(null);
  const [error, setError] = useState('');
  const [themeFilter, setThemeFilter] = useState('base');
  const cards = useMemo(() => CATALOG_THEMES.flatMap((theme) => (
    GALLERY.flatMap((entry) => FORMATS.map((format) => ({
      entry, format, theme, key: `${theme.id}-${entry.id}-default-${format.id}`,
    })))
  )), []);
  const reviewCards = useMemo(() => [
    ...RESULT_REVIEW_STATES,
    ...TABLE_REVIEW_STATES,
    ...EDITORIAL_PAGINATION_REVIEW_STATES,
    ...DISCIPLINE_REVIEW_STATES,
    ...REVIEW_STATES,
    ...XI_REVIEW_STATES,
    ...XI_RARE_LINES,
    ...SPONSOR_REVIEW_STATES,
    ...FIGURE_REVIEW_STATES,
  ].flatMap((entry) => entry.formats.map((format) => (
    (entry.themes || CATALOG_THEMES).map((theme) => ({
      entry, format, theme, key: `review-${theme.id}-${entry.id}-${entry.state}-${format.id}`,
    }))
  ))).flat(), []);
  const visibleCards = useMemo(
    () => cards.filter(({ theme }) => theme.id === themeFilter),
    [cards, themeFilter],
  );
  const visibleReviewCards = useMemo(
    () => reviewCards.filter(({ theme }) => theme.id === themeFilter),
    [reviewCards, themeFilter],
  );

  useEffect(() => {
    let active = true;
    const loadRendererFonts = async () => {
      await ensureSocialFonts();
      for (const themeId of ['heritage', 'street', 'scoreboard', 'editorial']) {
        await ensurePremiumSocialFonts(themeId);
      }
    };
    Promise.all([
      loadRendererFonts(),
      loadImage(BASE_LOCKUP_DATA_URL),
      loadImage(QA_TOURNAMENT_LOGO),
      loadImage(QA_SHIELD_A),
      loadImage(QA_SHIELD_B),
      loadImage(QA_PLAYER_PHOTO),
    ]).then(([, lockup, tournamentLogo, shieldA, shieldB, photo]) => {
      if (active) {
        setQaAssets({
          lockup,
          tournamentLogo,
          photo,
          shields: { 'qa/team-a.svg': shieldA, 'qa/team-b.svg': shieldB },
          sponsors: [
            { id: 'sponsor-a', image: shieldA },
            { id: 'sponsor-b', image: shieldB },
            { id: 'sponsor-c', image: tournamentLogo },
          ],
        });
      }
    }).catch((loadError) => {
      if (active) setError(loadError.message);
    });
    return () => { active = false; };
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <span>QA LOCAL · catálogo final V2</span>
          <h1>Social Studio · 110</h1>
          <p>
            Base y los cuatro temas Premium recorren las 11 familias en sus superficies
            contractuales 4:5 y 9:16. Los datos y assets son exclusivos de QA.
          </p>
          <div className={styles.meta}>
            <strong data-testid="gallery-count">{cards.length} celdas</strong>
            <Link to={QA_TOURNAMENT_REVIEW_PATH}>Volver al mapa QA</Link>
          </div>
          <label className={styles.filter}>
            Tema visible
            <select value={themeFilter} onChange={(event) => setThemeFilter(event.target.value)}>
              {CATALOG_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>{theme.name}</option>
              ))}
            </select>
          </label>
          {error ? <p className={styles.error}>{error}</p> : null}
        </header>
        <section className={styles.grid} aria-label="Galería final 110 celdas">
          {visibleCards.map(({ entry, format, theme, key }) => (
            <GalleryCanvas
              key={key}
              entry={entry}
              format={format}
              qaAssets={qaAssets}
              theme={theme}
            />
          ))}
        </section>
        <header className={styles.reviewHeader}>
          <span>QA focal · {reviewCards.length} casos adicionales</span>
          <h2>Estrés y variantes</h2>
          <p>Resultados 4/6/8, tablas 4/8/12/16/18/20/24, disciplina 0/1/3, Equipo Ideal F5–F11 y líneas raras, Figura drag/zoom/reset.</p>
        </header>
        <section className={styles.grid} aria-label="Galería focal adicional">
          {visibleReviewCards.map(({ entry, format, theme, key }) => (
            <GalleryCanvas
              key={key}
              entry={entry}
              format={format}
              qaAssets={qaAssets}
              theme={theme}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
