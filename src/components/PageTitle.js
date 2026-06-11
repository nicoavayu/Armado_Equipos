import { HiMiniChatBubbleOvalLeft } from 'react-icons/hi2';
import { toSentenceCase } from '../utils/textCase';

/**
 * @param {Object} props
 * @param {React.ReactNode} [props.children]
 * @param {string} [props.title]
 * @param {() => void} [props.onBack]
 * @param {boolean} [props.showChatButton] - Mostrar botón de chat en el header
 * @param {() => void} [props.onChatClick] - Handler para abrir chat
 * @param {number} [props.unreadCount] - Contador de mensajes sin leer
 * @param {React.ReactNode} [props.rightActions] - Nodo opcional para renderizar acciones a la derecha
 * @param {number} [props.contentOffsetY] - Desplazamiento vertical interno del contenido (px)
 * @param {boolean} [props.respectSafeArea] - Empuja el contenido del header debajo de la safe area
 * @param {string} [props.topOffset] - Desplazamiento superior del contenedor fijo
 * @param {'fixed'|'sticky'|'static'} [props.position] - Estrategia de posicionamiento del header
 */
const PageTitle = ({
  children,
  title,
  onBack,
  showChatButton,
  onChatClick,
  unreadCount = 0,
  rightActions = null,
  contentOffsetY = 0,
  respectSafeArea = false,
  topOffset,
  position = 'fixed',
}) => {
  const titleText = children ?? title;
  const normalizedTitle = toSentenceCase(titleText);
  const containerStyle = {
    ...(respectSafeArea
      ? {
        paddingTop: 'max(18px, calc(var(--safe-top, 0px) + 12px))',
        paddingRight: 'max(16px, calc(var(--safe-right, 0px) + 16px))',
        paddingBottom: '18px',
        paddingLeft: 'max(16px, calc(var(--safe-left, 0px) + 16px))',
      }
      : {}),
    ...(topOffset ? { top: topOffset } : {}),
  };

  return (
    <div
      className={`${position === 'sticky' ? 'sticky' : position === 'static' ? 'relative' : 'fixed'} top-0 left-0 right-0 z-[1000] p-[14px_16px] box-border shrink-0 bg-[#120e28]/95 backdrop-blur-md border-b border-[rgba(148,134,255,0.14)] shadow-[0_10px_28px_rgba(5,3,16,0.4)] after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-[linear-gradient(90deg,transparent_8%,rgba(139,92,255,0.5)_40%,rgba(236,0,125,0.35)_64%,transparent_92%)] md:p-[12px_12px]`}
      style={Object.keys(containerStyle).length > 0 ? containerStyle : undefined}
    >
      <div
        className="relative w-full min-h-[44px]"
        style={{
          transform: contentOffsetY ? `translateY(${contentOffsetY}px)` : undefined,
        }}
      >
        {onBack && (
          <button
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/[0.06] border border-[rgba(148,134,255,0.25)] text-white cursor-pointer py-2 px-3 rounded-full transition-all duration-200 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/[0.12] hover:border-[rgba(148,134,255,0.45)] active:scale-95 group shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
            onClick={(e) => {
              e.stopPropagation();
              onBack();
            }}
          >
            <svg width="20" height="20" viewBox="0 0 32 32" fill="currentColor" className="transition-transform group-hover:-translate-x-1 md:w-[18px] md:h-[18px]">
              <polygon points="22,4 10,15.999 22,28" />
            </svg>
          </button>
        )}
        <h2 className="m-0 font-oswald font-bold text-center text-white absolute top-1/2 left-0 -translate-y-1/2 w-full px-[52px] text-[17px] tracking-[0.08em] uppercase whitespace-normal break-words drop-shadow-[0_2px_10px_rgba(106,67,255,0.35)] md:text-[16px] xs:text-[15px]">
          {normalizedTitle}
        </h2>

        {rightActions ? (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex items-center">
            {rightActions}
          </div>
        ) : showChatButton ? (
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
        ) : null}
      </div>
    </div>
  );
};

export default PageTitle;
