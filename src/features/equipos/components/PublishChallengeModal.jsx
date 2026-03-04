import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import {
  TEAM_FORMAT_OPTIONS,
  TEAM_SKILL_OPTIONS,
  normalizeTeamMode,
} from '../config';
import { formatSkillLevelLabel } from '../utils/teamColors';
import NeighborhoodAutocomplete from './NeighborhoodAutocomplete';

const actionButtonBaseClass = '!w-full !h-auto !min-h-[44px] !px-4 !py-2.5 !rounded-none !font-bebas !text-base !tracking-[0.01em] !normal-case sm:!text-[13px] sm:!px-3 sm:!py-2 sm:!min-h-[36px]';
const actionPrimaryClass = `${actionButtonBaseClass} !border !border-[#7d5aff] !bg-[#6a43ff] !text-white !shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:!bg-[#7550ff]`;
const actionSecondaryClass = `${actionButtonBaseClass} !border !border-white/35 !bg-white/5 !text-white hover:!bg-white/10`;

const FORMAT_OPTIONS_LABEL = TEAM_FORMAT_OPTIONS.map((value) => `F${value}`).join(' · ');
const SKILL_OPTIONS_LABEL = TEAM_SKILL_OPTIONS.map((option) => option.label).join(' · ');

const sanitizeAmountInput = (value) => String(value || '').replace(/[^\d.,]/g, '').slice(0, 16);

const parseOptionalAmount = (value) => {
  const normalized = String(value || '').trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const toLocalDateTimeInputValue = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const PublishChallengeModal = ({
  isOpen,
  teams = [],
  onClose,
  onSubmit,
  isSubmitting = false,
  prefilledTeamId = null,
  initialChallenge = null,
  submitLabel = 'Publicar',
  submitLoadingText = 'Publicando...',
}) => {
  const [challengerTeamId, setChallengerTeamId] = useState('');
  const [scheduledAtLocal, setScheduledAtLocal] = useState('');
  const [locationName, setLocationName] = useState('');
  const [fieldPrice, setFieldPrice] = useState('');
  const isEditMode = Boolean(initialChallenge?.id);

  useEffect(() => {
    if (!isOpen) return;

    if (isEditMode) {
      setChallengerTeamId(initialChallenge?.challenger_team_id || prefilledTeamId || teams[0]?.id || '');
      setScheduledAtLocal(toLocalDateTimeInputValue(initialChallenge?.scheduled_at));
      setLocationName(initialChallenge?.location || initialChallenge?.location_name || '');
      const parsedPrice = Number(initialChallenge?.cancha_cost ?? initialChallenge?.field_price);
      setFieldPrice(Number.isFinite(parsedPrice) && parsedPrice > 0 ? String(Math.round(parsedPrice)) : '');
      return;
    }

    if (prefilledTeamId) {
      setChallengerTeamId(prefilledTeamId);
    } else {
      setChallengerTeamId(teams[0]?.id || '');
    }

    setScheduledAtLocal('');
    setLocationName('');
    setFieldPrice('');
  }, [initialChallenge, isEditMode, isOpen, prefilledTeamId, teams]);

  const selectedTeam = useMemo(() => teams.find((team) => team.id === challengerTeamId) || null, [challengerTeamId, teams]);
  const selectedTeamMode = useMemo(
    () => normalizeTeamMode(selectedTeam?.mode || initialChallenge?.mode || initialChallenge?.challenger_team?.mode),
    [initialChallenge?.challenger_team?.mode, initialChallenge?.mode, selectedTeam?.mode],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Editar desafio' : 'Publicar desafio'}
      className="w-full max-w-[560px]"
      classNameContent="p-4 sm:p-5"
      footer={(
        <div className="grid grid-cols-2 gap-2 mt-2.5 max-w-[420px] mx-auto">
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
            type="submit"
            form="publish-challenge-form"
            className={actionPrimaryClass}
            loading={isSubmitting}
            loadingText={submitLoadingText}
            disabled={!selectedTeam || !String(scheduledAtLocal || '').trim()}
            data-preserve-button-case="true"
          >
            {submitLabel}
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
            mode: selectedTeamMode,
            scheduled_at: scheduledAtLocal ? new Date(scheduledAtLocal).toISOString() : null,
            location_name: locationName.trim() || null,
            field_price: parseOptionalAmount(fieldPrice),
          });
        }}
      >
        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide inline-flex items-center">
            Equipo desafiante
            <span className="ml-1 text-[#7d5aff] font-bold" aria-label="Campo obligatorio">*</span>
          </span>
          <select
            value={challengerTeamId}
            onChange={(event) => setChallengerTeamId(event.target.value)}
            required
            className="mt-1 w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
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
              className="mt-1 w-full rounded-none bg-slate-800/70 border border-white/15 px-3 py-2 text-white/80"
            />
          </label>

          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Nivel</span>
            <input
              type="text"
              readOnly
              value={selectedTeam ? formatSkillLevelLabel(selectedTeam.skill_level) : SKILL_OPTIONS_LABEL}
              className="mt-1 w-full rounded-none bg-slate-800/70 border border-white/15 px-3 py-2 text-white/80"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Genero</span>
          <input
            type="text"
            readOnly
            value={selectedTeamMode}
            className="mt-1 w-full rounded-none bg-slate-800/70 border border-white/15 px-3 py-2 text-white/80"
          />
        </label>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide inline-flex items-center">
            Fecha y hora
            <span className="ml-1 text-[#7d5aff] font-bold" aria-label="Campo obligatorio">*</span>
          </span>
          <input
            type="datetime-local"
            value={scheduledAtLocal}
            onChange={(event) => setScheduledAtLocal(event.target.value)}
            required
            className="mt-1 w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
          />
        </label>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Barrio (opcional)</span>
          <div className="mt-1">
            <NeighborhoodAutocomplete
              value={locationName}
              onChange={setLocationName}
              placeholder="Ej: Palermo"
              inputClassName="w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9] disabled:opacity-60 disabled:cursor-not-allowed"
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
            className="mt-1 w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
            placeholder="Ej: 24000"
          />
        </label>

      </form>
    </Modal>
  );
};

export default PublishChallengeModal;
