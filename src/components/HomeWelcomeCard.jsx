import React, { useState } from 'react';
import logo from '../Logo.png';

export const HOME_WELCOME_CARD_SEEN_KEY = 'arma2:home:welcome-card-seen:v1';

const hasSeenHomeWelcomeCard = () => {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(HOME_WELCOME_CARD_SEEN_KEY) === '1';
  } catch (_error) {
    return false;
  }
};

const persistHomeWelcomeCardSeen = () => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(HOME_WELCOME_CARD_SEEN_KEY, '1');
  } catch (_error) {
    // Ignore storage failures; the card can reappear next time.
  }
};

export default function HomeWelcomeCard() {
  const [isVisible, setIsVisible] = useState(() => !hasSeenHomeWelcomeCard());

  if (!isVisible) return null;

  const handleDismiss = () => {
    persistHomeWelcomeCardSeen();
    setIsVisible(false);
  };

  return (
    <div
      data-modal-root="true"
      data-home-welcome-modal="true"
      className="fixed inset-0 z-[12000] flex items-center justify-center bg-[rgba(4,7,18,0.78)] px-5 backdrop-blur-[3px]"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-welcome-title"
        className="auth-premium-card relative w-full max-w-[396px] overflow-hidden border border-white/20 px-6 py-6 text-white shadow-[0_20px_46px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.08)] sm:px-7 sm:py-7"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_center,rgba(126,141,255,0.18),transparent_54%)]"
        />

        <div className="relative flex flex-col items-center justify-center text-center">
          <div className="auth-logo-block mb-4 text-center">
            <img
              src={logo}
              alt="ARMA2"
              className="auth-logo-mark mx-auto h-[88px] w-auto max-w-full object-contain sm:h-[96px]"
            />
          </div>

          <h2
            id="home-welcome-title"
            className="font-oswald text-[21px] font-medium leading-[1.05] tracking-[0.01em] text-white/92 drop-shadow-[0_2px_8px_rgba(129,120,229,0.18)] sm:text-[22px]"
          >
            Tu punto de partida
          </h2>

          <p className="mt-3 max-w-[300px] text-[14px] leading-[1.5] text-white/74 sm:text-[15px]">
            Desde acá podés seguir la actividad reciente, acceder rápido a tus partidos agendados y revisar tus estadísticas.
          </p>

          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={handleDismiss}
              className="auth-btn auth-btn-primary inline-flex h-11 min-w-[148px] items-center justify-center rounded-none px-6 font-oswald text-[15px] font-semibold"
            >
              Aceptar
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
