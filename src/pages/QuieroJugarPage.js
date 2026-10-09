import React from 'react';
import PageTransition from '../components/PageTransition';
import AvailabilityOpportunityCard from '../components/jugar/AvailabilityOpportunityCard';
import QuieroJugar from './QuieroJugar';
import OnboardingCoachMark from '../features/onboarding/OnboardingCoachMark';
import ExploreTournamentsEntry from '../components/jugar/ExploreTournamentsEntry';

const QuieroJugarPage = () => {
  return (
    <PageTransition>
      <QuieroJugar />
      <AvailabilityOpportunityCard />
      <ExploreTournamentsEntry />
      <OnboardingCoachMark screenKey="auto-match" />
    </PageTransition>
  );
};

export default QuieroJugarPage;
