import React, { useEffect, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';

const toDateTimeLocalValue = (isoDate) => {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const actionButtonClass = 'h-11 rounded-xl text-sm font-oswald tracking-wide';

const CompleteChallengeModal = ({ isOpen, challenge, onClose, onSubmit, isSubmitting = false }) => {
  const [scoreA, setScoreA] = useState('0');
  const [scoreB, setScoreB] = useState('0');
  const [playedAt, setPlayedAt] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setScoreA('0');
    setScoreB('0');
    setPlayedAt(toDateTimeLocalValue(new Date().toISOString()));
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Finalizar desafio"
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
            CANCELAR
          </Button>
          <Button
            type="submit"
            form="complete-challenge-form"
            className={actionButtonClass}
            loading={isSubmitting}
            loadingText="FINALIZANDO..."
          >
            GUARDAR RESULTADO
          </Button>
        </div>
      )}
    >
      <p className="text-sm text-white/70 mb-3">
        {challenge?.challenger_team?.name || 'Equipo A'} vs {challenge?.accepted_team?.name || 'Equipo B'}
      </p>

      <form
        id="complete-challenge-form"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();

          const parsedA = Number(scoreA);
          const parsedB = Number(scoreB);

          if (!Number.isFinite(parsedA) || parsedA < 0) return;
          if (!Number.isFinite(parsedB) || parsedB < 0) return;

          onSubmit({
            challengeId: challenge.id,
            scoreA: parsedA,
            scoreB: parsedB,
            playedAt: playedAt ? new Date(playedAt).toISOString() : new Date().toISOString(),
          });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="text-xs text-white/80 uppercase tracking-wide">Goles equipo A</span>
            <input
              type="number"
              min={0}
              step={1}
              value={scoreA}
              onChange={(event) => setScoreA(event.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
            />
          </label>
          <label>
            <span className="text-xs text-white/80 uppercase tracking-wide">Goles equipo B</span>
            <input
              type="number"
              min={0}
              step={1}
              value={scoreB}
              onChange={(event) => setScoreB(event.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
            />
          </label>
        </div>

        <label>
          <span className="text-xs text-white/80 uppercase tracking-wide">Fecha jugada</span>
          <input
            type="datetime-local"
            value={playedAt}
            onChange={(event) => setPlayedAt(event.target.value)}
            className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
          />
        </label>
      </form>
    </Modal>
  );
};

export default CompleteChallengeModal;
