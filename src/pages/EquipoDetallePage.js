import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import PageTitle from '../components/PageTitle';
import PageTransition from '../components/PageTransition';
import EquipoDetalleView from '../features/equipos/views/EquipoDetalleView';

const EquipoDetallePage = () => {
  const navigate = useNavigate();
  const { teamId } = useParams();
  const { user } = useAuth();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/quiero-jugar');
  };

  return (
    <PageTransition>
      <PageTitle title="Editar equipo" onBack={handleBack}>Editar equipo</PageTitle>
      <EquipoDetalleView teamId={teamId} userId={user?.id} />
    </PageTransition>
  );
};

export default EquipoDetallePage;
