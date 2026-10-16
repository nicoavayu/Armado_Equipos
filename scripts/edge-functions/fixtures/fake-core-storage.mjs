// A fake of the parts of the Supabase Storage API that _shared/coreAccountStorageErasure.ts uses, with the semantics of
// storage-api's list (immediate children of a prefix; folders are entries with id null; `search` is a case-insensitive
// prefix of the child name; sortBy name; limit/offset) and remove (removes what exists, answers the removed objects,
// ignores the missing ones). Also a fake PostgREST select().ilike().range() over in-memory rows. Test-only.

export function createFakeStorage(initial = {}) {
  const buckets = new Map(Object.entries(initial).map(([bucket, paths]) => [bucket, new Set(paths)]));
  const calls = [];
  const state = { failOn: null, hangOn: null, listEntriesOverride: null };

  const bucketApi = (bucket) => ({
    list(prefix, options) {
      calls.push({ op: 'list', bucket, prefix, options });
      if (state.hangOn?.('list', bucket, prefix)) return new Promise(() => {});
      const failure = state.failOn?.('list', bucket, prefix);
      if (failure) return Promise.resolve({ data: null, error: failure });
      const override = state.listEntriesOverride?.(bucket, prefix);
      if (override) return Promise.resolve({ data: override, error: null });
      const base = prefix ? `${prefix}/` : '';
      const children = new Map();
      for (const path of buckets.get(bucket) ?? []) {
        if (!path.startsWith(base)) continue;
        const rest = path.slice(base.length);
        const [head, ...tail] = rest.split('/');
        if (tail.length) children.set(`d:${head}`, { name: head, id: null, metadata: null });
        else children.set(`f:${head}`, { name: head, id: `obj-${head}`, metadata: { size: 1 } });
      }
      let entries = [...children.values()];
      if (options?.search) entries = entries.filter((e) => e.name.toLowerCase().startsWith(String(options.search).toLowerCase()));
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 100;
      return Promise.resolve({ data: entries.slice(offset, offset + limit), error: null });
    },
    remove(paths) {
      calls.push({ op: 'remove', bucket, paths: [...paths] });
      if (state.hangOn?.('remove', bucket, paths)) return new Promise(() => {});
      const failure = state.failOn?.('remove', bucket, paths);
      if (failure) return Promise.resolve({ data: null, error: failure });
      if (paths.length > 1000) return Promise.resolve({ data: null, error: { message: 'too many objects' } });
      const set = buckets.get(bucket) ?? new Set();
      const removed = [];
      for (const path of paths) if (set.delete(path)) removed.push({ name: path });
      return Promise.resolve({ data: removed, error: null });
    },
    // Reading an object is never part of the account deletion (it removes by path): these exist only so a test can
    // prove they are never called.
    download(path) { calls.push({ op: 'download', bucket, paths: [path] }); return Promise.resolve({ data: null, error: { message: 'not in this fake' } }); },
    createSignedUrl(path) { calls.push({ op: 'createSignedUrl', bucket, paths: [path] }); return Promise.resolve({ data: null, error: { message: 'not in this fake' } }); },
    getPublicUrl(path) { calls.push({ op: 'getPublicUrl', bucket, paths: [path] }); return { data: { publicUrl: `https://fake.invalid/${bucket}/${path}` } }; },
  });

  return {
    api: { from: bucketApi },
    calls,
    state,
    objects: (bucket) => [...(buckets.get(bucket) ?? [])].sort(),
    add: (bucket, path) => { if (!buckets.has(bucket)) buckets.set(bucket, new Set()); buckets.get(bucket).add(path); },
  };
}

const likeToRegExp = (pattern) => new RegExp(`^${pattern.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\_]/g, (c) => (c === '_' ? '.' : `\\${c}`))).join('.*')}$`, 'i');

/** select(column).ilike(column, pattern).range(from, to) over `rows[table]`; `failOn(table)` injects an error. */
export function createFakeReferenceDb(rows = {}, { failOn = null, calls = [] } = {}) {
  return {
    calls,
    from(table) {
      return {
        select(column) {
          return {
            ilike(col, pattern) {
              return {
                range(from, to) {
                  calls.push({ op: 'select', table, column, col, pattern, from, to });
                  const failure = failOn?.(table);
                  if (failure) return Promise.resolve({ data: null, error: failure });
                  const re = likeToRegExp(pattern);
                  const matched = (rows[table] ?? []).filter((r) => typeof r[col] === 'string' && re.test(r[col]))
                    .map((r) => ({ [column]: r[column] }));
                  return Promise.resolve({ data: matched.slice(from, to + 1), error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}
