import React from 'react';

// Lightweight, theme-matched SVG illustrations for the onboarding steps. Pure
// vector (no external assets, no heavy media), so they stay crisp and cheap.
// Colors come from the app palette: violet #6a43ff / #8b7cff, magenta #ec007d,
// pitch green #35d07f. Any subtle motion is CSS-driven and disabled under
// prefers-reduced-motion by the parent's reduced-motion styles.

const Frame = ({ children, label }) => (
  <svg viewBox="0 0 200 140" role="img" aria-label={label} className="onboarding-art">
    <defs>
      <linearGradient id="ob-violet" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8b5cff" />
        <stop offset="1" stopColor="#6a43ff" />
      </linearGradient>
      <linearGradient id="ob-pitch" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1f7a4d" />
        <stop offset="1" stopColor="#0f3d28" />
      </linearGradient>
    </defs>
    {children}
  </svg>
);

const PitchBase = () => (
  <g opacity="0.9">
    <rect x="16" y="18" width="168" height="104" rx="12" fill="url(#ob-pitch)" />
    <rect x="16" y="18" width="168" height="104" rx="12" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.6" />
    <line x1="100" y1="18" x2="100" y2="122" stroke="rgba(255,255,255,0.28)" strokeWidth="1.4" />
    <circle cx="100" cy="70" r="16" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.4" />
  </g>
);

const arts = {
  create: (
    <Frame label="Crear partido">
      <PitchBase />
      <g>
        <rect x="70" y="52" width="60" height="36" rx="8" fill="#120e28" stroke="url(#ob-violet)" strokeWidth="2" />
        <line x1="80" y1="64" x2="120" y2="64" stroke="#8b7cff" strokeWidth="3" strokeLinecap="round" />
        <line x1="80" y1="74" x2="108" y2="74" stroke="rgba(255,255,255,0.45)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="128" cy="46" r="11" fill="#6a43ff" />
        <path d="M128 41v10M123 46h10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </Frame>
  ),
  whatsapp: (
    <Frame label="Invitar por WhatsApp">
      <PitchBase />
      <g>
        <circle cx="100" cy="70" r="26" fill="#25D366" />
        <path
          d="M100 55c-8.3 0-15 6.7-15 15 0 2.6.7 5.1 2 7.3L85 87l10-2c2 1.1 4.4 1.7 6.9 1.7 8.3 0 15-6.7 15-15S108.3 55 100 55z"
          fill="#fff"
        />
        <path
          d="M94.5 63.5c-.4-.9-.8-.9-1.2-.9h-1c-.3 0-.9.1-1.4.6-.5.5-1.8 1.7-1.8 4.2s1.9 4.9 2.1 5.2c.3.4 3.6 5.7 8.9 7.8 4.4 1.7 5.3 1.4 6.2 1.3.9-.1 3-1.2 3.4-2.4.4-1.2.4-2.2.3-2.4-.1-.2-.5-.4-1-.6l-3.1-1.5c-.4-.2-.8-.3-1.1.2l-1.5 2c-.3.4-.6.4-1 .2-.6-.3-2.4-.9-4.6-2.8-1.7-1.5-2.8-3.4-3.2-4-.3-.5 0-.8.2-1 .2-.2.5-.5.7-.8.2-.3.3-.5.5-.8.1-.3.1-.6 0-.8-.1-.2-1-2.6-1.4-3.5z"
          fill="#25D366"
        />
      </g>
    </Frame>
  ),
  evaluate: (
    <Frame label="El grupo evalúa">
      <PitchBase />
      <g>
        {[62, 100, 138].map((cx, i) => (
          <g key={cx}>
            <circle cx={cx} cy="64" r="12" fill="#1d1740" stroke="#8b7cff" strokeWidth="2" />
            <circle cx={cx} cy="60" r="4" fill="#cfc4ff" />
            <path d={`M${cx - 6} 72c1.5-3 10.5-3 12 0`} fill="#cfc4ff" />
            <path
              d={`M${cx - 4} 84l1.4 3 3.3.3-2.5 2.2.8 3.2-3-1.7-3 1.7.8-3.2-2.5-2.2 3.3-.3z`}
              fill={i === 1 ? '#ffd45e' : '#6a43ff'}
            />
          </g>
        ))}
      </g>
    </Frame>
  ),
  teams: (
    <Frame label="Equipos parejos">
      <PitchBase />
      <g>
        {[46, 66, 86].map((cy, i) => (
          <circle key={`a${cy}`} cx={i === 1 ? 60 : 54} cy={cy} r="7" fill="#6a43ff" stroke="#8b7cff" strokeWidth="1.5" />
        ))}
        {[46, 66, 86].map((cy, i) => (
          <circle key={`b${cy}`} cx={i === 1 ? 140 : 146} cy={cy} r="7" fill="#ec007d" stroke="#ff5aa8" strokeWidth="1.5" />
        ))}
        <circle cx="100" cy="70" r="8" fill="#fff" />
        <path d="M100 64l2.2 4 4.4.4-3.3 2.9 1 4.3-4.3-2.4-4.3 2.4 1-4.3-3.3-2.9 4.4-.4z" fill="#120e28" />
      </g>
    </Frame>
  ),
  record: (
    <Frame label="Registro e historial">
      <PitchBase />
      <g>
        <rect x="66" y="44" width="68" height="52" rx="8" fill="#120e28" stroke="url(#ob-violet)" strokeWidth="2" />
        {[56, 66, 76, 86].map((y, i) => (
          <g key={y}>
            <circle cx="76" cy={y} r="2.6" fill={i % 2 ? '#35d07f' : '#8b7cff'} />
            <line x1="84" y1={y} x2={i % 2 ? 118 : 124} y2={y} stroke="rgba(255,255,255,0.4)" strokeWidth="2.4" strokeLinecap="round" />
          </g>
        ))}
      </g>
    </Frame>
  ),
  availability: (
    <Frame label="Disponibilidad">
      <PitchBase />
      <g>
        <rect x="64" y="42" width="72" height="56" rx="8" fill="#120e28" stroke="url(#ob-violet)" strokeWidth="2" />
        <line x1="64" y1="54" x2="136" y2="54" stroke="#8b7cff" strokeWidth="2" />
        {[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => {
          const on = (c + r) % 2 === 0;
          return (
            <rect
              key={`${c}-${r}`}
              x={72 + c * 15}
              y={60 + r * 11}
              width="10"
              height="8"
              rx="2"
              fill={on ? '#6a43ff' : 'rgba(255,255,255,0.12)'}
            />
          );
        }))}
      </g>
    </Frame>
  ),
  preferences: (
    <Frame label="Preferencias de juego">
      <PitchBase />
      <g>
        <circle cx="100" cy="70" r="30" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="4 4" />
        <circle cx="100" cy="70" r="18" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeDasharray="3 4" />
        <circle cx="100" cy="70" r="7" fill="#6a43ff" />
        <path d="M100 70l18-10" stroke="#ec007d" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="118" cy="60" r="4" fill="#ec007d" />
      </g>
    </Frame>
  ),
  matching: (
    <Frame label="Buscando jugadores">
      <PitchBase />
      <g>
        <circle cx="100" cy="70" r="8" fill="#6a43ff" />
        {[24, 34].map((r, i) => (
          <circle key={r} cx="100" cy="70" r={r} fill="none" stroke="#8b7cff" strokeWidth="2" opacity={0.55 - i * 0.2} />
        ))}
        <circle cx="72" cy="52" r="6" fill="#ec007d" />
        <circle cx="132" cy="58" r="6" fill="#35d07f" />
        <circle cx="128" cy="92" r="6" fill="#ffd45e" />
        <circle cx="70" cy="90" r="6" fill="#8b7cff" />
      </g>
    </Frame>
  ),
  confirm: (
    <Frame label="Confirmar oportunidad">
      <PitchBase />
      <g>
        <circle cx="100" cy="70" r="24" fill="#120e28" stroke="#35d07f" strokeWidth="3" />
        <path d="M89 71l7 7 15-16" fill="none" stroke="#35d07f" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Frame>
  ),
  overview: (
    <Frame label="Conocer Arma2">
      <PitchBase />
      <g>
        <circle cx="100" cy="70" r="20" fill="#6a43ff" opacity="0.25" />
        <path
          d="M100 52l4.6 9.4 10.4 1.5-7.5 7.3 1.8 10.3-9.3-4.9-9.3 4.9 1.8-10.3-7.5-7.3 10.4-1.5z"
          fill="#ffd45e"
        />
      </g>
    </Frame>
  ),
};

export default function OnboardingStepArt({ name }) {
  return arts[name] || arts.overview;
}
