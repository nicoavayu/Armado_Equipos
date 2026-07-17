import React from 'react';

import { checklistCompletionContent } from './content';
import OnboardingModal from './OnboardingModal';
import OnboardingStepArt from './OnboardingStepArt';
import { PrimaryButton } from './OnboardingUI';

export default function OnboardingCompletedModal({ onClose }) {
  return (
    <OnboardingModal
      labelledById="onboarding-completed-title"
      describedById="onboarding-completed-description"
      onClose={onClose}
      showClose
      closeLabel="Cerrar finalización"
    >
      <div className="flex flex-col items-center pb-0 pt-4 text-center">
        <div className="mb-3 w-full max-w-[320px]">
          <OnboardingStepArt name="completion" />
        </div>
        <h2
          id="onboarding-completed-title"
          className="font-bebas-real text-[clamp(38px,11vw,50px)] leading-[0.92] tracking-[0.035em] text-white"
        >
          {checklistCompletionContent.title}
        </h2>
        <p
          id="onboarding-completed-description"
          className="mt-3 max-w-[330px] font-sans text-[14.5px] leading-[1.5] text-white/72"
        >
          {checklistCompletionContent.description}
        </p>
        <PrimaryButton onClick={onClose} className="mt-6">
          {checklistCompletionContent.cta}
        </PrimaryButton>
      </div>
    </OnboardingModal>
  );
}
