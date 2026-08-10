import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import {
  isTournamentParticipantRelation,
  resolveTorneosUserExperience,
} from '../features/torneos/domain/userExperience';

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
    expect(screen.queryByText('Administrar')).not.toBeInTheDocument();
    expect(screen.queryByText('Mi actividad')).not.toBeInTheDocument();
  });

  test('participant only sees personal activity and no administration', async () => {
    renderLanding(createService({ relations: [PARTICIPANT_RELATION] }));

    expect(await screen.findByText('Mi actividad')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mis torneos/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mis partidos/i })).toBeInTheDocument();
    expect(screen.queryByText('Administrar')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nueva organización/i })).not.toBeInTheDocument();
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

  test('limited collaborator is not promoted to owner/admin actions', async () => {
    renderLanding(createService({
      organizations: [{ ...ORGANIZATION, role: 'collaborator' }],
    }));

    expect(await screen.findByText('Colaborador · active')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nueva organización/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Mi actividad')).not.toBeInTheDocument();
  });

  test('mobile-width browser remains web while Torneos participant access stays available', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    mockNativeRuntime = false;
    renderLanding(createService({ relations: [PARTICIPANT_RELATION] }));

    expect(await screen.findByText('Mi actividad')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Volver a Arma2' })).not.toBeInTheDocument();
  });

  test('Capacitor/native preserves the same Torneos access and adds the native exit', async () => {
    mockNativeRuntime = true;
    renderLanding(createService({ relations: [PARTICIPANT_RELATION] }));

    expect(await screen.findByText('Mi actividad')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a Arma2' })).toBeInTheDocument();
  });

  test('PRO or participant entitlement never creates administration', () => {
    const experience = resolveTorneosUserExperience({
      organizations: [],
      tournamentRelations: [{
        ...PARTICIPANT_RELATION,
        plan: 'PRO',
        entitlements: { 'media.history': true },
      }],
    });

    expect(isTournamentParticipantRelation(PARTICIPANT_RELATION)).toBe(true);
    expect(experience.hasParticipantActivity).toBe(true);
    expect(experience.hasAdministration).toBe(false);
  });
});
