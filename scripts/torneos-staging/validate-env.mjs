#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  KNOWN_PRODUCTION_PROJECT_REFS,
  REQUIRED_RUNTIME_ENV,
  TOGGLE_ENV,
} from './manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isTemplateCheck = process.argv.includes('--template');
const envFileArgument = process.argv.find((argument) => argument.startsWith('--env-file='));
const envPath = envFileArgument
  ? path.resolve(process.cwd(), envFileArgument.slice('--env-file='.length))
  : path.join(ROOT, 'config', 'torneos-staging.env.example');
const parsed = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }),
);
const env = isTemplateCheck ? parsed : { ...parsed, ...process.env };
const failures = [];
const projectRef = String(env.REACT_APP_TORNEOS_STAGING_PROJECT_REF || '').trim().toLowerCase();
const supabaseUrl = String(env.REACT_APP_SUPABASE_URL || '').trim();

if (isTemplateCheck) {
  for (const toggle of TOGGLE_ENV) {
    if (env[toggle] !== 'false') failures.push(`${toggle} debe iniciar en false`);
  }
  if (env.REACT_APP_DEPLOY_ENV !== 'staging') failures.push('DEPLOY_ENV de plantilla debe ser staging');
  if (env.REACT_APP_TORNEOS_DATA_ENV !== 'staging') failures.push('DATA_ENV debe ser staging');
  if (!/replace-with/i.test(projectRef)) failures.push('la plantilla no debe contener un project ref real');
  if (!supabaseUrl.includes('replace-with')) failures.push('la plantilla no debe contener una URL real');
  for (const [key, value] of Object.entries(env)) {
    if (/service.role|database.url|password|secret/i.test(key) && String(value).trim()) {
      failures.push(`${key} no puede existir con valor en la plantilla cliente`);
    }
  }
} else {
  for (const key of REQUIRED_RUNTIME_ENV) {
    if (!String(env[key] || '').trim()) failures.push(`${key} es obligatoria`);
  }
  if (env.REACT_APP_DEPLOY_ENV !== 'staging') failures.push('solo se admite deploy environment staging');
  if (env.REACT_APP_TORNEOS_DATA_ENV !== 'staging') failures.push('solo se admite data environment staging');
  if (!/^[a-z0-9]{8,64}$/.test(projectRef)) failures.push('project ref inválido');
  if (KNOWN_PRODUCTION_PROJECT_REFS.includes(projectRef)) failures.push('project ref productivo rechazado');
  try {
    const url = new URL(supabaseUrl);
    if (
      url.protocol !== 'https:'
      || url.hostname !== `${projectRef}.supabase.co`
      || url.port
      || !['', '/'].includes(url.pathname)
      || url.username
      || url.password
      || url.search
      || url.hash
    ) failures.push('URL y project ref de staging no coinciden exactamente');
  } catch {
    failures.push('REACT_APP_SUPABASE_URL inválida');
  }
  if (String(env.REACT_APP_SUPABASE_ANON_KEY || '').split('.').length !== 3) {
    failures.push('anon key no parece JWT');
  }
  if (env.REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED === 'true') {
    for (const key of [
      'REACT_APP_TORNEOS_MEDIA_SIGNER_READY',
      'REACT_APP_TORNEOS_MEDIA_WORKER_READY',
      'REACT_APP_TORNEOS_MEDIA_AV_READY',
      'REACT_APP_TORNEOS_MEDIA_CLEANUP_READY',
      'REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY',
    ]) {
      if (env[key] !== 'true') failures.push(`${key}=true es requisito para habilitar uploads`);
    }
  }
}

if (failures.length) {
  console.error(`STAGING_ENV_INVALID\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`STAGING_ENV_OK mode=${isTemplateCheck ? 'template' : 'runtime'} flags=fail-closed`);
