// Example integration file showing how to use the enhanced components
import React, { useState } from 'react';
import Button from './Button';
import LoadingSpinner from './LoadingSpinner';
import Modal from './Modal';
import ShareButton from './ShareButton';
import ProtectedRoute from './ProtectedRoute';
import { handleSuccess, handleError, withLoading } from '../utils/errorHandler';

const EnhancedComponentsExample = () => {
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const handleAsyncAction = async () => {
    await withLoading(
      async () => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 2000));
        handleSuccess('Operación completada exitosamente');
      },
      setLoading,
      'Error en la operación',
    );
  };

  return (
    <div className="enhanced-components-demo">
      <h2>Enhanced Components Demo</h2>
      
      {/* Enhanced Button with animations */}
      <Button
        onClick={handleAsyncAction}
        loading={loading}
        variant="primary"
        ariaLabel="Ejecutar acción de ejemplo"
      >
        ACCIÓN CON LOADING
      </Button>

      {/* Loading Spinner variants */}
      <div style={{ margin: '20px 0' }}>
        <LoadingSpinner size="sm" message="Cargando pequeño..." />
        <LoadingSpinner size="md" message="Cargando mediano..." />
        <LoadingSpinner variant="shimmer" />
      </div>

      {/* Modal with accessibility */}
      <Button onClick={() => setModalOpen(true)}>
        ABRIR MODAL
      </Button>
      
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Modal de Ejemplo"
      >
        <p>Este modal tiene gestión de foco y navegación por teclado.</p>
        <Button onClick={() => setModalOpen(false)}>
          CERRAR
        </Button>
      </Modal>

      {/* Share functionality */}
      <ShareButton
        url={window.location.href}
        title="Compartir esta página"
        message="Enlace copiado exitosamente"
      />

      {/* Protected content example */}
      <ProtectedRoute requireAuth={false}>
        <div style={{ padding: '20px', background: '#f0f0f0', margin: '20px 0' }}>
          <p>Este contenido está protegido pero accesible sin autenticación.</p>
        </div>
      </ProtectedRoute>
    </div>
  );
};

export default EnhancedComponentsExample;