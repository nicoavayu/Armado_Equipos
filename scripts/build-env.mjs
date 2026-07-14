import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const environment = process.env.NODE_ENV || 'production';
const root = process.cwd();
const candidates = [
  `.env.${environment}.local`,
  ...(environment === 'test' ? [] : ['.env.local']),
  `.env.${environment}`,
  '.env',
];

export const loadBuildEnvironment = () => {
  const loadedFiles = [];

  for (const relativePath of candidates) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    dotenv.config({ path: absolutePath, override: false, quiet: true });
    loadedFiles.push(relativePath);
  }

  return loadedFiles;
};

export const hasValue = (name) => Boolean(String(process.env[name] || '').trim());
