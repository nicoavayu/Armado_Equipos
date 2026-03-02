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

      <div className="w-full flex justify-center pb-7" style={{ paddingTop: `${secondaryTabsTop}px` }}>
        <div
          className="w-full transition-[transform,opacity] duration-200 ease-out will-change-transform"
          style={{
            transform: showSecondaryTabs
              ? 'translateX(0)'
              : `translateX(${secondaryTabsDirection === 'left' ? '-18px' : '18px'})`,
            opacity: showSecondaryTabs ? 1 : 0.01,
          }}
        >
          <div className="relative left-1/2 w-screen -translate-x-1/2">
            <div className="flex h-[44px] w-full overflow-hidden border-y border-[rgba(106,126,202,0.40)] bg-[rgba(17,26,59,0.96)]">
              {SUBTABS.map((tab, index) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveSubtab(tab.key)}
                  className={`relative flex-1 min-w-0 border px-0 py-0 font-bebas text-[0.95rem] tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${index > 0 ? 'border-l-0' : ''} ${activeSubtab === tab.key
                    ? 'z-[2] border-[rgba(132,112,255,0.64)] bg-[#31239f] text-white shadow-[inset_0_0_0_1px_rgba(160,142,255,0.26)]'
                    : 'z-[1] border-[rgba(106,126,202,0.40)] bg-[rgba(17,26,59,0.96)] text-white/65 hover:text-white/88 hover:bg-[rgba(26,37,83,0.98)]'
                    }`}
                >
                  {activeSubtab === tab.key ? (
                    <span className="pointer-events-none absolute left-0 top-0 h-[3px] w-full bg-[#644dff]" />
                  ) : null}
                  {tab.label}
                </button>
              ))}
            </div>
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
