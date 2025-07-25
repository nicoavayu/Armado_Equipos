import React from 'react';
import './AvatarWithProgress.css';

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
        className="avatar-with-progress"
        onClick={onClick}
        style={{ width: size, height: size }}
      >
        <svg className="progress-ring" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth={strokeWidth}
          />
        </svg>
        <div className="avatar-container">
          <div className="avatar-placeholder">👤</div>
        </div>
        <div className="progress-badge" style={{ backgroundColor: '#666', color: 'white' }}>...</div>
      </div>
    );
  }

  return (
    <div 
      className={`avatar-with-progress ${quarterInfo.glow ? 'complete' : ''}`}
      onClick={onClick}
      style={{ width: size, height: size }}
    >
      {/* Progress Ring */}
      <svg 
        className="progress-ring" 
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
          className="progress-circle"
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
            filter: quarterInfo.glow ? 'drop-shadow(0 0 8px currentColor)' : 'none',
          }}
        />
      </svg>

      {/* Avatar */}
      <div className="avatar-container">
        {profile?.avatar_url ? (
          <img 
            src={profile.avatar_url} 
            alt="Perfil" 
            className="avatar-image"
          />
        ) : (
          <div className="avatar-placeholder">
            👤
          </div>
        )}
      </div>

      {/* Progress Badge */}
      {completion < 100 && (
        <div 
          className="progress-badge"
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
        <div className="completion-glow"></div>
      )}
    </div>
  );
}