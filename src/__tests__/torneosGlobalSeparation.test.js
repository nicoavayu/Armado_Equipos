import fs from 'fs';
import path from 'path';

describe('global vs Torneos internal navigation responsibilities', () => {
  const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

  test('Torneos shell mounts the space header by route hierarchy and removes duplicate branding/exit', () => {
    const source = read('src/features/torneos/components/TorneosShell.jsx');
    expect(source).toContain('shouldShowTorneosSpaceHeader(location.pathname)');
    expect(source).toContain('{showSpaceHeader && <GlobalHeader');
    expect(source).not.toContain('topbarExit');
    expect(source).not.toContain('mobileBrand');
  });

  test('workspace switchers no longer own the global Arma2 to Torneos transition', () => {
    const workspace = read('src/features/torneos/components/WorkspaceSwitcher.jsx');
    const personal = read('src/features/torneos/components/PersonalWorkspaceSwitcher.jsx');
    expect(workspace).not.toContain('Tu espacio personal');
    expect(workspace).not.toContain('navigate(\'/\')');
    expect(personal).not.toContain('Arma2 y Torneos');
    expect(personal).not.toContain('Tu espacio personal');
  });

  test('Profile does not expose the Torneos workspace switcher', () => {
    const profile = read('src/pages/ProfilePage.js');
    expect(profile).not.toContain('PersonalWorkspaceSwitcher');
    expect(profile).not.toContain('Tus espacios de competición');
  });

  test('workspace creation keeps a compact user-facing introduction', () => {
    const source = read('src/features/torneos/components/CreateOrganizationPage.jsx');
    expect(source).toContain('formIntroHeader');
    expect(source).toContain('Nuevo workspace');
    expect(source).toContain('Creá tu organización');
    expect(source).not.toContain('Creación atómica');
  });
});
