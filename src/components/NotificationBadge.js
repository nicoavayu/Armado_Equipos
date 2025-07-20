import React from 'react';
import './NotificationBadge.css';

const NotificationBadge = ({ count, showZero = false }) => {
  if (count === 0 && !showZero) return null;
  
  return (
    <div className="notification-badge">
      {count > 99 ? '99+' : count}
    </div>
  );
};

export default NotificationBadge;