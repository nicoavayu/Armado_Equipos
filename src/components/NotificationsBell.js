import React from 'react';

const NotificationsBell = ({ unreadCount, onClick }) => {
  return (
    <button
      className="relative bg-transparent border-none cursor-pointer p-2 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 active:bg-white/20 active:scale-95 md:p-3 group"
      onClick={onClick}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-6 h-6 text-white md:w-[26px] md:h-[26px]"
      >
        <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
      </svg>
      {(unreadCount?.total || 0) > 0 && (
        <span className="absolute bottom-[6px] left-[6px] bg-[#ff0000] w-2 h-2 rounded-full shadow-[0_0_0_2px_#0864b2,0_2px_4px_rgba(0,0,0,0.3)] z-[100] md:bottom-2 md:left-2 md:w-[10px] md:h-[10px]"></span>
      )}
    </button>
  );
};

export default NotificationsBell;