import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { tournamentWorkspaceService } from '../torneos/api/tournamentWorkspaceService';
import { canonicalRoutes } from '../torneos/routing/canonicalRoutes';

const palette = {
  background: '#0c0a1d',
  surface: '#171334',
  border: '#2c2559',
  text: '#f7f3ff',
  muted: '#b3a9dd',
  accent: '#8b7cff',
  warn: '#ffd166',
  danger: '#ff7b83',
};

const styles = {
  page: {
    minHeight: '100dvh',
    boxSizing: 'border-box',
    padding: '24px 16px 48px',
    background: palette.background,
    color: palette.text,
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  },
  shell: { width: 'min(920px, 100%)', margin: '0 auto', display: 'grid', gap: 20 },
  eyebrow: {
    width: 'fit-content', padding: '6px 11px', border: `1px solid ${palette.warn}`,
    borderRadius: 999, color: palette.warn, fontSize: 12, fontWeight: 800,
    letterSpacing: '0.08em', textTransform: 'uppercase',
  },
  title: { margin: 0, fontSize: 'clamp(1.8rem, 5vw, 2.8rem)', lineHeight: 1.05 },
  intro: { margin: 0, maxWidth: 720, color: palette.muted, lineHeight: 1.55 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  action: { color: palette.accent, fontWeight: 800 },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12,
  },
  card: {
    display: 'grid', gap: 7, minHeight: 112, boxSizing: 'border-box', padding: 16,
    border: `1px solid ${palette.border}`, borderRadius: 15, background: palette.surface,
    color: palette.text, textDecoration: 'none',
  },
  section: { margin: 0, color: palette.muted, fontSize: 12, fontWeight: 800, textTransform: 'uppercase' },
  label: { fontSize: 17, fontWeight: 800 },
  detail: { color: palette.muted, fontSize: 13, lineHeight: 1.4 },
  state: {
    padding: 18, border: `1px solid ${palette.border}`, borderRadius: 15,
    background: palette.surface, color: palette.muted,
  },
  error: { color: palette.danger },
};

function chooseCanonicalOrganization(organizations) {
  return organizations.find((organization) => organization.slug === 'qa-metropolitana')
    || organizations[0]
    || null;
}

function chooseFreePlanOrganization(organizations) {
  return organizations.find((organization) => organization.slug === 'qa-planes-first-free') || null;
}

function choosePremiumPlanOrganization(organizations) {
  return organizations.find(
    (organization) => organization.slug === 'qa-planes-legacy-premium',
  ) || null;
}

function chooseCanonicalTournament(payload) {
  return payload.tournaments?.find(
    (tournament) => tournament.id === payload.preference?.activeTournamentId,
  ) || payload.tournaments?.find((tournament) => tournament.name === 'Torneo Apertura QA 2026')
    || payload.tournaments?.[0]
    || null;
}

function chooseReviewMatch(matches) {
  return matches.find((match) => Number(match.matchNumber) === 4)
    || matches.find((match) => match.operationId && match.operationStatus === 'official')
    || matches.find((match) => match.operationId)
    || matches[0]
    || null;
}

export default function QaTournamentReviewMapPage({ service = tournamentWorkspaceService }) {
  const [state, setState] = useState({ status: 'loading', model: null, error: '' });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const workspace = await service.loadContext();
        const organization = chooseCanonicalOrganization(workspace?.organizations || []);
        if (!organization) throw new Error('Este rol no tiene una organización QA disponible.');
        const freeOrganization = chooseFreePlanOrganization(workspace?.organizations || []);
        const premiumOrganization = choosePremiumPlanOrganization(workspace?.organizations || []);
        const [competition, freeCompetition, premiumCompetition] = await Promise.all([
          service.loadCompetitionContext(organization.id),
          freeOrganization ? service.loadCompetitionContext(freeOrganization.id) : null,
          premiumOrganization ? service.loadCompetitionContext(premiumOrganization.id) : null,
        ]);
        const tournament = chooseCanonicalTournament(competition || {});
        if (!tournament) throw new Error('No encontramos el torneo principal del dataset QA.');
        const freeTournament = freeCompetition?.tournaments?.find(
          (item) => item.name === 'Liga Free QA · Antes de Playoffs',
        ) || null;
        const premiumTournament = premiumCompetition?.tournaments?.find(
          (item) => item.name === 'Torneo Premium Legacy QA',
        ) || null;
        const category = tournament.categories?.find((item) => item.status === 'active')
          || tournament.categories?.[0]
          || null;
        const freeCategory = freeTournament?.categories?.find((item) => item.status === 'active')
          || freeTournament?.categories?.[0]
          || null;
        const [
          teams, operations, publicPage, premiumPlan, freePlan, freeFixture, postFixture,
        ] = await Promise.all([
          service.loadTeamsContext(organization.id, tournament.id),
          service.loadMatchOperations({
            organizationId: organization.id,
            tournamentId: tournament.id,
            categoryId: category?.id || null,
          }),
          service.loadPublicPageSettings({
            organizationId: organization.id,
            tournamentId: tournament.id,
          }),
          premiumOrganization && premiumTournament ? service.loadEntitlements({
            organizationId: premiumOrganization?.id,
            tournamentId: premiumTournament?.id,
          }) : null,
          freeOrganization && freeTournament ? service.loadEntitlements({
            organizationId: freeOrganization.id,
            tournamentId: freeTournament.id,
          }) : null,
          freeOrganization && freeTournament && freeCategory
            ? service.loadFixtureContext(
              freeOrganization.id,
              freeTournament.id,
              freeCategory.id,
            ) : null,
          category ? service.loadFixtureContext(
            organization.id,
            tournament.id,
            category.id,
          ) : null,
        ]);
        const team = teams?.entries?.find((entry) => entry.name === 'Barrio Norte FC')
          || teams?.entries?.[0]
          || null;
        const match = chooseReviewMatch(operations?.matches || []);
        if (!active) return;
        setState({
          status: 'ready',
          error: '',
          model: {
            organization,
            tournament,
            category,
            team,
            match,
            publicPath: publicPage?.published ? publicPage.publicPath : null,
            planExamples: {
              free: freePlan?.plan === 'FREE' ? { organization: freeOrganization, tournament: freeTournament } : null,
              premium: premiumPlan?.plan === 'PREMIUM'
                ? { organization: premiumOrganization, tournament: premiumTournament }
                : null,
            },
            phaseExamples: {
              before: freeTournament?.status === 'active'
                && freeFixture?.versions?.some((version) => version.status === 'published')
                && freeFixture?.phases?.some((phase) => phase.phaseType === 'league')
                && !freeFixture?.phases?.some((phase) => phase.phaseType !== 'league')
                ? { organization: freeOrganization, tournament: freeTournament, category: freeCategory }
                : null,
              after: postFixture?.phases?.some((phase) => phase.phaseType === 'league')
                && postFixture?.phases?.some((phase) => phase.phaseType !== 'league')
                ? { organization, tournament, category }
                : null,
            },
          },
        });
      } catch (error) {
        if (active) {
          setState({
            status: 'error',
            model: null,
            error: error?.message || 'No pudimos preparar el recorrido QA.',
          });
        }
      }
    })();
    return () => { active = false; };
  }, [service]);

  const links = useMemo(() => {
    if (!state.model) return [];
    const {
      organization, tournament, category, team, match, publicPath, planExamples, phaseExamples,
    } = state.model;
    const options = { categoryId: category?.id || null };
    const entries = [
      ['Inicio', 'Centro de Torneos', canonicalRoutes.organizationHome(organization.id)],
      ['Competencia', 'Temporadas y torneos', canonicalRoutes.organizationTournaments(organization.id)],
      ['Equipos', 'Listado del torneo', canonicalRoutes.tournamentTeams(organization.id, tournament.id, options)],
      ['Fixture', 'Estructura publicada', canonicalRoutes.tournamentFixture(organization.id, tournament.id, options)],
      ['Agenda real', 'Programación', canonicalRoutes.tournamentSchedule(organization.id, tournament.id, options)],
      ['Competencia', 'Tabla', canonicalRoutes.tournamentTable(organization.id, tournament.id, options)],
      ['Competencia', 'Estadísticas', canonicalRoutes.tournamentStatistics(organization.id, tournament.id, options)],
      ['Competencia', 'Disciplina', canonicalRoutes.tournamentDiscipline(organization.id, tournament.id, options)],
      ['Gobierno', 'Configuración del torneo', canonicalRoutes.tournamentConfiguration(organization.id, tournament.id, options)],
      ['Gobierno', 'Plan', canonicalRoutes.organizationSettingsPlan(organization.id)],
      ['Multimedia', 'Centro Multimedia', canonicalRoutes.organizationMedia(organization.id)],
    ];
    if (planExamples?.premium) {
      entries.unshift([
        'Planes',
        'Plan PREMIUM',
        canonicalRoutes.organizationSettingsPlan(planExamples.premium.organization.id),
        'PREMIUM real · legacy_grant validado por servidor',
      ]);
    }
    if (planExamples?.free) {
      entries.unshift([
        'Planes',
        'Plan FREE',
        canonicalRoutes.organizationSettingsPlan(planExamples.free.organization.id),
        'FREE real · first_free validado por servidor',
      ]);
    }
    if (phaseExamples?.before) {
      entries.unshift([
        'Fixture',
        'Liga lista para agregar Playoffs',
        canonicalRoutes.tournamentFixture(
          phaseExamples.before.organization.id,
          phaseExamples.before.tournament.id,
          { categoryId: phaseExamples.before.category.id },
        ),
        'Liga oficial activa · 28 resultados · tabla Top 8 · sin Playoffs',
      ]);
    }
    if (phaseExamples?.after) {
      entries.unshift([
        'Fixture',
        'Liga + Playoffs ya agregados',
        canonicalRoutes.tournamentFixtureBracket(
          phaseExamples.after.organization.id,
          phaseExamples.after.tournament.id,
          { categoryId: phaseExamples.after.category.id },
        ),
        'Estado posterior canónico · Liga y llave publicadas',
      ]);
    }
    if (team) {
      entries.splice(3, 0,
        ['Barrio Norte', 'Información y responsables', canonicalRoutes.organizationTeamEntryRegistration(organization.id, team.id)],
        ['Barrio Norte', 'Identidad visual · Escudo y Foto del equipo', canonicalRoutes.organizationTeamEntryVisualIdentity(organization.id, team.id)],
        ['Barrio Norte', 'Plantel', canonicalRoutes.organizationTeamEntryRoster(organization.id, team.id)]);
    }
    if (match) {
      entries.splice(7, 0,
        ['Partido rico', `Partido #${match.matchNumber || 'QA'}`, canonicalRoutes.tournamentMatch(organization.id, tournament.id, match.id, options)],
        ['Partido rico', 'Acta', canonicalRoutes.tournamentMatchReport(organization.id, tournament.id, match.id, options)]);
    }
    if (publicPath) entries.push(['Pública', 'Página pública', publicPath]);
    return entries;
  }, [state.model]);

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <span style={styles.eyebrow}>Local · Auth y RLS reales</span>
        <h1 style={styles.title}>QA · Recorrido Torneos</h1>
        <p style={styles.intro}>
          Atajos del dataset canónico para revisión humana. No conceden permisos:
          cada destino vuelve a validar la sesión, la relación deportiva y las capabilities reales.
        </p>
        <div style={styles.actions}>
          <Link style={styles.action} to="/qa/rol">Cambiar rol QA</Link>
          <Link style={styles.action} to="/torneos">Empezar desde /torneos</Link>
        </div>
        {state.status === 'loading' ? (
          <section style={styles.state} role="status">Preparando links con el acceso del rol actual…</section>
        ) : null}
        {state.status === 'error' ? (
          <section style={{ ...styles.state, ...styles.error }} role="alert">
            {state.error} Cambiá a Owner o usá el recorrido personal permitido para este rol.
          </section>
        ) : null}
        {state.status === 'ready' ? (
          <section style={styles.grid} aria-label="Destinos del recorrido QA">
            {links.map(([section, label, to, detail = 'Abrir con permisos reales']) => (
              <Link key={`${section}:${label}`} to={to} style={styles.card}>
                <span style={styles.section}>{section}</span>
                <span style={styles.label}>{label}</span>
                <span style={styles.detail}>{detail}</span>
              </Link>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
