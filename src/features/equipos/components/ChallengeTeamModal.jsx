import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Swords } from 'lucide-react';
import Modal from '../../../components/Modal';
import NeighborhoodAutocomplete from './NeighborhoodAutocomplete';

const PRIMARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/20 bg-cta-gradient px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white shadow-cta transition-all hover:brightness-105 active:opacity-95 disabled:cursor-not-allowed disabled:border-[rgba(125,90,255,0.45)] disabled:bg-[rgba(106,67,255,0.55)] disabled:text-white/45 disabled:shadow-none';
const SECONDARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[rgba(148,134,255,0.28)] bg-white/[0.05] px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white/92 transition-all hover:bg-white/[0.1] active:opacity-95 disabled:cursor-not-allowed disabled:opacity-50';
const INPUT_CLASS = 'h-[52px] w-full rounded-xl border border-[rgba(148,134,255,0.28)] bg-white/[0.05] px-4 text-white font-oswald text-lg outline-none transition-all duration-300 focus:border-[#8b7cff] focus:bg-[rgba(29,23,64,0.95)] focus:ring-2 focus:ring-[#6a43ff]/30 placeholder:text-white/45 backdrop-blur-md';
const INPUT_READONLY_CLASS = 'h-[52px] w-full rounded-xl border border-[rgba(148,134,255,0.18)] bg-[rgba(31,25,64,0.6)] px-4 text-white/78 font-oswald text-lg outline-none flex items-center';
const TEXTAREA_CLASS = 'min-h-[80px] w-full rounded-xl border border-[rgba(148,134,255,0.28)] bg-white/[0.05] px-4 py-3 text-white font-oswald text-base outline-none transition-all duration-300 focus:border-[#8b7cff] focus:bg-[rgba(29,23,64,0.95)] focus:ring-2 focus:ring-[#6a43ff]/30 placeholder:text-white/45 backdrop-blur-md resize-none';
const FIELD_LABEL_CLASS = 'mb-2 block text-sm text-white/70';

const challengedFormat = (team) => {
  const raw = String(team?.format ?? '').replace(/\D/g, '');
  return raw ? Number(raw) : null;
};

// Modal premium para desafiar a un equipo puntual (Equipo A -> Equipo B).
// El equipo desafiante se elige entre MIS equipos del MISMO formato que el
// rival (el backend exige mismo formato). Si no tengo ninguno, se deshabilita
// el envío con un aviso claro.
const ChallengeTeamModal = ({
  isOpen,
  challengedTeam,
  myTeams = [],
  onClose,
  onSubmit,
  isSubmitting = false,
  errorMessage = '',
}) => {
  const [challengerTeamId, setChallengerTeamId] = useState('');
  const [scheduledAtLocal, setScheduledAtLocal] = useState('');
  const [locationName, setLocationName] = useState('');
  const [message, setMessage] = useState('');
  const initializedKeyRef = useRef(null);

  const rivalName = challengedTeam?.team_name || challengedTeam?.name || 'el equipo rival';
  const rivalFormat = challengedFormat(challengedTeam);

  // Solo equipos míos activos del mismo formato que el rival pueden desafiar.
  const eligibleTeams = useMemo(
    () => (myTeams || []).filter((team) => (
      team?.id
      && team?.is_active !== false
      && (rivalFormat == null || Number(team?.format) === rivalFormat)
    )),
    [myTeams, rivalFormat],
  );

  const initializationKey = challengedTeam?.team_id || challengedTeam?.id || null;

  useEffect(() => {
    if (!isOpen) {
      initializedKeyRef.current = null;
      return;
    }
    if (initializedKeyRef.current === initializationKey) return;
    initializedKeyRef.current = initializationKey;

    setChallengerTeamId(eligibleTeams[0]?.id || '');
    setScheduledAtLocal('');
    setLocationName('');
    setMessage('');
  }, [isOpen, initializationKey, eligibleTeams]);

  const selectedTeam = useMemo(
    () => eligibleTeams.find((team) => team.id === challengerTeamId) || null,
    [challengerTeamId, eligibleTeams],
  );

  const hasEligibleTeam = eligibleTeams.length > 0;
  const canSubmit = hasEligibleTeam
    && Boolean(selectedTeam)
    && Boolean(String(scheduledAtLocal || '').trim())
    && !isSubmitting;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Desafiar a ${rivalName}`}
      className="w-full max-w-[620px] !bg-[#101a35] border border-[rgba(148,134,255,0.28)]"
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
            form="challenge-team-form"
            className={`${PRIMARY_ACTION_BUTTON_CLASS} w-full min-w-0`}
            disabled={!canSubmit}
            data-preserve-button-case="true"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
            {isSubmitting ? 'Enviando...' : 'Enviar desafío'}
          </button>
        </div>
      )}
    >
      <form
        id="challenge-team-form"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit || !selectedTeam) return;
          onSubmit({
            challengerTeamId: selectedTeam.id,
            challengedTeamId: challengedTeam?.team_id || challengedTeam?.id,
            scheduledAt: scheduledAtLocal ? new Date(scheduledAtLocal).toISOString() : null,
            locationName: locationName.trim() || null,
            notes: message.trim() || null,
          });
        }}
      >
        {errorMessage ? (
          <div className="flex items-start gap-2 rounded-xl border border-[#ff5c8a]/40 bg-[#ff5c8a]/10 px-3 py-2.5 text-[13px] text-[#ffc2d4]">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        <label className="block">
          <span className={`${FIELD_LABEL_CLASS} inline-flex items-center`}>
            Tu equipo
            <span className="ml-1 text-[#7d5aff] font-bold" aria-label="Campo obligatorio">*</span>
          </span>
          {hasEligibleTeam ? (
            <select
              value={challengerTeamId}
              onChange={(event) => setChallengerTeamId(event.target.value)}
              required
              className={INPUT_CLASS}
            >
              {eligibleTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} · F{team.format} · {team.base_zone || 'sin zona'}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-start gap-2 rounded-xl border border-[rgba(148,134,255,0.28)] bg-[rgba(31,25,64,0.6)] px-3 py-2.5 text-[13px] text-white/75">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#cdbcff]" />
              <span>{`No tenés un equipo F${rivalFormat || '-'} para desafiar a este equipo.`}</span>
            </div>
          )}
        </label>

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>Formato</span>
          <div className={INPUT_READONLY_CLASS}>{rivalFormat ? `F${rivalFormat}` : 'F-'}</div>
        </label>

        <label className="block">
          <span className={`${FIELD_LABEL_CLASS} inline-flex items-center`}>
            Fecha y hora propuesta
            <span className="ml-1 text-[#7d5aff] font-bold" aria-label="Campo obligatorio">*</span>
          </span>
          <input
            type="datetime-local"
            value={scheduledAtLocal}
            onChange={(event) => setScheduledAtLocal(event.target.value)}
            required
            disabled={!hasEligibleTeam}
            className={`${INPUT_CLASS} disabled:opacity-60 disabled:cursor-not-allowed`}
          />
        </label>

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>Zona / cancha (opcional)</span>
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
          <span className={FIELD_LABEL_CLASS}>Mensaje (opcional)</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={280}
            placeholder="Ej: ¿Juegan este jueves?"
            className={TEXTAREA_CLASS}
          />
        </label>
      </form>
    </Modal>
  );
};

export default ChallengeTeamModal;
