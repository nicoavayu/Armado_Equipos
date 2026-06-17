import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageTitle from '../../components/PageTitle';
import { useAuth } from '../../components/AuthProvider';
import { useNotifications } from '../../context/NotificationContext';
import DesafiosTab from './views/DesafiosTab';
import MisEquiposTab from './views/MisEquiposTab';
import TeamRankingsView from './views/TeamRankingsView';
import { QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY } from './config';
import { listMyManageableTeams } from '../../services/db/teamChallenges';
import { useSmartBackNavigation } from '../../hooks/useSmartBackNavigation';

const SUBTABS = [
  { key: 'desafios', label: 'DESAFIOS' },
  { key: 'ranking', label: 'RANKING' },
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
  const [manageableTeams, setManageableTeams] = useState([]);

  useEffect(() => {
    sessionStorage.setItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY, activeSubtab);
  }, [activeSubtab]);

  useEffect(() => {
    if (!user?.id) {
      setManageableTeams([]);
      return;
    }
    let cancelled = false;
    listMyManageableTeams(user.id)
      .then((teams) => {
        if (!cancelled) setManageableTeams(teams || []);
      })
      .catch((error) => {
        // Non-blocking: the ranking/directory still render; only the own-team
        // guard and CTA prefill depend on this list.
        console.warn('[RANKING] No se pudieron cargar tus equipos manejables', error);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Used only to flag "Tu equipo" in the ranking/directory. Direct team-vs-team
  // challenges are not wired yet, so there is no "Publicar desafío" CTA here.
  const ownTeamIds = useMemo(
    () => new Set((manageableTeams || []).map((team) => String(team?.id)).filter(Boolean)),
    [manageableTeams],
  );

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

      <div className="w-full flex justify-center pb-4" style={{ paddingTop: `${secondaryTabsTop}px` }}>
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
            <div className="flex h-[44px] w-full max-w-[560px] mx-auto gap-1 p-1 overflow-hidden rounded-full border border-[rgba(148,134,255,0.22)] bg-[rgba(20,16,41,0.85)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_16px_rgba(5,3,16,0.35)]">
              {SUBTABS.map((tab, index) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveSubtab(tab.key)}
                  className={`relative flex-1 min-w-0 border px-0 py-0 font-bebas text-[0.95rem] uppercase tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${index > 0 ? 'border-l-0' : ''} ${activeSubtab === tab.key
                    ? 'z-[2] rounded-full border-transparent bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]'
                    : 'z-[1] rounded-full border-transparent bg-transparent text-white/60 hover:text-white/90 hover:bg-white/[0.06]'
                    }`}
                >
                  {activeSubtab === tab.key ? (
                    <span className="hidden" />
                  ) : null}
                  {tab.key === 'mis-equipos' ? (
                    <span className="inline-flex items-center justify-center gap-2.5">
                      <span>{tab.label}</span>
                      {(unreadCount?.teamInvites || 0) > 0 && (
                        <span className="inline-flex shrink-0 translate-y-[1px] items-center justify-center min-w-[18px] h-[18px] px-1 bg-[#ec007d] text-white text-[10px] font-bold rounded-full shadow-[0_0_10px_rgba(236,0,125,0.45)]">
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

        {activeSubtab === 'ranking' ? (
          <TeamRankingsView
            userId={user?.id}
            ownTeamIds={ownTeamIds}
            myTeams={manageableTeams}
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
