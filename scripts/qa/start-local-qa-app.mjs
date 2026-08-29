#!/usr/bin/env node
//
// Arranque fail-closed de la app para una sesión de QA LOCAL.
//
// El riesgo que este script cierra es concreto: `.env.local` apunta hoy a un
// Supabase remoto, y Create React App lo lee salvo que alguien pise la variable
// en el proceso. O sea que una sesión de QA LOCAL correcta dependía de que quien
// la arrancara se acordara del override; olvidarlo no rompía nada visible, sólo
// movía el QA —y sus escrituras— al proyecto remoto.
//
// Acá el default se invierte. Sin un destino loopback explícito el arranque
// falla y no hay app. Además las variables se le pasan al hijo ya resueltas, así
// que CRA nunca llega a consultar los archivos `.env*`: no hay ruta por la que
// el valor remoto pueda volver a colarse.
//
// Uso:
//   npm run qa:start:local                  (revisa el destino y no arranca nada)
//   npm run qa:start:local -- --start       (revisa y arranca la app)
//
// Variables requeridas (sin fallback y sin archivo):
//   QA_SUPABASE_URL=http://127.0.0.1:57321
//   QA_SUPABASE_ANON_KEY=<anon key del Supabase LOCAL>
//
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

import productionGuard from './production-guard.js';

const { assertLocalAppTarget, ProductionGuardError } = productionGuard;

// Los archivos que CRA leería, en su orden de precedencia real.
const DOTENV_FILES = ['.env.development.local', '.env.local', '.env.development', '.env'];

/** Qué destino traen los archivos, sólo para poder decirlo en voz alta. */
function readDotenvTargets(repoRoot) {
  const found = [];
  for (const file of DOTENV_FILES) {
    const fullPath = path.join(repoRoot, file);
    if (!fs.existsSync(fullPath)) continue;
    const match = fs.readFileSync(fullPath, 'utf8')
      .match(/^\s*REACT_APP_SUPABASE_URL\s*=\s*(.+)\s*$/m);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, '');
    let host = null;
    try {
      host = new URL(value).host;
    } catch {
      host = value;
    }
    found.push({ file, host });
  }
  return found;
}

function main() {
  const repoRoot = process.cwd();
  const shouldStart = process.argv.includes('--start');

  let target;
  try {
    target = assertLocalAppTarget(process.env);
  } catch (error) {
    if (!(error instanceof ProductionGuardError)) throw error;
    console.error(`\n${error.message}\n`);
    console.error('Una sesión de QA LOCAL no arranca sin un destino loopback explícito.');
    console.error('Definí las dos variables en el proceso (no en un archivo) y volvé a intentar:');
    console.error('  QA_SUPABASE_URL=http://127.0.0.1:57321');
    console.error('  QA_SUPABASE_ANON_KEY=<anon key del Supabase LOCAL>\n');
    process.exit(1);
    return;
  }

  const dotenvTargets = readDotenvTargets(repoRoot);
  const overridden = dotenvTargets.filter(({ host }) => !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host));

  console.log('[qa:local] destino verificado');
  console.log(`  Supabase: ${target.supabaseUrl}`);
  for (const { file, host } of dotenvTargets) {
    const mark = overridden.some((entry) => entry.file === file) ? 'IGNORADO' : 'coincide';
    console.log(`  ${file}: ${host} (${mark})`);
  }
  if (overridden.length > 0) {
    console.log('  Los archivos que apuntan afuera quedan sin efecto: las variables van');
    console.log('  resueltas al proceso hijo y CRA no las vuelve a leer.');
  }

  if (!shouldStart) {
    console.log('\nRevisión solamente. Agregá --start para arrancar la app.');
    return;
  }

  // El hijo recibe el destino ya resuelto. Nada queda librado a los archivos.
  const child = spawn('npx', ['react-scripts', 'start'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      REACT_APP_SUPABASE_URL: target.supabaseUrl,
      REACT_APP_SUPABASE_ANON_KEY: target.anonKey,
    },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main();
