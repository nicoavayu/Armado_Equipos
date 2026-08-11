import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  MapPin,
  Shield,
  Trophy,
} from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { publicTournamentService } from '../api/publicTournamentService';
import { importantNameProps } from './importantNames';
import { getFormatLabel, getModalityLabel, getStatusLabel } from './presentationLabels';
import TorneosBrand from './TorneosBrand';
import TorneosSelect from './TorneosSelect';
import styles from './PublicTournamentPage.module.css';
import './TorneosDesignSystem.css';
import './ImportantNames.css';

const TABS = [
  ['inicio', 'Inicio'],
  ['fixture', 'Fixture'],
  ['resultados', 'Resultados'],
  ['tabla', 'Tabla'],
  ['goleadores', 'Goleadores'],
  ['equipos', 'Equipos'],
  ['disciplina', 'Disciplina'],
];

const STATUS_LABELS = {
  registration: 'Inscripción',
  scheduled: 'Programado',
  active: 'En juego',
  completed: 'Finalizado',
};

const formatDate = (value, options = {}) => {
  if (!value) return 'A confirmar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'A confirmar';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    ...options,
  }).format(date);
};

const initials = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
};

function TeamMark({
  team, service, compact = false, nameContext,
}) {
  const shieldUrl = service.resolveTeamShieldUrl(team?.shieldPath);
  const [failedShieldUrl, setFailedShieldUrl] = useState(null);
  const shieldFailed = Boolean(shieldUrl && failedShieldUrl === shieldUrl);
  const style = {
    '--team-primary': team?.primaryColor || '#6d4aff',
    '--team-secondary': team?.secondaryColor || '#f4f0ff',
  };
  return (
    <span className={compact ? styles.teamCompact : styles.team} style={style}>
      <span className={styles.crest} aria-hidden="true">
        {shieldUrl && !shieldFailed
          ? <img src={shieldUrl} alt="" loading="lazy" onError={() => setFailedShieldUrl(shieldUrl)} />
          : initials(team?.shortName || team?.name)}
      </span>
      <span {...importantNameProps(team?.name || 'A definir', nameContext || (compact ? 'table' : 'match'))}>
        {team?.name || 'A definir'}
      </span>
    </span>
  );
}

function MatchCard({ match, service }) {
  const official = Boolean(match.result);
  return (
    <article
      className={styles.matchCard}
      data-official={official}
    >
      <header>
        <span>Partido {match.matchNumber || '–'}</span>
        <time dateTime={match.scheduledAt || undefined}>
          {formatDate(match.scheduledAt, { weekday: 'short' })}
          {match.scheduledAt && ` · ${formatDate(match.scheduledAt, {
            hour: '2-digit',
            minute: '2-digit',
            day: undefined,
            month: undefined,
          })}`}
        </time>
      </header>
      <div className={styles.scoreLine}>
        <TeamMark team={match.home} service={service} />
        <strong>{official ? match.result.home : '–'}</strong>
        <span className={styles.scoreDivider}>:</span>
        <strong>{official ? match.result.away : '–'}</strong>
        <TeamMark team={match.away} service={service} />
      </div>
      <footer>
        {official ? <b>Resultado oficial</b> : <span>Próximo partido</span>}
        {match.venue?.name && (
          <span><MapPin size={13} /> {match.venue.name}{match.venue.courtName ? ` · ${match.venue.courtName}` : ''}</span>
        )}
      </footer>
    </article>
  );
}

function EmptySection({ title, detail }) {
  return (
    <div className={styles.emptyState}>
      <Shield size={25} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function StandingsTable({ rows, service, compact = false }) {
  if (!rows?.length) return <EmptySection title="Tabla todavía no publicada" detail="La organización publicará la tabla oficial cuando esté disponible." />;
  return (
    <div className={styles.tableScroll} data-allow-horizontal-scroll="true">
      <table className={styles.standingsTable}>
        <thead>
          <tr><th>Pos.</th><th>Equipo</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr>
        </thead>
        <tbody>
          {(compact ? rows.slice(0, 5) : rows).map((row) => (
            <tr key={`${row.position}-${row.teamName}`}>
              <td><b>{row.position}</b></td>
              <td><TeamMark compact team={{ name: row.teamName, shortName: row.shortName, shieldPath: row.shieldPath }} service={service} /></td>
              <td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td>
              <td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference}</td><td><strong>{row.points}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayerList({ players, limit }) {
  const rows = limit ? players?.slice(0, limit) : players;
  if (!rows?.length) return <EmptySection title="Estadísticas todavía no publicadas" detail="Los datos aparecerán después de la publicación de la tabla oficial." />;
  return (
    <ol className={styles.rankingList}>
      {rows.map((player, index) => (
        <li key={`${player.name}-${player.teamName}`}>
          <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span>
          <div><strong {...importantNameProps(player.name, 'player')}>{player.name}</strong><small {...importantNameProps(player.teamName, 'compact')}>{player.teamName}</small></div>
          <div className={styles.playerMetrics}>
            <span><b>{player.goals}</b> goles</span>
            <span><b>{player.appearances}</b> PJ</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ScopeHeading({ scope }) {
  return (
    <div className={styles.sectionHeading}>
      <div><span>Datos oficiales</span><h2>{scope?.label || 'Competencia'}</h2></div>
      {scope?.publishedAt && <small>Actualizada {formatDate(scope.publishedAt, { year: 'numeric' })}</small>}
    </div>
  );
}

function PublicTournamentContent({ page, activeTab, scope, service }) {
  const officialMatches = page.matches.filter((match) => Boolean(match.result));
  const upcomingMatches = page.matches.filter((match) => !match.result);
  const groups = page.matches.reduce((result, match) => {
    const label = match.round?.name || `Fecha ${match.round?.number || '–'}`;
    if (!result[label]) result[label] = [];
    result[label].push(match);
    return result;
  }, {});

  if (activeTab === 'inicio') {
    return (
      <div className={styles.homeGrid}>
        <section className={styles.featurePanel}>
          <div className={styles.sectionHeading}><div><span>Agenda</span><h2>Próximos partidos</h2></div></div>
          {upcomingMatches.length
            ? upcomingMatches.slice(0, 3).map((match) => <MatchCard key={match.matchNumber} match={match} service={service} />)
            : <EmptySection title="Sin próximos partidos" detail="La programación publicada no tiene encuentros pendientes." />}
        </section>
        <section className={styles.featurePanel}>
          <div className={styles.sectionHeading}><div><span>Marcadores</span><h2>Últimos resultados</h2></div></div>
          {officialMatches.length
            ? officialMatches.slice(-3).reverse().map((match) => <MatchCard key={match.matchNumber} match={match} service={service} />)
            : <EmptySection title="Sin resultados oficiales" detail="Los marcadores aparecen únicamente después de cerrar el acta oficial." />}
        </section>
        <section className={`${styles.featurePanel} ${styles.widePanel}`}>
          <ScopeHeading scope={scope} />
          <StandingsTable rows={scope?.standings} service={service} compact />
        </section>
        <section className={`${styles.featurePanel} ${styles.widePanel}`}>
          <div className={styles.sectionHeading}><div><span>Figuras</span><h2>Goleadores</h2></div></div>
          <PlayerList players={scope?.players} limit={5} />
        </section>
      </div>
    );
  }

  if (activeTab === 'fixture') {
    if (!page.hasPublishedFixture) return <EmptySection title="Fixture todavía no publicado" detail="Volvé más adelante para consultar la programación oficial." />;
    return <div className={styles.rounds}>{Object.entries(groups).map(([label, matches]) => <section key={label}><h2>{label}</h2><div className={styles.matchGrid}>{matches.map((match) => <MatchCard key={match.matchNumber} match={match} service={service} />)}</div></section>)}</div>;
  }

  if (activeTab === 'resultados') {
    return officialMatches.length
      ? <div className={styles.matchGrid}>{officialMatches.slice().reverse().map((match) => <MatchCard key={match.matchNumber} match={match} service={service} />)}</div>
      : <EmptySection title="Sin resultados oficiales" detail="No mostramos borradores ni actas en revisión." />;
  }

  if (activeTab === 'tabla') return <><ScopeHeading scope={scope} /><StandingsTable rows={scope?.standings} service={service} /></>;
  if (activeTab === 'goleadores') return <><ScopeHeading scope={scope} /><PlayerList players={scope?.players} /></>;
  if (activeTab === 'equipos') {
    return page.teams.length ? (
      <div className={styles.teamsGrid}>{page.teams.map((team) => <article key={team.name} className={styles.teamCard}><TeamMark team={team} service={service} nameContext="card" /><small>{team.status === 'withdrawn' ? 'Retirado' : 'Participante'}</small></article>)}</div>
    ) : <EmptySection title="Equipos todavía no publicados" detail="Los equipos aparecen cuando existe un fixture oficial." />;
  }
  if (activeTab === 'disciplina') {
    return scope?.discipline?.length ? (
      <div className={styles.disciplineList}>{scope.discipline.map((row) => {
        const remaining = row.suspensions.reduce((total, suspension) => total + suspension.remainingMatches, 0);
        return <article key={`${row.name}-${row.teamName}`}><div><strong {...importantNameProps(row.name, 'player')}>{row.name}</strong><small {...importantNameProps(row.teamName, 'compact')}>{row.teamName}</small></div><span><b>{row.yellowCards}</b> amarillas</span><span><b>{row.redCards}</b> rojas</span><span data-active={remaining > 0}><b>{remaining}</b> fechas pendientes</span></article>;
      })}</div>
    ) : <EmptySection title="Sin disciplina publicada" detail="Sólo se muestran tarjetas y fechas de suspensión; nunca motivos ni notas internas." />;
  }
  return null;
}

export default function PublicTournamentPage({ service = publicTournamentService }) {
  const { publicSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const categorySlug = searchParams.get('categoria');
  const [state, setState] = useState({ status: 'loading', page: null });
  const [activeTab, setActiveTab] = useState('inicio');
  const [scopeKey, setScopeKey] = useState('');

  useEffect(() => {
    let current = true;
    setState({ status: 'loading', page: null });
    service.loadPage({ publicSlug, categorySlug }).then((page) => {
      if (!current) return;
      setState(page ? { status: 'ready', page } : { status: 'not-found', page: null });
      setScopeKey(page?.competition?.[0]?.scopeKey || '');
    }).catch(() => {
      if (current) setState({ status: 'error', page: null });
    });
    return () => { current = false; };
  }, [categorySlug, publicSlug, service]);

  useEffect(() => {
    if (state.status !== 'ready') return undefined;
    const previousTitle = document.title;
    const title = `${state.page.tournament.name} · ${state.page.organization.name} | Arma2`;
    document.title = title;
    const description = state.page.tournament.description
      || `Fixture, resultados y tabla oficial de ${state.page.tournament.name}.`;
    const managed = [
      ['meta[name="description"]', 'name', 'description', description],
      ['meta[property="og:title"]', 'property', 'og:title', title],
      ['meta[property="og:description"]', 'property', 'og:description', description],
    ].map(([selector, attribute, value, content]) => {
      let element = document.head.querySelector(selector);
      const created = !element;
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, value);
        document.head.appendChild(element);
      }
      const previous = element.getAttribute('content');
      element.setAttribute('content', content);
      return { element, created, previous };
    });
    return () => {
      document.title = previousTitle;
      managed.forEach(({ element, created, previous }) => {
        if (created) element.remove();
        else if (previous === null) element.removeAttribute('content');
        else element.setAttribute('content', previous);
      });
    };
  }, [state]);

  const page = state.page;
  const scope = useMemo(() => page?.competition?.find((item) => item.scopeKey === scopeKey)
    || page?.competition?.[0] || null, [page, scopeKey]);

  if (state.status === 'loading') return <main className={styles.statePage} data-torneos-surface="public" data-torneos-tone="dark"><div className={styles.loader} /><p>Cargando competencia oficial…</p></main>;
  if (state.status === 'not-found') return <main className={styles.statePage} data-torneos-surface="public" data-torneos-tone="dark"><TorneosBrand /><span>404</span><h1>Torneo no disponible</h1><p>El enlace no existe, dejó de estar publicado o la competencia ya no está disponible.</p></main>;
  if (state.status === 'error') return <main className={styles.statePage} data-torneos-surface="public" data-torneos-tone="dark"><TorneosBrand /><span>Sin conexión</span><h1>No pudimos cargar el torneo</h1><p>Probá de nuevo en unos minutos.</p><button type="button" onClick={() => window.location.reload()}>Reintentar</button></main>;

  const selectedCategory = page.selectedCategory;
  return (
    <div className={styles.publicPage} data-torneos-surface="public" data-torneos-tone="dark">
      <a className={styles.skipLink} href="#contenido-publico">Saltar al contenido</a>
      <header className={styles.topbar}>
        <TorneosBrand className={styles.brand} />
        <span className={styles.officialBadge} data-torneos-chip><Shield size={14} /> Sitio oficial</span>
      </header>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <span {...importantNameProps(page.organization.name, 'compact')}>{page.organization.name}</span>
            <ChevronRight size={14} />
            <span {...importantNameProps(page.season.name, 'compact')}>{page.season.name}</span>
          </span>
          <h1 {...importantNameProps(page.tournament.name, 'hero')}>{page.tournament.name}</h1>
          <p>{page.tournament.description || 'Información oficial de la competencia.'}</p>
          <div className={styles.heroTags}>
            <span data-status={page.tournament.status} data-torneos-chip>{STATUS_LABELS[page.tournament.status] || getStatusLabel(page.tournament.status)}</span>
            <span data-torneos-chip>{getModalityLabel(page.tournament.sportModality)}</span>
            <span data-torneos-chip>{getFormatLabel(page.tournament.competitionFormat)}</span>
          </div>
        </div>
        <aside className={styles.heroBoard} aria-label="Resumen de competencia">
          <div><CalendarDays size={18} /><span>Temporada</span><b {...importantNameProps(page.season.name, 'card')}>{page.season.name}</b></div>
          <div><Trophy size={18} /><span>Categoría</span><b {...importantNameProps(selectedCategory?.name || 'General', 'card')}>{selectedCategory?.name || 'General'}</b></div>
          <div><Clock3 size={18} /><span>Partidos oficiales</span><b>{page.matches.filter((match) => match.result).length}</b></div>
        </aside>
      </section>
      <div className={styles.controls}>
        {page.categories.length > 1 && <label><span>Categoría</span><TorneosSelect {...importantNameProps(selectedCategory?.name, 'selector')} aria-label="Categoría" value={selectedCategory?.slug || ''} onChange={(event) => setSearchParams(event.target.value ? { categoria: event.target.value } : {})}>{page.categories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}</TorneosSelect></label>}
        {page.competition.length > 1 && <label><span>Fase o grupo</span><TorneosSelect {...importantNameProps(scope?.label, 'selector')} aria-label="Fase o grupo" value={scope?.scopeKey || ''} onChange={(event) => setScopeKey(event.target.value)}>{page.competition.map((item) => <option key={item.scopeKey} value={item.scopeKey}>{item.label}</option>)}</TorneosSelect></label>}
      </div>
      <nav
        className={styles.tabs}
        aria-label="Secciones del torneo"
        data-allow-horizontal-scroll="true"
      >
        {TABS.map(([key, label]) => <button key={key} type="button" aria-current={activeTab === key ? 'page' : undefined} onClick={() => setActiveTab(key)}>{label}</button>)}
      </nav>
      <main id="contenido-publico" className={styles.content} tabIndex="-1">
        <PublicTournamentContent page={page} activeTab={activeTab} scope={scope} service={service} />
      </main>
      <footer className={styles.pageFooter}><TorneosBrand className={styles.brand} /><p>Información oficial publicada por {page.organization.name}.</p></footer>
    </div>
  );
}
