import { formatSkillLevelLabel, getTeamPalette } from '../features/equipos/utils/teamColors';

describe('teamColors utils', () => {
  test('uses default palette when team has no custom colors', () => {
    const palette = getTeamPalette({});

    expect(palette.primary).toBe('#128BE9');
    expect(palette.secondary).toBe('#1E293B');
    expect(palette.accent).toBe('#9ED3FF');
  });

  test('uses primary-based palette when one color is provided', () => {
    const palette = getTeamPalette({ color_primary: '#FF0000' });

    expect(palette.primary).toBe('#FF0000');
    expect(palette.secondary).toMatch(/^#[0-9A-F]{6}$/);
  });

  test('uses two-color gradient when primary and secondary are provided', () => {
    const palette = getTeamPalette({ color_primary: '#112233', color_secondary: '#445566' });

    expect(palette.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(palette.secondary).toMatch(/^#[0-9A-F]{6}$/);
    expect(palette.backgroundFrom).toBe('#1E293B');
    expect(palette.backgroundTo).toBe('#0F172A');
  });

  test('uses accent when three colors are provided', () => {
    const palette = getTeamPalette({
      color_primary: '#123456',
      color_secondary: '#654321',
      color_accent: '#ABCDEF',
    });

    expect(palette.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(palette.secondary).toMatch(/^#[0-9A-F]{6}$/);
    expect(palette.accent).toMatch(/^#[0-9A-F]{6}$/);
    expect(palette.backgroundFrom).toBe('#1E293B');
    expect(palette.backgroundTo).toBe('#0F172A');
  });

  test('normalizes very dark custom colors to preserve contrast', () => {
    const palette = getTeamPalette({ color_primary: '#000000' });

    expect(palette.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(palette.primary).not.toBe('#000000');
  });

  test('normalizes very light custom colors to preserve contrast', () => {
    const palette = getTeamPalette({ color_primary: '#FFFFFF' });

    expect(palette.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(palette.primary).not.toBe('#FFFFFF');
  });

  test('formats skill labels', () => {
    expect(formatSkillLevelLabel('easy')).toBe('Easy');
    expect(formatSkillLevelLabel('hard')).toBe('Hard');
    expect(formatSkillLevelLabel('normal')).toBe('Normal');
    expect(formatSkillLevelLabel('whatever')).toBe('Normal');
  });
});
