import {
  addFriendsToPrivateGroup,
  archivePrivateGroup,
  createPrivateGroup,
  getPrivateGroupsByOwner,
  removeFriendFromPrivateGroup,
  renamePrivateGroup,
  resolveInviteRecipientsFromGroups,
} from '../services/db/privateFriendGroups';

const createMockClient = (initialTables = {}) => {
  const tables = Object.fromEntries(
    Object.entries(initialTables).map(([table, rows]) => [table, [...rows]]),
  );
  let idCounter = 1;

  class QueryBuilder {
    constructor(table) {
      this.table = table;
      this.action = 'select';
      this.filters = [];
      this.ordering = [];
      this.payload = null;
      this.returning = false;
      this.mode = 'many';
    }

    select() {
      if (this.action !== 'select') {
        this.returning = true;
      }
      return this;
    }

    insert(rows) {
      this.action = 'insert';
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }

    update(patch) {
      this.action = 'update';
      this.payload = patch;
      return this;
    }

    delete() {
      this.action = 'delete';
      return this;
    }

    eq(field, value) {
      this.filters.push((row) => row?.[field] === value);
      return this;
    }

    in(field, values) {
      const valueSet = new Set(values || []);
      this.filters.push((row) => valueSet.has(row?.[field]));
      return this;
    }

    is(field, value) {
      this.filters.push((row) => row?.[field] === value);
      return this;
    }

    not(field, operator, value) {
      if (operator === 'is' && value === null) {
        this.filters.push((row) => row?.[field] !== null && row?.[field] !== undefined);
      }
      return this;
    }

    order(field, { ascending = true } = {}) {
      this.ordering.push({ field, ascending });
      return this;
    }

    single() {
      this.mode = 'single';
      return this;
    }

    maybeSingle() {
      this.mode = 'maybeSingle';
      return this;
    }

    then(resolve, reject) {
      try {
        resolve(this.execute());
      } catch (error) {
        if (typeof reject === 'function') reject(error);
        else throw error;
      }
    }

    execute() {
      const tableRows = tables[this.table] || [];
      const filteredRows = this.applyOrdering(
        tableRows.filter((row) => this.filters.every((filter) => filter(row))),
      );

      if (this.action === 'select') {
        return this.finalize(filteredRows);
      }

      if (this.action === 'insert') {
        const createdRows = this.payload.map((row) => ({
          created_at: row.created_at || `2026-03-19T12:00:0${idCounter}Z`,
          updated_at: row.updated_at || `2026-03-19T12:00:0${idCounter}Z`,
          archived_at: row.archived_at ?? null,
          id: row.id || `${this.table}-${idCounter++}`,
          ...row,
        }));
        tables[this.table] = [...tableRows, ...createdRows];
        return this.finalize(this.returning ? createdRows : null);
      }

      if (this.action === 'update') {
        const updatedRows = filteredRows.map((row) => Object.assign(row, this.payload));
        return this.finalize(this.returning ? updatedRows : null);
      }

      if (this.action === 'delete') {
        const toDelete = new Set(filteredRows);
        tables[this.table] = tableRows.filter((row) => !toDelete.has(row));
        return this.finalize(this.returning ? filteredRows : null);
      }

      return { data: null, error: null };
    }

    applyOrdering(rows) {
      return this.ordering.reduceRight((acc, { field, ascending }) => (
        [...acc].sort((left, right) => {
          if (left?.[field] === right?.[field]) return 0;
          if (left?.[field] === undefined || left?.[field] === null) return ascending ? -1 : 1;
          if (right?.[field] === undefined || right?.[field] === null) return ascending ? 1 : -1;
          return ascending
            ? (left[field] > right[field] ? 1 : -1)
            : (left[field] > right[field] ? -1 : 1);
        })
      ), rows);
    }

    finalize(data) {
      if (this.mode === 'single') {
        return {
          data: Array.isArray(data) ? (data[0] || null) : data,
          error: null,
        };
      }

      if (this.mode === 'maybeSingle') {
        return {
          data: Array.isArray(data) ? (data[0] || null) : data,
          error: null,
        };
      }

      return {
        data,
        error: null,
      };
    }
  }

  return {
    tables,
    from(table) {
      return new QueryBuilder(table);
    },
  };
};

describe('privateFriendGroups service', () => {
  test('maps create failures to a precise permission error instead of an unknown error', async () => {
    const client = {
      from(table) {
        if (table !== 'private_friend_groups') {
          throw new Error(`Unexpected table in permission mapping test: ${table}`);
        }

        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: null,
                error: {
                  code: '42501',
                  message: '',
                  details: 'new row violates row-level security policy for table "private_friend_groups"',
                  hint: null,
                },
              }),
            }),
          }),
        };
      },
    };

    await expect(createPrivateGroup({
      ownerUserId: 'owner-1',
      name: 'Futbol 7',
      memberUserIds: [],
    }, client)).rejects.toMatchObject({
      message: 'No tenés permisos para crear o modificar este grupo.',
      code: '42501',
    });
  });

  test('does not expose or allow mutation of another user\'s groups', async () => {
    const client = createMockClient({
      usuarios: [
        { id: 'owner-1', nombre: 'Owner 1' },
        { id: 'owner-2', nombre: 'Owner 2' },
      ],
      private_friend_groups: [
        {
          id: 'group-1',
          owner_user_id: 'owner-1',
          name: 'Privado',
          archived_at: null,
          created_at: '2026-03-19T12:00:00Z',
          updated_at: '2026-03-19T12:00:00Z',
        },
      ],
      private_friend_group_members: [],
    });

    expect(await getPrivateGroupsByOwner('owner-2', {}, client)).toEqual([]);

    await expect(renamePrivateGroup({
      groupId: 'group-1',
      ownerUserId: 'owner-2',
      name: 'Cambio ajeno',
    }, client)).rejects.toThrow('No se encontró el grupo o no tenés permisos para modificarlo.');
  });

  test('creates an empty group and excludes archived groups from the active list', async () => {
    const client = createMockClient({
      usuarios: [
        { id: 'owner-1', nombre: 'Owner' },
      ],
      private_friend_groups: [],
      private_friend_group_members: [],
    });

    const createdGroup = await createPrivateGroup({
      ownerUserId: 'owner-1',
      name: 'Lista vacia',
      memberUserIds: [],
    }, client);

    expect(createdGroup.name).toBe('Lista vacia');
    expect(createdGroup.member_count).toBe(0);
    expect(createdGroup.members).toEqual([]);

    await archivePrivateGroup({
      groupId: createdGroup.id,
      ownerUserId: 'owner-1',
    }, client);

    const activeGroups = await getPrivateGroupsByOwner('owner-1', {}, client);
    expect(activeGroups).toEqual([]);
  });

  test('creates a group with members, renames it, adds and removes members', async () => {
    const client = createMockClient({
      usuarios: [
        { id: 'owner-1', nombre: 'Owner' },
        { id: 'friend-1', nombre: 'Ana' },
        { id: 'friend-2', nombre: 'Bruno' },
        { id: 'friend-3', nombre: 'Carla' },
      ],
      amigos: [
        { id: 'rel-1', user_id: 'owner-1', friend_id: 'friend-1', status: 'accepted' },
        { id: 'rel-2', user_id: 'owner-1', friend_id: 'friend-2', status: 'accepted' },
        { id: 'rel-3', user_id: 'friend-3', friend_id: 'owner-1', status: 'accepted' },
      ],
      private_friend_groups: [],
      private_friend_group_members: [],
    });

    const createdGroup = await createPrivateGroup({
      ownerUserId: 'owner-1',
      name: 'Martes',
      memberUserIds: ['friend-1', 'friend-2'],
    }, client);

    expect(createdGroup.member_count).toBe(2);
    expect(createdGroup.members.map((member) => member.friend_user_id)).toEqual(['friend-1', 'friend-2']);

    const renamedGroup = await renamePrivateGroup({
      groupId: createdGroup.id,
      ownerUserId: 'owner-1',
      name: 'Martes noche',
    }, client);

    expect(renamedGroup.name).toBe('Martes noche');

    const expandedGroup = await addFriendsToPrivateGroup({
      groupId: createdGroup.id,
      ownerUserId: 'owner-1',
      friendUserIds: ['friend-3'],
    }, client);

    expect(expandedGroup.members.map((member) => member.friend_user_id)).toEqual(['friend-1', 'friend-2', 'friend-3']);

    const trimmedGroup = await removeFriendFromPrivateGroup({
      groupId: createdGroup.id,
      ownerUserId: 'owner-1',
      friendUserId: 'friend-1',
    }, client);

    expect(trimmedGroup.members.map((member) => member.friend_user_id)).toEqual(['friend-2', 'friend-3']);
  });

  test('resolves group invite recipients with dedupe and skip buckets', async () => {
    const client = createMockClient({
      usuarios: [
        { id: 'owner-1', nombre: 'Owner', acepta_invitaciones: true },
        { id: 'friend-1', nombre: 'Ana', acepta_invitaciones: true },
        { id: 'friend-2', nombre: 'Bruno', acepta_invitaciones: true },
        { id: 'friend-3', nombre: 'Carla', acepta_invitaciones: true },
        { id: 'friend-4', nombre: 'Dani', acepta_invitaciones: true },
      ],
      amigos: [
        { id: 'rel-1', user_id: 'owner-1', friend_id: 'friend-1', status: 'accepted' },
        { id: 'rel-2', user_id: 'owner-1', friend_id: 'friend-2', status: 'accepted' },
        { id: 'rel-3', user_id: 'friend-4', friend_id: 'owner-1', status: 'accepted' },
      ],
      private_friend_groups: [
        { id: 'group-1', owner_user_id: 'owner-1', name: 'Equipo A', archived_at: null, created_at: '2026-03-19T12:00:00Z', updated_at: '2026-03-19T12:00:00Z' },
        { id: 'group-2', owner_user_id: 'owner-1', name: 'Equipo B', archived_at: null, created_at: '2026-03-19T12:01:00Z', updated_at: '2026-03-19T12:01:00Z' },
      ],
      private_friend_group_members: [
        { id: 'member-1', group_id: 'group-1', friend_user_id: 'friend-1', created_at: '2026-03-19T12:00:00Z' },
        { id: 'member-2', group_id: 'group-1', friend_user_id: 'friend-2', created_at: '2026-03-19T12:00:01Z' },
        { id: 'member-3', group_id: 'group-2', friend_user_id: 'friend-2', created_at: '2026-03-19T12:01:00Z' },
        { id: 'member-4', group_id: 'group-2', friend_user_id: 'friend-3', created_at: '2026-03-19T12:01:01Z' },
        { id: 'member-5', group_id: 'group-2', friend_user_id: 'friend-4', created_at: '2026-03-19T12:01:02Z' },
      ],
      jugadores: [
        { id: 'player-1', partido_id: 55, usuario_id: 'friend-1' },
      ],
      notifications_ext: [
        {
          id: 'notif-1',
          user_id: 'friend-4',
          match_id_text: '55',
          type: 'match_invite',
          data: { status: 'pending' },
          send_at: '2026-03-19T13:00:00Z',
          created_at: '2026-03-19T13:00:00Z',
        },
      ],
    });

    const resolution = await resolveInviteRecipientsFromGroups({
      matchId: 55,
      ownerUserId: 'owner-1',
      selectedGroupIds: ['group-1', 'group-2'],
    }, client);

    expect(resolution.recipients.map((recipient) => recipient.user_id)).toEqual(['friend-2']);
    expect(resolution.skipped.duplicate.map((entry) => entry.user_id)).toEqual(['friend-2']);
    expect(resolution.skipped.already_in_match.map((entry) => entry.user_id)).toEqual(['friend-1']);
    expect(resolution.skipped.already_invited.map((entry) => entry.user_id)).toEqual(['friend-4']);
    expect(resolution.skipped.ineligible.map((entry) => entry.user_id)).toEqual(['friend-3']);
  });

  test('removing a member from a group does not delete the friendship', async () => {
    const client = createMockClient({
      usuarios: [
        { id: 'owner-1', nombre: 'Owner' },
        { id: 'friend-1', nombre: 'Ana' },
      ],
      amigos: [
        { id: 'rel-1', user_id: 'owner-1', friend_id: 'friend-1', status: 'accepted' },
      ],
      private_friend_groups: [
        {
          id: 'group-1',
          owner_user_id: 'owner-1',
          name: 'Martes',
          archived_at: null,
          created_at: '2026-03-19T12:00:00Z',
          updated_at: '2026-03-19T12:00:00Z',
        },
      ],
      private_friend_group_members: [
        { id: 'member-1', group_id: 'group-1', friend_user_id: 'friend-1', created_at: '2026-03-19T12:00:01Z' },
      ],
    });

    await removeFriendFromPrivateGroup({
      groupId: 'group-1',
      ownerUserId: 'owner-1',
      friendUserId: 'friend-1',
    }, client);

    expect(client.tables.private_friend_group_members).toEqual([]);
    expect(client.tables.amigos).toEqual([
      { id: 'rel-1', user_id: 'owner-1', friend_id: 'friend-1', status: 'accepted' },
    ]);
  });
});
