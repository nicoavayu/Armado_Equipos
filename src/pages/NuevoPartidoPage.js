import logger from '../utils/logger';
import React, { useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  MessageCircle,
  PencilLine,
  Sparkles,
} from 'lucide-react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import FormularioNuevoPartidoFlow from './FormularioNuevoPartidoFlow';
import WhatsAppMatchImportFlow from '../components/WhatsAppMatchImportFlow';

const PickerBackground = () => (
  <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(118,78,255,0.24),transparent_48%),radial-gradient(circle_at_8%_54%,rgba(73,43,171,0.16),transparent_32%),radial-gradient(circle_at_96%_82%,rgba(236,0,125,0.08),transparent_30%),linear-gradient(180deg,#0c091b_0%,#100b26_48%,#090715_100%)]" />
    <div className="absolute left-1/2 top-[31%] h-[340px] w-[720px] -translate-x-1/2 rounded-[50%] border border-[#7d5aff]/10 shadow-[0_0_100px_rgba(106,67,255,0.12)]" />
    <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.24)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.24)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_72%,transparent)]" />
  </div>
);

const MethodCard = ({ icon, eyebrow, title, description, badge, onClick, featured = false }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group relative w-full overflow-hidden rounded-[24px] border p-4 text-left transition-all duration-200 active:scale-[0.985] ${featured
      ? 'border-[rgba(151,126,255,0.38)] bg-[radial-gradient(360px_150px_at_12%_-18%,rgba(139,92,255,0.25),transparent_72%),linear-gradient(155deg,rgba(48,37,103,0.88),rgba(16,12,38,0.96))] shadow-[0_22px_60px_rgba(5,2,22,0.45),0_0_0_1px_rgba(255,255,255,0.035),inset_0_1px_0_rgba(255,255,255,0.08)]'
      : 'border-[rgba(148,134,255,0.2)] bg-[linear-gradient(155deg,rgba(35,27,76,0.72),rgba(13,10,31,0.94))] shadow-[0_16px_44px_rgba(5,2,22,0.34),inset_0_1px_0_rgba(255,255,255,0.055)] hover:border-[rgba(151,126,255,0.4)]'}`}
  >
    <span className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-70" />
    <span className="relative flex items-center gap-4">
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${featured
        ? 'border-[#9b7bff]/35 bg-[#6a43ff]/20 text-[#c8baff] shadow-[0_10px_28px_rgba(81,45,196,0.3)]'
        : 'border-white/10 bg-white/[0.045] text-white/60'}`}
      >
        {React.cloneElement(icon, { size: 26, strokeWidth: 1.8 })}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-oswald text-[10px] font-semibold uppercase tracking-[0.19em] text-[#aa94ff]">
            {eyebrow}
          </span>
          {badge ? (
            <span className="rounded-full border border-[#9b7bff]/30 bg-[#6a43ff]/13 px-2 py-0.5 font-sans text-[9px] font-bold uppercase tracking-[0.1em] text-[#cfc4ff]">
              {badge}
            </span>
          ) : null}
        </span>
        <strong className="mt-1 block font-bebas-real text-[27px] leading-none tracking-[0.035em] text-white">
          {title}
        </strong>
        <span className="mt-2 block max-w-[390px] font-oswald text-[12.5px] leading-[1.35] text-white/52">
          {description}
        </span>
      </span>

      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/45 transition-all duration-200 group-hover:border-[#9b7bff]/35 group-hover:bg-[#6a43ff]/13 group-hover:text-[#c8baff] group-hover:translate-x-0.5">
        <ChevronRight size={18} strokeWidth={2} />
      </span>
    </span>
  </button>
);

const NewMatchMethodPicker = ({ onManual, onWhatsApp, onBack }) => (
  <div className="relative min-h-[100dvh] overflow-hidden font-oswald text-white">
    <PickerBackground />

    <header className="relative z-30 border-b border-[rgba(148,134,255,0.14)] bg-[#0d0a1f]/88 px-[max(16px,var(--safe-left,0px))] pb-2.5 pt-[max(10px,var(--safe-top,0px))] backdrop-blur-xl">
      <div className="relative mx-auto flex min-h-10 w-full max-w-[560px] items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.055] text-white transition-all hover:bg-white/10 active:scale-95"
          aria-label="Volver al inicio"
        >
          <ArrowLeft size={20} strokeWidth={2.2} />
        </button>
        <h1 className="absolute inset-x-12 m-0 text-center font-oswald text-[15px] font-semibold uppercase tracking-[0.14em] text-white/90">
          Nuevo partido
        </h1>
        <span className="h-10 w-10" aria-hidden="true" />
      </div>
    </header>

    <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-64px)] w-full max-w-[560px] flex-col justify-center px-4 pb-[max(34px,var(--safe-bottom,0px))] pt-8 sm:pt-10">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#9b7bff]/30 bg-[#6a43ff]/15 text-[#c8baff] shadow-[0_12px_35px_rgba(64,32,160,0.3)]">
          <Sparkles size={22} strokeWidth={1.8} />
        </div>
        <p className="font-oswald text-[10px] font-semibold uppercase tracking-[0.23em] text-[#a98cff]">
          Elegí el punto de partida
        </p>
        <h2 className="mt-1 font-bebas-real text-[clamp(38px,11vw,54px)] leading-[0.9] tracking-[0.035em] text-white drop-shadow-[0_8px_26px_rgba(5,2,20,0.7)]">
          ¿CÓMO QUERÉS CREARLO?
        </h2>
        <p className="mx-auto mt-3 max-w-[420px] font-oswald text-[13px] leading-relaxed text-white/52">
          Usá el flujo habitual o convertí los mensajes del grupo en un borrador editable.
        </p>
      </div>

      <div className="space-y-3">
        <MethodCard
          featured
          icon={<MessageCircle />}
          eyebrow="Asistente de creación"
          title="IMPORTAR DESDE WHATSAPP"
          description="Pegá la conversación. Arma2 detecta los datos principales y te deja revisar todo antes de crear."
          badge="Nuevo"
          onClick={onWhatsApp}
        />
        <MethodCard
          icon={<PencilLine />}
          eyebrow="Flujo clásico"
          title="CREAR MANUALMENTE"
          description="Completá nombre, modalidad, fecha, lugar y cupo con el recorrido paso a paso."
          onClick={onManual}
        />
      </div>

      <p className="mt-5 text-center font-sans text-[10.5px] leading-relaxed text-white/32">
        Nada se crea ni se modifica sin tu confirmación.
      </p>
    </main>
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
