import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import { clearTeamPhotoUrlCache } from '../features/torneos/components/useTeamPhotoUrl';

const mockLoadTeamPhotoState = jest.fn();
const mockResolveTeamPhoto = jest.fn();
const mockUploadTeamPhoto = jest.fn();
const mockSetEditorialStatus = jest.fn();
const mockRevokeTeamPhoto = jest.fn();
const mockRemoveTeamPhoto = jest.fn();

jest.mock('../features/torneos/api/tournamentTeamPhotoService', () => ({
  loadTeamPhotoState: (...args) => mockLoadTeamPhotoState(...args),
  resolveTeamPhoto: (...args) => mockResolveTeamPhoto(...args),
  uploadTeamPhoto: (...args) => mockUploadTeamPhoto(...args),
  setTeamPhotoEditorialStatus: (...args) => mockSetEditorialStatus(...args),
  revokeTeamPhoto: (...args) => mockRevokeTeamPhoto(...args),
  removeTeamPhoto: (...args) => mockRemoveTeamPhoto(...args),
}));

jest.mock('../features/torneos/api/tournamentPlayerPortraitService', () => ({
  loadRosterPortraits: jest.fn().mockResolvedValue(new Map()),
  resolvePlayerPortrait: jest.fn(),
  uploadPlayerPortrait: jest.fn(),
  setPlayerPortraitCrop: jest.fn(),
  removePlayerPortrait: jest.fn(),
}));

jest.mock('../features/torneos/api/tournamentBrandingService', () => ({
  uploadTournamentBrandingAsset: jest.fn(),
  removeTournamentBrandingAsset: jest.fn(),
}));

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const ORG = '71000000-0000-4000-8000-000000000001';
const SEASON = '72000000-0000-4000-8000-000000000001';
const TOURNAMENT = '73000000-0000-4000-8000-000000000001';
const ENTRY = '74000000-0000-4000-8000-000000000001';
const CURRENT = '76000000-0000-4000-8000-000000000001';
const CANDIDATE = '76000000-0000-4000-8000-000000000002';
const CURRENT_REF = { kind: 'team_photo', id: CURRENT, variant: 'original' };
const CANDIDATE_REF = { kind: 'team_photo', id: CANDIDATE, variant: 'original' };

const currentPhoto = {
  teamPhotoId: CURRENT, ref: CURRENT_REF, width: 1600, height: 900,
  editorialStatus: 'approved', approvedAt: '2026-08-20T10:00:00Z',
};
const pendingCandidate = {
  teamPhotoId: CANDIDATE, ref: CANDIDATE_REF, width: 1600, height: 900,
  editorialStatus: 'pending_review', reviewReason: null,
};

function registration() {
  return {
    entry: {
      id: ENTRY, organizationId: ORG, tournamentId: TOURNAMENT,
      categoryId: 'category-a', name: 'Barrio Norte FC', status: 'approved',
      linked: false, shieldPath: null,
    },
    tournament: { id: TOURNAMENT, name: 'Apertura QA', status: 'active' },
    category: { id: 'category-a', name: 'Primera' },
    settings: { minimumPlayers: 2, maximumPlayers: 10, minimumGoalkeepers: 1 },
    managers: [],
    roster: { id: 'roster-a', version: 1, status: 'approved', players: [] },
    reviews: [],
    audit: [],
    viewer: { scope: 'full' },
    visualAssets: { policy: 'delegates', canManageShield: true, canManagePortraits: true },
  };
}

function createService({ role = 'owner' } = {}) {
  const organization = {
    id: ORG, name: 'AMFA', slug: 'amfa', role, capabilities: getCapabilitiesForRole(role),
  };
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG },
      organizations: [organization],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    loadCompetitionContext: jest.fn().mockResolvedValue({
      preference: { organizationId: ORG, activeSeasonId: SEASON, activeTournamentId: TOURNAMENT },
      seasons: [{ id: SEASON, organizationId: ORG, name: 'Apertura', status: 'active' }],
      tournaments: [{
        id: TOURNAMENT, organizationId: ORG, seasonId: SEASON, name: 'Apertura QA',
        status: 'active',
        categories: [{ id: 'category-a', name: 'Primera', status: 'active' }],
      }],
      modalities: [], formats: [],
    }),
    setTournamentContext: jest.fn(),
    loadTeamRegistration: jest.fn().mockResolvedValue(registration()),
    updateTeamEntry: jest.fn(),
    createProvisionalPlayer: jest.fn(),
    addRosterPlayer: jest.fn(),
    updateRosterPlayer: jest.fn(),
    removeRosterPlayer: jest.fn(),
    submitTeamEntry: jest.fn(),
    reviewTeamEntry: jest.fn(),
    searchPlayers: jest.fn().mockResolvedValue([]),
    searchArma2Teams: jest.fn().mockResolvedValue([]),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
}

function photoState(overrides = {}) {
  return {
    organizationId: ORG, teamEntryId: ENTRY,
    canManage: false, canModerate: false, current: null, candidate: null,
    ...overrides,
  };
}

function renderEntry(service, path = 'inscripcion') {
  return render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/equipos/${ENTRY}/${path}`]}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const panel = () => screen.getByRole('heading', { name: 'Foto del equipo' }).closest('section');

async function openPanel(state, { role = 'owner', path = 'inscripcion' } = {}) {
  mockLoadTeamPhotoState.mockResolvedValue(state);
  renderEntry(createService({ role }), path);
  if (path === 'inscripcion') await screen.findByRole('heading', { name: 'Foto del equipo' });
  else await screen.findByText('Barrio Norte FC');
  return panel;
}

const validFile = () => new File(['jpeg-bytes'], 'plantel.jpg', { type: 'image/jpeg' });

/*
 * Esperar una imagen firmada es esperar un viaje de ida y vuelta por el caché
 * compartido, y en el primer test del archivo eso compite con la carga en frío
 * del módulo. El default de `waitFor` alcanza justo, y «justo» es un test
 * intermitente. El resolver está mockeado: si tarda 3 s, hay un bug real.
 */
const SIGNED = Object.freeze({ timeout: 3000 });

function chooseFile(scope, file) {
  const input = scope.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

beforeEach(() => {
  jest.clearAllMocks();
  clearTeamPhotoUrlCache();
  URL.createObjectURL = jest.fn(() => 'blob:team-photo-preview');
  URL.revokeObjectURL = jest.fn();
  mockResolveTeamPhoto.mockImplementation(async (ref) => ({
    ref, url: `http://127.0.0.1:57321/signed/${ref.id}`, ttlSeconds: 300,
    width: 1600, height: 900, mimeType: 'image/jpeg',
  }));
});

describe('what each actor sees', () => {
  test('a read-only viewer sees the current photo and its state, and no controls', async () => {
    await openPanel(photoState({ current: currentPhoto }), { role: 'collaborator' });
    expect(within(panel()).getByText('Publicada')).toBeInTheDocument();
    // Poder entrar no es poder ejecutar: ni subir, ni aprobar, ni retirar. Se
    // afirma antes de la imagen porque no depende de ninguna firma.
    for (const label of [/Subir/, /Reemplazar/, /Aprobar/, /Rechazar/, /Retirar/, /Dar de baja/]) {
      expect(within(panel()).queryByRole('button', { name: label })).toBeNull();
    }
    await waitFor(() => expect(
      within(panel()).getByAltText('Foto del equipo Barrio Norte FC'),
    ).toBeInTheDocument(), SIGNED);
  });

  test('a read-only viewer is never shown the pending candidate', async () => {
    // El servidor no se la manda; la pantalla tampoco la inventa ni deja hueco.
    await openPanel(photoState({ current: currentPhoto, candidate: null }), { role: 'collaborator' });
    expect(within(panel()).queryByText('En revisión')).toBeNull();
    expect(within(panel()).queryByAltText(/Foto enviada/)).toBeNull();
  });

  test('someone who can manage can upload but cannot decide', async () => {
    await openPanel(photoState({
      canManage: true, canModerate: false, current: currentPhoto, candidate: pendingCandidate,
    }));
    expect(within(panel()).getByRole('button', { name: /Subir otra/ })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: /Dar de baja/ })).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: /Aprobar/ })).toBeNull();
    expect(within(panel()).queryByRole('button', { name: /Rechazar/ })).toBeNull();
    expect(within(panel()).queryByRole('button', { name: /Retirar/ })).toBeNull();
  });

  test('someone who can moderate decides but is not handed upload rights it lacks', async () => {
    await openPanel(photoState({
      canManage: false, canModerate: true, current: currentPhoto, candidate: pendingCandidate,
    }));
    expect(within(panel()).getByRole('button', { name: /Aprobar/ })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: /Rechazar/ })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: /Retirar la vigente/ })).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: /Subir|Reemplazar/ })).toBeNull();
  });
});

describe('the current photo survives a pending candidate', () => {
  test('with a candidate waiting, the photo on screen is still the approved one', async () => {
    await openPanel(photoState({
      canManage: true, canModerate: true, current: currentPhoto, candidate: pendingCandidate,
    }));
    await waitFor(() => expect(
      within(panel()).getByAltText('Foto del equipo Barrio Norte FC'),
    ).toHaveAttribute('src', `http://127.0.0.1:57321/signed/${CURRENT}`), SIGNED);
    expect(within(panel()).getByText('Foto vigente')).toBeInTheDocument();
    expect(within(panel()).getByText('En revisión')).toBeInTheDocument();
    expect(within(panel()).getByText(/la organización todavía no la revisó/i)).toBeInTheDocument();
  });

  test('uploading says out loud that the current photo did not change', async () => {
    await openPanel(photoState({ canManage: true, current: currentPhoto }));
    mockUploadTeamPhoto.mockResolvedValue({
      ref: CANDIDATE_REF, editorialStatus: 'pending_review',
      replacedCandidateId: null, currentTeamPhotoId: CURRENT,
    });
    mockLoadTeamPhotoState.mockResolvedValue(photoState({
      canManage: true, current: currentPhoto, candidate: pendingCandidate,
    }));
    chooseFile(panel(), validFile());
    await screen.findByText(/Foto enviada a revisión\. La foto vigente no cambió\./);
    expect(mockUploadTeamPhoto).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, teamEntryId: ENTRY,
    }));
  });

  test('a rejected candidate shows its reason and leaves the current photo alone', async () => {
    await openPanel(photoState({
      canManage: true, current: currentPhoto,
      candidate: {
        ...pendingCandidate, editorialStatus: 'rejected',
        reviewReason: 'No se ve el plantel completo.',
      },
    }));
    expect(within(panel()).getByText('Rechazada')).toBeInTheDocument();
    expect(within(panel()).getByText('No se ve el plantel completo.')).toBeInTheDocument();
    await waitFor(() => expect(
      within(panel()).getByAltText('Foto del equipo Barrio Norte FC'),
    ).toHaveAttribute('src', `http://127.0.0.1:57321/signed/${CURRENT}`), SIGNED);
  });
});

describe('moderating', () => {
  test('approving promotes the candidate and reloads the state from the server', async () => {
    await openPanel(photoState({
      canModerate: true, current: currentPhoto, candidate: pendingCandidate,
    }));
    mockSetEditorialStatus.mockResolvedValue({
      teamPhotoId: CANDIDATE, editorialStatus: 'approved', replacedTeamPhotoId: CURRENT,
    });
    mockLoadTeamPhotoState.mockResolvedValue(photoState({
      canModerate: true,
      current: { ...currentPhoto, teamPhotoId: CANDIDATE, ref: CANDIDATE_REF },
      candidate: null,
    }));
    fireEvent.click(within(panel()).getByRole('button', { name: /Aprobar/ }));
    await screen.findByText(/Foto aprobada\. Ahora es la foto del equipo\./);
    expect(mockSetEditorialStatus).toHaveBeenCalledWith({
      organizationId: ORG, teamPhotoId: CANDIDATE, editorialStatus: 'approved',
    });
    await waitFor(() => expect(
      within(panel()).getByAltText('Foto del equipo Barrio Norte FC'),
    ).toHaveAttribute('src', `http://127.0.0.1:57321/signed/${CANDIDATE}`), SIGNED);
  });

  test('rejecting asks for a reason before it commits anything', async () => {
    await openPanel(photoState({
      canModerate: true, current: currentPhoto, candidate: pendingCandidate,
    }));
    fireEvent.click(within(panel()).getByRole('button', { name: /^Rechazar/ }));
    expect(mockSetEditorialStatus).not.toHaveBeenCalled();
    const reason = within(panel()).getByLabelText(/Motivo del rechazo/);
    fireEvent.change(reason, { target: { value: '  No se ve el plantel completo.  ' } });
    mockSetEditorialStatus.mockResolvedValue({
      teamPhotoId: CANDIDATE, editorialStatus: 'rejected',
    });
    mockLoadTeamPhotoState.mockResolvedValue(photoState({
      canModerate: true, current: currentPhoto,
      candidate: { ...pendingCandidate, editorialStatus: 'rejected', reviewReason: 'No se ve el plantel completo.' },
    }));
    fireEvent.click(within(panel()).getByRole('button', { name: /Confirmar rechazo/ }));
    await screen.findByText(/Foto rechazada\. La foto vigente no cambió\./);
    expect(mockSetEditorialStatus).toHaveBeenCalledWith({
      organizationId: ORG, teamPhotoId: CANDIDATE, editorialStatus: 'rejected',
      reviewReason: 'No se ve el plantel completo.',
    });
  });

  test('the reject form closes once the decision is taken, not when the row changes', async () => {
    // Rechazar no cambia el id de la candidata: la misma foto pasa de
    // `pending_review` a `rejected`. Si el formulario se cierra sólo cuando
    // cambia el id, queda abierto sobre una decisión ya tomada y ofrece un
    // botón que el servidor va a rechazar.
    await openPanel(photoState({
      canModerate: true, current: currentPhoto, candidate: pendingCandidate,
    }));
    fireEvent.click(within(panel()).getByRole('button', { name: /^Rechazar/ }));
    expect(within(panel()).getByLabelText(/Motivo del rechazo/)).toBeInTheDocument();
    mockSetEditorialStatus.mockResolvedValue({ teamPhotoId: CANDIDATE, editorialStatus: 'rejected' });
    mockLoadTeamPhotoState.mockResolvedValue(photoState({
      canModerate: true, current: currentPhoto,
      candidate: { ...pendingCandidate, editorialStatus: 'rejected', reviewReason: 'muy oscura' },
    }));
    fireEvent.click(within(panel()).getByRole('button', { name: /Confirmar rechazo/ }));
    await screen.findByText('muy oscura');
    expect(within(panel()).queryByLabelText(/Motivo del rechazo/)).toBeNull();
    expect(within(panel()).queryByRole('button', { name: /Confirmar rechazo/ })).toBeNull();
    expect(within(panel()).queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  test('an empty reason is sent as no reason, not as an empty string', async () => {
    await openPanel(photoState({
      canModerate: true, current: null, candidate: pendingCandidate,
    }));
    fireEvent.click(within(panel()).getByRole('button', { name: /^Rechazar/ }));
    mockSetEditorialStatus.mockResolvedValue({ teamPhotoId: CANDIDATE, editorialStatus: 'rejected' });
    fireEvent.click(within(panel()).getByRole('button', { name: /Confirmar rechazo/ }));
    await waitFor(() => expect(mockSetEditorialStatus).toHaveBeenCalledWith(
      expect.objectContaining({ reviewReason: null }),
    ));
  });

  test('revoking the current photo falls back to the shield', async () => {
    await openPanel(photoState({ canModerate: true, current: currentPhoto }));
    mockRevokeTeamPhoto.mockResolvedValue({ teamPhotoId: CURRENT, revoked: true });
    mockLoadTeamPhotoState.mockResolvedValue(photoState({ canModerate: true, current: null }));
    fireEvent.click(within(panel()).getByRole('button', { name: /Retirar la vigente/ }));
    await screen.findByText(/Foto retirada\. El equipo vuelve a mostrar su escudo\./);
    expect(within(panel()).getByText(/Sin foto aprobada · se muestra el escudo/)).toBeInTheDocument();
    expect(within(panel()).queryByAltText('Foto del equipo Barrio Norte FC')).toBeNull();
  });
});

describe('nothing broken is ever shown', () => {
  test('a photo whose signature fails falls back to the shield, not to a broken image', async () => {
    mockResolveTeamPhoto.mockRejectedValue(new Error('no signature'));
    await openPanel(photoState({ current: currentPhoto }));
    await waitFor(() => expect(
      within(panel()).queryByAltText('Foto del equipo Barrio Norte FC'),
    ).toBeNull(), SIGNED);
    expect(within(panel()).getByText('Foto vigente')).toBeInTheDocument();
  });

  test('a failed read offers a retry instead of claiming there is no photo', async () => {
    mockLoadTeamPhotoState.mockRejectedValue(new Error('boom'));
    renderEntry(createService());
    await screen.findByRole('heading', { name: 'Foto del equipo' });
    expect(within(panel()).getByText(/No pudimos cargar la foto del equipo/)).toBeInTheDocument();
    mockLoadTeamPhotoState.mockResolvedValue(photoState({ current: currentPhoto }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(within(panel()).getByText('Publicada')).toBeInTheDocument());
  });

  test('an upload failure keeps the panel usable and names the problem', async () => {
    await openPanel(photoState({ canManage: true, current: currentPhoto }));
    mockUploadTeamPhoto.mockRejectedValue(new Error('La foto supera los 8 MB.'));
    chooseFile(panel(), validFile());
    await screen.findByText('La foto supera los 8 MB.');
    expect(within(panel()).getByRole('button', { name: /Reemplazar/ })).not.toBeDisabled();
  });
});

describe('the squad surface consumes only what is published', () => {
  test('an approved photo heads the roster', async () => {
    await openPanel(photoState({ current: currentPhoto }), { path: 'plantel' });
    await waitFor(() => expect(
      screen.getByAltText('Foto del equipo Barrio Norte FC'),
    ).toHaveAttribute('src', `http://127.0.0.1:57321/signed/${CURRENT}`), SIGNED);
  });

  test('a pending candidate never reaches the roster surface', async () => {
    await openPanel(
      photoState({ canManage: true, current: null, candidate: pendingCandidate }),
      { path: 'plantel' },
    );
    expect(screen.queryByAltText(/Foto del equipo/)).toBeNull();
    expect(screen.queryByAltText(/Foto enviada/)).toBeNull();
    expect(mockResolveTeamPhoto).not.toHaveBeenCalled();
  });
});
