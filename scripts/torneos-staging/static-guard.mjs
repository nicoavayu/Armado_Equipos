#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ALLOWED_HOSTS = new Set([
  'hhyvmhgpapyuzjgxfnqv.supabase.co',
  'rcyuuoaqfwcembdajcss.supabase.co',
]);
const PLACEHOLDER_HOSTS = new Set([
  'actual.supabase.co',
  'example.supabase.co',
  'production-project.supabase.co',
  'xxxxx.supabase.co',
]);

export function scanText(text, file = '') {
  const findings = [];
  const isTest = /(?:^|\/)(?:__tests__|test|tests|fixtures)(?:\/|$)|\.test\.[^.]+$|setupTests\.js$/.test(file);
  const jwt = /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g;
  const privateKeyPayload = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{40,}-----END/g;
  if (!isTest && jwt.test(text)) findings.push('JWT-like credential');
  if (privateKeyPayload.test(text)) findings.push('private-key payload');
  if (!isTest && /\bsb_secret_[A-Za-z0-9_-]{20,}/.test(text)) findings.push('Supabase secret key value');

  for (const match of text.matchAll(/https:\/\/([a-z0-9-]+\.supabase\.co)/g)) {
    const host = match[1];
    if (!isTest && !ALLOWED_HOSTS.has(host) && !PLACEHOLDER_HOSTS.has(host)
      && !host.includes('replace-with') && !host.includes('${')) {
      findings.push(`unknown Supabase host ${host}`);
    }
  }
  return findings;
}

export function scanRepository(repoRoot = process.cwd()) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot })
    .toString('utf8').split('\0').filter(Boolean);
  const findings = [];
  for (const file of files) {
    const absolute = path.join(repoRoot, file);
    let content;
    try { content = fs.readFileSync(absolute, 'utf8'); } catch { continue; }
    for (const finding of scanText(content, file)) findings.push({ file, finding });
  }
  return findings;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const findings = scanRepository(process.cwd());
  if (findings.length) {
    for (const item of findings) console.error(`${item.file}: ${item.finding}`);
    process.exit(1);
  }
  console.log('STAGING_STATIC_GUARD_OK secrets=0 unknownProjectHosts=0');
}
