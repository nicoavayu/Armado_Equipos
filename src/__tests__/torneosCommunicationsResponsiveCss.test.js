import fs from 'fs';
import path from 'path';

describe('Torneos communications responsive CSS contract', () => {
  const participantCss = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/torneos/components/TournamentCommunications.module.css',
    ),
    'utf8',
  );
  const adminCss = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/torneos/components/CommunicationsAdminPage.module.css',
    ),
    'utf8',
  );
  const css = `${participantCss}\n${adminCss}`;

  test('defines compact mobile, mobile/tablet and desktop layouts', () => {
    expect(css).toMatch(/@media \(max-width: 420px\)/);
    expect(css).toMatch(/@media \(max-width: 700px\)/);
    expect(css).toMatch(/@media \(max-width: 1000px\)/);
  });

  test('keeps touch targets, keyboard focus and reduced motion explicit', () => {
    expect(css).toMatch(/min-height: 44px/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  test('prevents fixed desktop columns from forcing mobile overflow', () => {
    expect(css).toMatch(/grid-template-columns: 1fr/);
    expect(css).toMatch(/min-width: 0/);
    expect(css).toMatch(/overflow-x: auto/);
  });

  test('does not depend on hover for state or priority', () => {
    expect(css).toMatch(/data-priority/);
    expect(css).toMatch(/data-unread/);
    expect(css).toMatch(/@media \(hover: hover\)/);
  });
});
