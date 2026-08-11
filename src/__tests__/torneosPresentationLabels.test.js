import {
  getFormatLabel,
  getGenerationMethodLabel,
  getModalityLabel,
  getReviewTypeLabel,
  getStatusLabel,
} from '../features/torneos/components/presentationLabels';

describe('Torneos presentation labels', () => {
  test.each([
    ['scheduled', 'Programado'],
    ['published', 'Publicado'],
    ['frozen', 'Cerrado'],
    ['pending_review', 'Pendiente de revisión'],
  ])('localizes status %s', (value, expected) => {
    expect(getStatusLabel(value)).toBe(expected);
  });

  test('localizes modality, format, generation method, and review type', () => {
    expect(getModalityLabel('football_5')).toBe('Fútbol 5');
    expect(getFormatLabel('league_and_playoffs')).toBe('Liga y playoffs');
    expect(getGenerationMethodLabel('automatic')).toBe('Automática');
    expect(getReviewTypeLabel('correction')).toBe('Corrección');
  });

  test('never exposes snake_case for an unknown presentation value', () => {
    expect(getStatusLabel('custom_internal_state')).toBe('Custom internal state');
  });
});
