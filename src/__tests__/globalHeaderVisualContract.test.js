import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(
  path.join(process.cwd(), 'src/components/global-header/GlobalHeader.module.css'),
  'utf8',
);

const ruleBody = (className) => {
  const match = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing .${className} rule`);
  return match[1];
};

describe('GlobalHeader space-selector visual contract', () => {
  test('keeps the logo centered independently from the chevron', () => {
    expect(ruleBody('headerInner')).toMatch(
      /grid-template-columns:\s*minmax\(44px,\s*1fr\)\s+auto\s+minmax\(44px,\s*1fr\)/,
    );
    expect(ruleBody('spaceTrigger')).toMatch(/position:\s*relative/);
    expect(ruleBody('spaceAffordance')).toMatch(/position:\s*absolute/);
    expect(ruleBody('spaceAffordance')).toMatch(/left:\s*100%/);
  });

  test('gives the chevron no capsule, background, border or relief', () => {
    const trigger = ruleBody('spaceTrigger');
    const chevron = ruleBody('spaceAffordance');

    expect(trigger).toMatch(/background:\s*transparent/);
    expect(trigger).toMatch(/border:\s*0/);
    expect(chevron).not.toMatch(/background\s*:/);
    expect(chevron).not.toMatch(/border(?:-radius)?\s*:/);
    expect(chevron).not.toMatch(/box-shadow\s*:/);
    expect(chevron).not.toMatch(/filter\s*:/);
  });
});
