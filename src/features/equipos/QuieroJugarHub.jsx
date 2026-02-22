import React, { useEffect, useState } from 'react';
import QuieroJugarLegacy from '../../pages/QuieroJugar';
import QuieroJugarEquipos from './QuieroJugarEquipos';
import { FEATURE_EQUIPOS_ENABLED, QUIERO_JUGAR_TOP_TAB_STORAGE_KEY } from './config';

const TOP_TABS = [
  { key: 'individual', label: 'Individual' },
  { key: 'equipos', label: 'Equipos' },
];

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
        style={{ top: '86px' }}
      >
        <div className="w-full max-w-[560px] mx-auto rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl p-1 grid grid-cols-2 gap-1">
          {TOP_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTopTab(tab.key)}
              className={`rounded-lg py-2 text-xs font-oswald font-bold normal-case tracking-normal transition-all ${activeTopTab === tab.key
                ? 'bg-white/15 border border-white/25 text-white'
                : 'bg-transparent border border-transparent text-white/60'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-[50px]">
        {activeTopTab === 'individual' ? <QuieroJugarLegacy /> : <QuieroJugarEquipos />}
      </div>
    </>
  );
};

export default QuieroJugarHub;
