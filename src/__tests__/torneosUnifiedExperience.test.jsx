import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import {
  isTournamentParticipantRelation,
  resolveTorneosUserExperience,
} from '../features/torneos/domain/userExperience';

jest.mock('../components/global-header/GlobalHeader', () => () => <header data-testid="global-header" />);

let mockNativeRuntime = false;

jest.mock('../utils/runtimePlatform', () => ({
  isArma2NativeRuntime: () => mockNativeRuntime,
  getAuthenticatedProductHome: () => (mockNativeRuntime ? '/' : '/torneos'),
}));

const ORGANIZATION = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Liga Devoto',
  slug: 'liga-devoto',
  role: 'owner',
  status: 'active',
  membershipStatus: 'active',
  capabilities: ['workspace.access', 'workspace.manage'],
};

const PARTICIPANT_RELATION = {
  organizationId: '20000000-0000-4000-8000-000000000001',
  organizationName: 'Liga Norte',
  tournamentId: '30000000-0000-4000-8000-000000000001',
  tournamentName: 'Apertura',
  categoryId: '40000000-0000-4000-8000-000000000001',
  teamEntryId: '50000000-0000-4000-8000-000000000001',
  role: 'player',
};

function createService({ organizations = [], relations = [] } = {}) {
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'personal', activeOrganizationId: null },
      organizations,
    }),
    loadExperienceRelations: jest.fn().mockResolvedValue({
      items: relations,
      pagination: { total: relations.length, hasMore: false },
    }),
    setPreference: jest.fn(async (workspaceType, organizationId) => ({
      workspaceType,
      activeOrganizationId: organizationId,
    })),
    createOrganization: jest.fn(),
    updateOrganization: jest.fn(),
  };
}

function renderLanding(service) {
  return render(
    <MemoryRouter initialEntries={['/torneos']}>
      <Routes>
        <Route
          path="/torneos/*"
          element={<TorneosFeatureGate enabled service={service} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Arma2 Torneos unified participant/admin entrypoint', () => {
  beforeEach(() => {
    mockNativeRuntime = false;
  });

  test('shows a truthful empty state for an account without tournament relations', async () => {
    renderLanding(createService());

    expect(await screen.findByRole('heading', {
      name: 'No participás ni administrás torneos todavía',
    }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('global-header')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Descargar la app de Arma2' }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Descargar Arma2 en App Store' }))
      .toHaveAttribute('href', 'https://apps.apple.com/ar/app/arma2/id6760599244');
    expect(screen.getByRole('link', { name: 'Descargar Arma2 en Google Play' }))
      .toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=com.teambalancer.app');
    expect(screen.queryByText('Administrar')).not.toBeInTheDocument();
    expect(screen.queryByText('Mi actividad')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crear organización' }))
      .toHaveAttribute('href', '/torneos/nueva-organizacion');
  });

  test('participant only sees personal activity and no administration', async () => {
    renderLanding(createService({ relations: [PARTICIPANT_RELATION] }));

    expect(await screen.findByText('Mi actividad')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mis torneos/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mis partidos/i })).toBeInTheDocument();
    expect(screen.queryByText('Administrar')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nueva organización/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crear organización' }))
      .toHaveAttribute('href', '/torneos/nueva-organizacion');
  });

  test('owner only sees administration without being classified as participant', async () => {
    const ownerRelation = {
      ...PARTICIPANT_RELATION,
      teamEntryId: null,
      role: 'owner',
      organizationRole: 'owner',
    };
    renderLanding(createService({
      organizations: [ORGANIZATION],
      relations: [ownerRelation],
    }));

    expect(await screen.findByText('Administrar')).toBeInTheDocument();
    expect(screen.getByText('Liga Devoto')).toBeInTheDocument();
    expect(screen.queryByText('Mi actividad')).not.toBeInTheDocument();
  });

  test('dual participant and owner can access both areas with one context', async () => {
    renderLanding(createService({
      organizations: [ORGANIZATION],
      relations: [PARTICIPANT_RELATION],
    }));

    expect(await screen.findByText('Mi actividad')).toBeInTheDocument();
    expect(screen.getByText('Administrar')).toBeInTheDocument();
    expect(screen.getByText('Liga Devoto')).toBeInTheDocument();
  });

  test('limited collaborator keeps its role and may create a separate organization', async () => {
    renderLanding(createService({
      organizations: [{ ...ORGANIZATION, role: 'collaborator' }],
    }));

    // El estado de la organización se dice en castellano: `active` era la
    // clave de `tournament_organizations.status` filtrándose a la tarjeta.
    expect(await screen.findByText('Colaborador · Activa')).toBeInTheDocument();
    expect(screen.queryByText('Colaborador · active')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Nueva organización/i }))
      .toHaveAttribute('href', '/torneos/nueva-organizacion');
    expect(screen.queryByText('Mi actividad')).not.toBeInTheDocument();
  });

  test('mobile-width browser remains web while Torneos participant access stays available', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    mockNativeRuntime = false;
    renderLanding(createService({ relations: [PARTICIPANT_RELATION] }));

    expect(await screen.findByText('Mi actividad')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Volver a Arma2' })).not.toBeInTheDocument();
  });

  test('browser callout links to both live stores and can be dismissed', async () => {
    window.localStorage.removeItem('arma2:torneos:app-callout-dismissed:v1');
    renderLanding(createService());
    expect(await screen.findByText('La web primero. La app te acompaña.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Descargar Arma2 en App Store' }))
      .toHaveAttribute('href', 'https://apps.apple.com/ar/app/arma2/id6760599244');
    expect(screen.getByRole('link', { name: 'Descargar Arma2 en Google Play' }))
      .toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=com.teambalancer.app');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByText('La web primero. La app te acompaña.')).not.toBeInTheDocument();
  });

  test('Capacitor/native preserves the same Torneos access and adds the native exit', async () => {
    mockNativeRuntime = true;
    renderLanding(createService({ relations: [PARTICIPANT_RELATION] }));

    expect(await screen.findByText('Mi actividad')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crear organización' }))
      .toHaveAttribute('href', '/torneos/nueva-organizacion');
    expect(screen.getByRole('link', { name: 'Volver a Arma2' })).toBeInTheDocument();
  });

  test('PREMIUM or participant entitlement never creates administration', () => {
    const experience = resolveTorneosUserExperience({
      organizations: [],
      tournamentRelations: [{
        ...PARTICIPANT_RELATION,
        plan: 'PREMIUM',
        entitlements: { 'media.history': true },
      }],
    });

    expect(isTournamentParticipantRelation(PARTICIPANT_RELATION)).toBe(true);
    expect(experience.hasParticipantActivity).toBe(true);
    expect(experience.hasAdministration).toBe(false);
  });
});
