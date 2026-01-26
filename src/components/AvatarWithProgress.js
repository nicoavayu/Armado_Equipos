import React from 'react';

export default function AvatarWithProgress({ profile, onClick, size = 60 }) {
  const completion = profile?.profile_completion || 0;

  // No need for foto_url fallback anymore

  // Calculate which quarter we're in and colors
  const getQuarterInfo = (percentage) => {
    if (percentage <= 25) return { quarter: 1, color: '#dc3545', bgColor: 'rgba(220, 53, 69, 0.1)' };
    if (percentage <= 50) return { quarter: 2, color: '#ffc107', bgColor: 'rgba(255, 193, 7, 0.1)' };
    if (percentage <= 75) return { quarter: 3, color: '#20c997', bgColor: 'rgba(32, 201, 151, 0.1)' };
    if (percentage < 100) return { quarter: 4, color: '#28a745', bgColor: 'rgba(40, 167, 69, 0.1)' };
    return { quarter: 5, color: '#28a745', bgColor: 'rgba(40, 167, 69, 0.2)', glow: true };
  };

  const quarterInfo = getQuarterInfo(completion);
  const strokeWidth = 3;
  const radius = (size / 2) - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (completion / 100) * circumference;

  // Show loading state if no profile yet
  if (!profile) {
    return (
      <div
        className="relative cursor-pointer transition-transform duration-200 ease-linear hover:scale-105"
        onClick={onClick}
        style={{ width: size, height: size }}
      >
        <svg className="pointer-events-none" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth={strokeWidth}
          />
        </svg>
        <div className="absolute inset-[6px] rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
          <div className="text-2xl text-white/70 max-[600px]:text-[20px]">👤</div>
        </div>
        <div className="absolute -top-1 -right-1 min-w-[24px] h-5 rounded-[10px] flex items-center justify-center text-[10px] font-semibold font-[Oswald,Arial,sans-serif] border-2 border-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] max-[600px]:min-w-[20px] max-[600px]:h-[18px] max-[600px]:text-[9px]" style={{ backgroundColor: '#666', color: 'white' }}>...</div>
      </div>
    );
  }

  return (
    <div
      className={`relative cursor-pointer transition-transform duration-200 ease-linear hover:scale-105 ${quarterInfo.glow ? 'animate-[completionPulse_2s_ease-in-out_infinite]' : ''}`}
      onClick={onClick}
      style={{ width: size, height: size }}
    >
      <style>
        {`
          @keyframes completionPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
          }
          @keyframes glowPulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
          }
        `}
      </style>

      {/* Progress Ring */}
      <svg
        className="pointer-events-none"
        width={size}
        height={size}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth={strokeWidth}
        />

        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={quarterInfo.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          className="transition-[stroke-dashoffset,stroke] duration-[800ms,300ms] ease-[ease-in-out,ease]"
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
            filter: quarterInfo.glow ? 'drop-shadow(0 0 8px currentColor)' : 'none',
          }}
        />
      </svg>

      {/* Avatar */}
      <div className="absolute inset-[6px] rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt="Perfil"
            className="w-full h-full object-cover rounded-full"
          />
        ) : (
          <div className="text-2xl text-white/70 max-[600px]:text-[20px]">
            👤
          </div>
        )}
      </div>

      {/* Progress Badge */}
      {completion < 100 && (
        <div
          className="absolute -top-1 -right-1 min-w-[24px] h-5 rounded-[10px] flex items-center justify-center text-[10px] font-semibold font-[Oswald,Arial,sans-serif] border-2 border-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] max-[600px]:min-w-[20px] max-[600px]:h-[18px] max-[600px]:text-[9px]"
          style={{
            backgroundColor: quarterInfo.color,
            color: 'white',
          }}
        >
          {completion}%
        </div>
      )}

      {/* Completion Glow Effect */}
      {completion === 100 && (
        <div className="absolute -inset-1 rounded-full bg-[radial-gradient(circle,rgba(40,167,69,0.3)_0%,transparent_70%)] animate-[glowPulse_2s_ease-in-out_infinite] pointer-events-none"></div>
      )}
    </div>
  );
}