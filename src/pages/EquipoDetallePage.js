import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import PageTitle from '../components/PageTitle';
import PageTransition from '../components/PageTransition';
import EquipoDetalleView from '../features/equipos/views/EquipoDetalleView';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';

const EquipoDetallePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { teamId } = useParams();
  const { user } = useAuth();
  const goBackSmart = useSmartBackNavigation({
    fallback: '/desafios',
    fallbackState: { equiposSubtab: 'mis-equipos' },
  });

  const handleBack = () => goBackSmart();

  const handleOpenTeamChat = () => {
    if (!teamId) return;
    navigate(`/desafios/equipos/${teamId}/chat`, {
      state: {
        backTo: `${location.pathname}${location.search}`,
      },
    });
  };

  return (
    <PageTransition>
      <PageTitle
        title="Editar equipo"
        onBack={handleBack}
        showChatButton
        onChatClick={handleOpenTeamChat}
      >
        Editar equipo
      </PageTitle>
      <EquipoDetalleView teamId={teamId} userId={user?.id} />
    </PageTransition>
  );
};

export default EquipoDetallePage;
