export const supabase = new Proxy({}, { get: () => () => { throw new Error('Offline fixture: network access forbidden'); } });
