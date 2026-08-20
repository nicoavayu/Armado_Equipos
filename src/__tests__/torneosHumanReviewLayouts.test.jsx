import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CompetitionCenterPage from '../features/torneos/components/CompetitionCenterPage';
import CompetitionLifecycleActions from '../features/torneos/components/CompetitionLifecycleActions';
import { TOURNAMENT_ROLES } from '../features/torneos/domain/capabilities';

//
// Contratos de la revisión humana del CHECKPOINT 5B.1.
//
// No miden píxeles: fijan las decisiones de layout que se rompieron y que un
// refactor podría deshacer sin que nadie lo note —repartos de ancho, la
// separación entre nombre y metadata, y el tamaño del número de versión contra
// su caja—. Lo visual se verificó en el navegador; esto evita la regresión.
//
const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
const TORNEOS = 'src/features/torneos/components';
const centerCss = read(`${TORNEOS}/CompetitionCenter.module.css`);
const coreCss = read(`${TORNEOS}/CompetitionCore.module.css`);
const shellCss = read(`${TORNEOS}/TorneosShell.module.css`);
const fixtureCss = read(`${TORNEOS}/FixtureWorkspace.module.css`);

const contextBarRule = centerCss
  .split('\n')
  .find((line) => line.startsWith('.contextBar {'));

let mockOrganization;
let mockFixture;
let mockService;

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => ({ service: mockService }),
}));
jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useTorneosCompetition: () => ({
    activeTournament: { id: 'tournament', name: 'Torneo Apertura QA 2026' },
    startCompetition: jest.fn(),
    finishCompetition: jest.fn(),
    reopenCompetition: jest.fn(),
  }),
}));
jest.mock('../features/torneos/context/TorneosFixtureContext', () => ({
  useTorneosFixture: () => mockFixture,
}));
jest.mock('../features/torneos/components/CompetitionSelector', () => () => (
  <section aria-label="Contexto competitivo activo" />
));
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useOutletContext: () => ({ organization: mockOrganization }) };
});

describe('la barra de contexto no fuerza recorte', () => {
  test('los campos no se reparten el ancho en cuartos iguales', () => {
    // El reparto igual era la causa: el primer hijo contiene dos campos, así
    // que un cuarto se convertía en un octavo para Temporada y Torneo.
    expect(contextBarRule).toBeDefined();
    expect(contextBarRule).not.toContain('repeat(4, minmax(0, 1fr))');
    expect(contextBarRule).toMatch(/grid-template-columns:\s*minmax\(0, [\d.]+fr\)/);
  });

  test('el par Temporada/Torneo pesa más que Fase y Grupo juntos', () => {
    const weights = [...contextBarRule.matchAll(/minmax\(0, ([\d.]+)fr\)/g)]
      .map((match) => Number(match[1]));
    expect(weights).toHaveLength(4);
    const [seasonAndTournament, , phase, group] = weights;
    expect(seasonAndTournament).toBeGreaterThan(phase + group);
  });

  test('el torneo recibe más ancho que la temporada dentro del selector compacto', () => {
    const compact = coreCss.slice(coreCss.indexOf('.contextSelectorCompact {'));
    const [season, tournament] = [...compact.matchAll(/minmax\(0, ([\d.]+)fr\)/g)]
      .slice(0, 2)
      .map((match) => Number(match[1]));
    expect(tournament).toBeGreaterThan(season);
  });

  test('cada campo lleva su propio chevron en vez del nativo del select', () => {
    // El chevron nativo vive dentro de la caja del `select` y se come el texto
    // sin avisar; con `appearance: none` ese ancho vuelve al valor.
    expect(centerCss).toMatch(/\.contextBar select \{[^}]*appearance: none/);
    const source = read(`${TORNEOS}/CompetitionCenterPage.jsx`);
    const chevrons = source.match(/<ChevronDown size=\{14\} aria-hidden="true" \/>/g) || [];
    expect(chevrons).toHaveLength(3);
  });

  test('el icono decorativo no le saca ancho al nombre en la barra compacta', () => {
    const source = read(`${TORNEOS}/CompetitionSelector.jsx`);
    expect(source).toMatch(/\{!compact && <CalendarRange/);
    expect(source).toMatch(/\{!compact && <Trophy/);
  });

  test('la barra envuelve en pantallas angostas en vez de estrangular los cinco campos', () => {
    expect(centerCss).toMatch(/@media \(max-width: 1180px\) \{\s*\.contextBar \{ grid-template-columns/);
    // Y en una sola columna el par también se apila.
    expect(centerCss).toMatch(/\.contextBar > section \{ grid-template-columns: 1fr; \}/);
  });
});

describe('nombre y metadata no se pegan', () => {
  beforeEach(() => {
    mockOrganization = {
      id: 'org',
      capabilities: ['standings.read', 'statistics.read', 'qualification.read'],
    };
    mockFixture = {
      status: 'ready',
      error: '',
      refresh: jest.fn(),
      versions: [{ id: 'version', status: 'published' }],
      phases: [{ id: 'phase', fixtureVersionId: 'version', name: 'Liga' }],
      groups: [],
      categories: [{ id: 'category', name: 'Categoría Abierta' }],
      categoryId: 'category',
      activeCategory: { id: 'category', name: 'Categoría Abierta' },
      setCategoryId: jest.fn(),
    };
    mockService = {
      loadStandings: jest.fn().mockResolvedValue({ revision: null, standings: [] }),
      loadStatistics: jest.fn().mockResolvedValue({
        revision: { status: 'published', number: 1 },
        players: [{
          rosterPlayerId: 'player', name: 'Bruno Giménez', appearances: 1, goals: 2, assists: 0,
        }],
        teams: [{
          participantId: 'participant', name: 'Barrio Norte FC', homePlayed: 6, awayPlayed: 0, goals: 13,
        }],
      }),
    };
  });

  test('el par nombre + metadata comparte una clase que los apila con gap', () => {
    // Antes la regla existía sólo para `.team` por posición, y las listas que
    // copiaron el patrón nacían pegadas.
    expect(centerCss).toMatch(/\.identity[^{]*\{[^}]*display: grid[^}]*gap: 3px/);
  });

  test('goleadores y producción colectiva usan el patrón, no espacios en el string', async () => {
    render(
      <MemoryRouter>
        <CompetitionCenterPage mode="statistics" />
      </MemoryRouter>,
    );
    const player = await screen.findByText('Bruno Giménez');
    const team = await screen.findByText('Barrio Norte FC');
    [player, team].forEach((node) => {
      const pair = node.parentElement;
      expect(pair).toHaveClass('identity');
      expect(pair.querySelector('small')).not.toBeNull();
    });
    // La metadata sigue siendo su propio nodo: nada de concatenar textos.
    expect(screen.getByText('1 presencias acreditadas').tagName).toBe('SMALL');
    expect(screen.getByText('6 local · 0 visitante').tagName).toBe('SMALL');
  });
});

describe('Finalizar competencia es un CTA de una línea', () => {
  test('el disparador colapsado no envuelve y el contenedor le da lugar', () => {
    expect(shellCss).toMatch(/\.lifecycleTriggerButton \{\s*white-space: nowrap;\s*\}/);
    // 210px no alcanzaban para la etiqueta más larga del ciclo de vida.
    expect(shellCss).toMatch(/\.lifecycleActions \{[^}]*min-width: min\(100%, 248px\)/);
  });

  test('el botón de confirmación no hereda el nowrap, porque comparte fila con Cancelar', () => {
    const source = read(`${TORNEOS}/CompetitionLifecycleActions.jsx`);
    const triggerUses = source.match(/lifecycleTriggerButton/g) || [];
    expect(triggerUses).toHaveLength(1);
  });

  test('el disparador de finalizar lleva la clase de una línea', () => {
    render(
      <CompetitionLifecycleActions
        organization={{ id: 'org', role: TOURNAMENT_ROLES.OWNER }}
        tournament={{ id: 'tournament', status: 'active' }}
      />,
    );
    const cta = screen.getByRole('button', { name: 'Finalizar competencia' });
    expect(cta).toHaveClass('lifecycleTriggerButton');
  });
});

describe('el icono de la card tiene aire propio', () => {
  test('el patrón reutilizado separa el icono del eyebrow', () => {
    expect(shellCss).toMatch(/\.securityPanel > svg:first-child \{\s*margin-bottom: 10px;\s*\}/);
  });
});

describe('el número de versión pertenece a su caja', () => {
  test('el tipo se dimensiona contra los 50px del badge y no los desborda', () => {
    const badgeBox = fixtureCss.match(/\.versionNumber \{\s*display: grid;\s*width: (\d+)px;\s*height: (\d+)px;/);
    expect(badgeBox).not.toBeNull();
    const boxSide = Number(badgeBox[1]);
    const fontRule = fixtureCss.match(/\.versionNumber \{\s*font-size: clamp\([^,]+,[^,]+, ([\d.]+)rem\);\s*line-height: 1;/);
    expect(fontRule).not.toBeNull();
    const maxFontPx = Number(fontRule[1]) * 16;
    expect(maxFontPx).toBeLessThan(boxSide);
    // El valor anterior, 3.25rem = 52px, era más alto que la caja.
    expect(fixtureCss).not.toContain('font-size: clamp(2rem, 5vw, 3.25rem)');
  });
});
