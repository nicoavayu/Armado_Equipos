// PILOT 0015 — a participant sees that a match was rescheduled and the time it had before.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const MATCH = 'a4000000-0000-4000-8000-000000000015';

function show(match) {
  const service = {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'personal', activeOrganizationId: null },
      organizations: [],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: null }),
    loadCompetitionContext: jest.fn().mockResolvedValue({}),
    setTournamentContext: jest.fn(),
    loadPlayerMatches: jest.fn().mockResolvedValue([{
      matchId: MATCH,
      teamName: 'Lab Halcones',
      opponentName: 'Lab Halcones Reserva',
      isHome: true,
      status: 'scheduled',
      venue: 'Complejo Piloto',
      court: 'Cancha 2',
      availability: null,
      ...match,
    }]),
    respondMatchAvailability: jest.fn(),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
  render(
    <MemoryRouter initialEntries={['/torneos/mis-partidos']}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('a rescheduled match shows the new time and says what the previous one was', async () => {
  show({ scheduledAt: '2030-10-18T20:30:00.000Z', previousScheduledAt: '2030-10-17T18:00:00.000Z' });
  const note = await screen.findByText(/antes era el/);
  expect(note).toHaveTextContent('Reprogramado · antes era el');
  const previous = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date('2030-10-17T18:00:00.000Z'));
  expect(note).toHaveTextContent(previous);
});

test('a match that was never rescheduled has no note', async () => {
  show({ scheduledAt: '2030-10-18T20:30:00.000Z', previousScheduledAt: null });
  expect(await screen.findByText('Programado')).toBeInTheDocument();
  expect(screen.queryByText(/antes era el/)).not.toBeInTheDocument();
});

test('0015 only adds the previous kickoff to the two participant reads: no reason, venue or court of the old slot', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'backend/torneos/supabase/migrations/00000000000015_participant_match_reschedule_visibility.sql'), 'utf8');
  expect((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length).toBe(2);
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_player_tournament_matches\(\)/);
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_managed_tournament_matches\(\)/);
  expect((sql.match(/'previousScheduledAt', last_reschedule\.previous_scheduled_at/g) || []).length).toBe(2);
  expect(sql).not.toMatch(/reschedule\.reason|previous_venue_id|previous_court_id/);
  expect(sql).not.toMatch(/\b(GRANT|REVOKE|ALTER TABLE|CREATE POLICY|DROP)\b/);
  expect(sql).toMatch(/'998cd63e1fb57ca63147ee556ae81783'/);
  expect(sql).toMatch(/'ab7320d546b04e171868875d01beac2a'/);
});
