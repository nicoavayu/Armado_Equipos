import fs from 'node:fs';
import path from 'node:path';

const runtimeFiles = [
  'src/pages/QuieroJugar.js',
  'src/services/api/playerService.js',
  'src/services/db/profiles.js',
];

const readRuntime = (relativePath) => fs.readFileSync(
  path.resolve(process.cwd(), relativePath),
  'utf8',
);

describe('usuarios legacy creation-date cleanup', () => {
  test.each(runtimeFiles)('%s no longer depends on fecha_alta', (relativePath) => {
    expect(readRuntime(relativePath)).not.toContain('fecha_alta');
  });

  test('Quiero Jugar keeps canonical ordering and loads both player markets without the legacy column', () => {
    const source = readRuntime('src/pages/QuieroJugar.js');
    const usuariosReads = [...source.matchAll(/\.from\('usuarios'\)[\s\S]*?\.select\('([^']+)'\)/g)]
      .map((match) => match[1]);

    const marketReads = usuariosReads.filter((columns) => columns.includes('posiciones'));

    expect(marketReads).toHaveLength(2);
    expect(marketReads.every((columns) => columns.includes('disponible_arquero'))).toBe(true);
    expect(source).toContain(".order('created_at', { ascending: false })");
  });

  test.each([
    'src/services/api/playerService.js',
    'src/services/db/profiles.js',
  ])('%s leaves created_at under database control during profile bootstrap', (relativePath) => {
    const source = readRuntime(relativePath);
    const bootstrap = source.slice(source.indexOf('export const createOrUpdateProfile'));
    const profilePayload = bootstrap.slice(
      bootstrap.indexOf('const profileData = {'),
      bootstrap.indexOf('// Actualizar metadata') >= 0
        ? bootstrap.indexOf('// Actualizar metadata')
        : bootstrap.indexOf('// IMPORTANT:'),
    );

    expect(profilePayload).not.toContain('created_at:');
    expect(bootstrap).toContain('.upsert(profileData');
  });
});
