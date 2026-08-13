import fs from 'node:fs';
import path from 'node:path';
import {
  getRosterProgress,
  TEAM_ENTRY_TRANSITIONS,
} from '../features/torneos/domain/teamRegistration';

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations_history/20260725210000_tournament_teams_rosters.sql',
  ),
  'utf8',
);

describe('tournament team registration domain', () => {
  test('centralizes the safe team lifecycle', () => {
    expect(TEAM_ENTRY_TRANSITIONS.submitted).toEqual([
      'approved',
      'changes_requested',
      'rejected',
      'archived',
    ]);
    expect(TEAM_ENTRY_TRANSITIONS.approved).not.toContain('in_progress');
    expect(TEAM_ENTRY_TRANSITIONS.rejected).not.toContain('approved');
  });

  test('reports roster requirements without relying on UI state', () => {
    const progress = getRosterProgress([
      { shirtNumber: 1, primaryPosition: 'ARQ', isGoalkeeper: true },
      { shirtNumber: 2, primaryPosition: 'DEF', isGoalkeeper: false },
      { shirtNumber: 2, primaryPosition: null, isGoalkeeper: false },
    ], {
      minimumPlayers: 5,
      maximumPlayers: 10,
      minimumGoalkeepers: 1,
      shirtNumberRequired: true,
      uniqueShirtNumbers: true,
      positionRequired: true,
    });
    expect(progress.complete).toBe(false);
    expect(progress.errors).toEqual(expect.arrayContaining([
      'Faltan 2 jugadores para el mínimo.',
      'Todos los jugadores necesitan una posición.',
      'Hay dorsales repetidos.',
    ]));
  });

  test('fails closed when roster settings are legitimately absent', () => {
    const progress = getRosterProgress([], null);
    expect(progress).toEqual(expect.objectContaining({
      configured: false,
      complete: false,
      minimum: 0,
      percent: 0,
    }));
    expect(progress.errors).toContain(
      'Los requisitos del plantel todavía no están configurados.',
    );
  });

  test('keeps audit append-only and all client writes behind RPCs', () => {
    expect(migration).toMatch(/create table public\.tournament_audit_log/i);
    expect(migration).toMatch(/tournament_audit_append_only before update or delete/i);
    expect(migration).toMatch(/TORNEOS_AUDIT_APPEND_ONLY/);
    expect(migration).toMatch(/revoke all on table public\.tournament_team_entries from anon, authenticated/i);
    expect(migration).toMatch(/grant select on public\.tournament_team_entries to authenticated/i);
    expect(migration).not.toMatch(/grant (insert|update|delete).*tournament_team_entries.*authenticated/i);
  });

  test('hashes test invitations and never persists the returned token', () => {
    expect(migration).toMatch(/token_hash text not null unique/i);
    expect(migration).toMatch(/public\.digest\(v_token, 'sha256'\)/i);
    expect(migration).toMatch(/'environment', 'test-only'/i);
    expect(migration).not.toMatch(/token_plain|plain_token/i);
  });

  test('binds every relational child to the same tenant and entry', () => {
    expect(migration).toMatch(
      /foreign key \(organization_id, team_entry_id, roster_id\)[\s\S]{0,160}references public\.tournament_rosters\(organization_id, team_entry_id, id\)/i,
    );
    expect(migration).toMatch(
      /foreign key \(organization_id, tournament_id, team_entry_id\)[\s\S]{0,160}references public\.tournament_team_entries\(organization_id, tournament_id, id\)/i,
    );
    expect(migration).toMatch(
      /foreign key \(organization_id, team_entry_id, manager_id\)[\s\S]{0,160}references public\.tournament_team_managers\(organization_id, team_entry_id, id\)/i,
    );
  });

  test('requires verified session email and manager invitation acceptance', () => {
    expect(migration).toMatch(/email_confirmed_at/i);
    expect(migration).toMatch(/TORNEOS_MANAGER_INVITATION_REQUIRED/i);
    expect(migration).toMatch(/v_email_has_edge_space/i);
    expect(migration).toMatch(/team_user_is_admin_or_owner\(id, v_uid\)/i);
  });

  test('keeps direct column grants free of invitation hashes and provisional contacts', () => {
    const grants = migration.slice(migration.indexOf('grant select ('));
    expect(grants).not.toMatch(/grant select \([^;]*token_hash/);
    expect(grants).not.toMatch(/grant select \([^;]*contact_email/);
    expect(grants).not.toMatch(/grant select \([^;]*contact_phone/);
  });

  test('uses fail-closed definer functions with explicit empty search paths', () => {
    for (const functionName of [
      'create_tournament_team_entry',
      'add_tournament_roster_player',
      'submit_tournament_team_entry',
      'review_tournament_team_entry',
      'get_tournament_teams_context',
      'get_team_registration_context',
    ]) {
      expect(migration).toMatch(new RegExp(
        `create or replace function public\\.${functionName}[\\s\\S]{0,2000}security definer[\\s\\S]{0,120}set search_path = ''`,
        'i',
      ));
    }
  });
});
