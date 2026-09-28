// OFFICIALIZATION-V1 — frontend: organization members (invite / pending / roles / removal), the
// organization invitation page, the dual-control-aware match report flow, and the cheap fixes of the
// Production smoke (environment notice, public enum labels, numbered initials, "Presentar plantel").
import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  MemoryRouter,
  Outlet,
  Route,
  Routes,
} from 'react-router-dom';
import OrganizationMembersPage, { organizationInvitationUrl } from '../features/torneos/components/OrganizationMembersPage';
import OrganizationInvitationPage from '../features/torneos/components/OrganizationInvitationPage';
import BrandingImage, { initials } from '../features/torneos/components/BrandingImage';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { TorneosFeaturesProvider } from '../features/torneos/context/TorneosFeaturesContext';
import { getCapabilitiesForRole, hasCapability, TOURNAMENT_CAPABILITIES } from '../features/torneos/domain/capabilities';
import {
  canConfirmAlone,
  canViewerValidate,
  confirmMatchOperation,
  readDualControl,
} from '../features/torneos/domain/matchOfficialization';
import { resolveTorneosEnvironmentNotice } from '../features/torneos/config/environmentNotice';
import { getCompetitionFormatName, getSportModalityName } from '../features/torneos/domain/competitionCatalog';
import { stagingV1Features } from '../features/torneos/stagingV1/stagingV1Features';

let mockWorkspace;
jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => {
  const actual = jest.requireActual('../features/torneos/context/TorneosWorkspaceContext');
  return {
    ...actual,
    useTorneosWorkspace: (...args) => (mockWorkspace ? mockWorkspace : actual.useTorneosWorkspace(...args)),
  };
});
jest.mock('../components/global-header/GlobalHeader', () => () => <header data-testid="global-header" />);

const ORG = '10000000-0000-4000-8000-000000000001';
const organizationFor = (role) => ({
  id: ORG,
  name: 'Liga Metropolitana',
  slug: 'liga-metropolitana',
  status: 'active',
  role,
  capabilities: getCapabilitiesForRole(role),
});

const MEMBERS = [
  { id: 'm-owner', user_id: 'u-owner', role: 'owner', status: 'active', joined_at: '2026-09-01T00:00:00Z', email: null, is_viewer: false },
  { id: 'm-admin', user_id: 'u-admin', role: 'admin', status: 'active', joined_at: '2026-09-02T00:00:00Z', email: 'admin@club.com', is_viewer: false },
  { id: 'm-collab', user_id: 'u-collab', role: 'collaborator', status: 'active', joined_at: '2026-09-03T00:00:00Z', email: 'collab@club.com', is_viewer: false },
];

function membersService(overrides = {}) {
  return {
    listMembers: jest.fn().mockResolvedValue(MEMBERS),
    loadCompetitionContext: jest.fn().mockResolvedValue({ seasons: [] }),
    listSeasonMemberAssignments: jest.fn().mockResolvedValue([]),
    listMemberInvitations: jest.fn().mockResolvedValue([
      { id: 'inv-1', email: 'nuevo@club.com', role: 'admin', status: 'pending', expiresAt: '2030-01-01T00:00:00Z' },
      { id: 'inv-2', email: 'viejo@club.com', role: 'collaborator', status: 'expired', expiresAt: '2020-01-01T00:00:00Z' },
    ]),
    inviteMember: jest.fn().mockResolvedValue({
      invitationId: 'inv-3', role: 'admin', email: 'b@club.com', expiresAt: '2030-01-08T00:00:00Z', token: 'a'.repeat(64),
    }),
    revokeMemberInvitation: jest.fn().mockResolvedValue({ status: 'revoked' }),
    updateMemberRole: jest.fn().mockResolvedValue({ role: 'admin' }),
    removeMember: jest.fn().mockResolvedValue({ status: 'removed' }),
    ...overrides,
  };
}

function renderMembers(role, service, features) {
  mockWorkspace = { service };
  const organization = organizationFor(role);
  return render(
    <TorneosFeaturesProvider features={features}>
      <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/miembros`]}>
        <Routes>
          <Route path="/torneos/organizacion/:organizationId" element={<Outlet context={{ organization }} />}>
            <Route path="miembros" element={<OrganizationMembersPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TorneosFeaturesProvider>,
  );
}

describe('OFFICIALIZATION-V1 organization members page', () => {
  let confirmSpy;
  beforeEach(() => { confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true); });
  afterEach(() => { confirmSpy.mockRestore(); mockWorkspace = undefined; });

  test('the owner invites an administrator and receives the one-time link; no "Próximamente" anywhere', async () => {
    const service = membersService();
    renderMembers('owner', service, stagingV1Features);
    expect(await screen.findByText('admin@club.com')).toBeInTheDocument();
    expect(screen.queryByText(/Próximamente/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Invitar miembro/ }));
    const roleSelect = screen.getByLabelText('Rol');
    expect(within(roleSelect).getAllByRole('option').map((o) => o.value)).toEqual(['admin', 'collaborator']);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'b@club.com' } });
    fireEvent.change(roleSelect, { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: /Generar enlace/ }));
    await waitFor(() => expect(service.inviteMember).toHaveBeenCalledWith({ organizationId: ORG, email: 'b@club.com', role: 'admin' }));
    expect(await screen.findByLabelText('Enlace de invitación')).toHaveValue(organizationInvitationUrl('a'.repeat(64)));
    expect(service.listMemberInvitations).toHaveBeenCalledTimes(2);
  });

  test('an administrator can only invite collaborators and cannot revoke an administrator invitation', async () => {
    renderMembers('admin', membersService(), stagingV1Features);
    fireEvent.click(await screen.findByRole('button', { name: /Invitar miembro/ }));
    expect(within(screen.getByLabelText('Rol')).getAllByRole('option').map((o) => o.value)).toEqual(['collaborator']);
    const pending = await screen.findByText('nuevo@club.com');
    expect(within(pending.closest('article')).queryByRole('button', { name: /Revocar/ })).not.toBeInTheDocument();
    expect(within(screen.getByText('viejo@club.com').closest('article')).getByRole('button', { name: /Revocar/ })).toBeInTheDocument();
    expect(screen.getByText(/Vencida/)).toBeInTheDocument();
    // No role selector for an admin; removal only of collaborators.
    expect(screen.queryByLabelText(/^Rol de /)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quitar a admin@club.com/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quitar a collab@club.com/ })).toBeInTheDocument();
  });

  test('a collaborator sees members without emails and no management controls', async () => {
    const service = membersService({
      listMembers: jest.fn().mockResolvedValue(MEMBERS.map((m) => ({ ...m, email: null, is_viewer: m.role === 'collaborator' }))),
    });
    renderMembers('collaborator', service, stagingV1Features);
    expect(await screen.findByText(/Miembro · u-collab \(vos\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invitar miembro/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quitar a/ })).not.toBeInTheDocument();
    expect(service.listMemberInvitations).not.toHaveBeenCalled();
  });

  test('the owner changes a role and removes a member; the owner row has no controls', async () => {
    const service = membersService();
    renderMembers('owner', service, stagingV1Features);
    const select = await screen.findByLabelText('Rol de collab@club.com');
    fireEvent.change(select, { target: { value: 'admin' } });
    await waitFor(() => expect(service.updateMemberRole).toHaveBeenCalledWith({ organizationId: ORG, membershipId: 'm-collab', role: 'admin' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Quitar a admin@club.com' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Quitar a admin@club.com' }));
    await waitFor(() => expect(service.removeMember).toHaveBeenCalledWith({ organizationId: ORG, membershipId: 'm-admin' }));
    expect(screen.queryByLabelText(/Rol de Propietario/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quitar a Propietario/ })).not.toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByText('nuevo@club.com').closest('article')).getByRole('button', { name: /Revocar/ })).toBeEnabled());
    fireEvent.click(within(screen.getByText('nuevo@club.com').closest('article')).getByRole('button', { name: /Revocar/ }));
    await waitFor(() => expect(service.revokeMemberInvitation).toHaveBeenCalledWith({ organizationId: ORG, invitationId: 'inv-1' }));
  });

  test('a service without the membership aliases (legacy LOCAL) shows no invitation control and makes no invitation request', async () => {
    const service = membersService();
    delete service.inviteMember; delete service.listMemberInvitations; delete service.updateMemberRole; delete service.removeMember;
    renderMembers('owner', service);
    expect(await screen.findByText('admin@club.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invitar miembro/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Próximamente/)).not.toBeInTheDocument();
  });

  test('with the feature off the membership surface does not act even if the service has the aliases', async () => {
    const service = membersService();
    renderMembers('owner', service, { ...stagingV1Features, organization_members: false });
    expect(await screen.findByText('admin@club.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invitar miembro/ })).not.toBeInTheDocument();
    expect(service.listMemberInvitations).not.toHaveBeenCalled();
  });
});

describe('OFFICIALIZATION-V1 organization invitation page', () => {
  afterEach(() => { mockWorkspace = undefined; });
  const renderInvitation = (service) => {
    mockWorkspace = { service, refresh: jest.fn().mockResolvedValue(undefined) };
    return render(
      <MemoryRouter initialEntries={[`/torneos/invitacion/organizacion/${'b'.repeat(64)}`]}>
        <Routes><Route path="/torneos/invitacion/organizacion/:token" element={<OrganizationInvitationPage />} /></Routes>
      </MemoryRouter>,
    );
  };

  test('accepts the token and links to the organization', async () => {
    const service = { acceptOrganizationInvitation: jest.fn().mockResolvedValue({ organizationId: ORG, organizationName: 'Liga Metropolitana', role: 'admin', status: 'accepted' }) };
    renderInvitation(service);
    fireEvent.click(screen.getByRole('button', { name: /Aceptar invitación/ }));
    expect(await screen.findByText(/Ya sos Administrador de Liga Metropolitana/)).toBeInTheDocument();
    expect(service.acceptOrganizationInvitation).toHaveBeenCalledWith('b'.repeat(64));
    expect(mockWorkspace.refresh).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Abrir organización' })).toHaveAttribute('href', expect.stringContaining(ORG));
  });

  test('shows the backend refusal (other email) and a disabled button without the alias', async () => {
    const service = { acceptOrganizationInvitation: jest.fn().mockRejectedValue(new Error('La invitación no existe, ya fue usada o no corresponde a esta cuenta.')) };
    const { unmount } = renderInvitation(service);
    fireEvent.click(screen.getByRole('button', { name: /Aceptar invitación/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no corresponde a esta cuenta');
    unmount();
    renderInvitation({});
    expect(screen.getByRole('button', { name: /Aceptar invitación/ })).toBeDisabled();
  });
});

describe('OFFICIALIZATION-V1 match officialization helper', () => {
  const ctx = (status, dualControl) => ({ operation: { id: 'op', status }, ...(dualControl ? { dualControl } : {}) });
  const all = { canSubmit: true, canReview: true, canValidate: true, canMakeOfficial: true };

  test('a context without dualControl (pre-0005 backend) reads as ON: nothing is confirmable alone', () => {
    expect(readDualControl(ctx('under_review'))).toEqual({ known: false, enabled: true, submittedByViewer: false, validatedByViewer: false });
    expect(canConfirmAlone(ctx('under_review'), all)).toBe(false);
    expect(canViewerValidate(ctx('under_review'))).toBe(true);
  });

  test('OFF: every step is confirmable by one owner/admin; ON: the submitter cannot validate', () => {
    for (const status of ['draft', 'submitted', 'under_review', 'validated']) {
      expect(canConfirmAlone(ctx(status, { enabled: false, submittedByViewer: true }), all)).toBe(true);
    }
    expect(canConfirmAlone(ctx('official', { enabled: false }), all)).toBe(false);
    expect(canConfirmAlone(ctx('under_review', { enabled: false }), { ...all, canValidate: false })).toBe(false);
    expect(canConfirmAlone(ctx('draft', { enabled: false }), { ...all, canSubmit: false })).toBe(false);
    expect(canConfirmAlone(ctx('under_review', { enabled: true, submittedByViewer: false }), all)).toBe(false);
    expect(canViewerValidate(ctx('under_review', { enabled: true, submittedByViewer: true }))).toBe(false);
    expect(canViewerValidate(ctx('under_review', { enabled: true, submittedByViewer: false }))).toBe(true);
    expect(canViewerValidate(ctx('under_review', { enabled: false, submittedByViewer: true }))).toBe(true);
  });

  test('confirmMatchOperation walks submit → review → validate → official, reading the state back after each step', async () => {
    const states = ['draft', 'submitted', 'under_review', 'validated', 'official'];
    let i = 0;
    const service = {
      loadMatchOperation: jest.fn(async () => ctx(states[i])),
      submitMatchOperation: jest.fn(async () => { i += 1; }),
      reviewMatchOperation: jest.fn(async () => { i += 1; }),
      validateMatchOperation: jest.fn(async () => { i += 1; }),
      makeMatchOfficial: jest.fn(async () => { i += 1; }),
    };
    const result = await confirmMatchOperation(service, { organizationId: ORG, operationId: 'op', reason: 'Resultado confirmado' });
    expect(result.operation.status).toBe('official');
    expect(service.reviewMatchOperation).toHaveBeenCalledWith({ organizationId: ORG, operationId: 'op', decision: 'approved', reason: 'Resultado confirmado' });
    expect([service.submitMatchOperation, service.validateMatchOperation, service.makeMatchOfficial].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  test('resumes from an intermediate state and stops on an error without skipping a step', async () => {
    let status = 'under_review';
    const service = {
      loadMatchOperation: jest.fn(async () => ctx(status)),
      validateMatchOperation: jest.fn(async () => { throw new Error('Este torneo usa doble control'); }),
      makeMatchOfficial: jest.fn(),
    };
    await expect(confirmMatchOperation(service, { organizationId: ORG, operationId: 'op' })).rejects.toThrow('doble control');
    expect(service.makeMatchOfficial).not.toHaveBeenCalled();
    status = 'voided';
    await expect(confirmMatchOperation(service, { organizationId: ORG, operationId: 'op' })).rejects.toThrow('no está en un estado');
  });
});

describe('OFFICIALIZATION-V1 match report page', () => {
  const TOURNAMENT = 'a2000000-0000-4000-8000-000000000001';
  const CATEGORY = 'a3000000-0000-4000-8000-000000000001';
  const MATCH = 'a4000000-0000-4000-8000-000000000001';
  afterEach(() => { mockWorkspace = undefined; });
  function service(role, operation) {
    const organization = { id: ORG, name: 'Liga', slug: 'liga', role, capabilities: getCapabilitiesForRole(role) };
    return {
      loadContext: jest.fn().mockResolvedValue({ preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG }, organizations: [organization] }),
      setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
      loadCompetitionContext: jest.fn().mockResolvedValue({
        preference: { organizationId: ORG, activeSeasonId: 's', activeTournamentId: TOURNAMENT },
        seasons: [{ id: 's', name: 'Apertura', status: 'active' }],
        tournaments: [{ id: TOURNAMENT, seasonId: 's', name: 'Liga Devoto', status: 'active', categories: [{ id: CATEGORY, name: 'Primera', status: 'active' }] }],
        modalities: [], formats: [],
      }),
      setTournamentContext: jest.fn(),
      loadFixtureContext: jest.fn().mockResolvedValue({}),
      loadScheduleContext: jest.fn().mockResolvedValue({}),
      loadMatchOperations: jest.fn().mockResolvedValue({ matches: [{
        id: MATCH, categoryId: CATEGORY, matchNumber: 7, scheduledAt: '2030-06-01T18:00:00.000Z', planningStatus: 'ready',
        homeTeamEntryId: 'h', awayTeamEntryId: 'a', homeName: 'Napoli', awayName: 'Belgrano', operationId: 'op', operationStatus: operation.operation.status,
      }] }),
      loadMatchOperation: jest.fn().mockResolvedValue(operation),
      loadMatchSquad: jest.fn(),
      submitMatchOperation: jest.fn(),
      reviewMatchOperation: jest.fn(),
      validateMatchOperation: jest.fn(),
      makeMatchOfficial: jest.fn(),
      createIdempotencyKey: jest.fn(() => 'k'),
    };
  }
  const operation = (status, dualControl) => ({
    operation: {
      id: 'op', organization_id: ORG, tournament_id: TOURNAMENT, status, operation_version: 1,
      submitted_at: status === 'draft' ? null : '2030-06-01T20:00:00Z', opened_at: '2030-06-01T19:00:00Z',
      home_team_snapshot: { name: 'Napoli' }, away_team_snapshot: { name: 'Belgrano' }, source_operation_id: null,
    },
    outcome: null, score: null, players: [], events: [], reviews: [], resumptions: [],
    ...(dualControl ? { dualControl } : {}),
  });
  const renderAt = (path, svc) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/torneos/*" element={<TorneosFeatureGate enabled service={svc} />} /></Routes>
    </MemoryRouter>,
  );

  test('dual control OFF: the owner reviewing their own report gets "Confirmar y oficializar" and no dual-control wait', async () => {
    const svc = service('owner', operation('submitted', { enabled: false, submittedByViewer: true, validatedByViewer: false }));
    renderAt(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos/${MATCH}/revision`, svc);
    expect(await screen.findByRole('button', { name: /Confirmar y oficializar/ })).toBeInTheDocument();
    expect(screen.getByText(/Doble control desactivado/)).toBeInTheDocument();
    expect(screen.queryByText(/Otro Administrador debe validarla/)).not.toBeInTheDocument();
  });

  test('dual control ON: the submitter sees who must validate and no "Validar acta" button', async () => {
    const svc = service('admin', operation('under_review', { enabled: true, submittedByViewer: true, validatedByViewer: false }));
    renderAt(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos/${MATCH}/revision`, svc);
    expect(await screen.findByText(/Doble control activo/)).toHaveTextContent('Presentada por vos. Otro Administrador debe validarla.');
    expect(screen.queryByRole('button', { name: /Validar acta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar y oficializar/ })).not.toBeInTheDocument();
  });

  test('dual control ON: another administrator can validate', async () => {
    const svc = service('admin', operation('under_review', { enabled: true, submittedByViewer: false, validatedByViewer: false }));
    renderAt(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos/${MATCH}/revision`, svc);
    expect(await screen.findByRole('button', { name: /Validar acta/ })).toBeInTheDocument();
    expect(screen.getByText(/Presentada por otro miembro/)).toBeInTheDocument();
  });

  test('dual control OFF on a draft: "Presentar y oficializar" runs every step for one organizer', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const svc = service('owner', operation('draft', { enabled: false, submittedByViewer: false, validatedByViewer: false }));
    const steps = ['draft', 'submitted', 'under_review', 'validated', 'official'];
    let i = 0;
    svc.loadMatchOperation.mockImplementation(async () => operation(steps[Math.min(i, 4)], { enabled: false, submittedByViewer: i > 0, validatedByViewer: i > 2 }));
    const advance = async () => { i += 1; };
    for (const f of ['submitMatchOperation', 'reviewMatchOperation', 'validateMatchOperation', 'makeMatchOfficial']) svc[f].mockImplementation(advance);
    renderAt(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos/${MATCH}/acta`, svc);
    fireEvent.click(await screen.findByRole('button', { name: /Presentar y oficializar/ }));
    await waitFor(() => expect(svc.makeMatchOfficial).toHaveBeenCalledTimes(1));
    expect(svc.reviewMatchOperation).toHaveBeenCalledWith(expect.objectContaining({ decision: 'approved' }));
    window.confirm.mockRestore();
  });
});

describe('OFFICIALIZATION-V1 capabilities and cheap fixes from the Production smoke', () => {
  test('only the owner configures the dual-control policy', () => {
    expect(hasCapability(organizationFor('owner'), TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_CONFIGURE_DUAL_CONTROL)).toBe(true);
    expect(hasCapability(organizationFor('admin'), TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_CONFIGURE_DUAL_CONTROL)).toBe(false);
    expect(hasCapability(organizationFor('collaborator'), TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_CONFIGURE_DUAL_CONTROL)).toBe(false);
  });

  test('the environment notice never claims isolation in Production (or when undeclared)', () => {
    expect(resolveTorneosEnvironmentNotice({ REACT_APP_TORNEOS_DATA_ENV: 'production' })).toBeNull();
    expect(resolveTorneosEnvironmentNotice({})).toBeNull();
    expect(resolveTorneosEnvironmentNotice({ REACT_APP_TORNEOS_DATA_ENV: 'local' }).title).toBe('Entorno local');
    expect(resolveTorneosEnvironmentNotice({ REACT_APP_TORNEOS_DATA_ENV: 'staging' }).title).toBe('Entorno de pruebas');
  });

  test('public enums are shown with their Spanish names', () => {
    expect(getSportModalityName('football_5')).toBe('Fútbol 5');
    expect(getCompetitionFormatName('groups_and_playoffs')).toBe('Grupos y eliminatorias');
  });

  test('numbered team names keep distinct initials; other names keep the first two letters', () => {
    expect(['QA Equipo 1', 'QA Equipo 2', 'QA Equipo 12'].map(initials)).toEqual(['Q1', 'Q2', 'Q12']);
    expect(initials('Deportivo Belgrano')).toBe('DB');
    expect(initials('Asociación Metropolitana de Papi')).toBe('AM');
    expect(initials('River')).toBe('R');
    expect(initials('')).toBe('A2');
    render(<BrandingImage kind="team" name="QA Equipo 3" />);
    expect(screen.getByText('Q3')).toBeInTheDocument();
  });
});
