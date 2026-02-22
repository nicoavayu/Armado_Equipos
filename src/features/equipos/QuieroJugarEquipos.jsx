import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageTitle from '../../components/PageTitle';
import { useAuth } from '../../components/AuthProvider';
import DesafiosTab from './views/DesafiosTab';
import MisEquiposTab from './views/MisEquiposTab';
import { QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY } from './config';

const SUBTABS = [
  { key: 'desafios', label: 'Desafios' },
  { key: 'mis-equipos', label: 'Mis equipos' },
];

const QuieroJugarEquipos = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [activeSubtab, setActiveSubtab] = useState(() => {
    const stored = sessionStorage.getItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY);
    return SUBTABS.some((tab) => tab.key === stored) ? stored : 'desafios';
  });

  const [prefilledTeamId, setPrefilledTeamId] = useState(null);

  useEffect(() => {
    sessionStorage.setItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY, activeSubtab);
  }, [activeSubtab]);

  useEffect(() => {
    const state = location.state || {};
    const nextSubtab = state.equiposSubtab;
    const nextPrefilledTeamId = state.prefilledTeamId;

    if (SUBTABS.some((tab) => tab.key === nextSubtab)) {
      setActiveSubtab(nextSubtab);
    }

    if (nextPrefilledTeamId) {
      setPrefilledTeamId(nextPrefilledTeamId);
    }
  }, [location.state]);

  return (
    <>
      <PageTitle title="QUIERO JUGAR" onBack={() => navigate(-1)}>QUIERO JUGAR</PageTitle>

      <div className="w-full flex justify-center px-4 pt-[116px] pb-7">
        <div className="w-full max-w-[560px] rounded-xl border border-white/15 bg-[linear-gradient(135deg,rgba(61,74,130,0.42),rgba(31,43,96,0.4))] p-1.5 grid grid-cols-2 gap-1.5">
          {SUBTABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveSubtab(tab.key)}
              className={`min-w-0 rounded-lg px-1 py-2.5 text-[18px] font-oswald font-semibold normal-case tracking-[0.01em] transition-all ${activeSubtab === tab.key
                ? 'border border-[#A5B8FF]/45 bg-[linear-gradient(135deg,rgba(133,121,236,0.58),rgba(113,108,217,0.56))] text-white shadow-[0_8px_22px_rgba(121,111,231,0.34)]'
                : 'border border-transparent bg-transparent text-white/60 hover:text-white/80'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full flex justify-center px-4 pb-6">
        {activeSubtab === 'desafios' ? (
          <DesafiosTab
            userId={user?.id}
            prefilledTeamId={prefilledTeamId}
            onChallengePublished={() => setPrefilledTeamId(null)}
          />
        ) : null}

        {activeSubtab === 'mis-equipos' ? (
          <MisEquiposTab userId={user?.id} />
        ) : null}
      </div>
    </>
  );
};

export default QuieroJugarEquipos;
