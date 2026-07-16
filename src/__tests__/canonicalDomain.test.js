import fs from 'fs';
import path from 'path';
import { getCanonicalRedirectUrl, PUBLIC_APP_ORIGIN } from '../utils/publicAppUrl';
import { getPublicBaseUrl } from '../utils/publicBaseUrl';

describe('canonical production domain', () => {
  test.each([
    'arma2.vercel.app',
    'arma2-nicoavayus-projects.vercel.app',
  ])('redirects legacy host %s preserving path, query and hash', (hostname) => {
    expect(getCanonicalRedirectUrl({
      hostname,
      protocol: 'https:',
      pathname: '/perfil',
      search: '?source=test',
      hash: '#partido/123',
    })).toBe('https://app.arma2.com.ar/perfil?source=test#partido/123');
  });

  test.each([
    { hostname: 'localhost', protocol: 'http:' },
    { hostname: 'localhost', protocol: 'https:' },
    { hostname: '127.0.0.1', protocol: 'http:' },
    { hostname: 'localhost', protocol: 'capacitor:' },
    { hostname: '', protocol: 'file:' },
    { hostname: 'preview-git-fix.vercel.app', protocol: 'https:' },
    { hostname: 'arma2-git-main-nicoavayus-projects.vercel.app', protocol: 'https:' },
    { hostname: 'app.arma2.com.ar', protocol: 'https:' },
    { hostname: 'arma2.com.ar', protocol: 'https:' },
    { hostname: 'www.arma2.com.ar', protocol: 'https:' },
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
    const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
    const manifest = fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8');
    expect(PUBLIC_APP_ORIGIN).toBe('https://app.arma2.com.ar');
    expect(vercel.redirects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        has: [{ type: 'host', value: 'arma2.vercel.app' }],
        destination: 'https://app.arma2.com.ar/$1',
        permanent: true,
      }),
      expect.objectContaining({
        has: [{ type: 'host', value: 'arma2-nicoavayus-projects.vercel.app' }],
        destination: 'https://app.arma2.com.ar/$1',
        permanent: true,
      }),
    ]));
    expect(index).toContain('rel="canonical" href="https://app.arma2.com.ar/"');
    expect(index).toContain('property="og:url" content="https://app.arma2.com.ar/"');
    expect(index).toContain("'arma2.vercel.app'");
    expect(index).toContain("'arma2-nicoavayus-projects.vercel.app'");
    expect(index).toContain('window.location.pathname + window.location.search + window.location.hash');
    expect(manifest).toContain('"start_url": "https://app.arma2.com.ar/"');
    expect(manifest).toContain('"scope": "https://app.arma2.com.ar/"');
  });

  test('native platforms and association files declare only the canonical public app host', () => {
    const root = path.resolve(__dirname, '../..');
    const entitlements = fs.readFileSync(path.join(root, 'ios/App/App/App.entitlements'), 'utf8');
    const androidManifest = fs.readFileSync(
      path.join(root, 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    const appleAssociation = JSON.parse(fs.readFileSync(
      path.join(root, 'public/.well-known/apple-app-site-association'),
      'utf8',
    ));
    const androidAssociation = JSON.parse(fs.readFileSync(
      path.join(root, 'public/.well-known/assetlinks.json'),
      'utf8',
    ));

    expect(entitlements).toContain('applinks:app.arma2.com.ar');
    expect(entitlements).not.toContain('applinks:arma2.vercel.app');
    expect(androidManifest).toContain('android:host="app.arma2.com.ar"');
    expect(androidManifest).not.toContain('android:host="arma2.vercel.app"');
    expect(appleAssociation.applinks.details[0].appIDs).toContain(
      '878YHWVKB2.com.teambalancer.app',
    );
    expect(androidAssociation[0].target.package_name).toBe('com.teambalancer.app');
  });
});
