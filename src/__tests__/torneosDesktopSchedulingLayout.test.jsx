import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import FixtureWorkspacePage from '../features/torneos/components/FixtureWorkspacePage';
import TournamentWizardPage from '../features/torneos/components/TournamentWizardPage';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

/*
 * Tres bugs de escritorio encontrados navegando a mano. jsdom no hace layout,
 * así que lo que se protege no es un pixel sino el contrato que los causaba:
 * qué puede achicarse, qué puede envolver y qué no puede mandar la viewport al
 * principio del documento.
 */

const fixtureCss = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/torneos/components/FixtureWorkspace.module.css',
  ),
  'utf8',
);

const LONG_HOME = 'Club Atlético Defensores del Barrio Norte Unidos';
const LONG_AWAY = 'Asociación Deportiva y Cultural Villa Crespo Oeste';

const mockOrganization = {
  id: 'org-a',
  role: 'owner',
  capabilities: getCapabilitiesForRole('owner'),
};

const mockFixtureState = {
  status: 'ready',
  error: '',
  notice: '',
  categoryId: 'category-a',
  activeCategory: { id: 'category-a', name: 'Primera' },
  categories: [{ id: 'category-a', name: 'Primera', status: 'active' }],
  setCategoryId: jest.fn(),
  participantSet: { id: 'set-a', status: 'frozen', versionNumber: 1 },
  eligibleEntries: [],
  participants: [
    { id: 'participant-a', name: LONG_HOME, status: 'active', seedNumber: 1 },
    { id: 'participant-b', name: LONG_AWAY, status: 'active', seedNumber: 2 },
  ],
  pots: [],
  groups: [],
  versions: [{
    id: 'version-a',
    versionNumber: 1,
    status: 'published',
    generationMethod: 'automatic',
    matchCount: 1,
    scheduledCount: 0,
  }],
  phases: [{ id: 'phase-a', fixtureVersionId: 'version-a', phaseType: 'league' }],
  rounds: [{
    id: 'round-a',
    fixtureVersionId: 'version-a',
    phaseId: 'phase-a',
    name: 'Fecha 1',
    roundNumber: 1,
    status: 'draft',
  }],
  matches: [{
    id: 'match-a',
    fixtureVersionId: 'version-a',
    roundId: 'round-a',
    matchNumber: 5,
    homeParticipantId: 'participant-a',
    awayParticipantId: 'participant-b',
    status: 'unscheduled',
    sources: [],
  }],
  venues: [{
    id: 'venue-a', name: 'Complejo Central', address: 'Av. Central 100', status: 'active',
  }],
  courts: [{
    id: 'court-a', venueId: 'venue-a', name: 'Cancha 1', status: 'active',
  }],
  windows: [],
  reschedules: [],
  refresh: jest.fn(),
  actions: {
    freeze: jest.fn(),
    reopen: jest.fn(),
    savePots: jest.fn(),
    draw: jest.fn(),
    generate: jest.fn(),
    createManual: jest.fn(),
    publish: jest.fn(),
    supersede: jest.fn(),
    createVenue: jest.fn(),
    createCourt: jest.fn(),
    saveWindows: jest.fn(),
    schedule: jest.fn(),
    validateSchedule: jest.fn(),
    reschedule: jest.fn(),
    autoSchedule: jest.fn(),
  },
};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useOutletContext: () => ({ organization: mockOrganization }),
}));

jest.mock('../features/torneos/context/TorneosFixtureContext', () => ({
  useTorneosFixture: () => mockFixtureState,
}));

jest.mock('../features/torneos/components/CompetitionSelector', () => (
  function CompetitionSelectorMock() {
    return <div>Temporada Apertura</div>;
  }
));

const mockCompetitionValue = {
  status: 'ready',
  error: '',
  seasons: [{ id: 'season-a', name: 'Apertura', status: 'active' }],
  modalities: [],
  formats: [],
  preference: { activeSeasonId: 'season-a', activeTournamentId: 'tournament-a' },
  activeTournament: {
    id: 'tournament-a',
    name: 'Copa Apertura',
    status: 'registration',
    competitionFormat: 'league',
    sportModality: 'football_5',
  },
  tournaments: [{
    id: 'tournament-a',
    organizationId: 'org-a',
    seasonId: 'season-a',
    name: 'Copa Apertura',
    slug: 'copa-apertura',
    status: 'draft',
    competitionFormat: 'league',
    sportModality: 'football_5',
    categories: [],
  }],
  refresh: jest.fn(),
  createTournament: jest.fn(),
  createIdempotencyKey: jest.fn(() => 'request-a'),
  updateTournament: jest.fn(),
  saveCategory: jest.fn(),
  changeTournamentStatus: jest.fn(),
};

jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useTorneosCompetition: () => mockCompetitionValue,
}));

function renderSchedule() {
  return render(
    <MemoryRouter>
      <FixtureWorkspacePage mode="schedule" />
    </MemoryRouter>,
  );
}

function scheduleRow() {
  return screen.getByRole('button', { name: new RegExp(`#5.*${LONG_HOME}`, 's') });
}

describe('Agenda real: la fila de partido no se pisa en escritorio', () => {
  test('local y visitante son elementos propios con un separador nombrado', () => {
    renderSchedule();
    const row = scheduleRow();

    // El nombre completo está entero: no se trunca información deportiva.
    expect(within(row).getByText(LONG_HOME)).toBeInTheDocument();
    expect(within(row).getByText(LONG_AWAY)).toBeInTheDocument();
    // Y se sabe cuál es cuál sin depender de un punto medio.
    expect(within(row).getByText('vs')).toBeInTheDocument();
    expect(row.textContent).not.toContain(`${LONG_HOME} · ${LONG_AWAY}`);
  });

  test('el texto de la fila puede envolver en vez de desbordar su columna', () => {
    // `.panel button` declara `nowrap` para los botones de acción; la fila lo
    // heredaba y por eso el nombre se pintaba encima del horario y del estado.
    expect(fixtureCss).toMatch(
      /\.scheduleList button\s*\{[^}]*white-space:\s*normal;/s,
    );
    expect(fixtureCss).not.toMatch(
      /\.scheduleList button\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(fixtureCss).toMatch(
      /\.scheduleList button > strong\s*\{[^}]*min-width:\s*0;/s,
    );
  });

  test('la columna del nombre puede achicarse y la fila no usa anchos fijos', () => {
    expect(fixtureCss).toMatch(
      /\.scheduleList button\s*\{[^}]*grid-template-columns:\s*42px minmax\(0, 1fr\) auto auto;/s,
    );
  });

  test('`Programar automáticamente` no impone su ancho al panel', () => {
    renderSchedule();
    expect(screen.getByRole('button', { name: /Programar automáticamente/ }))
      .toBeInTheDocument();
    expect(fixtureCss).toMatch(
      /\.panelHeading > button\s*\{[^}]*min-width:\s*0;/s,
    );
    expect(fixtureCss).toMatch(
      /\.panelHeading > button\s*\{[^}]*white-space:\s*normal;/s,
    );
  });

  test('la agenda no recibe menos ancho que el formulario de cinco campos', () => {
    const columns = fixtureCss.match(
      /\.scheduleLayout\s*\{[^}]*grid-template-columns:\s*minmax\(([^)]*)\)\s+minmax\(([^)]*)\);/s,
    );
    expect(columns).not.toBeNull();
    const share = (track) => Number(track.split(',')[1].trim().replace('fr', ''));
    expect(share(columns[1])).toBeGreaterThanOrEqual(share(columns[2]));
  });
});

describe('Ventana semanal: la tarjeta contiene sus propios controles', () => {
  test('la ventana ocupa el ancho del layout y no la columna angosta', () => {
    // `scheduleLayout` tiene dos columnas y tres hijos: sin esto la ventana caía
    // en la fila siguiente, dentro de la columna angosta.
    expect(fixtureCss).toMatch(
      /\.scheduleLayout > \.resourceForms\s*\{[^}]*grid-column:\s*1 \/ -1;/s,
    );
    expect(fixtureCss).toMatch(
      /\.scheduleLayout > \.resourceForms\s*\{[^}]*grid-template-columns:\s*1fr;/s,
    );
  });

  test('los campos se acomodan al lugar disponible, sin anchos que excedan la tarjeta', () => {
    expect(fixtureCss).toMatch(
      /\.scheduleLayout > \.resourceForms > form\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(190px, 1fr\)\);/s,
    );
    // Los controles se miden contra su contenedor, no contra su contenido.
    expect(fixtureCss).toMatch(
      /\.resourceForms input,\n\.resourceForms select \{[^}]*width:\s*100%;/s,
    );
    expect(fixtureCss).toMatch(/\.resourceForms label \{[^}]*min-width:\s*0;/s);
  });

  test('el desborde no se tapa: no hay overflow oculto en la tarjeta', () => {
    expect(fixtureCss).not.toMatch(
      /\.scheduleLayout > \.resourceForms[^}]*overflow:\s*hidden;/s,
    );
  });

  test('todos los controles declarados siguen presentes', () => {
    renderSchedule();
    const form = screen.getByRole('heading', { name: 'Ventana semanal' }).closest('form');
    ['Día', 'Desde', 'Hasta', 'Minutos por turno', 'Sede opcional', 'Cancha opcional']
      .forEach((label) => {
        expect(within(form).getByText(label)).toBeInTheDocument();
      });
    expect(within(form).getByRole('button', { name: /Guardar ventana/ }))
      .toBeInTheDocument();
  });
});

describe('Stepper del wizard: cambiar de paso no manda al principio del documento', () => {
  function renderWizard() {
    return render(
      <MemoryRouter initialEntries={['/torneos/organizacion/org-a/torneo/tournament-a/configuracion']}>
        <Routes>
          <Route
            path="/torneos/organizacion/:organizationId/torneo/:tournamentId/configuracion"
            element={<TournamentWizardPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  test('los pasos son botones, no enlaces de hash ni submits accidentales', () => {
    renderWizard();
    const stepper = screen.getByRole('navigation', { name: 'Pasos de configuración' });
    const steps = within(stepper).getAllByRole('button');
    expect(steps).toHaveLength(6);
    steps.forEach((button) => {
      // Un submit dentro de un form recargaría; un `href="#"` movería la viewport.
      expect(button).toHaveAttribute('type', 'button');
    });
    expect(stepper.querySelectorAll('a')).toHaveLength(0);
  });

  test('tocar un paso cambia el contenido sin scrollear el documento', () => {
    const scrollTo = jest.fn();
    window.scrollTo = scrollTo;
    renderWizard();
    const stepper = screen.getByRole('navigation', { name: 'Pasos de configuración' });

    fireEvent.click(within(stepper).getByRole('button', { name: /Modalidad/ }));

    expect(screen.getByRole('heading', { level: 2, name: 'Modalidad' })).toBeInTheDocument();
    // La causa exacta del salto era este `window.scrollTo({ top: 0 })`.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  test('el destino del reacomodo es el stepper y nunca el origen del documento', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/features/torneos/components/TournamentWizardPage.jsx',
      ),
      'utf8',
    );
    // Sin comentarios: el que explica el bug cita la llamada vieja a propósito.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/window\.scrollTo/);
    expect(code).toMatch(/wizardStepperRef\.current\?\.scrollIntoView\?\.\(\{ block: 'nearest' \}\)/);
  });
});
