import React from 'react';
import { isChunkLoadError, recoverFromChunkLoadError } from '../utils/chunkLoadRecovery';

class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('GlobalErrorBoundary caught error:', error, errorInfo.componentStack);

    if (isChunkLoadError(error)) {
      recoverFromChunkLoadError();
    }
  }

  handleRetry = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '20px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          fontFamily: 'Oswald, Arial, sans-serif',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '48px', marginBottom: '16px', fontFamily: 'Bebas Neue, Arial, sans-serif' }}>
            Uy, algo falló
          </h1>
          <p style={{ fontSize: '18px', marginBottom: '32px', opacity: 0.9 }}>
            {chunkError
              ? 'La app se actualizó y faltó un archivo en caché. Recargá para sincronizar.'
              : 'Intentá recargar la página. Si persiste, avisanos.'}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              background: '#0EA9C6',
              border: 'none',
              borderRadius: '10px',
              color: 'white',
              padding: '12px 32px',
              fontSize: '16px',
              fontWeight: '700',
              cursor: 'pointer',
              fontFamily: 'Bebas Neue, Arial, sans-serif',
              letterSpacing: '0.5px',
            }}
          >
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
