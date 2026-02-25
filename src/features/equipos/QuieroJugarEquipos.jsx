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

const QuieroJugarEquipos = ({
  secondaryTabsTop = 116,
  secondaryTabsDirection = 'right',
  secondaryTabsTransitionKey = 'equipos',
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [activeSubtab, setActiveSubtab] = useState(() => {
    const stored = sessionStorage.getItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY);
    return SUBTABS.some((tab) => tab.key === stored) ? stored : 'desafios';
  });
  const [showSecondaryTabs, setShowSecondaryTabs] = useState(false);

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

  useEffect(() => {
    setShowSecondaryTabs(false);
    const frameId = window.requestAnimationFrame(() => {
      setShowSecondaryTabs(true);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [secondaryTabsDirection, secondaryTabsTransitionKey]);

  return (
    <>
      <PageTitle title="QUIERO JUGAR" onBack={() => navigate(-1)}>QUIERO JUGAR</PageTitle>

      <div className="w-full flex justify-center px-4 pb-7" style={{ paddingTop: `${secondaryTabsTop}px` }}>
        <div
          className="w-full max-w-[500px] transition-[transform,opacity] duration-200 ease-out will-change-transform"
          style={{
            transform: showSecondaryTabs
              ? 'translateX(0)'
              : `translateX(${secondaryTabsDirection === 'left' ? '-18px' : '18px'})`,
            opacity: showSecondaryTabs ? 1 : 0.01,
          }}
        >
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-[16px] p-1 flex gap-1">
            {SUBTABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveSubtab(tab.key)}
                className={`flex-1 min-w-0 px-1 h-10 rounded-[12px] font-oswald text-[18px] font-semibold tracking-[0.01em] transition-colors duration-200 ${activeSubtab === tab.key
                  ? 'bg-[#235796] text-white'
                  : 'text-white/58 hover:text-white/[0.88] hover:bg-white/[0.06]'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
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
