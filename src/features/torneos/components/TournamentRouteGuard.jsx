import React from 'react';
import { Navigate, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosFixture } from '../context/TorneosFixtureContext';
import { organizationTournaments, readCategoryId } from '../routing/canonicalRoutes';
import { WorkspaceLoading } from './WorkspaceState';

//
// Segundo eslabón de la cadena:
//
//   OrganizationRouteGuard → TournamentRouteGuard → páginas del torneo
//
// No hace ningún request propio. El catálogo de torneos de la organización ya
// lo cargó el provider de competencia que monta el guard de organización, así
// que acá sólo se resuelve contra lo que ya está en memoria.
//
// Todo lo que no se puede afirmar, cierra: un torneo que no existe, uno de
// otra organización o una categoría que no es de este torneo no caen al
// default, redirigen.
//
export default function TournamentRouteGuard() {
  const { organizationId, tournamentId } = useParams();
  const location = useLocation();
  const outletContext = useOutletContext();
  const {
    activeTournament,
    routeTournamentStatus,
    status,
    tournaments,
  } = useTorneosCompetition();
  const { categories } = useTorneosFixture();

  const fallback = organizationTournaments(organizationId);

  if (status === 'loading' || routeTournamentStatus === 'loading') {
    return <WorkspaceLoading label="Confirmando el torneo…" />;
  }

  if (routeTournamentStatus === 'not-found') {
    return (
      <Navigate
        to={fallback}
        replace
        state={{
          safeMessage: 'Ese torneo no existe en esta organización.',
          from: `${location.pathname}${location.search}`,
        }}
      />
    );
  }

  // El torneo salió del catálogo de la organización de la URL, así que la
  // pertenencia ya está implícita. Se comprueba igual: tener dos ids en la
  // ruta no es razón para confiar en los dos.
  const routeTournament = activeTournament
    || tournaments.find((tournament) => tournament.id === tournamentId)
    || null;
  if (!routeTournament) {
    return <WorkspaceLoading label="Confirmando el torneo…" />;
  }
  if (routeTournament.organizationId && routeTournament.organizationId !== organizationId) {
    return (
      <Navigate
        to={fallback}
        replace
        state={{
          safeMessage: 'Ese torneo pertenece a otra organización.',
          from: `${location.pathname}${location.search}`,
        }}
      />
    );
  }

  // `?categoria=` sólo se valida cuando viene explícita. Sin query, la página
  // elige el default de la categoría activa y la URL sigue siendo válida.
  const requestedCategoryId = readCategoryId(location.search);
  if (requestedCategoryId) {
    const belongs = categories.some((category) => category.id === requestedCategoryId);
    if (!belongs) {
      return (
        <Navigate
          to={fallback}
          replace
          state={{
            safeMessage: 'Esa categoría no pertenece a este torneo.',
            from: `${location.pathname}${location.search}`,
          }}
        />
      );
    }
  }

  return <Outlet context={outletContext} />;
}
