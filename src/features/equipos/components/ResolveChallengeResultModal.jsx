import React, { useEffect, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import { getChallengeResolveOptions } from '../utils/challengeResult';

const actionButtonClass = 'h-12 rounded-xl text-[18px] font-oswald font-semibold tracking-[0.01em] !normal-case';

const optionButtonClass = (selected) => [
  'w-full h-14 rounded-xl border text-[18px] font-oswald font-semibold !normal-case transition-all',
  selected
    ? 'border-white/70 bg-white/15 text-white'
    : 'border-white/15 bg-white/5 text-white/75 hover:bg-white/10',
].join(' ');

// Only the challenge creator opens this modal. Outcomes are absolute (neutral),
// not "ganamos/perdimos", because the creator is not necessarily on either team.
const ResolveChallengeResultModal = ({
  isOpen,
  challenge,
  teamAName = null,
  teamBName = null,
  onClose,
  onSubmit,
  isSubmitting = false,
}) => {
  const [resultStatus, setResultStatus] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setResultStatus(null);
  }, [isOpen]);

  const options = getChallengeResolveOptions({
    teamAName: teamAName || challenge?.challenger_team?.name,
    teamBName: teamBName || challenge?.accepted_team?.name,
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resolver resultado"
      className="w-full max-w-[480px]"
      classNameContent="p-4 sm:p-5"
      footer={(
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            onClick={onClose}
            variant="secondary"
            className={actionButtonClass}
            data-preserve-button-case="true"
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className={actionButtonClass}
            data-preserve-button-case="true"
            loading={isSubmitting}
            loadingText="Guardando..."
            disabled={!resultStatus || isSubmitting}
            onClick={() => {
              if (!resultStatus || !challenge?.id) return;
              onSubmit({ challengeId: challenge.id, resultStatus });
            }}
          >
            Confirmar
          </Button>
        </div>
      )}
    >
      <p className="text-white/75 font-oswald text-[18px] mb-4">
        Los capitanes cargaron resultados distintos. Elegí el resultado final.
      </p>

      <div className="space-y-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={optionButtonClass(resultStatus === option.value)}
            onClick={() => setResultStatus(option.value)}
            disabled={isSubmitting}
            aria-pressed={resultStatus === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Modal>
  );
};

export default ResolveChallengeResultModal;
