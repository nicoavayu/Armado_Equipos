import React, { useEffect } from 'react';
import {
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  CircleDashed,
  Plus,
  Trophy,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import {
  getOptionName,
  SEASON_STATUS_LABELS,
  TOURNAMENT_STATUS_LABELS,
} from '../domain/competitionCatalog';
import {
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import { getTournamentCardAction } from '../domain/competitionLifecycle';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import CompetitionSelector from './CompetitionSelector';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './CompetitionCore.module.css';
import BrandingImage from './BrandingImage';
import { capturePremiumIntent, hasPendingPremiumIntent, withPremiumIntent } from '../domain/premiumIntent';

function formatDateRange(startDate, endDate) {
  if (!startDate && !endDate) return 'Fechas a definir';
  const format = (value) => new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
  if (startDate && endDate) return `${format(startDate)} — ${format(endDate)}`;
  return startDate ? `Desde ${format(startDate)}` : `Hasta ${format(endDate)}`;
}

export default function CompetitionOverviewPage() {
  const { organization } = useOutletContext();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    status,
    error,
    seasons,
    tournaments,
    formats,
    modalities,
    refresh,
  } = useTorneosCompetition();
  const canCreateSeason = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.SEASONS_CREATE,
  );
  const canCreateTournament = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_CREATE,
  );
  const premiumIntent = hasPendingPremiumIntent() || location.search.includes('intent=premium');

  useEffect(() => {
    capturePremiumIntent(location.search);
  }, [location.search]);

  useEffect(() => {
    if (status === 'ready' && premiumIntent && seasons.length === 1) {
      navigate(withPremiumIntent(canonicalRoutes.seasonPlan(organization.id, seasons[0].id)), { replace: true });
    }
  }, [navigate, organization.id, premiumIntent, seasons, status]);

  if (status === 'loading') return <WorkspaceLoading label="Cargando competencia…" />;
  if (status === 'error') {
    return <WorkspaceError message={error} onRetry={() => refresh().catch(() => {})} />;
  }

  if (premiumIntent && seasons.length > 1) {
    return (
      <div className={styles.competitionPage}>
        <header className={styles.competitionHeader}>
          <div>
            <span className={styles.kicker}>PREMIUM POR TEMPORADA</span>
            <h1>Elegí la temporada</h1>
            <p>La compra es permanente para una temporada e incluye todos sus torneos.</p>
          </div>
        </header>
        <section className={styles.sectionBlock} aria-labelledby="premium-season-title">
          <div className={styles.sectionTitle}>
            <div><span>{seasons.length} temporadas</span><h2 id="premium-season-title">¿Cuál querés profesionalizar?</h2></div>
          </div>
          <div className={styles.seasonGrid}>
            {seasons.map((season, index) => {
              const count = tournaments.filter((item) => item.seasonId === season.id).length;
              return (
                <Link key={season.id} to={withPremiumIntent(canonicalRoutes.seasonPlan(organization.id, season.id))}>
                  <span className={styles.seasonIndex}>{String(index + 1).padStart(2, '0')}</span>
                  <span><small>{SEASON_STATUS_LABELS[season.status]}</small><strong>{season.name}</strong><em>{formatDateRange(season.startDate, season.endDate)}</em></span>
                  <span className={styles.countPill}>{count} {count === 1 ? 'torneo' : 'torneos'}</span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.competitionPage}>
      <header className={styles.competitionHeader}>
        <div>
          <span className={styles.kicker}>Núcleo competitivo</span>
          <h1>Temporadas y torneos</h1>
          <p>
            Organizá el calendario, definí reglas y dejá cada competencia lista
            antes de incorporar equipos.
          </p>
        </div>
        <div className={styles.headerActions}>
          {canCreateSeason && (
            <Link className={styles.secondaryAction} to={premiumIntent ? withPremiumIntent(canonicalRoutes.organizationSeasonNew(organization.id)) : canonicalRoutes.organizationSeasonNew(organization.id)}>
              <CalendarPlus size={17} />
              Nueva temporada
            </Link>
          )}
          {canCreateTournament && seasons.length > 0 && !premiumIntent && (
            <Link className={styles.primaryAction} to={premiumIntent ? withPremiumIntent(canonicalRoutes.organizationTournamentNew(organization.id)) : canonicalRoutes.organizationTournamentNew(organization.id)}>
              <Plus size={17} />
              Crear torneo
            </Link>
          )}
        </div>
      </header>

      <CompetitionSelector />

      {!seasons.length ? (
        <section className={styles.emptyCompetition}>
          <span><CalendarPlus size={27} /></span>
          <div>
            <span className={styles.kicker}>Primer paso</span>
            <h2>Creá la primera temporada</h2>
            <p>
              Una temporada agrupa torneos y conserva un calendario institucional.
              No se generan equipos, fixture ni partidos en este paso.
            </p>
          </div>
          {canCreateSeason && (
            <Link className={styles.primaryAction} to={premiumIntent ? withPremiumIntent(canonicalRoutes.organizationSeasonNew(organization.id)) : canonicalRoutes.organizationSeasonNew(organization.id)}>
              Crear temporada
              <ArrowRight size={17} />
            </Link>
          )}
        </section>
      ) : (
        <>
          <section className={styles.sectionBlock} aria-labelledby="seasons-title">
            <div className={styles.sectionTitle}>
              <div>
                <span>{seasons.length} {seasons.length === 1 ? 'temporada' : 'temporadas'}</span>
                <h2 id="seasons-title">Calendario institucional</h2>
              </div>
            </div>
            <div className={styles.seasonGrid}>
              {seasons.map((season) => {
                const count = tournaments.filter(
                  (tournament) => tournament.seasonId === season.id,
                ).length;
                return (
                  <Link key={season.id} to={canonicalRoutes.organizationSeason(organization.id, season.id)}>
                    <span className={styles.seasonIndex}>
                      {String(seasons.indexOf(season) + 1).padStart(2, '0')}
                    </span>
                    <span>
                      <small>{SEASON_STATUS_LABELS[season.status]}</small>
                      <strong>{season.name}</strong>
                      <em>{formatDateRange(season.startDate, season.endDate)}</em>
                    </span>
                    <span className={styles.countPill}>
                      {count} {count === 1 ? 'torneo' : 'torneos'}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className={styles.sectionBlock} aria-labelledby="tournaments-title">
            <div className={styles.sectionTitle}>
              <div>
                <span>{tournaments.length} {tournaments.length === 1 ? 'torneo' : 'torneos'}</span>
                <h2 id="tournaments-title">Competencias configuradas</h2>
              </div>
            </div>
            {!tournaments.length ? (
              <div className={styles.inlineEmpty}>
                <Trophy size={23} />
                <div>
                  <strong>Todavía no hay torneos</strong>
                  <span>Creá uno dentro de una temporada para empezar a configurarlo.</span>
                </div>
                {canCreateTournament && (
                  <Link to={premiumIntent ? withPremiumIntent(canonicalRoutes.organizationTournamentNew(organization.id)) : canonicalRoutes.organizationTournamentNew(organization.id)}>Crear torneo</Link>
                )}
              </div>
            ) : (
              <div className={styles.tournamentGrid}>
                {tournaments.map((tournament) => {
                  const complete = tournament.checklist?.ready;
                  const canUpdate = hasCapability(
                    organization,
                    TOURNAMENT_CAPABILITIES.TOURNAMENTS_UPDATE,
                  );
                  return (
                    <article key={tournament.id}>
                      <div className={styles.tournamentCardTop}>
                        <span className={styles.statusPill} data-status={tournament.status}>
                          {TOURNAMENT_STATUS_LABELS[tournament.status]}
                        </span>
                        {complete
                          ? <CheckCircle2 size={18} className={styles.readyIcon} />
                          : <CircleDashed size={18} className={styles.pendingIcon} />}
                      </div>
                      <BrandingImage
                        kind="tournament"
                        path={tournament.logoPath}
                        fallbackPath={tournament.organizationLogoPath || organization.logoPath}
                        name={tournament.name}
                        className={styles.competitionBrandMark}
                        imageClassName={styles.competitionBrandImage}
                      />
                      <div>
                        <small>
                          {seasons.find((season) => season.id === tournament.seasonId)?.name}
                        </small>
                        <h3>{tournament.name}</h3>
                        <p>{formatDateRange(tournament.startDate, tournament.endDate)}</p>
                      </div>
                      <dl>
                        <div>
                          <dt>Modalidad</dt>
                          <dd>{getOptionName(modalities, tournament.sportModality)}</dd>
                        </div>
                        <div>
                          <dt>Formato</dt>
                          <dd>{getOptionName(formats, tournament.competitionFormat)}</dd>
                        </div>
                        <div>
                          <dt>Categorías</dt>
                          <dd>{tournament.categories?.length || 0}</dd>
                        </div>
                      </dl>
                      <Link to={canonicalRoutes.tournamentConfiguration(organization.id, tournament.id)}>
                        {getTournamentCardAction(tournament.status, canUpdate)}
                        <ArrowRight size={16} />
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
