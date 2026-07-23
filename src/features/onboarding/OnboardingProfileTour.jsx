import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { useAuth } from '../../components/AuthProvider';
import { getProfilePositions } from '../../utils/positions';
import { profileTourContent } from './content';
import { onboardingHaptic } from './haptics';
import { useOnboarding } from './OnboardingProvider';
import OnboardingModal from './OnboardingModal';
import OnboardingStepArt from './OnboardingStepArt';
import { GhostButton, PrimaryButton, ProgressDots } from './OnboardingUI';

// Attribute marking the first editable field the final CTA scrolls to.
const PROFILE_TOUR_TARGET = '[data-profile-tour-target="telefono"]';

// Whether the profile already carries the key data this tutorial highlights.
// Used only to adapt the final CTA copy ("Ver mi perfil" vs "Completar mi perfil");
// the tour never edits or overwrites any existing data.
export function hasProfileKeyData(profile) {
  if (!profile) return false;
  const hasPhone = String(profile.telefono || '').trim().length > 0;
  const hasPositions = getProfilePositions(profile).length > 0;
  const hasLevel = profile.nivel != null && profile.nivel !== '';
  return hasPhone && hasPositions && hasLevel;
}

// Scrolls the Perfil form to its editable section and focuses the phone field.
// The tour lives in a portal, so a DOM query reaches the form regardless of tree.
function focusProfileFields() {
  if (typeof document === 'undefined') return;
  const target = document.querySelector(PROFILE_TOUR_TARGET);
  if (!target) return;
  if (typeof target.scrollIntoView === 'function') {
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_error) {
      target.scrollIntoView();
    }
  }
  const input = target.matches('input, textarea, select')
    ? target
    : target.querySelector('input, textarea, select');
  input?.focus?.({ preventScroll: true });
}

function ScoreSlide({ slide }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-3 w-full max-w-[260px]">
        <OnboardingStepArt name={slide.art} />
      </div>
      <h2 id="onboarding-profile-tour-title" className="max-w-[360px] font-bebas-real text-[clamp(26px,7.4vw,36px)] leading-[0.98] tracking-[0.02em] text-white">
        {slide.title}
      </h2>
      <p className="mt-3 max-w-[330px] font-sans text-[15px] font-semibold leading-[1.45] text-white">
        {slide.lead}
      </p>
      <p className="mt-2 max-w-[330px] font-sans text-[13.5px] leading-[1.5] text-white/70">
        {slide.description}
      </p>
      <p className="mt-1.5 max-w-[330px] font-sans text-[13.5px] leading-[1.5] text-white/70">
        {slide.detail}
      </p>
      <p className="mt-3 max-w-[320px] rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-sans text-[12px] leading-[1.45] text-white/60">
        {slide.levelNote}
      </p>
      <p className="mt-3 max-w-[320px] font-bebas-real text-[19px] leading-tight tracking-[0.02em] text-[#c9bdff]">
        {slide.closing}
      </p>
    </div>
  );
}

function InfoSlide({ slide }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-4 w-full max-w-[280px]">
        <OnboardingStepArt name={slide.art} />
      </div>
      <h2 id="onboarding-profile-tour-title" className="max-w-[360px] font-bebas-real text-[clamp(28px,7.8vw,40px)] leading-[0.96] tracking-[0.03em] text-white">
        {slide.title}
      </h2>
      <p className="mt-3 max-w-[340px] font-sans text-[14.5px] leading-[1.5] text-white/72">
        {slide.description}
      </p>
      {slide.note ? (
        <p className="mt-3 max-w-[330px] rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-sans text-[12px] leading-[1.45] text-white/58">
          {slide.note}
        </p>
      ) : null}
    </div>
  );
}

// The Perfil-tab tutorial: three brief slides. The final CTA closes the tour and
// scrolls the form to its editable fields; it never modifies data. A secondary
// action (and the X / Escape / back button) closes it without editing.
export default function OnboardingProfileTour() {
  const reduce = useReducedMotion();
  const { profile } = useAuth();
  const {
    completeProfileTour,
    dismissProfileTour,
    profileTourOrigin,
  } = useOnboarding();
  const [index, setIndex] = useState(0);

  const slides = profileTourContent.slides;
  const total = slides.length;
  const slide = slides[Math.min(index, total - 1)];
  const isFinal = index >= total - 1;
  const isFirst = index === 0;

  const ctaLabel = profileTourOrigin === 'onboarding'
    ? profileTourContent.primaryCtaOnboarding
    : (hasProfileKeyData(profile)
      ? profileTourContent.primaryCtaComplete
      : profileTourContent.primaryCta);

  const goNext = () => {
    onboardingHaptic('light');
    setIndex((current) => Math.min(current + 1, total - 1));
  };
  const goPrev = () => {
    onboardingHaptic('light');
    setIndex((current) => Math.max(current - 1, 0));
  };
  const finish = () => {
    onboardingHaptic('medium');
    // When opened from the general onboarding, closing resumes the goal selector,
    // which would cover the form — so only scroll to the fields on manual entry.
    const resumesOnboarding = profileTourOrigin === 'onboarding';
    completeProfileTour();
    if (!resumesOnboarding) {
      // Defer so the overlay unmounts before we scroll the form underneath.
      window.setTimeout(focusProfileFields, 60);
    }
  };

  const bodyMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2 } }
    : {
      initial: { opacity: 0, x: 24 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: -24 },
      transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
    };

  return (
    <OnboardingModal
      labelledById="onboarding-profile-tour-title"
      onClose={dismissProfileTour}
      closeLabel="Cerrar tutorial"
      showClose
    >
      <div className="flex flex-col pb-1 pt-6" data-onboarding-profile-tour="true">
        <div className="mb-2 flex justify-center">
          <ProgressDots total={total} index={index} label={`Paso ${index + 1} de ${total}`} />
        </div>

        <div className="min-h-[300px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={slide.key} {...bodyMotion}>
              {slide.key === 'score' ? <ScoreSlide slide={slide} /> : <InfoSlide slide={slide} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-6 flex items-center gap-3">
          {!isFirst && (
            <GhostButton onClick={goPrev} className="px-4" aria-label="Anterior">
              Anterior
            </GhostButton>
          )}
          {isFinal ? (
            <PrimaryButton onClick={finish} className="flex-1" data-onboarding-action="profile-tour-finish">
              {ctaLabel}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={goNext} className="flex-1" data-onboarding-action="profile-tour-next">
              Siguiente
            </PrimaryButton>
          )}
        </div>

        {isFinal && (
          <GhostButton
            onClick={dismissProfileTour}
            className="mt-2.5 w-full border-0 bg-transparent text-white/55"
            data-onboarding-action="profile-tour-dismiss"
          >
            {profileTourContent.secondaryCta}
          </GhostButton>
        )}
      </div>
    </OnboardingModal>
  );
}
