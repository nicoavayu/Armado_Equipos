import React from 'react';
import PageTransition from '../components/PageTransition';
import AvailabilityOpportunityCard from '../components/jugar/AvailabilityOpportunityCard';
import QuieroJugar from './QuieroJugar';
import OnboardingCoachMark from '../features/onboarding/OnboardingCoachMark';

const QuieroJugarPage = () => {
  return (
    <PageTransition>
      <QuieroJugar />
      <AvailabilityOpportunityCard />
      <OnboardingCoachMark screenKey="auto-match" />
    </PageTransition>
  );
};

export default QuieroJugarPage;
