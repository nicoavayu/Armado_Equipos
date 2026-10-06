import {
  forgetCoreUnreadSnapshots,
  loadCoreUnread,
  publishCoreUnreadSnapshot,
} from '../features/space-navigation/crossProductUnread';

jest.mock('../supabase', () => ({ supabase: {} }));

// A recording stand-in for the Core client: it only answers a HEAD count, and records every filter.
function countingClient(count, { error = null } = {}) {
  const calls = [];
  const query = {
    select: (...args) => { calls.push(['select', ...args]); return query; },
    eq: (...args) => { calls.push(['eq', ...args]); return query; },
    gte: (...args) => { calls.push(['gte', ...args]); return query; },
    gt: (...args) => { calls.push(['gt', ...args]); return query; },
    or: (...args) => { calls.push(['or', ...args]); return query; },
    then: (resolve) => resolve({ count, error }),
  };
  return {
    calls,
    client: { from: (table) => { calls.push(['from', table]); return query; } },
  };
}

describe('Core unread signal read from Torneos', () => {
  beforeEach(() => forgetCoreUnreadSnapshots());

  test('a bounded HEAD count of the account\'s unread, visible notifications: no rows are loaded', async () => {
    const { client, calls } = countingClient(2);
    await expect(loadCoreUnread('user-1', { client })).resolves.toEqual({ status: 'ready', hasUnread: true, exact: false });
    expect(calls).toEqual(expect.arrayContaining([
      ['from', 'notifications'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'user_id', 'user-1'],
      ['eq', 'read', false],
    ]));
    expect(calls.some(([kind, column]) => kind === 'gte' && column === 'created_at')).toBe(true);
    expect(calls.some(([kind, filter]) => kind === 'or' && /^send_at\.is\.null,send_at\.lte\./.test(filter))).toBe(true);
  });

  test('with Core\'s own exact total of this session, only the newer rows are counted', async () => {
    publishCoreUnreadSnapshot('user-1', 0, Date.UTC(2026, 9, 6, 12));
    const { client, calls } = countingClient(0);
    await expect(loadCoreUnread('user-1', { client })).resolves.toEqual({ status: 'ready', hasUnread: false, exact: true });
    expect(calls).toEqual(expect.arrayContaining([['gt', 'created_at', '2026-10-06T12:00:00.000Z']]));
  });

  test('another account never uses that snapshot', async () => {
    publishCoreUnreadSnapshot('user-1', 4);
    const { client } = countingClient(0);
    await expect(loadCoreUnread('user-2', { client })).resolves.toEqual({ status: 'ready', hasUnread: false, exact: false });
  });

  test('a failed read is an error, never «no notices»', async () => {
    const { client } = countingClient(null, { error: new Error('offline') });
    await expect(loadCoreUnread('user-1', { client })).rejects.toThrow('offline');
  });
});
