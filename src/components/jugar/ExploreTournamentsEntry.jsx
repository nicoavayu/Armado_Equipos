import React from 'react';
import { ChevronRight, Trophy } from 'lucide-react';
import { APP_SPACE, useSpaceNavigation } from '../../features/space-navigation';

// The one door from Arma2 (Core) to Explorar torneos. Explicit and discreet: it does not change Core's navigation,
// carries no administrative control, and switching product happens only because the person asked for it here.
export default function ExploreTournamentsEntry() {
  const { switchSpace, isSpaceAvailable } = useSpaceNavigation();
  if (!isSpaceAvailable(APP_SPACE.TORNEOS)) return null;
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pb-6">
      <button
        type="button"
        data-explore-tournaments-entry="true"
        onClick={() => switchSpace(APP_SPACE.TORNEOS, { route: '/torneos/explorar' })}
        className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-white transition-colors hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8b7cff]"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#6a43ff]/25 text-[#c9bcff]">
          <Trophy size={19} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="text-[15px] font-semibold leading-tight">¿Buscás un torneo?</strong>
          <small className="text-[13px] leading-snug text-white/65">Explorá convocatorias abiertas en Arma2 Torneos</small>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-white/55" />
      </button>
    </div>
  );
}
