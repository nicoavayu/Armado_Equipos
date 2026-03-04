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
      title="Aceptar desafío"
      className="w-full max-w-[520px] !rounded-none !border !border-[rgba(88,107,170,0.52)] !bg-[rgba(8,18,44,0.96)] !shadow-[0_26px_58px_rgba(0,0,0,0.62)]"
      classNameContent="p-4 sm:p-5 !font-oswald"
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
      <p className="mb-3 text-[15px] leading-relaxed text-white/82">
        Elegí uno de tus equipos para aceptar el desafío F{challenge?.format || '-'}
      </p>

      <select
        value={selectedTeamId}
        onChange={(event) => onChangeTeam(event.target.value)}
        className="h-[44px] w-full rounded-none border border-[rgba(88,107,170,0.46)] bg-[rgba(10,23,58,0.92)] px-3 text-[15px] text-white outline-none focus:border-[#6a43ff] focus:ring-1 focus:ring-[#6a43ff]/45"
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
