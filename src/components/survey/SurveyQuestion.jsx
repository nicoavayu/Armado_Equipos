import React from 'react';

/**
 * The question of a survey step: an icon tile, the question (the step's <h1>) and a short
 * hint on how to answer. `titleId` labels the answer group for screen readers.
 */
const SurveyQuestion = ({
  icon: Icon = null,
  title,
  hint = '',
  titleId = 'survey-step-title',
  children = null,
  compact = false,
}) => (
  <div className="flex w-full flex-col items-center text-center">
    {Icon ? (
      <span
        className={`a2-survey-icon inline-flex items-center justify-center rounded-[18px] border border-[rgba(167,139,250,0.4)] bg-[linear-gradient(140deg,rgba(139,92,255,0.42),rgba(106,67,255,0.12))] text-white shadow-[0_10px_26px_rgba(54,32,140,0.45),inset_0_1px_0_rgba(255,255,255,0.22)] ${compact ? 'mb-2.5 h-12 w-12' : 'mb-3.5 h-14 w-14'}`}
        aria-hidden="true"
      >
        <Icon size={compact ? 24 : 28} strokeWidth={2.1} />
      </span>
    ) : null}
    <h1
      id={titleId}
      className={`w-full px-2 font-bebas font-bold uppercase text-white drop-shadow-[0_8px_18px_rgba(6,9,36,0.42)] [text-wrap:balance] ${compact ? 'text-[26px] leading-[1.02] tracking-[0.035em]' : 'text-[30px] leading-[1.02] tracking-[0.04em]'}`}
    >
      {title}
    </h1>
    {hint ? (
      <p className={`mt-1.5 max-w-[34ch] font-oswald leading-snug text-white/72 ${compact ? 'text-[13px]' : 'text-[14px]'}`}>
        {hint}
      </p>
    ) : null}
    {children}
  </div>
);

export default SurveyQuestion;
