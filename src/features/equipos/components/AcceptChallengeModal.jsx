import React from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';

const actionButtonBaseClass = '!w-full !h-auto !min-h-[44px] !px-4 !py-2.5 !rounded-none !font-bebas !text-base !tracking-[0.01em] !normal-case sm:!text-[13px] sm:!px-3 sm:!py-2 sm:!min-h-[36px]';
const actionPrimaryClass = `${actionButtonBaseClass} !border !border-[#7d5aff] !bg-[#6a43ff] !text-white !shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:!bg-[#7550ff]`;
const actionSecondaryClass = `${actionButtonBaseClass} !border !border-[rgba(98,117,184,0.58)] !bg-[rgba(20,31,70,0.82)] !text-white/92 hover:!bg-[rgba(30,45,94,0.95)]`;

const AcceptChallengeModal = ({
  isOpen,
  challenge,
  availableTeams,
  selectedTeamId,
  onChangeTeam,
  onClose,
  onConfirm,
  isSubmitting = false,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Aceptar Desafio"
      className="w-full max-w-[520px] !rounded-none !border !border-[rgba(88,107,170,0.46)] !bg-[rgba(30,41,59,0.96)] !shadow-[0_20px_50px_rgba(3,10,32,0.55)]"
      classNameContent="p-4 sm:p-5"
      footer={(
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            onClick={onClose}
            variant="secondary"
            className={actionSecondaryClass}
            disabled={isSubmitting}
            data-preserve-button-case="true"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className={actionPrimaryClass}
            loading={isSubmitting}
            loadingText="Aceptando..."
            disabled={!selectedTeamId}
            data-preserve-button-case="true"
          >
            Aceptar
          </Button>
        </div>
      )}
    >
      <p className="text-sm text-white/70 mb-3">
        Elegi uno de tus equipos para aceptar el desafio F{challenge?.format || '-'}
      </p>

      <select
        value={selectedTeamId}
        onChange={(event) => onChangeTeam(event.target.value)}
        className="w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
      >
        {availableTeams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name} · F{team.format} · {team.base_zone || 'sin zona'}
          </option>
        ))}
      </select>
    </Modal>
  );
};

export default AcceptChallengeModal;
