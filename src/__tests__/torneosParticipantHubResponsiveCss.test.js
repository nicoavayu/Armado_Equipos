import fs from 'fs';
import path from 'path';

describe('Participant Hub responsive CSS contract', () => {
  const css = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/torneos/components/ParticipantHub.module.css',
    ),
    'utf8',
  );

  test('keeps mobile, tablet and desktop breakpoints explicit', () => {
    expect(css).toMatch(/@media \(max-width: 370px\)/);
    expect(css).toMatch(/@media \(max-width: 680px\)/);
    expect(css).toMatch(/@media \(max-width: 1100px\)/);
  });

  test('has keyboard focus, reduced motion and minimum touch targets', () => {
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/min-height: 44px/);
  });

  test('protects long content and horizontal data tables', () => {
    expect(css).toMatch(/overflow-wrap: anywhere/);
    expect(css).toMatch(/overflow-x: auto/);
    expect(css).toMatch(/min-width: 440px/);
  });
});
