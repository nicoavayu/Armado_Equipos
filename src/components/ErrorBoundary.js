import logger from '../utils/logger';
import React from 'react';
import { isChunkLoadError, recoverFromChunkLoadError } from '../utils/chunkLoadRecovery';
import { captureException } from '../utils/monitoring/sentry';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.lastReportedErrorSignature = null;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const componentStack = errorInfo?.componentStack || '';
    const chunkLoadError = isChunkLoadError(error);
    const errorSignature = [
      'ErrorBoundary',
      error?.name || 'UnknownError',
      error?.message || 'Unknown message',
      componentStack,
    ].join('::');

    logger.error('ErrorBoundary caught an error:', error, errorInfo);

    if (this.lastReportedErrorSignature !== errorSignature) {
      this.lastReportedErrorSignature = errorSignature;
      captureException(error, {
        boundaryName: 'ErrorBoundary',
        componentStack,
        errorKind: chunkLoadError ? 'chunk-load' : 'render',
        isChunkLoadError: chunkLoadError,
        recoveryStrategy: chunkLoadError ? 'recoverFromChunkLoadError' : 'none',
      });
    }

    if (chunkLoadError) {
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
                const recovered = recoverFromChunkLoadError({ force: true });
                if (!recovered) {
                  window.location.reload();
                }
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
