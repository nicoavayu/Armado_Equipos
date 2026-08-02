import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');

describe('Torneos staging tooling secret guard', () => {
  test('legacy diagnostic is absent and readiness tooling has no JWT literals', () => {
    const readinessSources = [
      path.join(root, 'scripts', 'staging', 'guard.mjs'),
      path.join(root, 'scripts', 'torneos-staging', 'readiness-lib.mjs'),
      path.join(root, 'scripts', 'torneos-staging', 'readiness.mjs'),
    ]
      .map((sourcePath) => fs.readFileSync(sourcePath, 'utf8'))
      .join('\n');

    expect(fs.existsSync(path.join(root, 'check_db.js'))).toBe(false);
    expect(readinessSources).not.toMatch(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );
  });

  test('backend tooling never accepts service role through a client-prefixed variable', () => {
    const source = fs.readFileSync(
      path.join(root, 'scripts', 'backfill-match-location-coordinates.mjs'),
      'utf8',
    );
    const clientPrefixedServiceRole = [
      'REACT_APP_SUPABASE',
      'SERVICE_ROLE_KEY',
    ].join('_');

    expect(source).not.toContain(clientPrefixedServiceRole);
    expect(source).toContain('process.env.SUPABASE_SERVICE_ROLE_KEY');
  });
});
