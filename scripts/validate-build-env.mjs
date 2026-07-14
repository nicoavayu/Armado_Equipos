import { hasValue, loadBuildEnvironment } from './build-env.mjs';

const requiredVariables = [
  'REACT_APP_SUPABASE_URL',
  'REACT_APP_SUPABASE_ANON_KEY',
];

const loadedFiles = loadBuildEnvironment();
const missingVariables = requiredVariables.filter((name) => !hasValue(name));

if (missingVariables.length > 0) {
  console.error(
    `Build aborted: missing required environment variables: ${missingVariables.join(', ')}`
  );
  console.error(
    `Environment files detected: ${loadedFiles.length > 0 ? loadedFiles.join(', ') : 'none'}`
  );
  process.exit(1);
}

console.log(
  `Build environment validated (${requiredVariables.map((name) => `${name}=true`).join(', ')}).`
);
