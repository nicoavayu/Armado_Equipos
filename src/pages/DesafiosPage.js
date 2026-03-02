import React from 'react';
import PageTransition from '../components/PageTransition';
import QuieroJugarEquipos from '../features/equipos/QuieroJugarEquipos';

const DesafiosPage = () => {
  return (
    <PageTransition>
      <QuieroJugarEquipos
        pageTitle="DESAFIOS"
        secondaryTabsTop={126}
      />
    </PageTransition>
  );
};

export default DesafiosPage;
