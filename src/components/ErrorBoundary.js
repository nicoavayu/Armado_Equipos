import React from 'react';
import { toast } from 'react-toastify';
import Button from './Button';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    
    // Log error for debugging (only in development)
    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo);
    }
    
    // Show toast notification
    toast.error('Ha ocurrido un error inesperado');
  }

  handleReportError = () => {
    const errorReport = {
      error: this.state.error?.message || 'Unknown error',
      stack: this.state.error?.stack,
      componentStack: this.state.errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };
    
    // For now, just copy to clipboard - can be enhanced to send to error reporting service
    navigator.clipboard.writeText(JSON.stringify(errorReport, null, 2))
      .then(() => {
        toast.success('Información del error copiada al portapapeles');
      })
      .catch(() => {
        toast.error('No se pudo copiar la información del error');
      });
  };

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
              lineHeight: '1.4',
            }}>
              Ha ocurrido un error inesperado. Por favor, recarga la página para continuar.
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button
                onClick={() => window.location.reload()}
                variant="primary"
                ariaLabel="Recargar página"
              >
                RECARGAR PÁGINA
              </Button>
              <Button
                onClick={this.handleReportError}
                variant="secondary"
                ariaLabel="Reportar error"
              >
                REPORTAR ERROR
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;