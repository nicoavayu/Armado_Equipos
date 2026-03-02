import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import {
  TEAM_FORMAT_OPTIONS,
  TEAM_MODE_OPTIONS,
  TEAM_SKILL_OPTIONS,
  normalizeTeamMode,
  normalizeTeamSkillLevel,
} from '../config';
import NeighborhoodAutocomplete from './NeighborhoodAutocomplete';

const EMPTY_FORM = {
  name: '',
  format: 5,
  mode: 'Masculino',
  base_zone: '',
  skill_level: 'sin_definir',
};

const toInitialColors = (team) => [team?.color_primary, team?.color_secondary, team?.color_accent]
  .filter((value) => typeof value === 'string' && value.trim().length > 0)
  .slice(0, 3);

const normalizeHex = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9A-Fa-f]{6}$/.test(withHash) ? withHash.toUpperCase() : null;
};

const actionButtonBaseClass = '!w-full !h-auto !min-h-[44px] !px-4 !py-2.5 !rounded-none !font-bebas !text-base !tracking-[0.01em] !normal-case sm:!text-[13px] sm:!px-3 sm:!py-2 sm:!min-h-[36px]';
const actionPrimaryClass = `${actionButtonBaseClass} !border !border-[#7d5aff] !bg-[#6a43ff] !text-white !shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:!bg-[#7550ff]`;
const actionSecondaryClass = `${actionButtonBaseClass} !border !border-white/35 !bg-white/5 !text-white hover:!bg-white/10`;

const TeamFormModal = ({ isOpen, initialTeam, onClose, onSubmit, isSubmitting = false }) => {
  const crestFileRef = useRef(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [colors, setColors] = useState([]);
  const [crestFile, setCrestFile] = useState(null);
  const [crestPreview, setCrestPreview] = useState(null);
  const [addCurrentUserAsPlayer, setAddCurrentUserAsPlayer] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    const nextForm = {
      name: initialTeam?.name || '',
      format: Number(initialTeam?.format || 5),
      mode: normalizeTeamMode(initialTeam?.mode),
      base_zone: initialTeam?.base_zone || '',
      skill_level: normalizeTeamSkillLevel(initialTeam?.skill_level),
    };

    setForm(nextForm);
    setColors(toInitialColors(initialTeam));
    setCrestFile(null);
    setCrestPreview(initialTeam?.crest_url || null);
    setAddCurrentUserAsPlayer(!initialTeam);
  }, [initialTeam, isOpen]);

  useEffect(() => () => {
    if (crestPreview && crestPreview.startsWith('blob:')) {
      URL.revokeObjectURL(crestPreview);
    }
  }, [crestPreview]);

  const handleCrestChange = (file) => {
    if (!file) return;

    setCrestFile(file);

    if (crestPreview && crestPreview.startsWith('blob:')) {
      URL.revokeObjectURL(crestPreview);
    }

    setCrestPreview(URL.createObjectURL(file));
  };

  const handleClearCrest = () => {
    setCrestFile(null);

    if (crestPreview && crestPreview.startsWith('blob:')) {
      URL.revokeObjectURL(crestPreview);
    }

    setCrestPreview(null);

    if (crestFileRef.current) {
      crestFileRef.current.value = '';
    }
  };

  const title = useMemo(() => (initialTeam ? 'Editar equipo' : 'Crear equipo'), [initialTeam]);
  const isCreateMode = !initialTeam;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
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
            form="team-form-modal"
            className={actionPrimaryClass}
            loading={isSubmitting}
            loadingText="Guardando..."
            disabled={form.name.trim().length === 0}
            data-preserve-button-case="true"
          >
            Guardar
          </Button>
        </div>
      )}
    >
      <form
        id="team-form-modal"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();

          const normalizedColors = colors
            .map((color) => normalizeHex(color))
            .filter(Boolean)
            .slice(0, 3);

          onSubmit({
            ...form,
            name: form.name.trim(),
            base_zone: form.base_zone.trim() || null,
            crest_url: crestPreview && !crestPreview.startsWith('blob:') ? crestPreview : null,
            color_primary: normalizedColors[0] || null,
            color_secondary: normalizedColors[1] || null,
            color_accent: normalizedColors[2] || null,
          }, crestFile, {
            addCurrentUserAsPlayer: Boolean(isCreateMode && addCurrentUserAsPlayer),
          });
        }}
      >
        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Nombre</span>
          <input
            type="text"
            required
            maxLength={60}
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            className="mt-1 w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Formato</span>
            <select
              value={form.format}
              onChange={(event) => setForm((prev) => ({ ...prev, format: Number(event.target.value) }))}
              className="mt-1 w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
            >
              {TEAM_FORMAT_OPTIONS.map((value) => (
                <option key={value} value={value}>F{value}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Nivel</span>
            <select
              value={form.skill_level}
              onChange={(event) => setForm((prev) => ({ ...prev, skill_level: event.target.value }))}
              className="mt-1 w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
            >
              {TEAM_SKILL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Genero</span>
          <select
            value={form.mode}
            onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value }))}
            className="mt-1 w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
          >
            {TEAM_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Zona base</span>
          <div className="mt-1">
            <NeighborhoodAutocomplete
              value={form.base_zone}
              onChange={(nextZone) => setForm((prev) => ({ ...prev, base_zone: nextZone }))}
              placeholder="Ej: Palermo"
              inputClassName="w-full rounded-none bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9] disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
        </label>

        {isCreateMode ? (
          <label className="rounded-none border border-white/15 bg-white/5 p-3 inline-flex items-start gap-2.5 text-white/90 font-oswald text-[15px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={addCurrentUserAsPlayer}
              onChange={(event) => setAddCurrentUserAsPlayer(event.target.checked)}
              className="sr-only"
            />
            <span
              className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-none border transition-all ${addCurrentUserAsPlayer
                ? 'border-[#93C5FD] bg-[#2563EB] text-white shadow-[0_0_0_3px_rgba(37,99,235,0.22)]'
                : 'border-white/30 bg-slate-900/70 text-transparent'
                }`}
            >
              <Check size={13} strokeWidth={3} />
            </span>
            <span className="leading-tight">
              <span className="block text-white">Agregarme como jugador</span>
              <span className="mt-1 block text-xs text-white/65">Te agrega automáticamente a la plantilla del equipo.</span>
            </span>
          </label>
        ) : null}

        <div className="rounded-none border border-white/15 bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/80 uppercase tracking-wide">Colores (opcionales)</span>
            <button
              type="button"
              disabled={colors.length >= 3}
              onClick={() => setColors((prev) => (prev.length >= 3 ? prev : [...prev, '#128BE9']))}
              className="inline-flex items-center justify-center rounded-none border border-[#9ED3FF]/35 bg-[#128BE9]/10 p-2 text-[#9ED3FF] transition-all hover:bg-[#128BE9]/20 disabled:opacity-45 disabled:cursor-not-allowed"
              title="Agregar color"
              aria-label="Agregar color"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-none border border-[#9ED3FF]/35 bg-[#128BE9]/20">
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </button>
          </div>

          <div className="mt-2 space-y-2">
            {colors.length === 0 ? (
              <p className="text-xs text-white/55">Sin colores personalizados.</p>
            ) : colors.map((color, index) => (
              <div key={`${index}-${color}`} className="flex items-center gap-2">
                <div className="h-10 w-12 rounded-none border border-white/20 bg-slate-900/60 p-1.5">
                  <input
                    type="color"
                    value={normalizeHex(color) || '#128BE9'}
                    onChange={(event) => {
                      const value = event.target.value;
                      setColors((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
                    }}
                    className="h-full w-full cursor-pointer rounded-none border-0 bg-transparent p-0"
                  />
                </div>
                <input
                  type="text"
                  value={color}
                  onChange={(event) => {
                    const value = event.target.value;
                    setColors((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
                  }}
                  placeholder="#128BE9"
                  className="flex-1 rounded-none bg-slate-900/80 border border-white/20 px-2.5 py-2 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={() => setColors((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-none border border-red-300/35 bg-red-500/10 text-red-200 transition-all hover:bg-red-500/20"
                  aria-label="Quitar color"
                  title="Quitar color"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-none border border-white/15 bg-white/5 p-3">
          <span className="text-xs text-white/80 uppercase tracking-wide">Escudo (opcional)</span>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!crestFileRef.current) return;
                crestFileRef.current.value = '';
                crestFileRef.current.click();
              }}
              className="h-14 w-14 rounded-none overflow-hidden border border-white/20 bg-slate-900/60 flex items-center justify-center shrink-0 transition-all hover:border-[#9ED3FF]/45"
              title="Elegir escudo"
              aria-label="Elegir escudo"
            >
              {crestPreview ? (
                <img src={crestPreview} alt="Escudo" className="h-full w-full object-cover" />
              ) : (
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#9ED3FF]/40 bg-[#128BE9]/15 text-[#9ED3FF]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8.5h18v11H3z" />
                    <path d="M8 8.5V6h8v2.5" />
                    <circle cx="12" cy="14" r="2.7" />
                    <path d="M12 2.8v2.4M10.6 4.2h2.8" />
                  </svg>
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (!crestFileRef.current) return;
                crestFileRef.current.value = '';
                crestFileRef.current.click();
              }}
              className="flex-1 min-w-0 rounded-none border border-dashed border-white/20 bg-slate-900/45 px-3 py-3 text-left text-white/90 font-oswald text-[16px] transition-all hover:border-[#9ED3FF]/45 hover:text-white"
            >
              Elegir foto
            </button>

            <input
              ref={crestFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleCrestChange(file);
              }}
              className="hidden"
            />

            {crestPreview ? (
              <button
                type="button"
                onClick={handleClearCrest}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-none border border-red-300/35 bg-red-500/10 text-red-200 transition-all hover:bg-red-500/20"
                title="Quitar escudo"
                aria-label="Quitar escudo"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default TeamFormModal;
