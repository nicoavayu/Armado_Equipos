#!/usr/bin/env node

import crypto from 'node:crypto';
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
// Intentional decoys, each pinned to one file AND the exact literal around it.
// The same host anywhere else (or elsewhere in that file) is still a finding.
export const KNOWN_DECOY_HOSTS = [
  // R4 egress-block harness: a non-existent project ref the sandbox must refuse.
  {
    file: 'backend/torneos/phase3b/r4/harness/index.ts',
    // Split so this entry is not itself a scanner match.
    literal: "['other_supabase','https://" + "abcdefghijklmnopqrst.supabase.co']",
  },
];
// Certified evidence tokens, pinned by file AND sha256 of the exact token.
// Any other JWT-like value in that file (or this token elsewhere) is a finding.
export const KNOWN_EVIDENCE_JWTS = [
  // Local SSO lab anon key (role=anon, exp 2026-09-19T19:55:48Z), captured in
  // certified console evidence.
  {
    file: 'integration/torneos-sso/evidence/app-console.json',
    sha256: '304e83a88aa6f4d66f01fdb5416d4dcacab7930dc0b7f1d448f164814028b5a6',
  },
];

function isKnownDecoyHost(text, file, match) {
  return KNOWN_DECOY_HOSTS.some((entry) => {
    const start = match.index - entry.literal.indexOf(match[0]);
    return entry.file === file && start >= 0 && text.startsWith(entry.literal, start);
  });
}

function isKnownEvidenceJwt(token, file) {
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  return KNOWN_EVIDENCE_JWTS.some((entry) => entry.file === file && entry.sha256 === digest);
}

export function scanText(text, file = '') {
  const findings = [];
  const isTest = /(?:^|\/)(?:__tests__|test|tests|fixtures)(?:\/|$)|\.test\.[^.]+$|setupTests\.js$/.test(file);
  const jwt = /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g;
  const privateKeyPayload = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{40,}-----END/g;
  if (!isTest && [...text.matchAll(jwt)].some(([token]) => !isKnownEvidenceJwt(token, file))) {
    findings.push('JWT-like credential');
  }
  if (privateKeyPayload.test(text)) findings.push('private-key payload');
  if (!isTest && /\bsb_secret_[A-Za-z0-9_-]{20,}/.test(text)) findings.push('Supabase secret key value');

  // The lookahead stops `api.supabase.com` from reading as the host `api.supabase.co`.
  for (const match of text.matchAll(/https:\/\/([a-z0-9-]+\.supabase\.co)(?![A-Za-z0-9_-])/g)) {
    const host = match[1];
    if (!isTest && !ALLOWED_HOSTS.has(host) && !PLACEHOLDER_HOSTS.has(host)
      && !host.includes('replace-with') && !host.includes('${')
      && !isKnownDecoyHost(text, file, match)) {
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
