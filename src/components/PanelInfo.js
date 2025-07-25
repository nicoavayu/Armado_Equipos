import React from 'react';
import './PanelInfo.css';

const PanelInfo = () => {
  // Datos hardcodeados para demo
  const notifications = [
    { id: 1, message: 'Hoy jugás a las 20:00 en Sede Palermo', type: 'match' },
    { id: 2, message: 'Se sumó Juan al partido del viernes', type: 'player' },
    { id: 3, message: 'Faltan 3 jugadores para el partido', type: 'alert' },
  ];

  return (
    <div className="panel-info">
      <div className="panel-info-header">
        <h4>Resumen</h4>
      </div>
      <div className="panel-info-content">
        {notifications.map((notification) => (
          <div key={notification.id} className={`panel-info-item ${notification.type}`}>
            <div className="panel-info-icon">
              {notification.type === 'match' && '⚽'}
              {notification.type === 'player' && '👤'}
              {notification.type === 'alert' && '⚠️'}
            </div>
            <div className="panel-info-text">{notification.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PanelInfo;