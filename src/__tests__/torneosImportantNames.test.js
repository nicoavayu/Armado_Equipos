import fs from 'node:fs';
import path from 'node:path';
import {
  getImportantNameLength,
  importantNameProps,
} from '../features/torneos/components/importantNames';

describe('Torneos important-name contract', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'src/features/torneos/components/ImportantNames.css'),
    'utf8',
  );

  test('classifies QA names into progressive size tiers', () => {
    expect(getImportantNameLength('Barrio Norte FC')).toBe('standard');
    expect(getImportantNameLength('Los Pibes del Parque Central')).toBe('long');
    expect(getImportantNameLength('Los Pibes del Parque Central y Biblioteca Popular')).toBe('extra-long');
    expect(importantNameProps('Torneo Apertura QA 2026', 'hero')).toEqual({
      'data-important-name': 'hero',
      'data-name-length': 'long',
      title: 'Torneo Apertura QA 2026',
    });
  });

  test('uses one-line ellipsis before overlap and keeps responsive minimums explicit', () => {
    expect(css).toMatch(/\[data-important-name\]\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    expect(css).toMatch(/\[data-important-name='match'\]\[data-name-length='extra-long'\][^{]*\{[^}]*font-size:\s*clamp\(0\.72rem,/s);
    expect(css).toMatch(/\[data-important-name='table'\]\[data-name-length='extra-long'\][^{]*\{[^}]*font-size:\s*0\.72rem;/s);
    expect(css).toMatch(/@media \(max-width:\s*390px\)[\s\S]*?\[data-important-name='hero'\]\[data-name-length='long'\][^{]*\{[^}]*font-size:\s*clamp\(1\.55rem,/s);
    expect(css).toMatch(/@media \(max-width:\s*390px\)[\s\S]*?\[data-important-name='hero'\]\[data-name-length='extra-long'\][^{]*\{[^}]*white-space:\s*nowrap;/s);
    expect(css).not.toMatch(/\[data-important-name='(?:card|match|table)'\][^{]*\{[^}]*white-space:\s*normal;/s);
  });
});
