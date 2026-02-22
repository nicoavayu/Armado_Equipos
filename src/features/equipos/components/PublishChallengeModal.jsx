import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import { TEAM_FORMAT_OPTIONS, TEAM_SKILL_OPTIONS } from '../config';
import { formatSkillLevelLabel } from '../utils/teamColors';
import NeighborhoodAutocomplete from './NeighborhoodAutocomplete';

const actionButtonClass = 'h-12 rounded-xl text-[18px] font-oswald font-semibold tracking-[0.01em] !normal-case';

const FORMAT_OPTIONS_LABEL = TEAM_FORMAT_OPTIONS.map((value) => `F${value}`).join(' · ');
const SKILL_OPTIONS_LABEL = TEAM_SKILL_OPTIONS.map((option) => option.label).join(' · ');
const MODE_OPTIONS = ['Masculino', 'Femenino', 'Mixto'];

const sanitizeAmountInput = (value) => String(value || '').replace(/[^\d.,]/g, '').slice(0, 16);

const parseOptionalAmount = (value) => {
  const normalized = String(value || '').trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

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
  const [fieldPrice, setFieldPrice] = useState('');
  const [mode, setMode] = useState('Masculino');

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
    setFieldPrice('');
    setMode('Masculino');
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
            Cancelar
          </Button>
          <Button
            type="submit"
            form="publish-challenge-form"
            className={actionButtonClass}
            loading={isSubmitting}
            loadingText="Publicando..."
            disabled={!selectedTeam}
          >
            Publicar
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
            mode: mode || 'Masculino',
            scheduled_at: scheduledAtLocal ? new Date(scheduledAtLocal).toISOString() : null,
            location_name: locationName.trim() || null,
            field_price: parseOptionalAmount(fieldPrice),
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
              value={selectedTeam ? `F${selectedTeam.format}` : FORMAT_OPTIONS_LABEL}
              className="mt-1 w-full rounded-xl bg-slate-800/70 border border-white/15 px-3 py-2 text-white/80"
            />
          </label>

          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Nivel</span>
            <input
              type="text"
              readOnly
              value={selectedTeam ? formatSkillLevelLabel(selectedTeam.skill_level) : SKILL_OPTIONS_LABEL}
              className="mt-1 w-full rounded-xl bg-slate-800/70 border border-white/15 px-3 py-2 text-white/80"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Genero</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

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
          <span className="text-xs text-white/80 uppercase tracking-wide">Barrio (opcional)</span>
          <div className="mt-1">
            <NeighborhoodAutocomplete
              value={locationName}
              onChange={setLocationName}
              placeholder="Ej: Palermo"
              inputClassName="w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9] disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
        </label>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Precio cancha (opcional)</span>
          <input
            type="text"
            inputMode="decimal"
            value={fieldPrice}
            onChange={(event) => setFieldPrice(sanitizeAmountInput(event.target.value))}
            className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
            placeholder="Ej: 24000"
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
