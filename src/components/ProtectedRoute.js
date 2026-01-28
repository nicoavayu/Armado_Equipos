import React from 'react';
import { useAuth } from './AuthProvider';
import LoadingSpinner from './LoadingSpinner';
import Button from './Button';

const ProtectedRoute = ({ children, requireAuth = true, fallback = null }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex flex-col items-center justify-center gap-4">
        <LoadingSpinner size="lg" />
        <div className="text-white font-oswald text-lg">Verificando autenticación...</div>
      </div>
    );
  }

  if (requireAuth && !user) {
    return fallback || (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-5">
        <div className="bg-white/10 p-8 rounded-2xl shadow-fifa-card backdrop-blur-md flex flex-col items-center max-w-[400px] w-full">
          <div className="text-white text-3xl font-bebas mb-5 tracking-wider">
            ACCESO RESTRINGIDO
          </div>
          <div className="text-white text-center font-oswald text-lg mb-8 leading-relaxed">
            Necesitas iniciar sesión para acceder a esta función.
          </div>
          <Button
            onClick={() => window.location.reload()}
            variant="primary"
            ariaLabel="Iniciar sesión"
          >
            INICIAR SESIÓN
          </Button>
        </div>
      </div>
    );
  }

  return children;
};

export default ProtectedRoute;