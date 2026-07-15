import logger from '../utils/logger';
import React, { useState } from 'react';
import { PencilLine } from 'lucide-react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import FormularioNuevoPartidoFlow from './FormularioNuevoPartidoFlow';
import PageTitle from '../components/PageTitle';
import WhatsAppMatchImportFlow from '../components/WhatsAppMatchImportFlow';
import WhatsappIcon from '../components/WhatsappIcon';

const PickerBackground = () => (
  <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(118,78,255,0.24),transparent_48%),radial-gradient(circle_at_8%_54%,rgba(73,43,171,0.16),transparent_32%),radial-gradient(circle_at_96%_82%,rgba(236,0,125,0.08),transparent_30%),linear-gradient(180deg,#0c091b_0%,#100b26_48%,#090715_100%)]" />
    <div className="absolute left-1/2 top-[31%] h-[340px] w-[720px] -translate-x-1/2 rounded-[50%] border border-[#7d5aff]/10 shadow-[0_0_100px_rgba(106,67,255,0.12)]" />
    <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.24)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.24)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_72%,transparent)]" />
  </div>
);

export const MethodTile = ({ icon, title, onClick, disabled = false, testId }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    data-testid={testId}
    aria-label={title}
    className={`group relative flex min-h-[184px] w-full min-w-0 flex-col items-center justify-center gap-4 overflow-hidden rounded-[24px] border p-4 text-center outline-none transition-[transform,border-color,box-shadow] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[#a98cff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0818] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-[204px] sm:gap-5 sm:p-5 ${disabled
      ? 'cursor-not-allowed border-white/10 bg-white/[0.02] opacity-45'
      : 'border-[rgba(151,126,255,0.38)] bg-[linear-gradient(160deg,rgba(38,29,80,0.78),rgba(13,10,31,0.96))] shadow-[0_16px_44px_rgba(5,2,22,0.38),inset_0_1px_0_rgba(255,255,255,0.055)] hover:-translate-y-1 hover:border-[rgba(177,157,255,0.64)] hover:shadow-[0_20px_48px_rgba(5,2,22,0.46),0_0_26px_rgba(106,67,255,0.2),inset_0_1px_0_rgba(255,255,255,0.075)] active:translate-y-[1px] active:scale-[0.985]'}`}
  >
    <span className="pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-[#a98cff]/60 to-transparent" />
    <span className={`relative flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[18px] border transition-transform duration-200 group-hover:scale-[1.035] group-active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none sm:h-16 sm:w-16 ${disabled
      ? 'border-white/10 bg-white/[0.03] text-white/40'
      : 'border-[#9b7bff]/40 bg-[#6a43ff]/17 text-white shadow-[0_10px_26px_rgba(81,45,196,0.3),0_0_18px_rgba(106,67,255,0.14)]'}`}
    >
      {React.cloneElement(icon, { size: 29, strokeWidth: 1.8 })}
    </span>
    <span className="relative flex min-h-[2.24em] max-h-[2.24em] max-w-full items-center justify-center overflow-hidden font-oswald text-[clamp(12px,3.6vw,17px)] font-bold uppercase leading-[1.12] tracking-[0.035em] text-white [overflow-wrap:normal] [word-break:keep-all]">
      {title}
    </span>
  </button>
);

export const NewMatchMethodPicker = ({ onManual, onWhatsApp, onBack }) => (
  // -mt cancels MainLayout's safe-top padding: this view owns the full offset
  // (fixed header + content padding), so the safe area is never counted twice.
  <div className="relative mt-[calc(var(--safe-top,0px)*-1)] min-h-[100dvh] overflow-hidden font-oswald text-white">
    <PickerBackground />

    <PageTitle respectSafeArea title="NUEVO PARTIDO" onBack={onBack}>NUEVO PARTIDO</PageTitle>

    <main className="relative z-10 mx-auto w-full max-w-[620px] px-4 pb-[max(34px,var(--safe-bottom,0px))] pt-[calc(var(--safe-top,0px)+96px)] sm:px-6">
      <div className="mb-7 text-center sm:mb-8">
        <h2 className="font-bebas-real text-[clamp(38px,11vw,54px)] leading-[0.9] tracking-[0.035em] text-white drop-shadow-[0_8px_26px_rgba(5,2,20,0.7)]">
          ¿CÓMO QUERÉS CREARLO?
        </h2>
      </div>

      <div
        data-testid="method-picker-grid"
        className="mx-auto grid w-full max-w-[500px] grid-cols-2 gap-3 sm:gap-4"
      >
        <MethodTile
          testId="method-tile-manual"
          icon={<PencilLine data-testid="manual-pencil-icon" />}
          title="CREAR PARTIDO MANUAL"
          onClick={onManual}
        />
        <MethodTile
          testId="method-tile-whatsapp"
          icon={<WhatsappIcon data-testid="whatsapp-icon" color="white" />}
          title="IMPORTAR DE WHATSAPP"
          onClick={onWhatsApp}
        />
      </div>
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
