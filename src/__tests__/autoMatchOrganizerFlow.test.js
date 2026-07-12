import fs from 'fs';
import path from 'path';

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock('../components/AutocompleteSede', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../supabase', () => ({
  __esModule: true,
  default: {},
  supabase: {},
}));

// eslint-disable-next-line import/first
import { resolveProposalStage } from '../components/jugar/AvailabilityOpportunityCard';
// eslint-disable-next-line import/first
import { buildOrganizeTimeOptions } from '../components/jugar/AutoMatchOrganizeSheet';
import {
  buildAutoMatchNotificationRoute,
  buildNotificationFallbackRoute,
  isAutoMatchNotificationType,
} from '../utils/notificationRoutes';

describe('resolveProposalStage', () => {
  const base = { status: 'collecting', member_count: 4, max_players: 10, organizer_id: null };

  test('collecting below roster cap searches for players', () => {
    expect(resolveProposalStage(base)).toEqual({ key: 'searching', label: 'Buscando jugadores' });
  });

  test('collecting with a full roster waits for responses', () => {
    expect(resolveProposalStage({ ...base, member_count: 10 }).key).toBe('waiting');
  });

  test('ready without organizer asks for one', () => {
    expect(resolveProposalStage({ ...base, status: 'ready' }).key).toBe('needs_organizer');
  });

  test('ready with organizer is organizing', () => {
    expect(resolveProposalStage({ ...base, status: 'ready', organizer_id: 'u1' }).key).toBe('organizing');
  });

  test('created and cancelled/expired are terminal states', () => {
    expect(resolveProposalStage({ ...base, status: 'created' }).key).toBe('created');
    expect(resolveProposalStage({ ...base, status: 'cancelled' }).key).toBe('cancelled');
    expect(resolveProposalStage({ ...base, status: 'expired' }).key).toBe('cancelled');
  });
});

describe('buildOrganizeTimeOptions', () => {
  test('offers 15-minute steps within ±2h without crossing the day', () => {
    const options = buildOrganizeTimeOptions('2026-07-15T21:00:00');
    expect(options).toContain('21:00');
    expect(options).toContain('19:00');
    expect(options).toContain('23:00');
    expect(options).not.toContain('23:15');
    expect(options.every((value) => /^\d{2}:(00|15|30|45)$/.test(value))).toBe(true);
  });

  test('clamps early-day slots to the same date', () => {
    const options = buildOrganizeTimeOptions('2026-07-15T01:00:00');
    expect(options[0]).toBe('00:00');
    expect(options).toContain('03:00');
  });

  test('returns empty for invalid input', () => {
    expect(buildOrganizeTimeOptions('nope')).toEqual([]);
  });
});

describe('auto match notification routing', () => {
  test('detects every auto match type', () => {
    for (const type of [
      'auto_match_gestating',
      'auto_match_almost_full',
      'auto_match_ready',
      'auto_match_organizing',
      'auto_match_created',
      'auto_match_cancelled',
    ]) {
      expect(isAutoMatchNotificationType({ type })).toBe(true);
    }
    expect(isAutoMatchNotificationType({ type: 'match_invite' })).toBe(false);
  });

  test('created deep-links to the real match', () => {
    expect(buildAutoMatchNotificationRoute({
      type: 'auto_match_created',
      data: { match_id: 128, route: '/quiero-jugar?auto=1' },
    })).toBe('/partido-publico/128');
  });

  test('transitions with proposal_id deep-link to that gestation detail', () => {
    expect(buildAutoMatchNotificationRoute({
      type: 'auto_match_ready',
      data: { proposal_id: 42, route: '/quiero-jugar?auto=1' },
    })).toBe('/quiero-jugar?auto=1&proposal=42');
    expect(buildAutoMatchNotificationRoute({
      type: 'auto_match_gestating',
      data: { proposalId: '7' },
    })).toBe('/quiero-jugar?auto=1&proposal=7');
  });

  test('created ignores proposal deep link and opens the real match route', () => {
    expect(buildAutoMatchNotificationRoute({
      type: 'auto_match_created',
      data: { proposal_id: 42, route: '/partido-publico/128' },
    })).toBe('/partido-publico/128');
  });

  test('legacy notifications without proposal_id keep opening the gestation screen', () => {
    expect(buildAutoMatchNotificationRoute({
      type: 'auto_match_ready',
      data: { route: '/quiero-jugar?auto=1' },
    })).toBe('/quiero-jugar?auto=1');
    expect(buildAutoMatchNotificationRoute({
      type: 'auto_match_ready',
      data: { proposal_id: 'abc', route: '/quiero-jugar?auto=1' },
    })).toBe('/quiero-jugar?auto=1');
  });

  test('unsafe or missing links fall back to the gestation screen', () => {
    expect(buildAutoMatchNotificationRoute({ type: 'auto_match_ready', data: {} })).toBe('/quiero-jugar?auto=1');
    expect(buildAutoMatchNotificationRoute({
      type: 'auto_match_ready',
      data: { route: 'https://evil.example/x' },
    })).toBe('/quiero-jugar?auto=1');
  });

  test('the generic fallback route respects auto match types (no more error toast path)', () => {
    expect(buildNotificationFallbackRoute({
      type: 'auto_match_gestating',
      data: { route: '/quiero-jugar?auto=1' },
    })).toBe('/quiero-jugar?auto=1');
  });
});

describe('organizer flow migration SQL guards', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260711210000_auto_match_organizer_flow.sql'),
    'utf8',
  );

  test('declining no longer cancels the whole proposal', () => {
    expect(sql).not.toMatch(/cancelled_reason = 'member_declined'/);
    expect(sql).toMatch(/backfill_auto_match_proposal_members/);
  });

  test('decline block lasts until the slot passes, not 24h from responded_at', () => {
    expect(sql).toMatch(/dp\.proposed_starts_at > now\(\)/);
    expect(sql).not.toMatch(/responded_at > now\(\) - interval '24 hours'/);
  });

  test('slot bucket is protected by an exclusion constraint', () => {
    expect(sql).toMatch(/auto_match_proposals_slot_bucket_excl/);
    expect(sql).toMatch(/exclude using gist/);
    expect(sql).toMatch(/create extension if not exists btree_gist/);
  });

  test('notifications are idempotent through the event registry', () => {
    expect(sql).toMatch(/create table if not exists public\.auto_match_proposal_events/);
    expect(sql).toMatch(/on conflict do nothing;\s*get diagnostics v_rows = row_count/);
  });

  test('organizer reservation rule is the documented least(now()+12h, expires_at)', () => {
    expect(sql).toMatch(/least\(now\(\) \+ interval '12 hours', expires_at\)/);
    expect(sql).toMatch(/cancelled_reason = 'no_organizer'/);
  });

  test('finalize is idempotent and organizer-gated', () => {
    expect(sql).toMatch(/if v_proposal\.partido_id is not null then\s*return v_proposal;/);
    expect(sql).toMatch(/raise exception 'not_the_organizer'/);
  });

  test('client-facing RPCs stay locked down to authenticated', () => {
    for (const grant of [
      /grant execute on function public\.claim_auto_match_organizer\(bigint\) to authenticated;/,
      /grant execute on function public\.finalize_auto_match_proposal\([^)]+\) to authenticated;/,
      /grant execute on function public\.get_auto_match_proposal_members\(bigint\) to authenticated;/,
      /grant execute on function public\.respond_to_auto_match_proposal\(bigint,text,boolean\) to authenticated;/,
    ]) {
      expect(sql).toMatch(grant);
    }
    expect(sql).toMatch(/revoke all on function public\.backfill_auto_match_proposal_members\(bigint\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on function public\.enqueue_auto_match_notification\(bigint,text,text,text,uuid\[\],text,jsonb\) from public, anon, authenticated;/);
  });
});
