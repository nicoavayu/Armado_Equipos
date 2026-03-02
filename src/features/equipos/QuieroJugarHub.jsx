import React, { useEffect, useState } from 'react';
import QuieroJugarLegacy from '../../pages/QuieroJugar';
import QuieroJugarEquipos from './QuieroJugarEquipos';
import { FEATURE_EQUIPOS_ENABLED, QUIERO_JUGAR_TOP_TAB_STORAGE_KEY } from './config';

const TOP_TABS = [
  { key: 'individual', label: 'Individual' },
  { key: 'equipos', label: 'Equipos' },
];
const PRIMARY_TABS_TOP_OFFSET_PX = 80;
const PRIMARY_TABS_HEIGHT_PX = 44;
const SECONDARY_TABS_TOP_OFFSET_PX = PRIMARY_TABS_TOP_OFFSET_PX + PRIMARY_TABS_HEIGHT_PX + 12;

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
        className="fixed left-0 right-0 z-[950]"
        style={{ top: `${PRIMARY_TABS_TOP_OFFSET_PX}px` }}
      >
        <div
          className="relative w-screen"
          style={{
            marginLeft: 'calc(50% - 50vw)',
            marginRight: 'calc(50% - 50vw)',
          }}
        >
          <div className="flex h-[44px] w-full overflow-hidden border-y border-[rgba(106,126,202,0.40)] bg-[rgba(17,26,59,0.96)]">
            {TOP_TABS.map((tab, index) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTopTabChange(tab.key)}
                className={`relative flex-1 min-w-0 border px-0 py-0 font-bebas text-[0.95rem] tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${index > 0 ? 'border-l-0' : ''} ${activeTopTab === tab.key
                  ? 'z-[2] border-[rgba(132,112,255,0.64)] bg-[#31239f] text-white shadow-[inset_0_0_0_1px_rgba(160,142,255,0.26)]'
                  : 'z-[1] border-[rgba(106,126,202,0.40)] bg-[rgba(17,26,59,0.96)] text-white/65 hover:text-white/88 hover:bg-[rgba(26,37,83,0.98)]'
                  }`}
              >
                {activeTopTab === tab.key ? (
                  <span className="pointer-events-none absolute left-0 top-0 h-[3px] w-full bg-[#644dff]" />
                ) : null}
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
