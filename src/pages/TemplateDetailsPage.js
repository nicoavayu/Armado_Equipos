import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import { supabase } from '../supabase';

const formatearSede = (sede = '') => {
  if (sede === 'La Terraza Fútbol 5, 8') return 'La Terraza Fútbol 5 y 8';
  return sede;
};

const formatPrice = (precioRaw) => {
  if (precioRaw === undefined || precioRaw === null || String(precioRaw).trim() === '') return 'Sin precio';
  const parsed = Number(String(precioRaw).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'));
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 'Sin precio';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(parsed);
};

const TemplateDetailsPage = () => {
  const { templateId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(location.state?.template || null);

  useEffect(() => {
    if (template || !templateId) return;
    let isMounted = true;
    (async () => {
      const { data, error } = await supabase
        .from('partidos_frecuentes')
        .select('*')
        .eq('id', templateId)
        .single();
      if (!isMounted) return;
      if (error) {
        console.warn('[TemplateDetails] No se pudo cargar plantilla', error);
        return;
      }
      setTemplate(data);
    })();
    return () => { isMounted = false; };
  }, [templateId, template]);

  const modalidad = template?.modalidad || 'F5';
  const tipo = template?.tipo_partido || 'Masculino';
  const priceLabel = formatPrice(template?.precio_cancha_por_persona ?? template?.precio ?? template?.valor_cancha);
  const jugadoresCount = template?.jugadores?.[0]?.count || template?.jugadores_count || 0;
  const cupoMaximo = template?.cupo_jugadores || 20;
  const isComplete = jugadoresCount >= cupoMaximo;

  return (
    <div className="w-full max-w-[600px] mx-auto flex flex-col items-center pt-24 pb-32 px-4 box-border">
      <PageTitle title="PLANTILLA" onBack={() => navigate(-1)}>PLANTILLA</PageTitle>

      <div className="w-full mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="font-bebas text-[26px] leading-6 text-white uppercase tracking-wide drop-shadow-sm">
              {template?.nombre || 'Plantilla'}
            </div>
            <div className="text-white/80 text-sm font-oswald mt-[4px] uppercase">
              {template?.hora || 'Sin horario'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="font-oswald text-[11px] font-semibold text-white px-2.5 py-1.5 rounded-lg bg-slate-700 border-2 border-[#4CAF50] whitespace-nowrap">
            {modalidad}
          </div>
          <div className="font-oswald text-[11px] font-semibold text-white px-2.5 py-1.5 rounded-lg bg-slate-700 border-2 border-[#2196F3] whitespace-nowrap">
            {tipo}
          </div>
          <div className="font-oswald text-[11px] font-semibold text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 whitespace-nowrap">
            {priceLabel}
          </div>
          <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap ${
            isComplete
              ? 'bg-[#165a2e] text-[#22c55e] border border-[#22c55e]'
              : 'bg-slate-900 text-slate-300 border border-slate-700'
          }`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor">
              <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z" />
            </svg>
            {jugadoresCount}/{cupoMaximo} jugadores
          </div>
        </div>

        <div className="font-oswald text-sm font-medium text-white/90 flex items-center gap-2 mb-6 overflow-hidden text-ellipsis">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="16" height="16" fill="rgba(255, 255, 255, 0.9)">
            <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
          </svg>
          <span className="truncate">{formatearSede(template?.sede || template?.lugar || 'Sin ubicación')}</span>
        </div>

        <button
          className="w-full font-bebas text-base px-4 py-2.5 border-2 border-transparent rounded-xl cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-primary shadow-lg hover:brightness-110 hover:-translate-y-px"
          onClick={() => console.log('[TEMPLATE DETAILS] JUGAR placeholder', templateId)}
        >
          JUGAR
        </button>
      </div>
    </div>
  );
};

export default TemplateDetailsPage;
