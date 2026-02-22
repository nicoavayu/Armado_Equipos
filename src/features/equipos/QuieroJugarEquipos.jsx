import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import PageTitle from '../../components/PageTitle';
import { useAuth } from '../../components/AuthProvider';
import { QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY } from './config';
import DesafiosTab from './views/DesafiosTab';
import MisEquiposTab from './views/MisEquiposTab';
import MisDesafiosTab from './views/MisDesafiosTab';

const SUBTABS = [
  { key: 'desafios', label: 'Desafios' },
  { key: 'mis-equipos', label: 'Mis equipos' },
  { key: 'mis-desafios', label: 'Mis desafios' },
];

const QuieroJugarEquipos = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activeSubtab, setActiveSubtab] = useState(() => {
    const stored = sessionStorage.getItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY);
    return SUBTABS.some((tab) => tab.key === stored) ? stored : 'desafios';
  });

  const [prefilledTeamId, setPrefilledTeamId] = useState(null);

  useEffect(() => {
    sessionStorage.setItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY, activeSubtab);
  }, [activeSubtab]);

  return (
    <>
      <PageTitle title="QUIERO JUGAR" onBack={() => navigate(-1)}>QUIERO JUGAR</PageTitle>

      <div className="w-full flex justify-center pt-[85px] pb-4 px-4">
        <div className="w-full max-w-[560px] rounded-2xl border border-white/15 bg-white/5 px-4 py-3 flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-[#128BE9]/20 border border-[#128BE9]/40 flex items-center justify-center">
            <Trophy size={18} className="text-[#9ED3FF]" />
          </div>
          <div>
            <p className="font-oswald text-[10px] uppercase tracking-widest text-white/65">Equipos & Desafios</p>
            <p className="font-oswald text-sm text-white">Mercado entre equipos armados</p>
          </div>
        </div>
      </div>

      <div className="w-full flex justify-center px-4 pb-5">
        <div className="w-full max-w-[560px] rounded-xl border border-white/10 bg-white/5 p-1 grid grid-cols-3 gap-1">
          {SUBTABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveSubtab(tab.key)}
              className={`min-w-0 rounded-lg px-1 py-2 text-xs font-oswald font-bold normal-case tracking-normal transition-all ${activeSubtab === tab.key
                ? 'bg-white/15 border border-white/25 text-white'
                : 'bg-transparent border border-transparent text-white/60'
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
          <MisEquiposTab
            userId={user?.id}
            onOpenDesafiosWithTeam={(teamId) => {
              setPrefilledTeamId(teamId);
              setActiveSubtab('desafios');
            }}
          />
        ) : null}

        {activeSubtab === 'mis-desafios' ? (
          <MisDesafiosTab userId={user?.id} />
        ) : null}
      </div>
    </>
  );
};

export default QuieroJugarEquipos;
