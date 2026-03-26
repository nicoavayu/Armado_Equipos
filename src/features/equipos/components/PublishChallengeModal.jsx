import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '../../../components/Modal';
import {
  TEAM_FORMAT_OPTIONS,
  TEAM_SKILL_OPTIONS,
  normalizeTeamMode,
} from '../config';
import { formatSkillLevelLabel } from '../utils/teamColors';
import NeighborhoodAutocomplete from './NeighborhoodAutocomplete';

const PRIMARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none border border-[#7d5aff] bg-[#6a43ff] px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white shadow-[0_0_14px_rgba(106,67,255,0.3)] transition-all hover:bg-[#7550ff] active:opacity-95 disabled:cursor-not-allowed disabled:border-[rgba(125,90,255,0.45)] disabled:bg-[rgba(106,67,255,0.55)] disabled:text-white/45 disabled:shadow-none';
const SECONDARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none border border-[rgba(98,117,184,0.58)] bg-[rgba(20,31,70,0.82)] px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white/92 transition-all hover:bg-[rgba(30,45,94,0.95)] active:opacity-95 disabled:cursor-not-allowed disabled:opacity-50';
const INPUT_CLASS = 'h-[52px] w-full rounded-none border border-[rgba(98,117,184,0.58)] bg-[rgba(20,31,70,0.82)] px-4 text-white font-oswald text-lg outline-none transition-all duration-300 focus:border-[#7f8dff] focus:bg-[rgba(30,45,94,0.95)] focus:ring-2 focus:ring-[#6f7dff]/30 placeholder:text-white/45 backdrop-blur-md';
const INPUT_READONLY_CLASS = 'h-[52px] w-full rounded-none border border-[rgba(88,107,170,0.4)] bg-[rgba(26,35,76,0.58)] px-4 text-white/78 font-oswald text-lg outline-none';
const FIELD_LABEL_CLASS = 'mb-2 block text-sm text-white/70';

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

const buildModalInitializationKey = ({
  isEditMode,
  initialChallengeId,
  prefilledTeamId,
}) => (
  isEditMode
    ? `edit:${initialChallengeId || 'unknown'}`
    : `create:${prefilledTeamId || 'default'}`
);

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
  const initializedKeyRef = useRef(null);
  const isEditMode = Boolean(initialChallenge?.id);
  const initializationKey = useMemo(() => buildModalInitializationKey({
    isEditMode,
    initialChallengeId: initialChallenge?.id,
    prefilledTeamId,
  }), [initialChallenge?.id, isEditMode, prefilledTeamId]);

  useEffect(() => {
    if (!isOpen) {
      initializedKeyRef.current = null;
      return;
    }

    if (initializedKeyRef.current === initializationKey) return;
    initializedKeyRef.current = initializationKey;

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
  }, [
    initialChallenge?.cancha_cost,
    initialChallenge?.challenger_team_id,
    initialChallenge?.field_price,
    initialChallenge?.id,
    initialChallenge?.location,
    initialChallenge?.location_name,
    initialChallenge?.scheduled_at,
    initializationKey,
    isEditMode,
    isOpen,
    prefilledTeamId,
    teams,
  ]);

  useEffect(() => {
    if (!isOpen || challengerTeamId || teams.length === 0) return;

    const nextTeamId = isEditMode
      ? initialChallenge?.challenger_team_id || prefilledTeamId || teams[0]?.id || ''
      : prefilledTeamId || teams[0]?.id || '';

    if (nextTeamId) {
      setChallengerTeamId(nextTeamId);
    }
  }, [
    challengerTeamId,
    initialChallenge?.challenger_team_id,
    isEditMode,
    isOpen,
    prefilledTeamId,
    teams,
  ]);

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
      className="w-full max-w-[620px] !bg-[#101a35] border border-[rgba(98,117,184,0.58)]"
      classNameContent="p-5"
      footer={(
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className={`${SECONDARY_ACTION_BUTTON_CLASS} w-full min-w-0`}
            data-preserve-button-case="true"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="publish-challenge-form"
            className={`${PRIMARY_ACTION_BUTTON_CLASS} w-full min-w-0`}
            disabled={isSubmitting || !selectedTeam || !String(scheduledAtLocal || '').trim()}
            data-preserve-button-case="true"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
            {isSubmitting ? submitLoadingText : submitLabel}
          </button>
        </div>
      )}
    >
      <form
        id="publish-challenge-form"
        className="space-y-5"
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
          <span className={`${FIELD_LABEL_CLASS} inline-flex items-center`}>
            Equipo desafiante
            <span className="ml-1 text-[#7d5aff] font-bold" aria-label="Campo obligatorio">*</span>
          </span>
          <select
            value={challengerTeamId}
            onChange={(event) => setChallengerTeamId(event.target.value)}
            required
            className={INPUT_CLASS}
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
            <span className={FIELD_LABEL_CLASS}>Formato</span>
            <input
              type="text"
              readOnly
              value={selectedTeam ? `F${selectedTeam.format}` : FORMAT_OPTIONS_LABEL}
              className={INPUT_READONLY_CLASS}
            />
          </label>

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>Nivel</span>
            <input
              type="text"
              readOnly
              value={selectedTeam ? formatSkillLevelLabel(selectedTeam.skill_level) : SKILL_OPTIONS_LABEL}
              className={INPUT_READONLY_CLASS}
            />
          </label>
        </div>

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>Género</span>
          <input
            type="text"
            readOnly
            value={selectedTeamMode}
            className={INPUT_READONLY_CLASS}
          />
        </label>

        <label className="block">
          <span className={`${FIELD_LABEL_CLASS} inline-flex items-center`}>
            Fecha y hora
            <span className="ml-1 text-[#7d5aff] font-bold" aria-label="Campo obligatorio">*</span>
          </span>
          <input
            type="datetime-local"
            value={scheduledAtLocal}
            onChange={(event) => setScheduledAtLocal(event.target.value)}
            required
            className={INPUT_CLASS}
          />
        </label>

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>Barrio (opcional)</span>
          <div>
            <NeighborhoodAutocomplete
              value={locationName}
              onChange={setLocationName}
              placeholder="Ej: Palermo"
              inputClassName={`${INPUT_CLASS} disabled:opacity-60 disabled:cursor-not-allowed`}
            />
          </div>
        </label>

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>Precio cancha (opcional)</span>
          <input
            type="text"
            inputMode="decimal"
            value={fieldPrice}
            onChange={(event) => setFieldPrice(sanitizeAmountInput(event.target.value))}
            className={INPUT_CLASS}
            placeholder="Ej: 24000"
          />
        </label>

      </form>
    </Modal>
  );
};

export default PublishChallengeModal;
