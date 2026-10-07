import { derivePostMatchCard } from '../utils/postMatchCard';

const labels = (card) => [card.primary?.label, card.secondary?.label].filter(Boolean);

describe('derivePostMatchCard (player)', () => {
  test('survey pending comes first; payment second', () => {
    const card = derivePostMatchCard({ myPaymentStatus: 'pending', amountLabel: '$ 6.000' });
    expect(labels(card)).toEqual(['Completar encuesta', 'Pagar']);
    expect(card.lines.map((line) => line.text)).toEqual(['Encuesta pendiente', 'Pago pendiente · $ 6.000']);
  });

  test('answered and still open: no disabled "Respondida" button, says when results come', () => {
    const card = derivePostMatchCard({ hasCompletedSurvey: true });
    expect(labels(card)).toEqual([]);
    expect(card.lines[0].text).toBe('Respondiste la encuesta · los resultados salen al cerrarla');
  });

  test('closed with unseen awards: premiación first, then pay', () => {
    const card = derivePostMatchCard({
      hasCompletedSurvey: true, surveyClosed: true, resultsReady: true, awardsReady: true, myPaymentStatus: 'pending', amountLabel: '$ 6.000',
    });
    expect(labels(card)).toEqual(['Ver premiación', 'Pagar']);
  });

  test('awards already seen: pay first, then results', () => {
    const card = derivePostMatchCard({
      surveyClosed: true, resultsReady: true, awardsReady: true, awardsSeen: true, myPaymentStatus: 'pending', amountLabel: '$ 6.000',
    });
    expect(labels(card)).toEqual(['Pagar', 'Ver resultados']);
  });

  test('no payment configured and no price: no payment line, no "Pago pendiente"', () => {
    const card = derivePostMatchCard({ surveyClosed: true, resultsReady: true });
    expect(card.lines.map((line) => line.key)).toEqual(['survey']);
    expect(labels(card)).toEqual(['Ver resultados']);
  });

  test('price but no payment row: shows the price, not a debt', () => {
    const card = derivePostMatchCard({ surveyClosed: true, amountLabel: '$ 6.000' });
    expect(card.lines[1]).toEqual({ key: 'payment', text: 'Cancha $ 6.000 por jugador', tone: 'muted' });
    expect(card.lines.some((line) => /pendiente/i.test(line.text) && line.key === 'payment')).toBe(false);
  });

  test('reported and confirmed payments read as such', () => {
    expect(derivePostMatchCard({ surveyClosed: true, resultsReady: true, myPaymentStatus: 'reported_paid' }).lines[1].text)
      .toBe('Avisaste que pagaste · falta que lo confirmen');
    const paid = derivePostMatchCard({ surveyClosed: true, resultsReady: true, myPaymentStatus: 'paid' });
    expect(paid.lines[1].text).toBe('Pago confirmado');
    expect(labels(paid)).toEqual(['Ver resultados', 'Ver pago']);
  });

  test('closed payments never ask to pay', () => {
    const card = derivePostMatchCard({ surveyClosed: true, myPaymentStatus: 'pending', paymentsClosed: true });
    expect(labels(card)).not.toContain('Pagar');
  });
});

describe('derivePostMatchCard (organizer)', () => {
  test('reported payments to confirm come first', () => {
    const card = derivePostMatchCard({
      isAdmin: true,
      surveyClosed: true,
      resultsReady: true,
      awardsReady: true,
      awardsSeen: true,
      adminSummary: { total: 10, paid: 2, reported: 1, pending: 7, exempt: 0 },
    });
    expect(labels(card)).toEqual(['Confirmar pagos', 'Ver resultados']);
    expect(card.lines[1].text).toBe('Pagos 2/10 confirmados · 1 para confirmar');
  });

  test('open survey shows how many answered', () => {
    const card = derivePostMatchCard({ isAdmin: true, hasCompletedSurvey: true, surveyCount: 3, rosterCount: 10 });
    expect(card.lines[0].text).toBe('Encuesta abierta · respondieron 3/10');
    expect(labels(card)).toEqual(['Pagos']);
  });
});
