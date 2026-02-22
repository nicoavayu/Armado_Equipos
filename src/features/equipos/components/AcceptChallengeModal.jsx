import React from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';

const actionButtonClass = 'h-11 rounded-xl text-sm font-oswald tracking-wide !normal-case';

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
      title="Aceptar desafio"
      className="w-full max-w-[520px]"
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
            onClick={onConfirm}
            className={actionButtonClass}
            loading={isSubmitting}
            loadingText="Aceptando..."
            disabled={!selectedTeamId}
          >
            Aceptar
          </Button>
        </div>
      )}
    >
      <p className="text-sm text-white/70 mb-3">
        Elegi uno de tus equipos con formato F{challenge?.format || '-'}
      </p>

      <select
        value={selectedTeamId}
        onChange={(event) => onChangeTeam(event.target.value)}
        className="w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
      >
        {availableTeams.map((team) => (
          <option key={team.id} value={team.id}>{team.name} · {team.base_zone || 'sin zona'}</option>
        ))}
      </select>
    </Modal>
  );
};

export default AcceptChallengeModal;
