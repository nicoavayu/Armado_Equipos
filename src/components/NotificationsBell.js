import React from 'react';
import './NotificationsBell.css';

const NotificationsBell = ({ unreadCount, onClick }) => {
  return (
    <button className="notifications-bell" onClick={onClick}>
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 24 24" 
        fill="currentColor" 
        className="bell-icon"
      >
        <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
      </svg>
      {(unreadCount?.total || 0) > 0 && (
        <span className="notification-dot"></span>
      )}
    </button>
  );
};

export default NotificationsBell;