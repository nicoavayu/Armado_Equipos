import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  CalendarDays,
  Check,
  Clock3,
  Link2,
  MapPin,
  MessageCircle,
  Phone,
  Radar,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Users,
} from 'lucide-react';

const ART_LABELS = {
  profile: 'Ficha de perfil de jugador con nombre, posiciones y nivel',
  profile_contact: 'Ficha de perfil resaltando teléfono de contacto y dos posiciones',
  responsibility: 'Puntaje de responsabilidad con el número cinco destacado',
  intro: 'Fichas de jugadores formando un equipo alrededor de una pelota',
  create: 'Card de partido con fecha, horario y ubicación',
  whatsapp: 'Enlace de un partido que incorpora fichas de jugadores',
  evaluate: 'Jugadores aportando señales a una evaluación grupal',
  teams: 'Fichas reorganizadas en dos equipos equilibrados',
  history: 'Lista cronológica de partidos anteriores sin marcadores',
  availability: 'Calendario con días y horarios disponibles',
  preferences: 'Formato, distancia y ubicación combinados para buscar',
  matching: 'Disponibilidad y preferencias convergiendo en una oportunidad',
  confirm: 'Oportunidad de partido lista para confirmar',
  explore_matches: 'Card de un partido disponible en la pestaña Jugar',
  explore_players: 'Fichas de jugadores disponibles en la pestaña Jugar',
  organizer_closing: 'Dos equipos formados en una cancha con la pelota lista para empezar',
  auto_closing: 'Disponibilidad conectada con un grupo completo listo para jugar',
  explore_closing: 'Vista de Jugar conectando partidos y jugadores disponibles',
  challenges: 'Cartelera de desafíos entre dos equipos ficticios',
  stats: 'Resumen anual con módulos de jugados, ganados, empatados y lesiones',
  completion: 'Formación completa y primeros pasos confirmados',
};

const TOKEN_STYLES = {
  violet: 'border-[#9d86ff]/70 bg-[#6a43ff] text-white shadow-[0_5px_16px_rgba(106,67,255,0.4)]',
  magenta: 'border-[#ff78b9]/65 bg-[#c71d78] text-white shadow-[0_5px_16px_rgba(199,29,120,0.35)]',
  teal: 'border-[#71e0ce]/60 bg-[#167a6b] text-white shadow-[0_5px_16px_rgba(22,122,107,0.35)]',
  amber: 'border-[#ffe09a]/60 bg-[#9b6816] text-white shadow-[0_5px_16px_rgba(155,104,22,0.35)]',
};

const enter = (reduce, { delay = 0, x = 0, y = 12, scale = 1 } = {}) => ({
  initial: reduce ? false : { opacity: 0, x, y, scale },
  animate: { opacity: 1, x: 0, y: 0, scale: 1 },
  transition: { duration: reduce ? 0 : 0.38, delay: reduce ? 0 : delay, ease: [0.16, 1, 0.3, 1] },
});

function ArtStage({ name, children, bare = false }) {
  return (
    <div
      role="img"
      aria-label={ART_LABELS[name] || 'Visual del onboarding de Arma2'}
      data-onboarding-art={name}
      data-onboarding-art-safe-area="true"
      className="relative h-[clamp(138px,26dvh,176px)] w-full overflow-visible"
    >
      {!bare && (
        <div aria-hidden className="absolute inset-0 overflow-hidden rounded-[24px] border border-white/10 bg-[radial-gradient(220px_120px_at_50%_-15%,rgba(139,92,255,0.2),transparent_68%),linear-gradient(165deg,rgba(34,27,72,0.88),rgba(13,10,31,0.96))] shadow-[0_18px_38px_rgba(5,3,16,0.34),inset_0_1px_0_rgba(255,255,255,0.055)]">
          <div className="absolute inset-[12px] rounded-[18px] border border-white/[0.055]">
            <span className="absolute inset-y-0 left-1/2 w-px bg-white/[0.045]" />
            <span className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.05]" />
          </div>
        </div>
      )}
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}

function PlayerToken({ number, tone = 'violet', className = '', ...motionProps }) {
  return (
    <motion.span
      {...motionProps}
      className={`absolute inline-flex h-9 w-9 items-center justify-center rounded-full border-2 font-bebas-real text-[16px] leading-none ${TOKEN_STYLES[tone]} ${className}`}
    >
      {number}
    </motion.span>
  );
}

function Ball({ className = '' }) {
  return (
    <span className={`inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/80 bg-white text-[#17112f] shadow-[0_8px_24px_rgba(255,255,255,0.18)] ${className}`}>
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6.4l3.5 2.5-1.3 4.2H9.8L8.5 8.9 12 6.4zM12 6.4V3.1M15.5 8.9L19 7.8M14.2 13.1l2.7 3.4M9.8 13.1l-2.7 3.4M8.5 8.9L5 7.8" />
      </svg>
    </span>
  );
}

function IntroArt({ reduce }) {
  const tokens = [
    { number: 7, tone: 'violet', className: 'left-[18%] top-[28%]', x: 58, y: 24 },
    { number: 4, tone: 'teal', className: 'right-[18%] top-[25%]', x: -58, y: 26 },
    { number: 10, tone: 'magenta', className: 'left-[26%] bottom-[20%]', x: 46, y: -32 },
    { number: 5, tone: 'amber', className: 'right-[26%] bottom-[18%]', x: -46, y: -34 },
  ];
  return (
    <ArtStage name="intro" bare>
      <div aria-hidden className="absolute inset-x-[7%] inset-y-1 overflow-hidden border-y border-white/[0.055]">
        <span className="absolute inset-y-0 left-1/2 w-px bg-white/[0.055]" />
        <span className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.055]" />
      </div>
      <motion.div {...enter(reduce, { delay: 0.04, scale: 0.7 })} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Ball />
      </motion.div>
      {tokens.map((token, index) => (
        <PlayerToken
          key={token.number}
          number={token.number}
          tone={token.tone}
          className={token.className}
          {...enter(reduce, { delay: 0.11 + index * 0.07, x: token.x, y: token.y, scale: 0.75 })}
        />
      ))}
    </ArtStage>
  );
}

function MatchCard({ reduce, compact = false, delay = 0.05 }) {
  return (
    <motion.div
      {...enter(reduce, { delay, y: 18, scale: 0.96 })}
      className={`rounded-2xl border border-[#9d86ff]/28 bg-[linear-gradient(160deg,rgba(43,34,91,0.96),rgba(18,14,39,0.98))] shadow-[0_12px_28px_rgba(5,3,16,0.45)] ${compact ? 'w-[146px] p-3' : 'w-[230px] p-3.5'}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-bebas-real text-[20px] leading-none tracking-[0.04em] text-white">PARTIDO F5</span>
        <span className="rounded-full border border-[#35d07f]/30 bg-[#35d07f]/10 px-2 py-0.5 font-sans text-[8px] font-bold text-[#8ff0bd]">6/10</span>
      </div>
      <div className={`mt-2.5 grid ${compact ? 'grid-cols-2' : 'grid-cols-3'} gap-1.5`}>
        <InfoChip icon={CalendarDays} text="SÁB 19" />
        <InfoChip icon={Clock3} text="21:00" />
        {!compact && <InfoChip icon={MapPin} text="PALERMO" />}
      </div>
      {compact && (
        <div className="mt-2 flex items-center gap-1 font-sans text-[8px] font-semibold text-white/55">
          <MapPin size={9} /> Palermo
        </div>
      )}
    </motion.div>
  );
}

function InfoChip({ icon: Icon, text }) {
  return (
    <span className="inline-flex min-w-0 items-center justify-center gap-1 rounded-lg border border-white/8 bg-white/[0.045] px-1.5 py-1.5 font-sans text-[8.5px] font-bold text-white/68">
      <Icon size={10} className="shrink-0 text-[#b9a8ff]" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
}

function CreateArt({ reduce }) {
  return (
    <ArtStage name="create">
      <div className="flex h-full items-center justify-center">
        <MatchCard reduce={reduce} />
      </div>
      {[{ icon: CalendarDays, x: 'left-[13%]', delay: 0.25 }, { icon: Clock3, x: 'right-[13%]', delay: 0.32 }, { icon: MapPin, x: 'left-[22%]', delay: 0.39 }].map(({ icon: Icon, x, delay }, index) => (
        <motion.span key={index} {...enter(reduce, { delay, y: 10, scale: 0.75 })} className={`absolute ${x} ${index === 2 ? 'bottom-3' : 'top-3'} inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-[#171230] text-[#b9a8ff]`}>
          <Icon size={15} aria-hidden />
        </motion.span>
      ))}
    </ArtStage>
  );
}

function WhatsAppArt({ reduce }) {
  return (
    <ArtStage name="whatsapp">
      <div className="absolute left-3 top-1/2 -translate-y-1/2"><MatchCard reduce={reduce} compact /></div>
      <motion.div
        initial={reduce ? false : { opacity: 0, scaleX: 0 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : 0.28, ease: 'easeOut' }}
        className="absolute left-[47%] top-1/2 h-px w-[22%] origin-left bg-[linear-gradient(90deg,#8b7cff,#35d07f)]"
      />
      <motion.span {...enter(reduce, { delay: 0.36, x: -12, scale: 0.8 })} className="absolute left-[57%] top-[37%] inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_7px_20px_rgba(37,211,102,0.3)]">
        <MessageCircle size={18} fill="currentColor" aria-hidden />
      </motion.span>
      <motion.span {...enter(reduce, { delay: 0.42, x: -10 })} className="absolute left-[53%] top-[58%] text-[#a997ff]"><Link2 size={16} aria-hidden /></motion.span>
      <PlayerToken number="8" tone="teal" className="right-[15%] top-[23%]" {...enter(reduce, { delay: 0.46, x: -34, scale: 0.7 })} />
      <PlayerToken number="11" tone="violet" className="right-[7%] top-[47%]" {...enter(reduce, { delay: 0.54, x: -42, scale: 0.7 })} />
      <PlayerToken number="3" tone="magenta" className="right-[19%] bottom-[12%]" {...enter(reduce, { delay: 0.62, x: -28, scale: 0.7 })} />
    </ArtStage>
  );
}

function EvaluateArt({ reduce }) {
  return (
    <ArtStage name="evaluate">
      <PlayerToken number="7" tone="violet" className="left-[20%] top-4" {...enter(reduce, { delay: 0.04, y: -12 })} />
      <PlayerToken number="5" tone="teal" className="left-1/2 top-3 -translate-x-1/2" {...enter(reduce, { delay: 0.1, y: -12 })} />
      <PlayerToken number="10" tone="magenta" className="right-[20%] top-4" {...enter(reduce, { delay: 0.16, y: -12 })} />
      {[26, 50, 74].map((left, index) => (
        <motion.span
          key={left}
          initial={reduce ? false : { opacity: 0, scaleY: 0 }}
          animate={{ opacity: 0.55, scaleY: 1 }}
          transition={{ duration: reduce ? 0 : 0.32, delay: reduce ? 0 : 0.22 + index * 0.05 }}
          className="absolute top-[50px] h-10 w-px origin-top bg-[linear-gradient(#8b7cff,transparent)]"
          style={{ left: `${left}%` }}
        />
      ))}
      <motion.div {...enter(reduce, { delay: 0.32, y: 15 })} className="absolute inset-x-[15%] bottom-4 rounded-2xl border border-white/10 bg-[#12102a]/95 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-sans text-[8.5px] font-bold uppercase tracking-[0.12em] text-[#b9a8ff]">Aporte del grupo</span>
          <Users size={13} className="text-white/45" aria-hidden />
        </div>
        <div className="mt-2 flex items-end gap-1.5">
          {[45, 68, 56, 74, 62].map((height, index) => (
            <motion.span key={height} initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: reduce ? 0 : 0.4 + index * 0.04 }} className="w-full origin-bottom rounded-full bg-[linear-gradient(180deg,#8b7cff,#6a43ff)]" style={{ height: `${height / 5}px` }} />
          ))}
        </div>
      </motion.div>
    </ArtStage>
  );
}

function TeamsArt({ reduce }) {
  const left = [
    { number: 1, top: 'top-[34%]' }, { number: 4, top: 'top-[57%]' }, { number: 9, top: 'bottom-[3%]' },
  ];
  const right = [
    { number: 2, top: 'top-[34%]' }, { number: 6, top: 'top-[57%]' }, { number: 10, top: 'bottom-[3%]' },
  ];
  return (
    <ArtStage name="teams">
      <motion.div {...enter(reduce, { delay: 0.04, x: 18 })} className="absolute bottom-3 left-3 top-3 w-[43%] rounded-2xl border border-[#8b7cff]/25 bg-[#6a43ff]/[0.08]">
        <span className="absolute left-3 top-2 font-bebas-real text-[18px] text-[#b9a8ff]">EQUIPO A</span>
      </motion.div>
      <motion.div {...enter(reduce, { delay: 0.08, x: -18 })} className="absolute bottom-3 right-3 top-3 w-[43%] rounded-2xl border border-[#ec007d]/22 bg-[#ec007d]/[0.07]">
        <span className="absolute right-3 top-2 font-bebas-real text-[18px] text-[#ff91c6]">EQUIPO B</span>
      </motion.div>
      {left.map((token, index) => <PlayerToken key={token.number} number={token.number} tone="violet" className={`left-[22%] ${token.top}`} {...enter(reduce, { delay: 0.2 + index * 0.08, x: 58, scale: 0.75 })} />)}
      {right.map((token, index) => <PlayerToken key={token.number} number={token.number} tone="magenta" className={`right-[22%] ${token.top}`} {...enter(reduce, { delay: 0.24 + index * 0.08, x: -58, scale: 0.75 })} />)}
      <motion.span {...enter(reduce, { delay: 0.58, scale: 0.7 })} className="absolute left-1/2 top-[43%] inline-flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-[#35d07f]/40 bg-[#10251d] text-[#65e4a3]">
        <Check size={16} strokeWidth={3} aria-hidden />
      </motion.span>
    </ArtStage>
  );
}

function HistoryArt({ reduce }) {
  const matches = [
    { title: 'PARTIDO F5', meta: 'Sáb 12 · Palermo', tone: 'violet' },
    { title: 'FÚTBOL DEL JUEVES', meta: 'Jue 03 · Almagro', tone: 'teal' },
    { title: 'PARTIDO ENTRE AMIGOS', meta: 'Dom 22 · Caballito', tone: 'magenta' },
  ];
  return (
    <ArtStage name="history">
      <div className="absolute inset-x-[10%] inset-y-3 flex flex-col gap-1.5">
        {matches.map((match, index) => (
          <motion.div
            key={match.title}
            {...enter(reduce, { delay: 0.05 + index * 0.09, x: index % 2 ? 14 : -14, y: 0, scale: 0.97 })}
            className="flex min-h-0 flex-1 items-center gap-2.5 rounded-xl border border-white/9 bg-[#12102a]/95 px-3"
          >
            <span className={`h-7 w-1 shrink-0 rounded-full ${match.tone === 'violet' ? 'bg-[#8b7cff]' : match.tone === 'teal' ? 'bg-[#35c7ae]' : 'bg-[#ec4f9d]'}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bebas-real text-[14px] leading-none tracking-[0.035em] text-white">{match.title}</span>
              <span className="mt-0.5 block font-sans text-[8.5px] font-medium text-white/48">{match.meta}</span>
            </span>
            <span className="font-sans text-[8px] font-semibold text-white/42">Jugado</span>
          </motion.div>
        ))}
      </div>
    </ArtStage>
  );
}

function AvailabilityArt({ reduce }) {
  const selected = new Set([2, 5, 8, 9]);
  return (
    <ArtStage name="availability">
      <motion.div {...enter(reduce, { delay: 0.03, y: 14 })} className="absolute inset-x-[13%] inset-y-4 rounded-2xl border border-white/10 bg-[#12102a]/95 p-3">
        <div className="flex items-center justify-between">
          <span className="font-bebas-real text-[18px] tracking-[0.04em] text-white">TU DISPONIBILIDAD</span>
          <CalendarDays size={15} className="text-[#b9a8ff]" aria-hidden />
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {Array.from({ length: 10 }).map((_, index) => (
            <motion.span
              key={index}
              {...enter(reduce, { delay: 0.12 + index * 0.035, scale: 0.8 })}
              className={`h-5 rounded-md border ${selected.has(index) ? 'border-[#8b7cff]/55 bg-[#6a43ff]/35' : 'border-white/8 bg-white/[0.035]'}`}
            />
          ))}
        </div>
        <motion.div {...enter(reduce, { delay: 0.5, x: -14 })} className="mt-2 flex gap-1.5">
          <span className="rounded-lg border border-[#8b7cff]/30 bg-[#6a43ff]/15 px-2 py-1 font-sans text-[8px] font-bold text-white/72">19:00</span>
          <span className="rounded-lg border border-[#8b7cff]/30 bg-[#6a43ff]/15 px-2 py-1 font-sans text-[8px] font-bold text-white/72">22:00</span>
        </motion.div>
      </motion.div>
    </ArtStage>
  );
}

function PreferencesArt({ reduce }) {
  const chips = [
    { icon: Users, text: 'F5', className: 'left-[10%] top-[26%]', x: 36 },
    { icon: MapPin, text: '8 KM', className: 'right-[9%] top-[27%]', x: -36 },
    { icon: Clock3, text: 'NOCHE', className: 'left-[15%] bottom-[22%]', x: 32 },
  ];
  return (
    <ArtStage name="preferences">
      {chips.map(({ icon: Icon, text, className, x }, index) => (
        <motion.span key={text} {...enter(reduce, { delay: 0.06 + index * 0.08, x, scale: 0.8 })} className={`absolute ${className} inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#181333] px-2.5 py-2 font-sans text-[9px] font-bold text-white/70`}>
          <Icon size={12} className="text-[#b9a8ff]" aria-hidden /> {text}
        </motion.span>
      ))}
      <motion.div {...enter(reduce, { delay: 0.35, scale: 0.78 })} className="absolute right-[18%] bottom-[18%] inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-[#8b7cff]/35 bg-[#6a43ff]/15 text-[#c9bdff]">
        <SlidersHorizontal size={26} aria-hidden />
      </motion.div>
      <motion.span initial={reduce ? false : { opacity: 0, scaleX: 0 }} animate={{ opacity: 0.7, scaleX: 1 }} transition={{ delay: reduce ? 0 : 0.42 }} className="absolute left-[37%] top-1/2 h-px w-[22%] origin-left bg-[#8b7cff]" />
    </ArtStage>
  );
}

function MatchingArt({ reduce }) {
  const radarMotion = reduce
    ? { initial: false, animate: { opacity: 0.5, scale: 1 } }
    : { initial: { opacity: 0, scale: 0.72 }, animate: { opacity: 0.58, scale: 1 }, transition: { duration: 0.48, ease: 'easeOut' } };
  return (
    <ArtStage name="matching">
      <div className="absolute left-[8%] top-1/2 h-20 w-20 -translate-y-1/2">
        <motion.span {...radarMotion} className="absolute inset-0 rounded-full border border-[#8b7cff]/60" />
        <span className="absolute inset-4 inline-flex items-center justify-center rounded-full border border-[#8b7cff]/35 bg-[#6a43ff]/15 text-[#c9bdff]"><Radar size={20} aria-hidden /></span>
      </div>
      {[{ label: 'DÍAS', top: 'top-[18%]' }, { label: 'F5', top: 'top-[42%]' }, { label: 'ZONA', top: 'top-[66%]' }].map((item, index) => (
        <motion.span key={item.label} {...enter(reduce, { delay: 0.12 + index * 0.08, x: -12, y: 0, scale: 0.8 })} className={`absolute left-[31%] ${item.top} rounded-lg border border-[#8b7cff]/22 bg-[#171230] px-2 py-1 font-sans text-[7px] font-bold text-white/55`}>
          {item.label}
        </motion.span>
      ))}
      <motion.div {...enter(reduce, { delay: 0.36, x: 28, scale: 0.94 })} className="absolute bottom-4 right-[7%] top-4 flex w-[142px] flex-col justify-center rounded-2xl border border-[#35d07f]/25 bg-[#12231d]/95 p-3">
        <span className="font-sans text-[8px] font-bold uppercase tracking-[0.13em] text-[#7ce6ad]">Oportunidad</span>
        <p className="mt-1 font-bebas-real text-[19px] leading-none text-white">F5 · SÁBADO</p>
        <div className="mt-2 flex -space-x-1.5">
          {[7, 4, 10, 2].map((number, index) => <span key={number} className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#12102a] font-bebas-real text-[11px] ${index % 2 ? 'bg-[#167a6b]' : 'bg-[#6a43ff]'}`}>{number}</span>)}
        </div>
      </motion.div>
    </ArtStage>
  );
}

function ConfirmArt({ reduce }) {
  return (
    <ArtStage name="confirm">
      <motion.div {...enter(reduce, { delay: 0.04, y: 14 })} className="absolute inset-x-[14%] inset-y-5 rounded-2xl border border-[#35d07f]/26 bg-[linear-gradient(160deg,rgba(22,51,40,0.95),rgba(16,20,33,0.98))] p-3.5">
        <div className="flex items-start justify-between">
          <div>
            <span className="font-sans text-[8px] font-bold uppercase tracking-[0.14em] text-[#7ce6ad]">Partido encontrado</span>
            <p className="mt-1 font-bebas-real text-[23px] leading-none text-white">F5 · SÁB 21:00</p>
          </div>
          <MapPin size={16} className="text-[#b9a8ff]" aria-hidden />
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.035] px-2.5 py-2">
          <div className="flex -space-x-1.5">
            {[1, 5, 8, 11].map((number, index) => <span key={number} className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#17221d] font-bebas-real text-[11px] ${index % 2 ? 'bg-[#167a6b]' : 'bg-[#6a43ff]'}`}>{number}</span>)}
          </div>
          <motion.span {...enter(reduce, { delay: 0.34, scale: 0.72 })} className="inline-flex items-center gap-1 rounded-lg bg-[#35d07f] px-2 py-1 font-sans text-[8.5px] font-bold text-[#082216]"><Check size={10} strokeWidth={3} /> Confirmar</motion.span>
        </div>
      </motion.div>
    </ArtStage>
  );
}

function ExploreMatchesArt({ reduce }) {
  return (
    <ArtStage name="explore_matches">
      <div className="flex h-full items-center justify-center">
        <MatchCard reduce={reduce} delay={0.04} />
      </div>
      <motion.span {...enter(reduce, { delay: 0.34, x: 14 })} className="absolute bottom-3 right-[18%] rounded-lg bg-[linear-gradient(135deg,#8b5cff,#6a43ff)] px-3 py-1.5 font-bebas-real text-[13px] tracking-[0.04em] text-white shadow-[0_6px_16px_rgba(106,67,255,0.35)]">VER PARTIDO</motion.span>
    </ArtStage>
  );
}

function PlayerCard({ number, position, rating, tone, reduce, delay, className }) {
  return (
    <motion.div {...enter(reduce, { delay, x: -16, scale: 0.96 })} className={`absolute flex items-center gap-2 rounded-2xl border border-white/10 bg-[#15112e]/95 p-2.5 shadow-[0_8px_22px_rgba(5,3,16,0.34)] ${className}`}>
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 font-bebas-real text-[16px] ${TOKEN_STYLES[tone]}`}>{number}</span>
      <span className="min-w-0">
        <span className="block font-bebas-real text-[16px] leading-none text-white">JUGADOR DISPONIBLE</span>
        <span className="mt-1 flex items-center gap-2 font-sans text-[8px] font-bold text-white/48"><span>{position}</span><span className="flex items-center gap-0.5 text-[#ffd36f]"><Star size={8} fill="currentColor" /> {rating}</span></span>
      </span>
    </motion.div>
  );
}

function ExplorePlayersArt({ reduce }) {
  return (
    <ArtStage name="explore_players">
      <PlayerCard number="7" position="DEL" rating="4.8" tone="violet" reduce={reduce} delay={0.04} className="left-[8%] right-[18%] top-4" />
      <PlayerCard number="5" position="MED" rating="4.6" tone="teal" reduce={reduce} delay={0.15} className="left-[18%] right-[8%] top-[65px]" />
      <PlayerCard number="1" position="ARQ" rating="4.9" tone="magenta" reduce={reduce} delay={0.26} className="bottom-3 left-[10%] right-[16%]" />
    </ArtStage>
  );
}

function OrganizerClosingArt({ reduce }) {
  const tokens = [
    { n: 1, t: 'violet', c: 'left-[12%] top-[22%]', x: 42 },
    { n: 4, t: 'violet', c: 'left-[22%] bottom-[18%]', x: 38 },
    { n: 9, t: 'violet', c: 'left-[37%] top-[30%]', x: 26 },
    { n: 2, t: 'magenta', c: 'right-[12%] top-[22%]', x: -42 },
    { n: 6, t: 'magenta', c: 'right-[22%] bottom-[18%]', x: -38 },
    { n: 10, t: 'magenta', c: 'right-[37%] top-[30%]', x: -26 },
  ];
  return (
    <ArtStage name="organizer_closing">
      <motion.span {...enter(reduce, { delay: 0.08, scale: 0.7 })} className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"><Ball /></motion.span>
      {tokens.map((token, index) => (
        <PlayerToken key={token.n} number={token.n} tone={token.t} className={token.c} {...enter(reduce, { delay: 0.16 + index * 0.06, x: token.x, scale: 0.72 })} />
      ))}
      <span className="absolute bottom-2 left-[18%] font-sans text-[8px] font-bold uppercase tracking-[0.13em] text-[#b9a8ff]">Equipo A</span>
      <span className="absolute bottom-2 right-[18%] font-sans text-[8px] font-bold uppercase tracking-[0.13em] text-[#ff91c6]">Equipo B</span>
    </ArtStage>
  );
}

function AutoClosingArt({ reduce }) {
  return (
    <ArtStage name="auto_closing">
      <motion.div {...enter(reduce, { delay: 0.05, x: -16, scale: 0.94 })} className="absolute bottom-4 left-[7%] top-4 w-[35%] rounded-2xl border border-[#8b7cff]/25 bg-[#171230]/95 p-2.5">
        <div className="flex items-center justify-between font-sans text-[8px] font-bold uppercase tracking-[0.1em] text-[#b9a8ff]"><span>Disponible</span><CalendarDays size={13} /></div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {[true, false, true, true, false, true].map((active, index) => <span key={index} className={`h-4 rounded ${active ? 'bg-[#6a43ff]/45 ring-1 ring-[#9d86ff]/45' : 'bg-white/[0.045]'}`} />)}
        </div>
        <span className="mt-2 block font-sans text-[8px] font-semibold text-white/52">19:00—22:00</span>
      </motion.div>
      <motion.span initial={reduce ? false : { opacity: 0, scaleX: 0 }} animate={{ opacity: 0.72, scaleX: 1 }} transition={{ duration: reduce ? 0 : 0.38, delay: reduce ? 0 : 0.28 }} className="absolute left-[42%] top-1/2 h-px w-[16%] origin-left bg-[linear-gradient(90deg,#8b7cff,#35d07f)]" />
      <motion.div {...enter(reduce, { delay: 0.35, x: 18, scale: 0.94 })} className="absolute bottom-4 right-[7%] top-4 w-[35%] rounded-2xl border border-[#35d07f]/24 bg-[#10251d]/90">
        <span className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap font-sans text-[8px] font-bold uppercase tracking-[0.11em] text-[#7ce6ad]">Grupo listo</span>
        {[{ n: 7, c: 'left-[16%] top-[38%]' }, { n: 4, c: 'right-[16%] top-[38%]' }, { n: 10, c: 'left-[28%] bottom-[9%]' }, { n: 2, c: 'right-[28%] bottom-[9%]' }].map((token, index) => (
          <PlayerToken key={token.n} number={token.n} tone={index % 2 ? 'teal' : 'violet'} className={`${token.c} !h-7 !w-7 !text-[12px]`} {...enter(reduce, { delay: 0.43 + index * 0.06, y: 10, scale: 0.7 })} />
        ))}
      </motion.div>
    </ArtStage>
  );
}

function ExploreClosingArt({ reduce }) {
  return (
    <ArtStage name="explore_closing">
      <motion.span {...enter(reduce, { delay: 0.04, y: -8 })} className="absolute left-1/2 top-3 -translate-x-1/2 font-bebas-real text-[18px] tracking-[0.08em] text-white">JUGAR</motion.span>
      <motion.div {...enter(reduce, { delay: 0.12, x: -18, scale: 0.96 })} className="absolute bottom-4 left-[7%] top-10 w-[40%] rounded-2xl border border-[#8b7cff]/25 bg-[#171230]/95 p-2.5">
        <span className="font-sans text-[8px] font-bold uppercase tracking-[0.1em] text-[#b9a8ff]">Partidos</span>
        <div className="mt-2 rounded-xl border border-white/8 bg-white/[0.035] p-2">
          <span className="block font-bebas-real text-[15px] text-white">F5 · SÁBADO</span>
          <span className="mt-1 flex items-center gap-1 font-sans text-[8px] text-white/48"><MapPin size={9} /> Palermo</span>
        </div>
      </motion.div>
      <motion.div {...enter(reduce, { delay: 0.22, x: 18, scale: 0.96 })} className="absolute bottom-4 right-[7%] top-10 w-[40%] rounded-2xl border border-[#35c7ae]/22 bg-[#112822]/90 p-2.5">
        <span className="font-sans text-[8px] font-bold uppercase tracking-[0.1em] text-[#71e0ce]">Jugadores</span>
        <div className="mt-2 flex flex-col gap-1.5">
          {[7, 5].map((number, index) => <span key={number} className="flex items-center gap-2 rounded-lg bg-white/[0.04] p-1.5 font-sans text-[8px] text-white/55"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full font-bebas-real text-[10px] text-white ${index ? 'bg-[#167a6b]' : 'bg-[#6a43ff]'}`}>{number}</span> Disponible</span>)}
        </div>
      </motion.div>
    </ArtStage>
  );
}

function ChallengesArt({ reduce }) {
  return (
    <ArtStage name="challenges">
      <motion.div {...enter(reduce, { delay: 0.04, x: -18, scale: 0.9 })} className="absolute left-[7%] top-1/2 flex w-[25%] -translate-y-1/2 flex-col items-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[#9d86ff]/40 bg-[#6a43ff]/20 text-[#c9bdff]"><Shield size={25} fill="currentColor" fillOpacity={0.16} /></span>
        <span className="mt-2 text-center font-sans text-[8px] font-bold uppercase tracking-[0.09em] text-white/65">Tu equipo</span>
      </motion.div>
      <motion.div {...enter(reduce, { delay: 0.15, y: 12, scale: 0.96 })} className="absolute inset-x-[31%] inset-y-4 flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#12102a]/96 px-2 text-center shadow-[0_10px_24px_rgba(5,3,16,0.4)]">
        <span className="font-sans text-[8px] font-bold uppercase tracking-[0.14em] text-[#b9a8ff]">Cartelera</span>
        <span className="mt-1 font-bebas-real text-[19px] leading-none text-white">DESAFÍO F5</span>
        <span className="mt-2 rounded-lg border border-[#35d07f]/25 bg-[#35d07f]/10 px-2 py-1 font-sans text-[7px] font-bold uppercase tracking-[0.08em] text-[#8ff0bd]">Publicado</span>
      </motion.div>
      <motion.div {...enter(reduce, { delay: 0.26, x: 18, scale: 0.9 })} className="absolute right-[7%] top-1/2 flex w-[25%] -translate-y-1/2 flex-col items-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[#ff78b9]/35 bg-[#c71d78]/18 text-[#ffacd4]"><Shield size={25} fill="currentColor" fillOpacity={0.14} /></span>
        <span className="mt-2 text-center font-sans text-[8px] font-bold uppercase tracking-[0.09em] text-white/65">Equipo rival</span>
      </motion.div>
    </ArtStage>
  );
}

function StatsArt({ reduce }) {
  const year = new Date().getFullYear();
  const metrics = [
    { label: 'JUGADOS', tone: 'border-[#8b7cff]/28 bg-[#6a43ff]/10' },
    { label: 'GANADOS', tone: 'border-[#35d07f]/24 bg-[#35d07f]/[0.07]' },
    { label: 'EMPATADOS', tone: 'border-[#ffd36f]/22 bg-[#ffd36f]/[0.06]' },
    { label: 'LESIONES', tone: 'border-[#ec4f9d]/24 bg-[#ec4f9d]/[0.07]' },
  ];
  return (
    <ArtStage name="stats">
      <motion.span {...enter(reduce, { delay: 0.03, y: -8 })} className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full border border-white/10 bg-[#12102a]/90 px-3 py-1 font-sans text-[8px] font-bold uppercase tracking-[0.14em] text-white/58">Año {year}</motion.span>
      <div className="absolute inset-x-[8%] bottom-3 top-9 grid grid-cols-2 gap-2">
        {metrics.map((metric, index) => (
          <motion.div key={metric.label} {...enter(reduce, { delay: 0.1 + index * 0.07, y: 10, scale: 0.94 })} className={`flex min-h-0 items-center justify-between rounded-xl border px-3 ${metric.tone}`}>
            <span className="font-sans text-[8px] font-bold tracking-[0.08em] text-white/62">{metric.label}</span>
            <span className="font-bebas-real text-[22px] leading-none text-white/76">—</span>
          </motion.div>
        ))}
      </div>
    </ArtStage>
  );
}

function ProfileArt({ reduce }) {
  return (
    <ArtStage name="profile">
      <motion.div
        {...enter(reduce, { delay: 0.05, y: 16, scale: 0.96 })}
        className="absolute inset-x-[14%] inset-y-4 rounded-2xl border border-[#9d86ff]/28 bg-[linear-gradient(160deg,rgba(43,34,91,0.96),rgba(18,14,39,0.98))] p-3.5 shadow-[0_12px_28px_rgba(5,3,16,0.45)]"
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#9d86ff]/70 bg-[#6a43ff] font-bebas-real text-[18px] text-white">10</span>
          <span className="min-w-0">
            <span className="block font-bebas-real text-[18px] leading-none tracking-[0.03em] text-white">TU PERFIL</span>
            <span className="mt-1 flex items-center gap-1 font-sans text-[8px] font-semibold text-white/48"><MapPin size={9} /> Palermo</span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {['DEL', 'MED'].map((chip, index) => (
            <motion.span key={chip} {...enter(reduce, { delay: 0.24 + index * 0.07, y: 8, scale: 0.85 })} className="rounded-lg border border-[#8b7cff]/30 bg-[#6a43ff]/15 px-2 py-1 font-sans text-[8px] font-bold text-white/74">{chip}</motion.span>
          ))}
          <motion.span {...enter(reduce, { delay: 0.38, y: 8, scale: 0.85 })} className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 font-sans text-[8px] font-bold text-white/55">NIVEL</motion.span>
        </div>
      </motion.div>
    </ArtStage>
  );
}

function ProfileContactArt({ reduce }) {
  return (
    <ArtStage name="profile_contact">
      <motion.div {...enter(reduce, { delay: 0.05, y: 14 })} className="absolute inset-x-[13%] top-4 rounded-2xl border border-[#35d07f]/26 bg-[#12231d]/95 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#35d07f]/40 bg-[#10251d] text-[#7ce6ad]"><Phone size={15} aria-hidden /></span>
          <div className="min-w-0">
            <span className="block font-sans text-[8px] font-bold uppercase tracking-[0.12em] text-[#7ce6ad]">Teléfono</span>
            <span className="block font-bebas-real text-[16px] leading-none tracking-[0.04em] text-white">+54 9 11 ····</span>
          </div>
        </div>
      </motion.div>
      <motion.div {...enter(reduce, { delay: 0.2, y: 14 })} className="absolute inset-x-[13%] bottom-4 rounded-2xl border border-[#8b7cff]/25 bg-[#171230]/95 px-3 py-2.5">
        <span className="font-sans text-[8px] font-bold uppercase tracking-[0.12em] text-[#b9a8ff]">Posiciones · máx. 2</span>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[
            { label: 'ARQ', on: false }, { label: 'DEF', on: false }, { label: 'MED', on: true }, { label: 'DEL', on: true },
          ].map((chip, index) => (
            <motion.span
              key={chip.label}
              {...enter(reduce, { delay: 0.3 + index * 0.06, scale: 0.8 })}
              className={`inline-flex items-center justify-center rounded-md border py-1 font-sans text-[8px] font-bold ${chip.on ? 'border-[#8b7cff]/55 bg-[#6a43ff]/35 text-white' : 'border-white/8 bg-white/[0.035] text-white/40'}`}
            >
              {chip.label}
            </motion.span>
          ))}
        </div>
      </motion.div>
    </ArtStage>
  );
}

function ResponsibilityArt({ reduce }) {
  return (
    <ArtStage name="responsibility">
      <div className="flex h-full items-center justify-center">
        <motion.div {...enter(reduce, { delay: 0.05, scale: 0.8 })} className="relative flex h-[104px] w-[104px] items-center justify-center rounded-full border border-[#9d86ff]/40 bg-[radial-gradient(circle_at_50%_35%,rgba(139,92,255,0.32),rgba(18,14,39,0.96))] shadow-[0_14px_34px_rgba(106,67,255,0.34),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <span className="font-bebas-real text-[58px] leading-none text-white [text-shadow:0_4px_18px_rgba(139,92,255,0.5)]">5</span>
          <motion.span {...enter(reduce, { delay: 0.34, scale: 0.6 })} className="absolute -bottom-1 -right-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#6a43ff]/45 bg-[#1a1338] text-[#c9bdff] shadow-[0_6px_16px_rgba(5,3,16,0.5)]">
            <ShieldCheck size={18} aria-hidden />
          </motion.span>
        </motion.div>
      </div>
      <motion.span {...enter(reduce, { delay: 0.44, y: 8 })} className="absolute inset-x-0 bottom-2 text-center font-sans text-[8.5px] font-bold uppercase tracking-[0.16em] text-[#b9a8ff]">
        Responsabilidad
      </motion.span>
    </ArtStage>
  );
}

function CompletionArt({ reduce }) {
  return (
    <ArtStage name="completion">
      <motion.div {...enter(reduce, { delay: 0.05, scale: 0.78 })} className="absolute left-1/2 top-[18px] -translate-x-1/2"><Ball /></motion.div>
      {[{ n: 1, t: 'violet', c: 'left-[16%] bottom-[22%]', x: 60 }, { n: 4, t: 'teal', c: 'left-[34%] bottom-[10%]', x: 28 }, { n: 7, t: 'magenta', c: 'right-[34%] bottom-[10%]', x: -28 }, { n: 10, t: 'amber', c: 'right-[16%] bottom-[22%]', x: -60 }].map((token, index) => (
        <PlayerToken key={token.n} number={token.n} tone={token.t} className={token.c} {...enter(reduce, { delay: 0.16 + index * 0.07, x: token.x, y: -28, scale: 0.72 })} />
      ))}
      <motion.span {...enter(reduce, { delay: 0.48, scale: 0.7 })} className="absolute bottom-4 left-1/2 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[#35d07f]/45 bg-[#10251d] text-[#65e4a3] shadow-[0_0_20px_rgba(53,208,127,0.18)]"><Check size={19} strokeWidth={3} aria-hidden /></motion.span>
    </ArtStage>
  );
}

const ART_COMPONENTS = {
  profile: ProfileArt,
  profile_contact: ProfileContactArt,
  responsibility: ResponsibilityArt,
  intro: IntroArt,
  create: CreateArt,
  whatsapp: WhatsAppArt,
  evaluate: EvaluateArt,
  teams: TeamsArt,
  history: HistoryArt,
  availability: AvailabilityArt,
  preferences: PreferencesArt,
  matching: MatchingArt,
  confirm: ConfirmArt,
  explore_matches: ExploreMatchesArt,
  explore_players: ExplorePlayersArt,
  organizer_closing: OrganizerClosingArt,
  auto_closing: AutoClosingArt,
  explore_closing: ExploreClosingArt,
  challenges: ChallengesArt,
  stats: StatsArt,
  completion: CompletionArt,
};

export default function OnboardingStepArt({ name }) {
  const reduce = useReducedMotion();
  const Art = ART_COMPONENTS[name] || ExploreMatchesArt;
  return <Art reduce={Boolean(reduce)} />;
}
