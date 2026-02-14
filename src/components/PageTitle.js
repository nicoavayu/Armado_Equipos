import { HiMiniChatBubbleOvalLeft } from 'react-icons/hi2';

/**
 * @param {Object} props
 * @param {React.ReactNode} [props.children]
 * @param {string} [props.title]
 * @param {() => void} [props.onBack]
 * @param {boolean} [props.showChatButton] - Mostrar botón de chat en el header
 * @param {() => void} [props.onChatClick] - Handler para abrir chat
 * @param {number} [props.unreadCount] - Contador de mensajes sin leer
 */
const PageTitle = ({ children, title, onBack, showChatButton, onChatClick, unreadCount = 0 }) => {
  const titleText = children || title;

  return (
    <div className="fixed top-0 left-0 right-0 z-[1000] p-[18px_16px] box-border shrink-0 bg-black/40 backdrop-blur-xl border-b border-white/10 md:p-[14px_12px]">
      <div className="relative w-full min-h-[44px]">
        {onBack && (
          <button
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/5 border border-white/10 text-white cursor-pointer py-2 px-3 rounded-2xl transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/15 hover:scale-105 active:scale-95 group"
            onClick={(e) => {
              e.stopPropagation();
              onBack();
            }}
          >
            <svg width="24" height="24" viewBox="0 0 32 32" fill="currentColor" className="transition-transform group-hover:-translate-x-1 md:w-5 md:h-5">
              <polygon points="22,4 10,15.999 22,28" />
            </svg>
          </button>
        )}
        <h2 className="m-0 font-bebas-real font-bold text-center text-white absolute top-1/2 left-0 -translate-y-1/2 w-full uppercase drop-shadow-lg px-[52px] text-[26px] tracking-[1px] whitespace-normal break-words md:text-[22px] xs:text-[20px]">
          {titleText}
        </h2>

        {/* Botón de chat en header */}
        {showChatButton && (
          <button
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 text-white cursor-pointer p-2 transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center hover:text-white/90 active:scale-95"
            onClick={(e) => {
              e.stopPropagation();
              onChatClick?.();
            }}
            aria-label="Abrir chat"
          >
            <HiMiniChatBubbleOvalLeft className="w-6 h-6 md:w-5 md:h-5" />

            {/* Badge de mensajes sin leer */}
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#128BE9] text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 shadow-lg">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default PageTitle;
