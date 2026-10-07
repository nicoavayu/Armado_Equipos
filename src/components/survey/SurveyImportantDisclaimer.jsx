import React from 'react';

const VARIANTS = {
  // Pre-match voting keeps its original look.
  default: {
    box: 'rounded-[8px] border border-white/18 bg-white/[0.06] px-3 py-2 sm:px-3.5 sm:py-2.5',
    title: 'text-center font-bebas text-[15px] tracking-[0.08em] text-[#9EE7FF] sm:text-[16px]',
    message: 'mt-0.5 text-center font-oswald text-[12px] leading-snug text-white/84 sm:text-[13px]',
  },
  // Post-match survey: a quieter note in the survey's violet palette.
  survey: {
    box: 'rounded-[16px] border border-[rgba(148,134,255,0.22)] bg-white/[0.04] px-3.5 py-2.5',
    title: 'text-center font-bebas text-[13px] tracking-[0.16em] text-[#b9a6ff]',
    message: 'mt-0.5 text-center font-oswald text-[12.5px] leading-snug text-white/72',
  },
};

const SurveyImportantDisclaimer = ({
  title = 'IMPORTANTE',
  message = 'Completar la encuesta con seriedad y veracidad hace una comunidad más justa y limpia. ¡Viva el fútbol!',
  className = '',
  variant = 'default',
}) => {
  const styles = VARIANTS[variant] || VARIANTS.default;
  return (
    <div className={`${styles.box} ${className}`.trim()}>
      <div className={styles.title}>
        {title}
      </div>
      <div className={styles.message}>
        {message}
      </div>
    </div>
  );
};

export default SurveyImportantDisclaimer;
