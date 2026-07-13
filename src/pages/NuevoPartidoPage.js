import logger from '../utils/logger';
import React, { useState } from 'react';
import {
  ClipboardList,
  PencilLine,
} from 'lucide-react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import FormularioNuevoPartidoFlow from './FormularioNuevoPartidoFlow';
import PageTitle from '../components/PageTitle';
import WhatsAppMatchImportFlow from '../components/WhatsAppMatchImportFlow';

const PickerBackground = () => (
  <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(118,78,255,0.24),transparent_48%),radial-gradient(circle_at_8%_54%,rgba(73,43,171,0.16),transparent_32%),radial-gradient(circle_at_96%_82%,rgba(236,0,125,0.08),transparent_30%),linear-gradient(180deg,#0c091b_0%,#100b26_48%,#090715_100%)]" />
    <div className="absolute left-1/2 top-[31%] h-[340px] w-[720px] -translate-x-1/2 rounded-[50%] border border-[#7d5aff]/10 shadow-[0_0_100px_rgba(106,67,255,0.12)]" />
    <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.24)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.24)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_72%,transparent)]" />
  </div>
);

// Compact, equal-size square button. The whole surface is the pressable target
// (single <button>), it carries only an icon + a title (max two lines, height
// reserved so both tiles align identically) and it honours reduced-motion by
// dropping the transition/press-scale.
export const MethodTile = ({ icon, title, onClick, disabled = false, testId }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    data-testid={testId}
    aria-label={title}
    className={`group relative flex aspect-square w-full min-w-0 flex-col items-center justify-center gap-3 overflow-hidden rounded-[22px] border p-3 text-center transition-[transform,border-color,background-color] duration-200 motion-reduce:transition-none ${disabled
      ? 'cursor-not-allowed border-white/10 bg-white/[0.02] opacity-45'
      : 'border-[rgba(148,134,255,0.24)] bg-[linear-gradient(160deg,rgba(35,27,76,0.72),rgba(13,10,31,0.94))] shadow-[0_16px_44px_rgba(5,2,22,0.34),inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-[rgba(151,126,255,0.42)] active:scale-[0.97] active:border-[#9b7bff] active:bg-[linear-gradient(160deg,rgba(60,44,132,0.86),rgba(24,17,52,0.96))] motion-reduce:active:scale-100'}`}
  >
    <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-70" />
    <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${disabled
      ? 'border-white/10 bg-white/[0.03] text-white/40'
      : 'border-[#9b7bff]/30 bg-[#6a43ff]/16 text-[#c8baff] shadow-[0_10px_28px_rgba(81,45,196,0.28)] group-active:bg-[#6a43ff]/26'}`}
    >
      {React.cloneElement(icon, { size: 27, strokeWidth: 1.8 })}
    </span>
    <span className="flex min-h-[2.4em] items-center justify-center px-1 font-oswald text-[15px] font-bold uppercase leading-[1.16] tracking-[0.045em] text-white [text-wrap:balance]">
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

    <main className="relative z-10 mx-auto w-full max-w-[560px] px-4 pb-[max(34px,var(--safe-bottom,0px))] pt-[calc(var(--safe-top,0px)+96px)]">
      <div className="mb-6 text-center">
        <h2 className="font-bebas-real text-[clamp(38px,11vw,54px)] leading-[0.9] tracking-[0.035em] text-white drop-shadow-[0_8px_26px_rgba(5,2,20,0.7)]">
          ¿CÓMO QUERÉS CREARLO?
        </h2>
      </div>

      {/* Two equal squares, side by side. Stays 2-up on every phone width
          (no single-column breakpoint); the grid caps its own width so the
          tiles never grow past a comfortable size on tablets. */}
      <div
        data-testid="method-picker-grid"
        className="mx-auto grid max-w-[440px] grid-cols-2 gap-3"
      >
        <MethodTile
          testId="method-tile-manual"
          icon={<PencilLine />}
          title="Crear manual"
          onClick={onManual}
        />
        <MethodTile
          testId="method-tile-whatsapp"
          icon={<ClipboardList />}
          title="Importar WhatsApp"
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
