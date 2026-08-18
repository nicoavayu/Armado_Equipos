#!/usr/bin/env node

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const BUCKET = 'tournament-player-portraits';
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:57321';
const DATABASE_URL = process.env.SUPABASE_DB_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function assertLoopback(rawUrl, protocols) {
  const parsed = new URL(rawUrl);
  if (!protocols.includes(parsed.protocol) || !LOOPBACK.has(parsed.hostname)) {
    throw new Error('Player portrait provisioning only accepts an explicit loopback backend.');
  }
}

async function verifyDatabase(database) {
  const { rows } = await database.query(
    `select bucket.id, bucket.name, bucket.public, bucket.file_size_limit,
            bucket.allowed_mime_types,
            (select count(*)::integer from pg_policies policy
             where policy.schemaname = 'storage'
               and policy.tablename = 'objects'
               and coalesce(policy.qual, '') like '%tournament-player-portraits%'
            ) as object_policies
     from storage.buckets bucket where bucket.id = $1`,
    [BUCKET],
  );
  const row = rows[0];
  if (!row || row.name !== BUCKET || row.public !== false
    || Number(row.file_size_limit) !== MAX_BYTES
    || JSON.stringify([...row.allowed_mime_types].sort()) !== JSON.stringify([...MIME_TYPES].sort())
    || row.object_policies !== 0) {
    throw new Error('Player portrait bucket contract is not private/server-only.');
  }
  return row;
}

async function run() {
  const verifyOnly = process.argv.includes('--verify');
  assertLoopback(SUPABASE_URL, ['http:', 'https:']);
  assertLoopback(DATABASE_URL, ['postgres:', 'postgresql:']);
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in memory.');
  const database = new pg.Client({ connectionString: DATABASE_URL });
  await database.connect();
  try {
    if (!verifyOnly) {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const current = await supabase.storage.getBucket(BUCKET);
      const options = { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: MIME_TYPES };
      const result = current.data
        ? await supabase.storage.updateBucket(BUCKET, options)
        : await supabase.storage.createBucket(BUCKET, options);
      if (result.error) throw result.error;
    }
    const row = await verifyDatabase(database);
    process.stdout.write(`${JSON.stringify({
      mode: verifyOnly ? 'verify' : 'apply', target: 'loopback-only',
      bucket: BUCKET, private: !row.public, maxBytes: Number(row.file_size_limit),
      allowedMimeTypes: row.allowed_mime_types, directObjectPolicies: row.object_policies,
      verified: true,
    }, null, 2)}\n`);
  } finally {
    await database.end();
  }
}

run().catch((error) => {
  console.error(`[tournament-player-portraits] ${error.message}`);
  process.exitCode = 1;
});
