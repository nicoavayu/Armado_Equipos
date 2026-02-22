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
        style={{ top: '106px' }}
      >
        <div className="w-full max-w-[560px] mx-auto rounded-xl border border-white/15 bg-[linear-gradient(135deg,rgba(55,63,109,0.58),rgba(40,50,95,0.54))] backdrop-blur-xl p-1.5 grid grid-cols-2 gap-1.5">
          {TOP_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTopTab(tab.key)}
              className={`rounded-lg py-2.5 text-[18px] font-oswald font-semibold normal-case tracking-[0.01em] transition-all ${activeTopTab === tab.key
                ? 'border border-[#A5B8FF]/45 bg-[linear-gradient(135deg,rgba(136,123,238,0.62),rgba(113,108,217,0.58))] text-white shadow-[0_8px_22px_rgba(121,111,231,0.32)]'
                : 'bg-transparent border border-transparent text-white/60 hover:text-white/80'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-[76px]">
        {activeTopTab === 'individual' ? <QuieroJugarLegacy /> : <QuieroJugarEquipos />}
      </div>
    </>
  );
};

export default QuieroJugarHub;
