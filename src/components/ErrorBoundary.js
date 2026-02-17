import React from 'react';
import { isChunkLoadError, recoverFromChunkLoadError } from '../utils/chunkLoadRecovery';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    if (isChunkLoadError(error)) {
      recoverFromChunkLoadError();
    }
  }

  render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <div style={{ padding: '20px', textAlign: 'center', color: 'white' }}>
          <h2>Algo salió mal</h2>
          <p>
            {chunkError
              ? 'La app se actualizó y este navegador quedó con archivos viejos en caché.'
              : `Error: ${this.state.error?.message || 'Error desconocido'}`}
          </p>
          <button onClick={() => {
            try {
              if (chunkError) {
                window.location.reload();
                return;
              }

              if (typeof window !== 'undefined' && window.history) {
                window.history.pushState({}, '', '/');
                window.dispatchEvent(new PopStateEvent('popstate'));
              } else {
                window.location.href = '/';
              }
            } catch {
              window.location.href = '/';
            }
          }}>
            {chunkError ? 'Recargar app' : 'Volver al inicio'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
