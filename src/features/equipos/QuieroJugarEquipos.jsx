import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageTitle from '../../components/PageTitle';
import { useAuth } from '../../components/AuthProvider';
import { useNotifications } from '../../context/NotificationContext';
import DesafiosTab from './views/DesafiosTab';
import MisEquiposTab from './views/MisEquiposTab';
import { QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY } from './config';
import { useSmartBackNavigation } from '../../hooks/useSmartBackNavigation';

const SUBTABS = [
  { key: 'desafios', label: 'DESAFIOS' },
  { key: 'mis-equipos', label: 'MIS EQUIPOS' },
];

const normalizeEquiposSubtab = (value) => (
  SUBTABS.some((tab) => tab.key === value) ? value : null
);

const QuieroJugarEquipos = ({
  pageTitle = 'DESAFIOS',
  secondaryTabsTop = 80,
  secondaryTabsDirection = 'right',
  secondaryTabsTransitionKey = 'equipos',
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const notificationsCtx = useNotifications() || {};
  const unreadCount = notificationsCtx.unreadCount || { friends: 0, teamInvites: 0, matches: 0, total: 0 };
  const goBackSmart = useSmartBackNavigation({
    fallback: '/',
  });

  const [activeSubtab, setActiveSubtab] = useState(() => {
    const queryTab = normalizeEquiposSubtab(new URLSearchParams(location.search).get('tab'));
    if (queryTab) return queryTab;
    const stored = sessionStorage.getItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY);
    return SUBTABS.some((tab) => tab.key === stored) ? stored : 'desafios';
  });
  const [showSecondaryTabs, setShowSecondaryTabs] = useState(false);

  const [prefilledTeamId, setPrefilledTeamId] = useState(null);

  useEffect(() => {
    sessionStorage.setItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY, activeSubtab);
  }, [activeSubtab]);

  useEffect(() => {
    const queryTab = normalizeEquiposSubtab(new URLSearchParams(location.search).get('tab'));
    if (queryTab) {
      setActiveSubtab(queryTab);
    }
  }, [location.search]);

  useEffect(() => {
    const state = location.state || {};
    const nextSubtab = state.equiposSubtab;
    const nextPrefilledTeamId = state.prefilledTeamId;

    if (normalizeEquiposSubtab(nextSubtab)) {
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
      <PageTitle title={pageTitle} onBack={() => goBackSmart()}>{pageTitle}</PageTitle>

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
                  className={`relative flex-1 min-w-0 border px-0 py-0 font-bebas text-[0.95rem] uppercase tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${index > 0 ? 'border-l-0' : ''} ${activeSubtab === tab.key
                    ? 'z-[2] border-[rgba(132,112,255,0.64)] bg-[#31239f] text-white shadow-[inset_0_0_0_1px_rgba(160,142,255,0.26)]'
                    : 'z-[1] border-[rgba(106,126,202,0.40)] bg-[rgba(17,26,59,0.96)] text-white/65 hover:text-white/88 hover:bg-[rgba(26,37,83,0.98)]'
                    }`}
                >
                  {activeSubtab === tab.key ? (
                    <span className="pointer-events-none absolute left-0 top-0 h-[3px] w-full bg-[#644dff]" />
                  ) : null}
                  {tab.key === 'mis-equipos' ? (
                    <span className="inline-flex items-center justify-center gap-2.5">
                      <span>{tab.label}</span>
                      {(unreadCount?.teamInvites || 0) > 0 && (
                        <span className="inline-flex shrink-0 translate-y-[1px] items-center justify-center min-w-[18px] h-[18px] px-1 bg-[#128BE9] text-white text-[10px] font-bold rounded-[6px] border border-white/25 shadow-[0_6px_16px_rgba(18,139,233,0.35)]">
                          {unreadCount.teamInvites}
                        </span>
                      )}
                    </span>
                  ) : (
                    tab.label
                  )}
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
