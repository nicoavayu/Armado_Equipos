// OFFICIALIZATION-V1: helpers of the match-report authority flow shared by the pages.
//
// The backend keeps four audited steps — submit → review → validate → make official — and
// decides, per tournament, whether the same identity may take all of them (dual control
// OFF) or whether the validator must be someone else (ON). These helpers only read what the
// operation context says (`dualControl`) so the UI never offers a step that must be refused.

export const DEFAULT_CONFIRMATION_REASON = 'Resultado confirmado por el organizador';

/**
 * The dual-control view of an operation context. A context without `dualControl` (a backend
 * before OFFICIALIZATION-V1) reads as ON with an unknown submitter: the historical rule.
 */
export function readDualControl(context) {
  const dual = context?.dualControl;
  if (!dual || typeof dual !== 'object') {
    return { known: false, enabled: true, submittedByViewer: false, validatedByViewer: false };
  }
  return {
    known: true,
    enabled: dual.enabled !== false,
    submittedByViewer: dual.submittedByViewer === true,
    validatedByViewer: dual.validatedByViewer === true,
  };
}

/** Whether the viewer may validate this operation under the tournament's policy. */
export function canViewerValidate(context) {
  const dual = readDualControl(context);
  return !(dual.enabled && dual.submittedByViewer);
}

const CONFIRMABLE = ['draft', 'submitted', 'under_review', 'validated'];

/**
 * Whether the viewer can take the report to official in one action: the policy is OFF (known)
 * and the viewer holds every step's capability.
 */
export function canConfirmAlone(context, { canSubmit, canReview, canValidate, canMakeOfficial }) {
  const dual = readDualControl(context);
  const status = context?.operation?.status;
  if (!dual.known || dual.enabled || !CONFIRMABLE.includes(status)) return false;
  if (status === 'draft' && !canSubmit) return false;
  return Boolean(canReview && canValidate && canMakeOfficial);
}

/**
 * Takes the operation through the remaining steps, reading its state back after each one, so
 * an interrupted run resumes where it stopped. Each step is its own audited RPC.
 */
export async function confirmMatchOperation(service, { organizationId, operationId, reason = DEFAULT_CONFIRMATION_REASON }) {
  const common = { organizationId, operationId };
  let context = await service.loadMatchOperation(common);
  for (let step = 0; step < CONFIRMABLE.length + 1; step += 1) {
    const status = context?.operation?.status;
    if (status === 'official') return context;
    if (status === 'draft') await service.submitMatchOperation(common);
    else if (status === 'submitted') await service.reviewMatchOperation({ ...common, decision: 'approved', reason });
    else if (status === 'under_review') await service.validateMatchOperation(common);
    else if (status === 'validated') await service.makeMatchOfficial(common);
    else throw new Error('El acta no está en un estado que se pueda oficializar.');
    context = await service.loadMatchOperation(common);
  }
  throw new Error('No pudimos completar la oficialización del acta.');
}
