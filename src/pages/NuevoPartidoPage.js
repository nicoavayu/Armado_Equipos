import React from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import FormularioNuevoPartidoFlow from './FormularioNuevoPartidoFlow';

const NuevoPartidoPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  return (
    <FormularioNuevoPartidoFlow
      onConfirmar={async (partido) => {
        console.log('Match created:', partido.id);
        navigateWithAnimation(`/admin/${partido.id}`);
        return partido;
      }}
      onVolver={() => navigateWithAnimation('/', 'back')}
    />
  );
};

export default NuevoPartidoPage;
