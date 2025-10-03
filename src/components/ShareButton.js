import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useTimeout } from '../hooks/useTimeout';
import { handleSuccess, handleError } from '../utils/errorHandler';
import Button from './Button';

const ShareButton = ({ 
  url, 
  title = 'Compartir', 
  message = 'Enlace copiado al portapapeles',
  variant = 'secondary',
  className = '',
  children,
  showWhatsApp = true,
}) => {
  const [copied, setCopied] = useState(false);
  const { setTimeoutSafe } = useTimeout();

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      handleSuccess(message);
      setTimeoutSafe(() => setCopied(false), 2000);
    } catch (error) {
      handleError(error, 'No se pudo copiar el enlace');
    }
  };

  const shareWhatsApp = () => {
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(url)}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <div className={`share-button-container ${className}`}>
      <motion.div
        animate={copied ? { scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 0.3 }}
      >
        <Button
          onClick={copyToClipboard}
          variant={variant}
          ariaLabel={`Copiar enlace: ${title}`}
          style={{
            background: copied ? '#22c55e' : undefined,
            marginBottom: showWhatsApp ? '8px' : '0',
          }}
        >
          {copied ? '✓ COPIADO' : children || 'COPIAR ENLACE'}
        </Button>
      </motion.div>
      
      {showWhatsApp && (
        <Button
          onClick={shareWhatsApp}
          variant="whatsapp"
          ariaLabel={`Compartir por WhatsApp: ${title}`}
        >
          📱 COMPARTIR POR WHATSAPP
        </Button>
      )}
    </div>
  );
};

export default ShareButton;