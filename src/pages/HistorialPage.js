import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import EditarPartidoFrecuente from './EditarPartidoFrecuente';
import ListaPartidosFrecuentes from './ListaPartidosFrecuentes';
import { crearPartidoDesdeFrec } from '../supabase';

const HistorialPage = () => {
    const { navigateWithAnimation } = useAnimatedNavigation();
    const [partidoFrecuenteEditando, setPartidoFrecuenteEditando] = useState(null);
    const [step, setStep] = useState('list');

    if (step === 'edit' && partidoFrecuenteEditando) {
        return (
            <PageTransition>
                <div className="pb-24 w-full flex flex-col items-center">
                    <EditarPartidoFrecuente
                        partido={partidoFrecuenteEditando}
                        onGuardado={() => {
                            setPartidoFrecuenteEditando(null);
                            setStep('list');
                        }}
                        onVolver={() => {
                            setPartidoFrecuenteEditando(null);
                            setStep('list');
                        }}
                    />
                </div>
            </PageTransition>
        );
    }

    return (
        <PageTransition>
            <div className="pb-24 w-full flex flex-col items-center">
                <ListaPartidosFrecuentes
                    onEntrar={async (partidoFrecuente) => {
                        try {
                            const hoy = new Date().toISOString().split('T')[0];
                            const partido = await crearPartidoDesdeFrec(partidoFrecuente, hoy);
                            navigateWithAnimation(`/admin/${partido.id}`);
                        } catch (error) {
                            toast.error('Error al crear el partido');
                        }
                    }}
                    onEditar={(partido) => {
                        setPartidoFrecuenteEditando(partido);
                        setStep('edit');
                    }}
                    onVolver={() => navigateWithAnimation('/', 'back')}
                />
            </div>
        </PageTransition>
    );
};

export default HistorialPage;
