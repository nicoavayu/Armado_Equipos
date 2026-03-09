import React from 'react';

const SurveyImportantDisclaimer = ({
  title = 'IMPORTANTE',
  message = 'Completar la encuesta con seriedad y veracidad hace una comunidad más justa y limpia. ¡Viva el fútbol!',
  className = '',
}) => (
  <div className={`rounded-[8px] border border-white/18 bg-white/[0.06] px-3 py-2 sm:px-3.5 sm:py-2.5 ${className}`.trim()}>
    <div className="text-center font-bebas text-[15px] tracking-[0.08em] text-[#9EE7FF] sm:text-[16px]">
      {title}
    </div>
    <div className="mt-0.5 text-center font-oswald text-[12px] leading-snug text-white/84 sm:text-[13px]">
      {message}
    </div>
  </div>
);

export default SurveyImportantDisclaimer;
