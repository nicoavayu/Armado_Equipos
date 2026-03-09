import fs from 'fs';
import path from 'path';

describe('Encuesta RESULT step constant usage', () => {
  test('does not use hardcoded currentStep === 5 checks', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../pages/EncuestaPartido.js'),
      'utf8',
    );

    expect(source).toContain('currentStep === SURVEY_STEPS.RESULT');
    expect(source).not.toMatch(/currentStep\s*===\s*5/);
  });
});
