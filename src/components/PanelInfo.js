import React from 'react';


const PanelInfo = () => {
  // Datos hardcodeados para demo
  const notifications = [
    { id: 1, message: 'Hoy jugás a las 20:00 en Sede Palermo', type: 'match' },
    { id: 2, message: 'Se sumó Juan al partido del viernes', type: 'player' },
    { id: 3, message: 'Faltan 3 jugadores para el partido', type: 'alert' },
  ];

  const getTypeStyles = (type) => {
    switch (type) {
      case 'match': return 'border-l-[3px] border-[#4CAF50]';
      case 'player': return 'border-l-[3px] border-[#2196F3]';
      case 'alert': return 'border-l-[3px] border-[#FF9800]';
      default: return '';
    }
  };

  return (
    <div className="bg-white/15 border border-white/20 rounded-xl my-5 p-4 w-full box-border">
      <div className="mb-3">
        <h4 className="text-white font-bebas text-xl m-0 uppercase">Resumen</h4>
      </div>
      <div className="flex flex-col gap-2">
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`flex items-center px-3 py-2 bg-white/10 rounded-lg min-h-[48px] box-border ${getTypeStyles(notification.type)}`}
          >
            <div className="mr-3 text-lg min-w-[24px] text-center">
              {notification.type === 'match' && '⚽'}
              {notification.type === 'player' && '👤'}
              {notification.type === 'alert' && '⚠️'}
            </div>
            <div className="text-white/90 text-sm leading-[1.4] flex-1">{notification.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PanelInfo;