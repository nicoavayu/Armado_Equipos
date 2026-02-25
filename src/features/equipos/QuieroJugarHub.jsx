import React, { useEffect, useState } from 'react';
import QuieroJugarLegacy from '../../pages/QuieroJugar';
import QuieroJugarEquipos from './QuieroJugarEquipos';
import { FEATURE_EQUIPOS_ENABLED, QUIERO_JUGAR_TOP_TAB_STORAGE_KEY } from './config';

const TOP_TABS = [
  { key: 'individual', label: 'Individual' },
  { key: 'equipos', label: 'Equipos' },
];
const PRIMARY_TABS_TOP_OFFSET_PX = 92;
const SECONDARY_TABS_TOP_OFFSET_PX = 176;

const QuieroJugarHub = () => {
  const [activeTopTab, setActiveTopTab] = useState(() => {
    const stored = sessionStorage.getItem(QUIERO_JUGAR_TOP_TAB_STORAGE_KEY);
    return TOP_TABS.some((tab) => tab.key === stored) ? stored : 'individual';
  });
  const [secondaryTabsDirection, setSecondaryTabsDirection] = useState('right');

  useEffect(() => {
    sessionStorage.setItem(QUIERO_JUGAR_TOP_TAB_STORAGE_KEY, activeTopTab);
  }, [activeTopTab]);

  const handleTopTabChange = (nextTabKey) => {
    if (nextTabKey === activeTopTab) return;

    const currentIndex = TOP_TABS.findIndex((tab) => tab.key === activeTopTab);
    const nextIndex = TOP_TABS.findIndex((tab) => tab.key === nextTabKey);
    setSecondaryTabsDirection(nextIndex >= currentIndex ? 'right' : 'left');
    setActiveTopTab(nextTabKey);
  };

  if (!FEATURE_EQUIPOS_ENABLED) {
    return <QuieroJugarLegacy secondaryTabsDirection={secondaryTabsDirection} secondaryTabsTransitionKey="individual" />;
  }

  return (
    <>
      <div
        className="fixed left-0 right-0 z-[950] px-4"
        style={{ top: `${PRIMARY_TABS_TOP_OFFSET_PX}px` }}
      >
        <div className="w-full max-w-[500px] mx-auto rounded-[18px] border border-white/15 bg-[linear-gradient(140deg,rgba(34,46,98,0.8),rgba(28,37,84,0.74))] p-1.5 shadow-[0_8px_22px_rgba(5,12,34,0.34)]">
          <div className="flex gap-1.5">
            {TOP_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTopTabChange(tab.key)}
                className={`flex-1 h-12 rounded-[13px] font-oswald text-[20px] font-semibold tracking-[0.01em] !normal-case transition-all duration-200 ${activeTopTab === tab.key
                  ? 'bg-[#7e76de] text-white shadow-[0_6px_16px_rgba(126,118,222,0.42)]'
                  : 'bg-transparent text-white/58 hover:text-white/90 hover:bg-white/[0.08]'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTopTab === 'individual'
        ? (
          <QuieroJugarLegacy
            secondaryTabsTop={SECONDARY_TABS_TOP_OFFSET_PX}
            secondaryTabsDirection={secondaryTabsDirection}
            secondaryTabsTransitionKey={activeTopTab}
          />
        )
        : (
          <QuieroJugarEquipos
            secondaryTabsTop={SECONDARY_TABS_TOP_OFFSET_PX}
            secondaryTabsDirection={secondaryTabsDirection}
            secondaryTabsTransitionKey={activeTopTab}
          />
        )}
    </>
  );
};

export default QuieroJugarHub;
