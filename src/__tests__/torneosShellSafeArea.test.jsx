import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';

jest.mock('../components/global-header/GlobalHeader', () => () => <header data-testid="global-header" />);
jest.mock('../utils/runtimePlatform', () => ({
  isArma2NativeRuntime: () => true,
  getAuthenticatedProductHome: () => '/',
}));

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const shellCss = read('src/features/torneos/components/TorneosShell.module.css');
const headerCss = read('src/components/global-header/GlobalHeader.module.css');
const SAFE_TOP = 'var\\(--safe-top, env\\(safe-area-inset-top, 0px\\)\\)';

const rule = (css, selector) => {
  const match = css.match(new RegExp(`(^|\\n)\\s*${selector.replace(/\./g, '\\.')} \\{([^}]*)\\}`));
  return match ? match[2] : '';
};

// ANDROID 43 smoke: inside the Torneos shell content scrolled up under the
// Android status bar. Same criterion as MainLayout: exactly one layer pads the
// top inset at rest; a fixed plate the height of the real inset covers it while
// scrolling, without adding padding of its own.
describe('Torneos shell top safe area', () => {
  test('a fixed scrim of the real inset height, above the shell chrome and below dialogs', () => {
    const scrim = rule(shellCss, '.statusBarScrim');
    expect(scrim).toMatch(/position: fixed/);
    expect(scrim).toMatch(/top: 0/);
    expect(scrim).toMatch(new RegExp(`height: ${SAFE_TOP}`));
    expect(scrim).toMatch(/pointer-events: none/);
    expect(scrim).not.toMatch(/padding|margin/);
    const z = Number(scrim.match(/z-index: (\d+)/)[1]);
    const mobileNavigationZ = Number(shellCss.match(/\.mobileNavigation \{[^}]*z-index: (\d+)/s)[1]);
    const topbarZ = Number(rule(shellCss, '.topbar').match(/z-index: (\d+)/)[1]);
    const sidebarZ = Number(rule(shellCss, '.sidebar').match(/z-index: (\d+)/)[1]);
    expect(z).toBeGreaterThan(Math.max(mobileNavigationZ, topbarZ, sidebarZ));
    // Torneos dialogs and overlays start at 50.
    expect(z).toBeLessThan(50);
  });

  test('exactly one layer pads the inset: GlobalHeader, or the topbar when the shell has none', () => {
    expect(rule(headerCss, '.header')).toMatch(new RegExp(`padding: ${SAFE_TOP} 14px 0`));
    expect(rule(shellCss, '.shell')).toMatch(new RegExp(`--global-header-size: calc\\(64px \\+ ${SAFE_TOP}\\)`));
    expect(rule(shellCss, '.shellWithoutGlobalHeader')).toMatch(/--global-header-size: 0px/);
    expect(shellCss).toMatch(new RegExp(`\\.shellWithoutGlobalHeader \\.topbar \\{[^}]*padding-top: max\\(8px, ${SAFE_TOP}\\)`, 's'));
    // Nothing else in the shell pads the inset (no double gap), and no magic pixels stand in for it.
    const paddedWithInset = shellCss.match(/padding[^;]*safe-(top|area-inset-top)[^;]*;/g) || [];
    expect(paddedWithInset).toHaveLength(1);
    expect(rule(shellCss, '.main')).not.toMatch(/safe/);
    expect(rule(shellCss, '.topbar')).not.toMatch(/safe/);
  });

  test('the shell renders the scrim exactly once, decorative only', async () => {
    const service = {
      loadContext: jest.fn().mockResolvedValue({
        preference: { workspaceType: 'personal', activeOrganizationId: null },
        organizations: [],
      }),
      loadExperienceRelations: jest.fn().mockResolvedValue({ items: [], pagination: { total: 0, hasMore: false } }),
      setPreference: jest.fn(),
      createOrganization: jest.fn(),
      updateOrganization: jest.fn(),
    };
    render(
      <MemoryRouter initialEntries={['/torneos']}>
        <Routes>
          <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId('global-header');
    const scrims = screen.getAllByTestId('torneos-status-bar-scrim', { hidden: true });
    expect(scrims).toHaveLength(1);
    expect(scrims[0]).toHaveAttribute('aria-hidden', 'true');
    expect(scrims[0]).toBeEmptyDOMElement();
  });
});
