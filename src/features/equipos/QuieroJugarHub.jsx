import React, { useEffect, useState } from 'react';
import QuieroJugarLegacy from '../../pages/QuieroJugar';
import QuieroJugarEquipos from './QuieroJugarEquipos';
import { FEATURE_EQUIPOS_ENABLED, QUIERO_JUGAR_TOP_TAB_STORAGE_KEY } from './config';

const TOP_TABS = [
  { key: 'individual', label: 'Individual' },
  { key: 'equipos', label: 'Equipos' },
];
const PRIMARY_TABS_TOP_OFFSET_PX = 92;
const SECONDARY_TABS_TOP_OFFSET_PX = 164;

const QuieroJugarHub = () => {
  const [activeTopTab, setActiveTopTab] = useState(() => {
    const stored = sessionStorage.getItem(QUIERO_JUGAR_TOP_TAB_STORAGE_KEY);
    return TOP_TABS.some((tab) => tab.key === stored) ? stored : 'individual';
  });

  useEffect(() => {
    sessionStorage.setItem(QUIERO_JUGAR_TOP_TAB_STORAGE_KEY, activeTopTab);
  }, [activeTopTab]);

  if (!FEATURE_EQUIPOS_ENABLED) {
    return <QuieroJugarLegacy />;
  }

  return (
    <>
      <div
        className="fixed left-0 right-0 z-[950] px-4"
        style={{ top: `${PRIMARY_TABS_TOP_OFFSET_PX}px` }}
      >
        <div className="w-full max-w-[500px] mx-auto bg-white/5 border border-white/10 rounded-xl p-1 flex gap-1">
          {TOP_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTopTab(tab.key)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold tracking-wider uppercase transition-all ${activeTopTab === tab.key
                ? 'bg-primary text-white shadow-lg'
                : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTopTab === 'individual'
        ? <QuieroJugarLegacy secondaryTabsTop={SECONDARY_TABS_TOP_OFFSET_PX} />
        : <QuieroJugarEquipos secondaryTabsTop={SECONDARY_TABS_TOP_OFFSET_PX} />}
    </>
  );
};

export default QuieroJugarHub;
