import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');

describe('Torneos staging tooling secret guard', () => {
  test('diagnostic DB script has no hardcoded Supabase endpoint or JWT', () => {
    const source = fs.readFileSync(path.join(root, 'check_db.js'), 'utf8');

    expect(source).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co/i);
    expect(source).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(source).toContain('CHECK_DB_SUPABASE_URL');
    expect(source).toContain('CHECK_DB_SUPABASE_ANON_KEY');
    expect(source).toContain('CHECK_DB_PARTIDO_ID');
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
