import React from 'react';
import PageTransition from '../components/PageTransition';
import AvailabilityOpportunityCard from '../components/jugar/AvailabilityOpportunityCard';
import QuieroJugar from './QuieroJugar';

const QuieroJugarPage = () => {
  return (
    <PageTransition>
      <QuieroJugar />
      <AvailabilityOpportunityCard />
    </PageTransition>
  );
};

export default QuieroJugarPage;
