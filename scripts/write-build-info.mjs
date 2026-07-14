import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hasValue, loadBuildEnvironment } from './build-env.mjs';

loadBuildEnvironment();

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const buildDirectory = path.join(process.cwd(), 'build');

fs.writeFileSync(
  path.join(buildDirectory, 'build-info.json'),
  `${JSON.stringify({
    sha,
    environment: {
      supabaseUrl: hasValue('REACT_APP_SUPABASE_URL'),
      supabaseAnonKey: hasValue('REACT_APP_SUPABASE_ANON_KEY'),
    },
  }, null, 2)}\n`
);

console.log(`Build metadata written for ${sha.slice(0, 8)}.`);
