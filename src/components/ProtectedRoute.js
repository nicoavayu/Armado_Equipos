import React from 'react';
import { useAuth } from './AuthProvider';
import LoadingSpinner from './LoadingSpinner';
import Button from './Button';

const ProtectedRoute = ({ children, requireAuth = true, fallback = null }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <LoadingSpinner size="lg" message="Verificando autenticación..." />
        </div>
      </div>
    );
  }

  if (requireAuth && !user) {
    return fallback || (
      <div className="voting-bg">
        <div className="voting-modern-card" style={{ maxWidth: 400 }}>
          <div className="match-name" style={{ marginBottom: '20px' }}>
            ACCESO RESTRINGIDO
          </div>
          <div style={{
            color: '#fff',
            textAlign: 'center',
            fontFamily: 'Oswald, Arial, sans-serif',
            fontSize: '18px',
            marginBottom: '30px',
            lineHeight: '1.4',
          }}>
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