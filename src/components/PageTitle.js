import React from 'react';

/**
 * @param {Object} props
 * @param {React.ReactNode} [props.children]
 * @param {string} [props.title]
 * @param {() => void} [props.onBack]
 */
const PageTitle = ({ children, title, onBack }) => {
  const titleText = children || title;

  return (
    <div className="fixed top-0 left-0 right-0 z-[1000] p-[18px_16px] box-border shrink-0 bg-black/40 backdrop-blur-xl border-b border-white/10 md:p-[14px_12px]">
      <div className="flex items-center justify-center relative w-full">
        {onBack && (
          <button
            className="absolute left-0 z-10 bg-white/5 border border-white/10 text-white cursor-pointer py-2 px-3 rounded-2xl transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/15 hover:scale-105 active:scale-95 group"
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
        <h2 className="m-0 font-bebas text-[30px] font-bold tracking-[2px] text-center text-white flex-1 uppercase md:text-[26px] md:mt-[2px] xs:text-[24px] drop-shadow-lg">{titleText}</h2>
      </div>
    </div>
  );
};

export default PageTitle;