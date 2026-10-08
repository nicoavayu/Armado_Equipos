// PILOT 0015/0016 — a participant sees that a match was rescheduled, the time it had before, and gets a Torneos notice.
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

test('a postponed match says it was postponed and the time it had', async () => {
  show({ status: 'postponed', scheduledAt: null, previousScheduledAt: '2030-10-17T18:00:00.000Z' });
  const note = await screen.findByText(/estaba para el/);
  expect(note).toHaveTextContent('Postergado · estaba para el');
  expect(screen.queryByText(/Reprogramado/)).not.toBeInTheDocument();
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

test('0016: one notice per participant and reschedule, never the reason, and a repeated request records nothing', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'backend/torneos/supabase/migrations/00000000000016_match_reschedule_notice.sql'), 'utf8');
  const code = sql.replace(/--[^\n]*/g, '');
  // The organizer's reason never reaches a notice: the trigger does not read it and the table refuses a message.
  expect(code).not.toMatch(/new\.reason/);
  expect(code).toMatch(/\(kind IN \('match\.rescheduled', 'match\.postponed'\)\) = \([\s\S]*?message IS NULL/);
  // At most one notice per person and reschedule, even if the insert ran twice.
  expect(code).toMatch(/CREATE UNIQUE INDEX tournament_user_notifications_reschedule_recipient_key\s+ON public\.tournament_user_notifications \(source_reschedule_id, recipient_user_id\)/);
  expect(code).toMatch(/on conflict \(source_reschedule_id, recipient_user_id\) where source_reschedule_id is not null do nothing/);
  // The same request again is a no-op before any history row.
  const noop = code.indexOf("v_match.duration_minutes is not distinct from p_duration_minutes");
  expect(noop).toBeGreaterThan(-1);
  expect(noop).toBeLessThan(code.indexOf('insert into public.tournament_match_reschedules'));
  // Recipients are the people the two participant reads serve, minus whoever rescheduled.
  expect(code).toMatch(/roster\.status in \('approved', 'locked'\)/);
  expect(code).toMatch(/player\.eligibility_status = 'eligible'/);
  expect(code).toMatch(/manager\.role in \('captain', 'delegate'\)/);
  expect(code).toMatch(/recipient\.user_id is distinct from new\.actor_user_id/);
  // A postponement is its own notice, without a new time; only a scheduled or postponed history row is notified.
  expect(code).toMatch(/elsif new\.new_status = 'postponed' then\s+v_kind := 'match\.postponed';/);
  expect(code).toMatch(/AND \(kind <> 'match\.postponed' OR scheduled_at IS NULL\)/);
  expect(code).toMatch(/case when v_kind = 'match\.rescheduled' then new\.new_scheduled_at end/);
  // Internal trigger function, no new grants.
  expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.notify_tournament_match_schedule_change\(\) FROM PUBLIC, anon, authenticated, /);
  expect(code).not.toMatch(/\bGRANT\b/);
  expect(code).toMatch(/TORNEOS_PILOT_0016_PRECONDITION_FAILED: reschedule_tournament_match body/);
});
