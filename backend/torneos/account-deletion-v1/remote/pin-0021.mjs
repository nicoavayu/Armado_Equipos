#!/usr/bin/env node
// Re-pins db-0021.mjs after an edit of the migration or its rollback: the two file sha256 and the md5 of the two bodies
// (the exact text between the dollar quotes, which is what pg_proc.prosrc holds). db-0021.test.mjs checks the pins.
//   node backend/torneos/account-deletion-v1/remote/pin-0021.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const DRIVER = path.join(HERE, 'db-0021.mjs');
const migration = () => fs.readFileSync(path.join(REPO, 'backend/torneos/supabase/migrations/00000000000021_account_erasure.sql'), 'utf8');
const rollback = () => fs.readFileSync(path.join(REPO, 'backend/torneos/account-deletion-v1/rollback/00000000000021_account_erasure.rollback.sql'), 'utf8');
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const md5 = (t) => crypto.createHash('md5').update(t).digest('hex');
export const body = (text, name) => { const i = text.indexOf(`create function ${name}`); const j = text.indexOf('as $$', i) + 5; return text.slice(j, text.indexOf('$$;', j)); };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [m, r] = [migration(), rollback()];
  let driver = fs.readFileSync(DRIVER, 'utf8');
  driver = driver.replace(/(00000000000021_account_erasure\.sql',\n\s+')[^']+(')/, `$1${sha256(m)}$2`)
    .replace(/(00000000000021_account_erasure\.rollback\.sql',\n\s+')[^']+(')/, `$1${sha256(r)}$2`)
    .replace(/(POST_0021: Object\.freeze\(\{ erase: ')[^']+(', label: ')[^']+(')/,
      `$1${md5(body(m, 'private.erase_tournament_account'))}$2${md5(body(m, 'private.account_erasure_label'))}$3`);
  fs.writeFileSync(DRIVER, driver);
  process.stdout.write(`${JSON.stringify({ apply: sha256(m), rollback: sha256(r),
    erase: md5(body(m, 'private.erase_tournament_account')), label: md5(body(m, 'private.account_erasure_label')) })}\n`);
}
