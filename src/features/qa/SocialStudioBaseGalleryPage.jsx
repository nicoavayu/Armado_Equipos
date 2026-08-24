import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { renderBaseSocialPiece } from '../torneos/social/base';
import { BASE_LOCKUP_DATA_URL } from '../torneos/social/base/brandAsset';
import { QA_TOURNAMENT_REVIEW_PATH } from './qaRoleSwitcher';
import styles from './SocialStudioBaseGalleryPage.module.css';

const FORMATS = Object.freeze([
  { id: 'portrait', label: '4:5', width: 1080, height: 1350 },
  { id: 'story', label: '9:16', width: 1080, height: 1920 },
]);

const TEAM_A = Object.freeze({
  participantId: 'team-a', name: 'Deportivo Horizonte', primaryColor: '#6E2BFF',
});
const TEAM_B = Object.freeze({
  participantId: 'team-b', name: 'Atlético del Sur', primaryColor: '#13B8A6',
});
const TEAM_C = Object.freeze({
  participantId: 'team-c', name: 'Biblioteca Popular Central', primaryColor: '#F59E0B',
});
const TEAM_D = Object.freeze({
  participantId: 'team-d', name: 'Social y Deportivo Constitución', primaryColor: '#EF476F',
});
const TEAMS = Object.freeze([TEAM_A, TEAM_B, TEAM_C, TEAM_D]);

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

const NEXT_MATCHES = Object.freeze([
  match('n-1', TEAM_A, TEAM_C, null, null, '2026-08-29T18:30:00.000Z'),
  match('n-2', TEAM_B, TEAM_D, null, null, '2026-08-29T20:30:00.000Z'),
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

const DISCIPLINE = Object.freeze(PLAYERS.slice(2, 7).map((player, index) => ({
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo cargar el lockup aprobado.'));
    image.src = src;
  });
}

function GalleryCanvas({ entry, format, lockup }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState('');
  const [binary, setBinary] = useState(null);
  const selection = useMemo(() => (
    entry.id === 'champion' ? [] : PLAYERS.map((player) => player.rosterPlayerId)
  ), [entry.id]);

  useEffect(() => {
    if (!lockup || !canvasRef.current) return;
    try {
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      renderBaseSocialPiece(context, {
        snapshot: entry.snapshot,
        editorial: { format: format.id, selection },
        assets: { shields: {}, branding: { officialLockup: lockup } },
        branding: { tournamentName: entry.snapshot.competition.tournamentName },
      });
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
  }, [entry, format, lockup, selection]);

  const download = () => {
    const canvas = canvasRef.current;
    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/png');
    anchor.download = `arma2-${entry.id}-${format.id}.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <article
      className={styles.card}
      data-piece={entry.id}
      data-format={format.id}
    >
      <header className={styles.cardHeader}>
        <div>
          <h2>{entry.label}</h2>
          <p>{format.label} · {format.width} × {format.height}</p>
        </div>
        <button type="button" onClick={download} disabled={Boolean(error) || !lockup}>
          Exportar PNG
        </button>
      </header>
      <div className={styles.canvasShell}>
        <canvas
          ref={canvasRef}
          width={format.width}
          height={format.height}
          aria-label={`${entry.label} ${format.label}`}
        />
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
  const [lockup, setLockup] = useState(null);
  const [error, setError] = useState('');
  const cards = useMemo(() => GALLERY.flatMap((entry) => (
    FORMATS.map((format) => ({ entry, format, key: `${entry.id}-${format.id}` }))
  )), []);

  useEffect(() => {
    let active = true;
    loadImage(BASE_LOCKUP_DATA_URL).then((image) => {
      if (active) setLockup(image);
    }).catch((loadError) => {
      if (active) setError(loadError.message);
    });
    return () => { active = false; };
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <span>QA LOCAL · Design System aprobado</span>
          <h1>Social Studio Base</h1>
          <p>
            Las 11 familias recorren el mismo adapter y renderer que producción,
            en sus canvases contractuales 4:5 y 9:16. Los datos son fixtures exclusivos de QA.
          </p>
          <div className={styles.meta}>
            <strong data-testid="gallery-count">{cards.length} canvases</strong>
            <Link to={QA_TOURNAMENT_REVIEW_PATH}>Volver al mapa QA</Link>
          </div>
          {error ? <p className={styles.error}>{error}</p> : null}
        </header>
        <section className={styles.grid} aria-label="Galería Base">
          {cards.map(({ entry, format, key }) => (
            <GalleryCanvas key={key} entry={entry} format={format} lockup={lockup} />
          ))}
        </section>
      </div>
    </main>
  );
}
