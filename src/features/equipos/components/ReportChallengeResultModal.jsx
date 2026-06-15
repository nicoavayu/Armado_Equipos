import React, { useEffect, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import {
  CHALLENGE_OUTCOME_OPTIONS,
  outcomeToResultStatus,
} from '../utils/challengeResult';

const actionButtonClass = 'h-12 rounded-xl text-[18px] font-oswald font-semibold tracking-[0.01em] !normal-case';

const outcomeButtonClass = (selected) => [
  'w-full h-14 rounded-xl border text-[18px] font-oswald font-semibold !normal-case transition-all',
  selected
    ? 'border-white/70 bg-white/15 text-white'
    : 'border-white/15 bg-white/5 text-white/75 hover:bg-white/10',
].join(' ');

const ReportChallengeResultModal = ({
  isOpen,
  challenge,
  perspectiveIsChallenger = true,
  initialOutcome = null,
  onClose,
  onSubmit,
  isSubmitting = false,
}) => {
  const [outcome, setOutcome] = useState(initialOutcome);

  useEffect(() => {
    if (!isOpen) return;
    setOutcome(initialOutcome);
  }, [isOpen, initialOutcome]);

  const rivalName = perspectiveIsChallenger
    ? (challenge?.accepted_team?.name || 'el rival')
    : (challenge?.challenger_team?.name || 'el rival');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="¿Cómo salió el desafío?"
      className="w-full max-w-[480px]"
      classNameContent="p-4 sm:p-5"
      footer={(
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            onClick={onClose}
            variant="secondary"
            className={actionButtonClass}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className={actionButtonClass}
            loading={isSubmitting}
            loadingText="Guardando..."
            disabled={!outcome || isSubmitting}
            onClick={() => {
              if (!outcome || !challenge?.id) return;
              const resultStatus = outcomeToResultStatus(outcome, { perspectiveIsChallenger });
              if (!resultStatus) return;
              onSubmit({ challengeId: challenge.id, resultStatus, outcome });
            }}
          >
            Guardar respuesta
          </Button>
        </div>
      )}
    >
      <p className="text-white/75 font-oswald text-[18px] mb-4">
        ¿Cómo salió el desafío contra {rivalName}?
      </p>

      <div className="space-y-2">
        {CHALLENGE_OUTCOME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={outcomeButtonClass(outcome === option.value)}
            onClick={() => setOutcome(option.value)}
            disabled={isSubmitting}
            aria-pressed={outcome === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Modal>
  );
};

export default ReportChallengeResultModal;
