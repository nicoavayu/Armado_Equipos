import fs from 'fs';
import path from 'path';
import { getCanonicalRedirectUrl, PUBLIC_APP_ORIGIN } from '../utils/publicAppUrl';
import { getPublicBaseUrl } from '../utils/publicBaseUrl';

describe('canonical production domain', () => {
  test('redirects the legacy host preserving path, query and hash', () => {
    expect(getCanonicalRedirectUrl({
      hostname: 'arma2-nicoavayus-projects.vercel.app',
      protocol: 'https:',
      pathname: '/auth/callback',
      search: '?code=abc',
      hash: '#token',
    })).toBe('https://arma2.vercel.app/auth/callback?code=abc#token');
  });

  test.each([
    { hostname: 'localhost', protocol: 'http:' },
    { hostname: 'localhost', protocol: 'capacitor:' },
    { hostname: 'preview-git-fix.vercel.app', protocol: 'https:' },
  ])('does not redirect local, Capacitor or preview origins: %o', (locationLike) => {
    expect(getCanonicalRedirectUrl({ ...locationLike, pathname: '/', search: '', hash: '' })).toBeNull();
  });

  test('shared links use the canonical domain in production', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(getPublicBaseUrl()).toBe(PUBLIC_APP_ORIGIN);
    process.env.NODE_ENV = previousNodeEnv;
  });

  test('hosting and metadata declare the canonical domain', () => {
    const root = path.resolve(__dirname, '../..');
    const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
    const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
    const manifest = fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8');
    expect(vercel).toContain('arma2-nicoavayus-projects.vercel.app');
    expect(vercel).toContain('https://arma2.vercel.app/$1');
    expect(index).toContain('rel="canonical" href="https://arma2.vercel.app/"');
    expect(manifest).toContain('"start_url": "https://arma2.vercel.app/"');
  });
});
