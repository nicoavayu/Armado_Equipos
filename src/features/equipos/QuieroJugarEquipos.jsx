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

const QuieroJugarEquipos = ({ secondaryTabsTop = 116 }) => {
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

      <div className="w-full flex justify-center px-4 pb-7" style={{ paddingTop: `${secondaryTabsTop}px` }}>
        <div className="w-full max-w-[500px] bg-white/5 border border-white/10 rounded-xl p-1 flex gap-1">
          {SUBTABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveSubtab(tab.key)}
              className={`flex-1 min-w-0 px-1 py-2.5 rounded-lg text-sm font-bold tracking-wider uppercase transition-all ${activeSubtab === tab.key
                ? 'bg-[#128BE9] text-white shadow-[0_6px_18px_rgba(18,139,233,0.38)]'
                : 'text-white/60 hover:text-white hover:bg-white/10'
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
