import React from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import StatsView from '../components/StatsView';

const StatsPage = () => {
    const { navigateWithAnimation } = useAnimatedNavigation();
    return (
        <PageTransition>
            <StatsView onVolver={() => navigateWithAnimation('/', 'back')} />
        </PageTransition>
    );
};

export default StatsPage;
