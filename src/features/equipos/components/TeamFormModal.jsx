import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import { TEAM_FORMAT_OPTIONS, TEAM_SKILL_OPTIONS, normalizeTeamSkillLevel } from '../config';
import NeighborhoodAutocomplete from './NeighborhoodAutocomplete';

const EMPTY_FORM = {
  name: '',
  format: 5,
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

const actionButtonClass = 'h-11 rounded-xl text-sm font-oswald tracking-wide !normal-case';

const TeamFormModal = ({ isOpen, initialTeam, onClose, onSubmit, isSubmitting = false }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [colors, setColors] = useState([]);
  const [crestFile, setCrestFile] = useState(null);
  const [crestPreview, setCrestPreview] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    const nextForm = {
      name: initialTeam?.name || '',
      format: Number(initialTeam?.format || 5),
      base_zone: initialTeam?.base_zone || '',
      skill_level: normalizeTeamSkillLevel(initialTeam?.skill_level),
    };

    setForm(nextForm);
    setColors(toInitialColors(initialTeam));
    setCrestFile(null);
    setCrestPreview(initialTeam?.crest_url || null);
  }, [initialTeam, isOpen]);

  useEffect(() => () => {
    if (crestPreview && crestPreview.startsWith('blob:')) {
      URL.revokeObjectURL(crestPreview);
    }
  }, [crestPreview]);

  const title = useMemo(() => (initialTeam ? 'Editar equipo' : 'Crear equipo'), [initialTeam]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
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
            form="team-form-modal"
            className={actionButtonClass}
            loading={isSubmitting}
            loadingText="Guardando..."
            disabled={form.name.trim().length === 0}
          >
            Guardar equipo
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
            color_primary: normalizedColors[0] || null,
            color_secondary: normalizedColors[1] || null,
            color_accent: normalizedColors[2] || null,
          }, crestFile);
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
            className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Formato</span>
            <select
              value={form.format}
              onChange={(event) => setForm((prev) => ({ ...prev, format: Number(event.target.value) }))}
              className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
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
              className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
            >
              {TEAM_SKILL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-white/80 uppercase tracking-wide">Zona base</span>
          <div className="mt-1">
            <NeighborhoodAutocomplete
              value={form.base_zone}
              onChange={(nextZone) => setForm((prev) => ({ ...prev, base_zone: nextZone }))}
              placeholder="Ej: Palermo"
              inputClassName="w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9] disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
        </label>

        <div className="rounded-xl border border-white/15 bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/80 uppercase tracking-wide">Colores (opcionales)</span>
            <button
              type="button"
              disabled={colors.length >= 3}
              onClick={() => setColors((prev) => (prev.length >= 3 ? prev : [...prev, '#128BE9']))}
              className="text-xs text-[#9ED3FF] disabled:text-white/30"
            >
              + Agregar color
            </button>
          </div>

          <div className="mt-2 space-y-2">
            {colors.length === 0 ? (
              <p className="text-xs text-white/55">Sin colores personalizados.</p>
            ) : colors.map((color, index) => (
              <div key={`${index}-${color}`} className="flex items-center gap-2">
                <input
                  type="color"
                  value={normalizeHex(color) || '#128BE9'}
                  onChange={(event) => {
                    const value = event.target.value;
                    setColors((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
                  }}
                  className="h-8 w-10 rounded border border-white/20 bg-transparent"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(event) => {
                    const value = event.target.value;
                    setColors((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
                  }}
                  placeholder="#128BE9"
                  className="flex-1 rounded-lg bg-slate-900/80 border border-white/20 px-2 py-1.5 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={() => setColors((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                  className="text-xs text-red-300"
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/15 bg-white/5 p-3">
          <span className="text-xs text-white/80 uppercase tracking-wide">Escudo (opcional)</span>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-14 w-14 rounded-xl overflow-hidden border border-white/20 bg-black/20 flex items-center justify-center">
              {crestPreview ? (
                <img src={crestPreview} alt="Preview escudo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[10px] text-white/60">Sin escudo</span>
              )}
            </div>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setCrestFile(file);

                if (crestPreview && crestPreview.startsWith('blob:')) {
                  URL.revokeObjectURL(crestPreview);
                }

                if (file) {
                  setCrestPreview(URL.createObjectURL(file));
                } else {
                  setCrestPreview(initialTeam?.crest_url || null);
                }
              }}
              className="text-xs text-white/70"
            />
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default TeamFormModal;
