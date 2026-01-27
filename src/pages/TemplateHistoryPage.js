import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import { supabase, crearPartidoDesdeFrec } from '../supabase';

const TemplateHistoryPage = () => {
  const { templateId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(location.state?.template || null);
  const [instances, setInstances] = useState([]);
  const [creating, setCreating] = useState(false);

  // Fetch template if not provided
  useEffect(() => {
    if (template || !templateId) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('partidos_frecuentes')
        .select('*')
        .eq('id', templateId)
        .single();
      if (!alive) return;
      if (!error && data) setTemplate(data);
    })();
    return () => { alive = false; };
  }, [template, templateId]);

  // Fetch past instances linked to this template
  useEffect(() => {
    if (!templateId) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('partidos')
        .select('id, fecha, hora, estado, frequent_match_name, from_frequent_match_id')
        .eq('from_frequent_match_id', templateId)
        .order('fecha', { ascending: false });
      if (!alive) return;
      if (error) {
        console.warn('[TemplateHistory] no instances', error);
        setInstances([]);
        return;
      }
      setInstances(data || []);
    })();
    return () => { alive = false; };
  }, [templateId]);

  const handlePlayTemplate = async () => {
    if (!template) {
      console.warn('[TemplateHistory] no template to create match');
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const match = await crearPartidoDesdeFrec(template, today);
      if (match?.id) {
        navigate(`/admin/${match.id}`);
      }
    } catch (err) {
      console.warn('[TemplateHistory] JUGAR ESTE PARTIDO fallback/TODO', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-full max-w-[600px] mx-auto flex flex-col items-center pt-24 pb-32 px-4 box-border">
      <PageTitle title="HISTORIAL" onBack={() => navigate(-1)}>HISTORIAL</PageTitle>

      <div className="w-full mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="font-bebas text-[26px] leading-6 text-white uppercase tracking-wide drop-shadow-sm mb-1">
          {template?.nombre || `Template ${templateId}`}
        </div>
        <div className="text-white/70 text-sm font-oswald mb-6 uppercase tracking-wide">Historial del partido</div>

        {instances.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-3 py-10 border border-dashed border-white/10 rounded-xl bg-slate-900/40">
            <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/70">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="26" height="26" fill="currentColor">
                <path d="M152 64c0-17.7 14.3-32 32-32h80c17.7 0 32 14.3 32 32v32h40c26.5 0 48 21.5 48 48v16H64v-16c0-26.5 21.5-48 48-48h40V64zM64 208h320v192c0 26.5-21.5 48-48 48H112c-26.5 0-48-21.5-48-48V208zm192 48c0-8.8-7.2-16-16-16s-16 7.2-16 16v64H160c-8.8 0-16 7.2-16 16s7.2 16 16 16h64v64c0 8.8 7.2 16 16 16s16-7.2 16-16V352h64c8.8 0 16-7.2 16-16s-7.2-16-16-16H256V256z" />
              </svg>
            </div>
            <div className="font-bebas text-xl text-white leading-6">Este partido todavía no se jugó</div>
            <div className="text-white/70 text-sm max-w-[360px] leading-relaxed">
              Cuando juegues este partido, acá vas a ver el historial de fechas, jugadores y resultados.
            </div>
            <button
              className="mt-2 font-bebas text-base px-4 py-2.5 border-2 border-transparent rounded-xl cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-primary shadow-lg hover:brightness-110 hover:-translate-y-px"
              onClick={handlePlayTemplate}
              disabled={creating}
            >
              {creating ? 'CREANDO…' : 'JUGAR ESTE PARTIDO'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {instances.map((inst) => (
              <div key={inst.id} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-white flex flex-col gap-1">
                <div className="font-bebas text-lg leading-5">{inst.fecha} • {inst.hora || '—'}</div>
                <div className="text-xs text-white/70 uppercase">Estado: {inst.estado || 'desconocido'}</div>
                <div className="text-xs text-white/50">ID partido: {inst.id}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TemplateHistoryPage;
