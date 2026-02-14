import React from 'react';

const NotificationBadge = ({ count, showZero = false }) => {
  if (count === 0 && !showZero) return null;

  return (
    <>
      <style>
        {`
          @keyframes pulse-scale {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
          }
        `}
      </style>
      <div className="absolute -top-[5px] -right-[5px] bg-[#128BE9] text-white rounded-full min-w-[18px] h-[18px] text-[11px] font-bold flex items-center justify-center px-1 shadow-[0_2px_4px_rgba(0,0,0,0.2)] z-10 animate-[pulse-scale_1.5s_infinite]">
        {count > 99 ? '99+' : count}
      </div>
    </>
  );
};

export default NotificationBadge;
