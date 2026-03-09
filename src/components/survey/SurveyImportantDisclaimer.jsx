import React from 'react';

const SurveyImportantDisclaimer = ({
  title = 'IMPORTANTE',
  message = 'Completar la encuesta con seriedad y veracidad hace una comunidad más justa y limpia. ¡Viva el fútbol!',
  className = '',
}) => (
  <div className={`rounded-[8px] border border-white/18 bg-white/[0.06] px-3.5 py-2.5 sm:px-4 sm:py-3 ${className}`.trim()}>
    <div className="text-center font-bebas text-[16px] tracking-[0.08em] text-[#9EE7FF] sm:text-[17px]">
      {title}
    </div>
    <div className="mt-0.5 text-center font-oswald text-[13px] leading-snug text-white/86 sm:text-[14px]">
      {message}
    </div>
  </div>
);

export default SurveyImportantDisclaimer;
