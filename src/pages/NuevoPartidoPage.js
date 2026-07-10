import logger from '../utils/logger';
import React, { useState } from 'react';
import { MessageCircle, PencilLine } from 'lucide-react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import FormularioNuevoPartidoFlow from './FormularioNuevoPartidoFlow';
import WhatsAppMatchImportFlow from '../components/WhatsAppMatchImportFlow';

const NewMatchMethodPicker = ({ onManual, onWhatsApp, onBack }) => (
  <div className="min-h-[100dvh] bg-[#0b0818] px-4 pb-10 pt-[max(90px,var(--safe-top,0px))] font-oswald">
    <div className="mx-auto w-full max-w-[560px]">
      <button type="button" onClick={onBack} className="mb-5 min-h-10 rounded-full border border-white/10 bg-white/[.05] px-4 text-sm text-white/70">Volver</button>
      <p className="text-center text-[10px] font-bold uppercase tracking-[.22em] text-[#a98cff]">Nuevo partido</p>
      <h1 className="mt-1 text-center font-bebas-real text-[clamp(38px,11vw,54px)] leading-none text-white">¿CÓMO QUERÉS CREARLO?</h1>
      <p className="mx-auto mt-3 max-w-[430px] text-center text-sm leading-relaxed text-white/55">Podés completar los datos como siempre o pegar la conversación del grupo para que Arma2 prepare el borrador.</p>

      <div className="mt-7 grid gap-3">
        <button type="button" onClick={onWhatsApp} className="flex min-h-[108px] items-center gap-4 rounded-card border border-[#25D366]/30 bg-[linear-gradient(145deg,rgba(37,211,102,.16),rgba(17,45,31,.35))] p-4 text-left text-white shadow-elev-2">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#25D366]/18 text-[#7bf0a8]"><MessageCircle size={28} /></span>
          <span><strong className="block font-bebas-real text-2xl tracking-wide">IMPORTAR DESDE WHATSAPP</strong><span className="mt-1 block text-sm leading-snug text-white/58">Pegá mensajes; detectamos fecha, hora, cancha, formato, precio y jugadores.</span></span>
        </button>
        <button type="button" onClick={onManual} className="flex min-h-[94px] items-center gap-4 rounded-card border border-[#8b7cff]/25 bg-[linear-gradient(145deg,rgba(67,48,143,.5),rgba(13,10,31,.9))] p-4 text-left text-white shadow-elev-2">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#6a43ff]/20 text-[#c1b1ff]"><PencilLine size={26} /></span>
          <span><strong className="block font-bebas-real text-2xl tracking-wide">CREAR MANUALMENTE</strong><span className="mt-1 block text-sm text-white/58">Usar el flujo habitual paso a paso.</span></span>
        </button>
      </div>
    </div>
  </div>
);

const NuevoPartidoPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  const [method, setMethod] = useState(null);

  const handleCreated = async (partido) => {
    logger.log('Match created:', partido.id);
    navigateWithAnimation(`/admin/${partido.id}`);
    return partido;
  };

  if (method === 'whatsapp') {
    return (
      <WhatsAppMatchImportFlow
        onCreated={handleCreated}
        onBack={() => setMethod(null)}
      />
    );
  }

  if (method === 'manual') {
    return (
      <FormularioNuevoPartidoFlow
        onConfirmar={handleCreated}
        onVolver={() => setMethod(null)}
      />
    );
  }

  return (
    <NewMatchMethodPicker
      onManual={() => setMethod('manual')}
      onWhatsApp={() => setMethod('whatsapp')}
      onBack={() => navigateWithAnimation('/', 'back')}
    />
  );
};

export default NuevoPartidoPage;
