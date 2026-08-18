import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import { clearPlayerPortraitUrlCache } from '../features/torneos/components/usePlayerPortraitUrl';

const mockLoadRosterPortraits = jest.fn();
const mockResolvePlayerPortrait = jest.fn();
const mockUploadPlayerPortrait = jest.fn();
const mockSetCrop = jest.fn();
const mockRemovePlayerPortrait = jest.fn();

jest.mock('../features/torneos/api/tournamentPlayerPortraitService', () => ({
  loadRosterPortraits: (...args) => mockLoadRosterPortraits(...args),
  resolvePlayerPortrait: (...args) => mockResolvePlayerPortrait(...args),
  uploadPlayerPortrait: (...args) => mockUploadPlayerPortrait(...args),
  setPlayerPortraitCrop: (...args) => mockSetCrop(...args),
  removePlayerPortrait: (...args) => mockRemovePlayerPortrait(...args),
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
const LINKED = '75000000-0000-4000-8000-000000000001';
const PROVISIONAL = '75000000-0000-4000-8000-000000000002';
const PORTRAIT = '76000000-0000-4000-8000-000000000001';
const NEXT_PORTRAIT = '76000000-0000-4000-8000-000000000002';
const REF = { kind: 'player_portrait', id: PORTRAIT, variant: 'original' };

function players() {
  return [
    {
      id: LINKED,
      arma2UserId: '77000000-0000-4000-8000-000000000001',
      displayName: 'Francisco González',
      shirtNumber: 7,
      primaryPosition: 'DEL',
      isGoalkeeper: false,
      eligibilityStatus: 'eligible',
    },
    {
      id: PROVISIONAL,
      arma2UserId: null,
      provisionalPlayerId: '78000000-0000-4000-8000-000000000001',
      displayName: 'Alejandro Fernández',
      shirtNumber: 1,
      primaryPosition: 'ARQ',
      isGoalkeeper: true,
      eligibilityStatus: 'pending',
    },
  ];
}

function registration() {
  return {
    entry: {
      id: ENTRY,
      organizationId: ORG,
      tournamentId: TOURNAMENT,
      categoryId: 'category-a',
      name: 'Barrio Norte FC',
      status: 'approved',
      linked: false,
    },
    tournament: { id: TOURNAMENT, name: 'Apertura QA', status: 'active' },
    category: { id: 'category-a', name: 'Primera' },
    settings: { minimumPlayers: 2, maximumPlayers: 10, minimumGoalkeepers: 1 },
    managers: [],
    roster: { id: 'roster-a', version: 1, status: 'approved', players: players() },
    reviews: [],
    audit: [],
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
        id: TOURNAMENT,
        organizationId: ORG,
        seasonId: SEASON,
        name: 'Apertura QA',
        status: 'active',
        categories: [{ id: 'category-a', name: 'Primera', status: 'active' }],
      }],
      modalities: [],
      formats: [],
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

function portraitMap({ linked = null, provisional = null, canManage = true } = {}) {
  return new Map([
    [LINKED, { rosterPlayerId: LINKED, canManage, portrait: linked }],
    [PROVISIONAL, { rosterPlayerId: PROVISIONAL, canManage, portrait: provisional }],
  ]);
}

const activePortrait = {
  ref: REF,
  crop: { x: 0.5, y: 0.5, zoom: 1 },
  width: 900,
  height: 1200,
  editorialStatus: 'pending_review',
  publicationConsent: 'unknown',
};

function renderPlantel(service) {
  return render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/equipos/${ENTRY}/plantel`]}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function rowOf(name) {
  return screen.getByText(name).closest('article');
}

async function openEditor(name) {
  const row = rowOf(name);
  fireEvent.click(within(row).getByRole('button', { name: new RegExp(`(Subir foto|Cambiar).*${name}`) }));
  return screen.findByRole('dialog');
}

function chooseFile(dialog, file) {
  const input = within(dialog).getByLabelText(/Elegir (otra )?foto/);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

const validFile = () => new File(['jpeg-bytes'], 'retrato.jpg', { type: 'image/jpeg' });

/*
 * El editor es manipulación directa, así que probarlo es mover la foto: no hay
 * coordenada que escribir. jsdom no hace layout ni decodifica imágenes, así que
 * el marco declara su rectángulo y la imagen sus dimensiones naturales —lo
 * único que la geometría mide— y a partir de ahí el gesto es real.
 */
const FRAME_RECT = Object.freeze({
  left: 0, top: 0, width: 320, height: 400, right: 320, bottom: 400, x: 0, y: 0,
});
const LANDSCAPE = Object.freeze({ width: 1600, height: 900 });

function editorImage(dialog, name = 'Francisco González') {
  return within(dialog).getByAltText(`Foto de ${name}`);
}

function cropFrame(dialog, name) {
  const frame = editorImage(dialog, name).parentElement;
  frame.getBoundingClientRect = () => FRAME_RECT;
  return frame;
}

/** Lo que el navegador informa al decodificar: la medida que el editor espera. */
function measureImage(image, { width, height }) {
  Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: height, configurable: true });
  fireEvent.load(image);
}

/*
 * jsdom no implementa `PointerEvent`, así que `fireEvent.pointerDown` fabrica un
 * `Event` pelado y las coordenadas nunca llegan al handler: el gesto se dispara
 * pero no mueve nada, que es justamente el falso verde que hay que evitar. Un
 * `MouseEvent` con el nombre del evento de puntero sí las lleva, y es el mismo
 * nombre que React tiene registrado.
 */
function pointer(frame, type, points) {
  return points.map(({ id = 1, x, y }) => {
    const event = new MouseEvent(type.toLowerCase(), {
      bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1,
    });
    Object.defineProperty(event, 'pointerId', { value: id });
    return fireEvent(frame, event);
  });
}

function dragBy(frame, from, delta, { id = 1 } = {}) {
  pointer(frame, 'pointerDown', [{ id, ...from }]);
  const moved = pointer(frame, 'pointerMove', [
    { id, x: from.x + delta.x, y: from.y + delta.y },
  ]);
  pointer(frame, 'pointerUp', [{ id, x: from.x + delta.x, y: from.y + delta.y }]);
  return moved[0];
}

const placementOf = (element) => ({
  width: element.style.width,
  height: element.style.height,
  left: element.style.left,
  top: element.style.top,
});

const avatarPreview = (dialog) => dialog.querySelector('.framePreview img');

function zoomTo(dialog, value) {
  fireEvent.change(within(dialog).getByLabelText('Zoom'), { target: { value: String(value) } });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPlayerPortraitUrlCache();
  URL.createObjectURL = jest.fn(() => 'blob:portrait-preview');
  URL.revokeObjectURL = jest.fn();
  mockLoadRosterPortraits.mockResolvedValue(portraitMap());
  mockResolvePlayerPortrait.mockResolvedValue({
    ref: REF,
    url: 'http://127.0.0.1:57321/storage/v1/object/sign/x?token=abc',
    ttlSeconds: 300,
    focal: { x: 0.5, y: 0.5 },
  });
});

describe('render del retrato en Plantel', () => {
  test('muestra el retrato privado cuando el resolver autoriza', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    await waitFor(() => expect(mockResolvePlayerPortrait).toHaveBeenCalledWith(REF, expect.anything()));
    const image = await within(rowOf('Francisco González')).findByRole('img', { hidden: true });
    expect(image).toHaveAttribute('src', 'http://127.0.0.1:57321/storage/v1/object/sign/x?token=abc');
  });

  test('cae a un monograma digno cuando no hay foto', async () => {
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const row = rowOf('Francisco González');
    expect(within(row).getByText('FG')).toBeInTheDocument();
    expect(within(row).queryByRole('img', { hidden: true })).not.toBeInTheDocument();
    expect(row.textContent).not.toMatch(/http|storage|bucket|undefined|null/i);
  });

  test('el jugador provisional recibe el mismo trato que el vinculado', async () => {
    renderPlantel(createService());
    expect(await screen.findByText('Alejandro Fernández')).toBeInTheDocument();
    const row = rowOf('Alejandro Fernández');
    expect(within(row).getByText('Jugador sin cuenta')).toBeInTheDocument();
    expect(within(row).getByText('AF')).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /Subir foto.*Alejandro Fernández/ }),
    ).toBeInTheDocument();
  });

  test('una falla transitoria del resolver se reintenta una vez y recupera el retrato', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    try {
      mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
      mockResolvePlayerPortrait
        .mockRejectedValueOnce(new Error('storage_unavailable'))
        .mockResolvedValue({
          ref: REF,
          url: 'http://127.0.0.1:57321/storage/v1/object/sign/x?token=retry',
          ttlSeconds: 300,
          focal: { x: 0.5, y: 0.5 },
        });
      renderPlantel(createService());
      await screen.findByText('Francisco González');
      await waitFor(() => expect(mockResolvePlayerPortrait).toHaveBeenCalledTimes(1));
      await act(async () => { jest.advanceTimersByTime(1500); });
      await waitFor(() => expect(mockResolvePlayerPortrait).toHaveBeenCalledTimes(2));
      const image = await within(rowOf('Francisco González')).findByRole('img', { hidden: true });
      expect(image).toHaveAttribute('src', 'http://127.0.0.1:57321/storage/v1/object/sign/x?token=retry');
    } finally {
      jest.useRealTimers();
    }
  });

  test('un resolver que falla siempre vuelve al monograma y no muestra imagen rota', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    mockResolvePlayerPortrait.mockRejectedValue(new Error('storage_unavailable'));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const row = rowOf('Francisco González');
    await waitFor(() => expect(within(row).getByText('FG')).toBeInTheDocument());
    expect(within(row).queryByRole('img', { hidden: true })).not.toBeInTheDocument();
  });
});

describe('la lectura de retratos del plantel falla', () => {
  const noticeOf = () => screen.getByText('No pudimos cargar las fotos').closest('p');

  test('el error se declara en vez de disfrazarse de plantel sin fotos', async () => {
    mockLoadRosterPortraits.mockRejectedValue(new Error('TORNEOS_PORTRAIT_LIST_FAILED'));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const notice = await screen.findByText('No pudimos cargar las fotos');
    expect(notice.closest('p')).toHaveAttribute('role', 'status');
    expect(within(notice.closest('p')).getByRole('button', { name: 'Reintentar' }))
      .toBeInTheDocument();
    // Los jugadores siguen visibles y la fila no se mueve: monograma, nunca
    // una imagen rota.
    expect(screen.getByText('Alejandro Fernández')).toBeInTheDocument();
    const row = rowOf('Francisco González');
    expect(within(row).getByText('FG')).toBeInTheDocument();
    expect(within(row).queryByRole('img', { hidden: true })).not.toBeInTheDocument();
    // Nada técnico llega a la vista.
    expect(noticeOf().textContent).not.toMatch(/TORNEOS_|storage|rpc|http|undefined|null/i);
  });

  test('Reintentar vuelve a pedir los retratos y el éxito posterior recupera las fotos', async () => {
    mockLoadRosterPortraits
      .mockRejectedValueOnce(new Error('TORNEOS_PORTRAIT_LIST_FAILED'))
      .mockResolvedValue(portraitMap({ linked: activePortrait }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    await screen.findByText('No pudimos cargar las fotos');
    const attempts = mockLoadRosterPortraits.mock.calls.length;

    fireEvent.click(within(noticeOf()).getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(mockLoadRosterPortraits.mock.calls.length)
      .toBeGreaterThan(attempts));
    await waitFor(() => expect(mockLoadRosterPortraits).toHaveBeenLastCalledWith({
      organizationId: ORG, teamEntryId: ENTRY,
    }));
    // No queda clavado en el monograma falso: la foto vuelve.
    const image = await within(rowOf('Francisco González')).findByRole('img', { hidden: true });
    expect(image).toHaveAttribute('src', 'http://127.0.0.1:57321/storage/v1/object/sign/x?token=abc');
    expect(within(rowOf('Francisco González')).queryByText('FG')).toBeNull();
    await waitFor(() => expect(screen.queryByText('No pudimos cargar las fotos')).toBeNull());
  });

  test('una recarga fallida no borra los retratos ya leídos', async () => {
    mockLoadRosterPortraits.mockResolvedValueOnce(portraitMap({ linked: activePortrait }));
    mockUploadPlayerPortrait.mockResolvedValue({
      ref: { kind: 'player_portrait', id: NEXT_PORTRAIT, variant: 'original' },
      replacedPortraitId: null, crop: { x: 0.5, y: 0.5, zoom: 1 }, cropSaved: true,
    });
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    await within(rowOf('Francisco González')).findByRole('img', { hidden: true });

    // La recarga posterior a la carga falla.
    mockLoadRosterPortraits.mockRejectedValue(new Error('TORNEOS_PORTRAIT_LIST_FAILED'));
    const dialog = await openEditor('Francisco González');
    chooseFile(dialog, validFile());
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar foto/ }));

    await screen.findByText('No pudimos cargar las fotos');
    // El error no se convirtió en una colección vacía: la acción de administrar
    // sigue en pie porque el último estado leído sigue vigente.
    expect(
      within(rowOf('Francisco González')).getByRole('button', { name: /Cambiar/ }),
    ).toBeInTheDocument();
  });
});

describe('permisos sobre el retrato', () => {
  test('owner y admin ven las acciones que el servidor ya autorizó', async () => {
    renderPlantel(createService({ role: 'owner' }));
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    expect(
      within(rowOf('Francisco González')).getByRole('button', { name: /Subir foto/ }),
    ).toBeInTheDocument();
  });

  test('un delegado habilitado sobre ese equipo administra igual que el organizador', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({
      linked: activePortrait, canManage: true,
    }));
    renderPlantel(createService({ role: 'collaborator' }));
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const row = rowOf('Francisco González');
    expect(within(row).getByRole('button', { name: /Cambiar/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Quitar/ })).toBeInTheDocument();
  });

  test('sin capability real no se pinta ningún botón que vaya a fallar', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({
      linked: activePortrait, canManage: false,
    }));
    renderPlantel(createService({ role: 'collaborator' }));
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const row = rowOf('Francisco González');
    expect(within(row).queryByRole('button', { name: /Subir foto|Cambiar|Quitar/ })).toBeNull();
  });

  test('un outsider no obtiene ni refs ni acciones', async () => {
    mockLoadRosterPortraits.mockRejectedValue(new Error('TORNEOS_PORTRAIT_FORBIDDEN'));
    renderPlantel(createService({ role: 'collaborator' }));
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const row = rowOf('Francisco González');
    expect(within(row).queryByRole('button', { name: /Subir foto|Cambiar|Quitar/ })).toBeNull();
    expect(within(row).getByText('FG')).toBeInTheDocument();
  });
});

describe('carga de la foto', () => {
  test('elegir un archivo no lo sube: primero preview y confirmación', async () => {
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    chooseFile(dialog, validFile());
    await within(dialog).findByAltText('Foto de Francisco González');
    expect(mockUploadPlayerPortrait).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  test('rechaza un MIME no admitido antes de tocar la red', async () => {
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    chooseFile(dialog, new File(['<svg/>'], 'retrato.svg', { type: 'image/svg+xml' }));
    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent('Formato no admitido. Usá JPEG, PNG o WebP.');
    expect(mockUploadPlayerPortrait).not.toHaveBeenCalled();
  });

  test('rechaza un archivo por encima de 8 MB antes de tocar la red', async () => {
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const big = new File(['x'], 'retrato.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 8 * 1024 * 1024 + 1 });
    chooseFile(dialog, big);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('La foto supera los 8 MB.');
    expect(mockUploadPlayerPortrait).not.toHaveBeenCalled();
  });

  test('cancelar cierra el editor sin dejar nada en el servidor', async () => {
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    chooseFile(dialog, validFile());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockUploadPlayerPortrait).not.toHaveBeenCalled();
    expect(mockSetCrop).not.toHaveBeenCalled();
  });

  test('guardar sube el archivo y refresca el plantel', async () => {
    mockUploadPlayerPortrait.mockResolvedValue({
      ref: { kind: 'player_portrait', id: NEXT_PORTRAIT, variant: 'original' },
      replacedPortraitId: null,
      crop: { x: 0.5, y: 0.5, zoom: 1 },
      cropSaved: true,
    });
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    chooseFile(dialog, validFile());
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar foto/ }));
    await waitFor(() => expect(mockUploadPlayerPortrait).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, rosterPlayerId: LINKED }),
    ));
    expect(await screen.findByText('Foto guardada.')).toBeInTheDocument();
    expect(mockLoadRosterPortraits).toHaveBeenCalledTimes(2);
  });

  test('una carga fallida conserva la foto anterior y explica el motivo', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    mockUploadPlayerPortrait.mockRejectedValue(new Error('No pudimos guardar la foto.'));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    chooseFile(dialog, validFile());
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar foto/ }));
    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent('No pudimos guardar la foto.');
    // El plantel no se recargó: la referencia vigente sigue siendo la anterior.
    expect(mockLoadRosterPortraits).toHaveBeenCalledTimes(1);
    expect(
      within(rowOf('Francisco González')).getByRole('button', { name: /Cambiar/ }),
    ).toBeInTheDocument();
  });
});

describe('encuadre directo: arrastrar y zoom', () => {
  const landscape = { ...activePortrait, ...LANDSCAPE };

  test('no expone ninguna coordenada: los deslizadores de X e Y ya no existen', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    await within(dialog).findByAltText('Foto de Francisco González');

    expect(within(dialog).queryByLabelText('Punto focal horizontal')).toBeNull();
    expect(within(dialog).queryByLabelText('Punto focal vertical')).toBeNull();
    expect(dialog.textContent).not.toMatch(/[Pp]unto focal|0\.\d\d\s*\/|coordenada/);
    // Lo que hay es una foto que se acomoda y un solo control de zoom.
    expect(within(dialog).getByText('Ajustá la foto')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Zoom')).toHaveValue('1');
    expect(within(dialog).getAllByRole('slider')).toHaveLength(1);
    expect(dialog.textContent).toMatch(/Arrastrá para/);
  });

  test('arrastrar horizontalmente mueve la foto y no scrollea el diálogo', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: landscape }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const frame = cropFrame(dialog, 'Francisco González');
    const before = placementOf(image);

    const notScrolled = dragBy(frame, { x: 160, y: 200 }, { x: 60, y: 0 });

    // La imagen se movió a la derecha; el marco no se movió nunca.
    expect(parseFloat(image.style.left)).toBeGreaterThan(parseFloat(before.left));
    expect(image.style.width).toBe(before.width);
    // El gesto le pertenece a la foto: el diálogo no scrollea debajo del dedo.
    expect(notScrolled).toBe(false);
  });

  test('arrastrar en vertical mueve la foto de una imagen que desborda a lo alto', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const frame = cropFrame(dialog, 'Francisco González');
    const before = placementOf(image);

    dragBy(frame, { x: 160, y: 200 }, { x: 0, y: 24 });

    expect(parseFloat(image.style.top)).toBeGreaterThan(parseFloat(before.top));
    expect(image.style.height).toBe(before.height);
  });

  test('no se puede arrastrar hasta dejar un borde vacío, en ningún zoom', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: landscape }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const frame = cropFrame(dialog, 'Francisco González');

    for (const zoom of [1, 2.5]) {
      zoomTo(dialog, zoom);
      for (const delta of [{ x: 4000, y: 0 }, { x: -4000, y: 0 },
        { x: 0, y: 4000 }, { x: 0, y: -4000 }]) {
        dragBy(frame, { x: 160, y: 200 }, delta);
        const place = placementOf(image);
        expect(parseFloat(place.left)).toBeLessThanOrEqual(0);
        expect(parseFloat(place.top)).toBeLessThanOrEqual(0);
        expect(parseFloat(place.left) + parseFloat(place.width)).toBeGreaterThanOrEqual(100);
        expect(parseFloat(place.top) + parseFloat(place.height)).toBeGreaterThanOrEqual(100);
      }
    }
  });

  test('el zoom mínimo es el que cubre el marco, y lo decide la foto', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: landscape }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const zoom = within(dialog).getByLabelText('Zoom');

    expect(zoom).toHaveAttribute('min', '1');
    expect(zoom).toHaveAttribute('max', '4');
    // Una horizontal en un 4:5 arranca muy por encima del 100%: el mínimo
    // visual se calcula, no se hardcodea.
    expect(parseFloat(image.style.width)).toBeCloseTo(222.2222, 3);
    expect(image.style.height).toBe('100%');

    zoomTo(dialog, 0.2);
    expect(zoom).toHaveValue('1');
    expect(parseFloat(image.style.width)).toBeCloseTo(222.2222, 3);
  });

  test('el zoom acerca la foto y se detiene en un máximo razonable', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const before = parseFloat(image.style.width);

    zoomTo(dialog, 2);
    expect(parseFloat(image.style.width)).toBeCloseTo(before * 2, 3);

    zoomTo(dialog, 99);
    expect(within(dialog).getByLabelText('Zoom')).toHaveValue('4');
    expect(parseFloat(image.style.width)).toBeCloseTo(before * 4, 3);
  });

  test('el pellizco acerca sobre el punto que quedó entre los dos dedos', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: landscape }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const frame = cropFrame(dialog, 'Francisco González');
    const before = parseFloat(image.style.width);

    pointer(frame, 'pointerDown', [{ id: 1, x: 130, y: 200 }, { id: 2, x: 190, y: 200 }]);
    pointer(frame, 'pointerMove', [{ id: 1, x: 100, y: 200 }, { id: 2, x: 220, y: 200 }]);
    pointer(frame, 'pointerUp', [{ id: 1, x: 100, y: 200 }, { id: 2, x: 220, y: 200 }]);

    // Dos dedos separándose al doble de distancia: la foto se acercó al doble.
    expect(parseFloat(image.style.width)).toBeCloseTo(before * 2, 2);
    expect(within(dialog).getByLabelText('Zoom')).toHaveValue('2');
  });

  test('el Avatar cuadrado se dibuja del mismo encuadre, sin editarlo aparte', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: landscape }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const preview = avatarPreview(dialog);
    expect(within(dialog).getByText('Avatar')).toBeInTheDocument();
    // El 4:5 ya es el marco grande: no se previsualiza dos veces.
    expect(dialog.textContent).not.toMatch(/Retrato 4:5/);

    const before = placementOf(preview);
    // El cuadrado tiene menos margen que el 4:5, así que el mismo dato se
    // coloca distinto en cada marco.
    expect(before.width).not.toBe(image.style.width);

    zoomTo(dialog, 2.4);
    const frame = cropFrame(dialog, 'Francisco González');
    dragBy(frame, { x: 160, y: 200 }, { x: 40, y: 20 });

    // Un único encuadre: mover o acercar la foto actualiza las dos vistas.
    expect(placementOf(preview)).not.toEqual(before);
    expect(parseFloat(preview.style.left)).toBeLessThanOrEqual(0);
    expect(parseFloat(preview.style.left) + parseFloat(preview.style.width))
      .toBeGreaterThanOrEqual(100);
  });

  test('un encuadre guardado fuera de rango se acomoda y el zoom no da un salto', async () => {
    // 1C.2A guardó puntos focales con la semántica anterior: hay filas cuyo
    // punto cae fuera de lo que cubre el 4:5. El editor no puede mostrar el
    // recorte legal y guardar otro: lo que se ve es lo que se guarda.
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({
      linked: { ...activePortrait, crop: { x: 0.9, y: 0.1, zoom: 1 } },
    }));
    mockSetCrop.mockResolvedValue({ portraitId: PORTRAIT, crop: { x: 0.5, y: 0.4688, zoom: 1 } });
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const centred = placementOf(image);

    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar foto/ }));
    await waitFor(() => expect(mockSetCrop).toHaveBeenCalledWith({
      organizationId: ORG,
      portraitId: PORTRAIT,
      // Una vertical en un 4:5 no tiene juego horizontal: el eje queda centrado.
      crop: { x: 0.5, y: 0.4688, zoom: 1 },
    }));

    // Y al acercar, la foto no se va de golpe al valor que estaba guardado:
    // el centro sigue siendo el centro.
    expect(centred).toMatchObject({ width: '100%', left: '0%' });
    zoomTo(dialog, 2);
    expect(placementOf(image)).toMatchObject({ width: '200%', left: '-50%' });
  });

  test('el marco se maneja con el teclado: flechas, Shift y el zoom', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: landscape }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const frame = cropFrame(dialog, 'Francisco González');

    // Enfocable sin mouse, con nombre y con las instrucciones a mano.
    expect(frame).toHaveAttribute('tabindex', '0');
    frame.focus();
    expect(frame).toHaveFocus();
    expect(frame).toHaveAccessibleName('Ajustá la foto');
    expect(frame).toHaveAccessibleDescription(/flechas mueven la foto/);

    const start = parseFloat(image.style.left);
    fireEvent.keyDown(frame, { key: 'ArrowRight' });
    const nudged = parseFloat(image.style.left);
    expect(nudged).toBeGreaterThan(start);

    fireEvent.keyDown(frame, { key: 'ArrowRight', shiftKey: true });
    // Shift mueve más que la flecha sola.
    expect(parseFloat(image.style.left) - nudged).toBeGreaterThan(nudged - start);

    fireEvent.keyDown(frame, { key: 'ArrowUp' });
    fireEvent.keyDown(frame, { key: 'ArrowDown' });
    expect(parseFloat(image.style.top)).toBeLessThanOrEqual(0);

    const zoomed = parseFloat(image.style.width);
    fireEvent.keyDown(frame, { key: '+' });
    expect(parseFloat(image.style.width)).toBeGreaterThan(zoomed);
    fireEvent.keyDown(frame, { key: '-' });
    expect(parseFloat(image.style.width)).toBeCloseTo(zoomed, 3);
  });

  test('el deslizador de zoom se opera con el teclado', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const zoom = within(dialog).getByLabelText('Zoom');
    const before = parseFloat(image.style.height);

    zoom.focus();
    expect(zoom).toHaveFocus();
    expect(zoom).toHaveAttribute('step', '0.02');
    // Un paso del deslizador es un paso del encuadre: el navegador lo mueve con
    // las flechas y el `change` es el mismo que dispara el mouse.
    fireEvent.change(zoom, { target: { value: '1.02' } });
    expect(parseFloat(image.style.height)).toBeGreaterThan(before);
  });

  test('guarda el encuadre completo junto con la carga de una foto nueva', async () => {
    mockUploadPlayerPortrait.mockResolvedValue({
      ref: { kind: 'player_portrait', id: NEXT_PORTRAIT, variant: 'original' },
      replacedPortraitId: null, crop: { x: 0.5, y: 0.4, zoom: 1.6 }, cropSaved: true,
    });
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    chooseFile(dialog, validFile());
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    // Una foto recién elegida trae sus medidas al decodificarse, no antes.
    measureImage(image, LANDSCAPE);
    const frame = cropFrame(dialog, 'Francisco González');

    zoomTo(dialog, 1.6);
    dragBy(frame, { x: 160, y: 200 }, { x: 30, y: 0 });
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar foto/ }));

    await waitFor(() => expect(mockUploadPlayerPortrait).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        rosterPlayerId: LINKED,
        crop: expect.objectContaining({ zoom: 1.6 }),
      }),
    ));
    const [{ crop }] = mockUploadPlayerPortrait.mock.calls[0];
    // El encuadre viaja normalizado y dentro de los límites que cubren el marco.
    expect(crop.x).toBeGreaterThan(0.25);
    expect(crop.x).toBeLessThan(0.5);
    expect(crop.y).toBe(0.5);
  });

  test('reajustar el encuadre de un retrato vigente no vuelve a subir la foto', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: landscape }));
    mockSetCrop.mockResolvedValue({
      portraitId: PORTRAIT, crop: { x: 0.4, y: 0.5, zoom: 2 },
    });
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    const image = await within(dialog).findByAltText('Foto de Francisco González');
    const frame = cropFrame(dialog, 'Francisco González');

    zoomTo(dialog, 2);
    dragBy(frame, { x: 160, y: 200 }, { x: -50, y: 0 });
    const framed = placementOf(image);
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar foto/ }));

    await waitFor(() => expect(mockSetCrop).toHaveBeenCalledWith({
      organizationId: ORG,
      portraitId: PORTRAIT,
      crop: expect.objectContaining({ zoom: 2 }),
    }));
    expect(mockUploadPlayerPortrait).not.toHaveBeenCalled();
    expect(await screen.findByText('Encuadre actualizado.')).toBeInTheDocument();
    expect(framed.width).toBe('444.4444%');
  });

  test('después de recargar, el encuadre guardado se reconstruye idéntico', async () => {
    // Lo que quedó en la base, tal como vuelve: tres fracciones.
    const stored = { ...landscape, crop: { x: 0.3125, y: 0.5, zoom: 1.84 } };
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: stored }));

    const first = renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    let dialog = await openEditor('Francisco González');
    const framed = placementOf(await within(dialog).findByAltText('Foto de Francisco González'));
    const avatar = placementOf(avatarPreview(dialog));
    expect(within(dialog).getByLabelText('Zoom')).toHaveValue('1.84');

    // Recargar de verdad: se desmonta todo y se vuelve a leer del servidor.
    first.unmount();
    clearPlayerPortraitUrlCache();
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    dialog = await openEditor('Francisco González');

    expect(placementOf(await within(dialog).findByAltText('Foto de Francisco González')))
      .toEqual(framed);
    expect(placementOf(avatarPreview(dialog))).toEqual(avatar);
    expect(within(dialog).getByLabelText('Zoom')).toHaveValue('1.84');
  });

  test('el retrato de la fila usa el mismo encuadre que la previsualización', async () => {
    const stored = { ...landscape, crop: { x: 0.3125, y: 0.5, zoom: 1.84 } };
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: stored }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const row = rowOf('Francisco González');
    const rowImage = await within(row).findByRole('img', { hidden: true });

    const dialog = await openEditor('Francisco González');
    await within(dialog).findByAltText('Foto de Francisco González');
    // La fila encuadra en cuadrado, igual que la previsualización Avatar.
    expect(placementOf(rowImage)).toEqual(placementOf(avatarPreview(dialog)));
  });
});

describe('baja del retrato', () => {
  async function openRemove() {
    fireEvent.click(
      within(rowOf('Francisco González')).getByRole('button', { name: /Quitar/ }),
    );
    return screen.findByRole('dialog');
  }

  beforeEach(() => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
  });

  test('pide confirmación y aclara que el jugador no se borra', async () => {
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openRemove();
    expect(within(dialog).getByRole('heading', {
      name: '¿Quitar la foto de Francisco González?',
    })).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/sigue en el plantel/i);
    expect(mockRemovePlayerPortrait).not.toHaveBeenCalled();
  });

  test('cancelar no borra nada', async () => {
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openRemove();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockRemovePlayerPortrait).not.toHaveBeenCalled();
  });

  test('confirmar borra sólo el retrato y devuelve el monograma', async () => {
    mockRemovePlayerPortrait.mockResolvedValue({ portraitId: PORTRAIT, deleted: true });
    const service = createService();
    renderPlantel(service);
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openRemove();
    mockLoadRosterPortraits.mockResolvedValue(portraitMap());
    fireEvent.click(within(dialog).getByRole('button', { name: /Quitar foto/ }));
    await waitFor(() => expect(mockRemovePlayerPortrait).toHaveBeenCalledWith({
      portraitId: PORTRAIT,
    }));
    expect(await screen.findByText('Foto eliminada.')).toBeInTheDocument();
    await waitFor(() => expect(
      within(rowOf('Francisco González')).getByText('FG'),
    ).toBeInTheDocument());
    expect(service.removeRosterPlayer).not.toHaveBeenCalled();
  });

  test('una baja fallida conserva el retrato y lo dice', async () => {
    mockRemovePlayerPortrait.mockRejectedValue(new Error('No pudimos borrar la foto.'));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openRemove();
    fireEvent.click(within(dialog).getByRole('button', { name: /Quitar foto/ }));
    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent('No pudimos borrar la foto.');
    expect(mockLoadRosterPortraits).toHaveBeenCalledTimes(1);
  });
});

describe('aislamiento y accesibilidad del diálogo', () => {
  test('el modal se monta fuera de la fila para que Plantel no le reescriba el layout', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    expect(dialog.closest('article')).toBeNull();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText(/Elegir otra foto/)).toBeInTheDocument();
  });

  test('Escape cierra sin guardar', async () => {
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    await openEditor('Francisco González');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockUploadPlayerPortrait).not.toHaveBeenCalled();
  });

  test('las acciones nombran al jugador para quien no ve la fila', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const row = rowOf('Francisco González');
    expect(within(row).getByRole('button', { name: 'Cambiar la foto de Francisco González' }))
      .toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Quitar la foto de Francisco González' }))
      .toBeInTheDocument();
  });
});

describe('límites de 1C.2B', () => {
  test('no ofrece publicar, consentir ni usar el avatar global', async () => {
    mockLoadRosterPortraits.mockResolvedValue(portraitMap({ linked: activePortrait }));
    renderPlantel(createService());
    expect(await screen.findByText('Francisco González')).toBeInTheDocument();
    const dialog = await openEditor('Francisco González');
    expect(dialog.textContent).toMatch(/Foto privada del plantel/);
    expect(dialog.textContent).not.toMatch(
      /hacer pública|publicar|consentimiento|avatar de Arma2|visibilidad/i,
    );
  });
});
