import React from 'react';
import { Users, Hand } from 'lucide-react';

/**
 * Compact "¿Cómo querés sumarte?" chooser shown when a match searches for both
 * players and a goalkeeper and the requester can keep goal. Two premium choices
 * + dismiss. No long flow.
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {() => void} props.onSelectPlayer
 * @param {() => void} props.onSelectGoalkeeper
 */
const JoinRoleModal = ({ isOpen, onClose, onSelectPlayer, onSelectGoalkeeper }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center px-5 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="¿Cómo querés sumarte?"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl border border-[rgba(148,134,255,0.24)] bg-[linear-gradient(165deg,rgba(48,38,98,0.96),rgba(20,16,41,0.98))] p-5 shadow-[0_20px_50px_rgba(5,3,16,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-oswald text-white text-lg font-bold text-center mb-1">
          ¿Cómo querés sumarte?
        </h3>
        <p className="text-white/60 text-[12.5px] text-center mb-4 leading-snug">
          Este partido busca jugadores y arquero.
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onSelectPlayer}
            className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl border border-[#7d5aff] bg-cta-gradient text-white font-bebas text-[16px] tracking-[0.04em] shadow-cta transition-all hover:brightness-110 active:scale-[0.985]"
          >
            <Users size={18} /> Como jugador
          </button>
          <button
            type="button"
            onClick={onSelectGoalkeeper}
            className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl border border-[#FDB022]/60 bg-[rgba(253,176,34,0.16)] text-[#ffd88a] font-bebas text-[16px] tracking-[0.04em] transition-all hover:bg-[rgba(253,176,34,0.24)] active:scale-[0.985]"
          >
            <Hand size={18} /> Como arquero
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 w-full min-h-[48px] flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] text-white/75 font-oswald text-[15px] tracking-[0.01em] transition-all hover:bg-white/[0.09] hover:text-white active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

export default JoinRoleModal;
