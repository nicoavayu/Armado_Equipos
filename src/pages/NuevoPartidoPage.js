import React from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import FormularioNuevoPartidoFlow from './FormularioNuevoPartidoFlow';

const NuevoPartidoPage = () => {
    const { navigateWithAnimation } = useAnimatedNavigation();
    return (
        <PageTransition>
            <FormularioNuevoPartidoFlow
                onConfirmar={async (partido) => {
                    console.log('Match created:', partido.id);
                    navigateWithAnimation(`/admin/${partido.id}`);
                    return partido;
                }}
                onVolver={() => navigateWithAnimation('/', 'back')}
            />
        </PageTransition>
    );
};

export default NuevoPartidoPage;
