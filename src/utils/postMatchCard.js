// What the finished-match card in "Mis partidos" says and offers. Pure: it only reads
// real states (survey, results, awards, payment rows) and never assumes a payment that
// was not configured.

const PAYMENT_LINES = {
  paid: { text: 'Pago confirmado', tone: 'ok' },
  reported_paid: { text: 'Avisaste que pagaste · falta que lo confirmen', tone: 'warn' },
  exempt: { text: 'No pagás este partido', tone: 'muted' },
};

/**
 * @param {Object} input
 * @param {boolean} input.isAdmin
 * @param {boolean} input.hasCompletedSurvey - the viewer answered the survey
 * @param {boolean} input.surveyClosed
 * @param {boolean} input.resultsReady
 * @param {boolean} input.awardsReady - there are awards to present
 * @param {boolean} input.awardsSeen - the viewer already watched this match's awards
 * @param {string|null} input.myPaymentStatus - the viewer's real payment row status
 * @param {string|null} input.amountLabel - formatted amount, null when there is none
 * @param {boolean} input.paymentsClosed
 * @param {{total:number,paid:number,reported:number,pending:number,exempt:number}} [input.adminSummary]
 * @param {number} [input.surveyCount]
 * @param {number} [input.rosterCount]
 * @returns {{ lines: Array<{key:string,text:string,tone:string}>, primary: Object|null, secondary: Object|null }}
 */
export const derivePostMatchCard = ({
  isAdmin = false,
  hasCompletedSurvey = false,
  surveyClosed = false,
  resultsReady = false,
  awardsReady = false,
  awardsSeen = false,
  myPaymentStatus = null,
  amountLabel = null,
  paymentsClosed = false,
  adminSummary = null,
  surveyCount = 0,
  rosterCount = 0,
} = {}) => {
  const lines = [];
  const actions = [];
  const surveyOpen = !surveyClosed;

  // Survey / results
  if (surveyOpen) {
    if (isAdmin) {
      lines.push({
        key: 'survey',
        text: rosterCount > 0 ? `Encuesta abierta · respondieron ${surveyCount}/${rosterCount}` : `Encuesta abierta · respondieron ${surveyCount}`,
        tone: 'muted',
      });
    } else if (hasCompletedSurvey) {
      lines.push({ key: 'survey', text: 'Respondiste la encuesta · los resultados salen al cerrarla', tone: 'ok' });
    } else {
      lines.push({ key: 'survey', text: 'Encuesta pendiente', tone: 'warn' });
    }
  } else {
    lines.push({
      key: 'survey',
      text: resultsReady ? 'Encuesta cerrada · resultados listos' : 'Encuesta cerrada',
      tone: 'muted',
    });
  }

  if (surveyOpen && !hasCompletedSurvey) {
    actions.push({ kind: 'survey', label: 'Completar encuesta' });
  }
  if (awardsReady && !awardsSeen) actions.push({ kind: 'results', label: 'Ver premiación' });

  // Payments
  if (isAdmin) {
    const summary = adminSummary || { total: 0, paid: 0, reported: 0, pending: 0, exempt: 0 };
    if (summary.total > 0) {
      const settled = summary.paid + summary.exempt;
      lines.push({
        key: 'payment',
        text: `Pagos ${settled}/${summary.total} confirmados${summary.reported ? ` · ${summary.reported} para confirmar` : ''}`,
        tone: summary.reported ? 'warn' : (settled === summary.total ? 'ok' : 'muted'),
      });
    } else if (amountLabel) {
      lines.push({ key: 'payment', text: `Cancha ${amountLabel} por jugador · cobro sin abrir`, tone: 'muted' });
    }
    if (!paymentsClosed && summary.reported > 0) {
      actions.unshift({ kind: 'payments', label: 'Confirmar pagos' });
    } else if (!paymentsClosed && (summary.pending > 0 || (summary.total === 0 && amountLabel))) {
      actions.push({ kind: 'payments', label: 'Cobrar' });
    }
  } else if (myPaymentStatus && PAYMENT_LINES[myPaymentStatus]) {
    lines.push({ key: 'payment', ...PAYMENT_LINES[myPaymentStatus] });
  } else if (myPaymentStatus === 'pending') {
    lines.push({ key: 'payment', text: amountLabel ? `Pago pendiente · ${amountLabel}` : 'Pago pendiente', tone: 'danger' });
    if (!paymentsClosed) actions.push({ kind: 'pay', label: 'Pagar' });
  } else if (amountLabel && !paymentsClosed) {
    // No payment row yet: the match has a price, nobody opened the payments.
    lines.push({ key: 'payment', text: `Cancha ${amountLabel} por jugador`, tone: 'muted' });
    actions.push({ kind: 'pay', label: 'Pagar' });
  }

  if (resultsReady && !actions.some((action) => action.kind === 'results')) {
    actions.push({ kind: 'results', label: 'Ver resultados' });
  }
  if (isAdmin && !actions.some((action) => action.kind === 'payments')) {
    actions.push({ kind: 'payments', label: 'Pagos' });
  }
  if (!isAdmin && myPaymentStatus && myPaymentStatus !== 'pending' && !actions.some((action) => action.kind === 'pay')) {
    actions.push({ kind: 'pay', label: 'Ver pago' });
  }
  if (isAdmin && surveyOpen && !hasCompletedSurvey && !actions.some((action) => action.kind === 'survey')) {
    actions.push({ kind: 'survey', label: 'Encuesta' });
  }

  const [primary = null, secondary = null] = actions;
  return {
    lines,
    primary,
    secondary,
  };
};

export default derivePostMatchCard;
