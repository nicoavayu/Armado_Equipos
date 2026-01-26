import React from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import QuieroJugar from './QuieroJugar';

const QuieroJugarPage = () => {
    const { navigateWithAnimation } = useAnimatedNavigation();
    return (
        <PageTransition>
            <QuieroJugar onVolver={() => navigateWithAnimation('/', 'back')} />
        </PageTransition>
    );
};

export default QuieroJugarPage;
