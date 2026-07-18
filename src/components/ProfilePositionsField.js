import React from 'react';
import {
  POSITION_KEYS,
  POSITION_LABELS,
  POSITION_LONG_LABELS,
  MAX_POSITIONS,
  GOALKEEPER_POSITION,
  normalizePositions,
  togglePosition,
} from '../utils/positions';

const POSITION_BASE_CLASS = 'h-[40px] bg-[rgba(28,39,86,0.72)] border border-[rgba(102,118,182,0.52)] text-white p-2 rounded-none text-xs sm:text-sm font-bold font-oswald transition-all';
const POSITION_ACTIVE_CLASS = 'bg-gradient-to-r from-[#f4d03f] to-[#f7dc6f] !border-[#f4d03f] !text-[#201600] shadow-[0_8px_18px_rgba(244,208,63,0.32)]';
const POSITION_ENABLED_HOVER = 'cursor-pointer hover:bg-[rgba(38,51,104,0.86)] hover:border-[rgba(139,156,221,0.68)]';
const POSITION_DISABLED_CLASS = 'opacity-35 cursor-not-allowed';

/**
 * Availability-to-keep-goal switch. Accessible (role=switch, aria-checked) and
 * not colour-only (an ON/OFF-driven knob position also conveys state).
 */
const GoalkeeperAvailabilityToggle = ({ checked, onChange }) => (
  <div className="rounded-xl border border-[rgba(148,134,255,0.25)] bg-[rgba(20,16,41,0.6)] px-3.5 py-3">
    <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
      <span className="min-w-0">
        <span className="block text-white/90 text-sm font-bold font-oswald leading-tight">
          Disponible para atajar
        </span>
        <span className="block text-[11px] text-white/60 leading-snug mt-0.5">
          Permite que otros jugadores te encuentren e inviten a partidos cercanos.
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Disponible para atajar"
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-[50px] h-[28px] rounded-full border transition-colors duration-200 ${
          checked
            ? 'bg-[#6a43ff] border-[#7d5aff]'
            : 'bg-white/15 border-white/25'
        }`}
      >
        <span
          className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.3)] transition-transform duration-200 ${
            checked ? 'translate-x-[22px]' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  </div>
);

/**
 * "Posiciones" multi-select (max 2) + optional goalkeeper-availability toggle.
 * Reused by both ProfileEditor render paths (embedded page + modal).
 *
 * @param {object} props
 * @param {string[]} props.selected - currently selected positions.
 * @param {boolean} props.disponibleArquero - availability-to-keep state.
 * @param {(positions: string[]) => void} props.onPositionsChange
 * @param {(value: boolean) => void} props.onDisponibleArqueroChange
 * @param {string} props.labelClass - shared label class from the editor.
 * @param {string} props.formGroupClass - shared field group class.
 */
const ProfilePositionsField = ({
  selected,
  disponibleArquero,
  onPositionsChange,
  onDisponibleArqueroChange,
  labelClass,
  formGroupClass,
}) => {
  const positions = normalizePositions(selected);
  const atMax = positions.length >= MAX_POSITIONS;
  const hasGoalkeeper = positions.includes(GOALKEEPER_POSITION);

  return (
    <>
      <div className={formGroupClass}>
        <label className={labelClass}>Posiciones</label>
        <p className="text-[11px] text-white/55 -mt-1 mb-1 normal-case tracking-normal font-normal">
          Podés elegir hasta 2 posiciones.
        </p>
        <div
          className="grid grid-cols-4 gap-2 md:gap-1.5 mt-1"
          role="group"
          aria-label="Posiciones (máximo 2)"
        >
          {POSITION_KEYS.map((key) => {
            const isActive = positions.includes(key);
            const isDisabled = !isActive && atMax;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={isActive}
                aria-disabled={isDisabled}
                aria-label={POSITION_LONG_LABELS[key]}
                disabled={isDisabled}
                className={`${POSITION_BASE_CLASS} ${
                  isActive ? POSITION_ACTIVE_CLASS : (isDisabled ? POSITION_DISABLED_CLASS : POSITION_ENABLED_HOVER)
                }`}
                onClick={() => onPositionsChange(togglePosition(positions, key))}
              >
                {POSITION_LABELS[key]}
              </button>
            );
          })}
        </div>
      </div>

      {hasGoalkeeper ? (
        <div className={formGroupClass}>
          <GoalkeeperAvailabilityToggle
            checked={Boolean(disponibleArquero)}
            onChange={onDisponibleArqueroChange}
          />
        </div>
      ) : null}
    </>
  );
};

export { GoalkeeperAvailabilityToggle };
export default ProfilePositionsField;
