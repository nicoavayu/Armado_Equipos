import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';

const actionButtonClass = 'h-11 rounded-xl text-sm font-oswald tracking-wide';

const PublishChallengeModal = ({
  isOpen,
  teams = [],
  onClose,
  onSubmit,
  isSubmitting = false,
  prefilledTeamId = null,
}) => {
  const [challengerTeamId, setChallengerTeamId] = useState('');
  const [scheduledAtLocal, setScheduledAtLocal] = useState('');
  const [locationName, setLocationName] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    if (prefilledTeamId) {
      setChallengerTeamId(prefilledTeamId);
    } else {
      setChallengerTeamId(teams[0]?.id || '');
    }

    setScheduledAtLocal('');
    setLocationName('');
    setNotes('');
  }, [isOpen, prefilledTeamId, teams]);

  const selectedTeam = useMemo(() => teams.find((team) => team.id === challengerTeamId) || null, [challengerTeamId, teams]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Publicar desafio"
      className="w-full max-w-[560px]"
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
            form="publish-challenge-form"
            className={actionButtonClass}
            loading={isSubmitting}
            loadingText="PUBLICANDO..."
            disabled={!selectedTeam}
          >
            PUBLICAR
          </Button>
        </div>
      )}
    >
      <form
        id="publish-challenge-form"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedTeam) return;

          onSubmit({
            challenger_team_id: selectedTeam.id,
            format: selectedTeam.format,
            skill_level: selectedTeam.skill_level,
            scheduled_at: scheduledAtLocal ? new Date(scheduledAtLocal).toISOString() : null,
            location_name: locationName.trim() || null,
            notes: notes.trim() || null,
          });
        }}
      >
        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Equipo desafiante</span>
          <select
            value={challengerTeamId}
            onChange={(event) => setChallengerTeamId(event.target.value)}
            className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
          >
            {teams.length === 0 ? <option value="">Sin equipos</option> : null}
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} · F{team.format} · {team.base_zone || 'sin zona'}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Formato</span>
            <input
              type="text"
              readOnly
              value={selectedTeam ? `F${selectedTeam.format}` : '-'}
              className="mt-1 w-full rounded-xl bg-slate-800/70 border border-white/15 px-3 py-2 text-white/80"
            />
          </label>

          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Nivel</span>
            <input
              type="text"
              readOnly
              value={selectedTeam?.skill_level || '-'}
              className="mt-1 w-full rounded-xl bg-slate-800/70 border border-white/15 px-3 py-2 text-white/80"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Fecha y hora (opcional)</span>
          <input
            type="datetime-local"
            value={scheduledAtLocal}
            onChange={(event) => setScheduledAtLocal(event.target.value)}
            className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
          />
        </label>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Cancha / Zona (opcional)</span>
          <input
            type="text"
            maxLength={120}
            value={locationName}
            onChange={(event) => setLocationName(event.target.value)}
            className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
            placeholder="Ej: Parque Sarmiento"
          />
        </label>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Notas (opcional)</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={250}
            rows={3}
            className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9] resize-none"
          />
        </label>
      </form>
    </Modal>
  );
};

export default PublishChallengeModal;
