import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import {
  getMatchPeriodLabel,
  MATCH_EVENT_PERIOD_OPTIONS,
  MATCH_PERIOD_LABELS,
  SUSPENSION_PERIOD_OPTIONS,
} from '../features/torneos/domain/matchPeriods';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
const TORNEOS = 'src/features/torneos/components';

const MATCH = 'a4000000-0000-4000-8000-000000000001';

/**
 * Los ocho valores del CHECK de `tournament_match_events.period`. `unknown` es
 * parte del contrato aunque ninguna pantalla lo ofrezca: la base lo admite y el
 * acta tiene que poder mostrarlo.
 */
const DB_PERIODS = [
  'pre_match', 'first_half', 'halftime', 'second_half',
  'extra_time', 'penalties', 'post_match', 'unknown',
];

describe('el período del partido se dice en castellano', () => {
  test('second_half es «Segundo tiempo», no la clave ni el guión bajo sustituido', () => {
    expect(getMatchPeriodLabel('second_half')).toBe('Segundo tiempo');
    expect(getMatchPeriodLabel('second_half')).not.toBe('second_half');
    // Un `replace('_', ' ')` daría «second half»: el mapping es de dominio.
    expect(getMatchPeriodLabel('second_half')).not.toBe('second half');
    expect(getMatchPeriodLabel('first_half')).toBe('Primer tiempo');
  });

  test('el mapping cubre exactamente el enum de la base', () => {
    expect(Object.keys(MATCH_PERIOD_LABELS).sort()).toEqual([...DB_PERIODS].sort());
    for (const period of DB_PERIODS) {
      const label = getMatchPeriodLabel(period);
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/_/);
      expect(label).not.toBe(period);
    }
  });

  test('un valor nuevo o vacío no filtra la clave técnica', () => {
    expect(getMatchPeriodLabel('golden_goal')).toBe('Período sin determinar');
    expect(getMatchPeriodLabel(null)).toBe('Período sin determinar');
    expect(getMatchPeriodLabel(undefined)).toBe('Período sin determinar');
    expect(getMatchPeriodLabel('')).toBe('Período sin determinar');
  });

  test('los selects se arman con las mismas etiquetas que el timeline', () => {
    expect(MATCH_EVENT_PERIOD_OPTIONS.map((option) => option.value)).toEqual([
      'pre_match', 'first_half', 'halftime', 'second_half',
      'extra_time', 'penalties', 'post_match',
    ]);
    expect(SUSPENSION_PERIOD_OPTIONS.map((option) => option.value)).toEqual([
      'first_half', 'halftime', 'second_half', 'extra_time',
    ]);
    for (const option of [...MATCH_EVENT_PERIOD_OPTIONS, ...SUSPENSION_PERIOD_OPTIONS]) {
      expect(option.label).toBe(MATCH_PERIOD_LABELS[option.value]);
    }
  });
});

/**
 * Las pantallas auditadas en esta pasada. Se lee el source porque lo que hay que
 * impedir es la reaparición del call site crudo, no un texto puntual.
 */
describe('las pantallas de Torneos no imprimen claves de la base', () => {
  test('el acta traduce período, tipo de evento y tipo de revisión', () => {
    const source = read(`${TORNEOS}/MatchOperationsPage.jsx`);
    expect(source).toContain('getMatchPeriodLabel(item.period)');
    expect(source).not.toMatch(/\{item\.period\}/);
    expect(source).not.toMatch(/\{review\.review_type\}/);
    expect(source).not.toMatch(/EVENT_LABELS\[item\.event_type\] \|\| item\.event_type/);
    // Los eventos de ciclo de vida también tienen etiqueta.
    for (const key of [
      'match_started', 'second_half_started', 'match_ended', 'resumption_future',
    ]) {
      expect(source).toContain(`${key}: '`);
    }
  });

  test('el historial de revisiones traduce su propio estado', () => {
    const source = read(`${TORNEOS}/MatchOperationsPage.jsx`);
    // `tournament_match_reviews.status`: open | approved | rejected | superseded.
    for (const pair of ["open: 'Abierta'", "approved: 'Aprobada'", "rejected: 'Rechazada'", "superseded: 'Reemplazada'"]) {
      expect(source).toContain(pair);
    }
    // El pill ya no cae al valor crudo cuando no conoce el estado.
    expect(source).not.toContain("STATUS_LABELS[status] || status");
  });

  test('los responsables del equipo no muestran «pending»', () => {
    const source = read(`${TORNEOS}/TeamRegistrationPage.jsx`);
    // El estado real de `tournament_team_managers` es pending | active | revoked.
    expect(source).toContain("pending: 'Invitación pendiente'");
    expect(source).not.toMatch(/^\s*invited: /m);
    expect(source).not.toContain('MANAGER_STATUS_LABELS[manager.status] || manager.status');
  });

  test('mis partidos y el landing no muestran el estado crudo', () => {
    expect(read(`${TORNEOS}/MyTournamentMatchesPage.jsx`)).not.toMatch(/<small>\{match\.status\}<\/small>/);
    expect(read(`${TORNEOS}/TorneosLanding.jsx`)).not.toMatch(/· \{organization\.status\}/);
  });
});

describe('el estado del partido le llega al jugador traducido', () => {
  function createService(playerMatches) {
    return {
      loadContext: jest.fn().mockResolvedValue({
        preference: { workspaceType: 'personal', activeOrganizationId: null },
        organizations: [],
      }),
      setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: null }),
      loadCompetitionContext: jest.fn().mockResolvedValue({}),
      setTournamentContext: jest.fn(),
      loadPlayerMatches: jest.fn().mockResolvedValue(playerMatches),
      respondMatchAvailability: jest.fn(),
      createIdempotencyKey: jest.fn(() => 'request-a'),
    };
  }

  test('«scheduled» se ve como «Programado»', async () => {
    const service = createService([{
      matchId: MATCH,
      teamName: 'Napoli',
      opponentName: 'Belgrano',
      isHome: true,
      scheduledAt: '2030-06-01T18:00:00.000Z',
      status: 'scheduled',
      venue: 'Club Horizonte',
      court: 'Cancha 1',
      availability: null,
    }]);
    render(
      <MemoryRouter initialEntries={['/torneos/mis-partidos']}>
        <Routes>
          <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Programado')).toBeInTheDocument();
    expect(screen.queryByText('scheduled')).not.toBeInTheDocument();
  });
});
