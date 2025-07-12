import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error for debugging (only in development)
    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="voting-bg">
          <div className="voting-modern-card" style={{ maxWidth: 500 }}>
            <div className="match-name" style={{ marginBottom: '20px' }}>
              ALGO SALIÓ MAL
            </div>
            <div style={{
              color: '#fff',
              textAlign: 'center',
              fontFamily: 'Oswald, Arial, sans-serif',
              fontSize: '18px',
              marginBottom: '30px',
              lineHeight: '1.4'
            }}>
              Ha ocurrido un error inesperado. Por favor, recarga la página para continuar.
            </div>
            <button
              className="voting-confirm-btn wipe-btn"
              onClick={() => window.location.reload()}
              style={{ margin: '0 auto' }}
            >
              RECARGAR PÁGINA
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;