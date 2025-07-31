import React from 'react';
import './PageTitle.css';

const PageTitle = ({ children, title, onBack }) => {
  const titleText = children || title;

  return (
    <div className="page-title-header">
      <div className="page-title-content">
        {onBack && (
          <button className="page-title-back-button" onClick={onBack}>
            <svg width="24" height="24" viewBox="0 0 32 32" fill="currentColor">
              <polygon points="22,4 10,15.999 22,28" />
            </svg>
          </button>
        )}
        <h2 className="page-title-text">{titleText}</h2>
      </div>
    </div>
  );
};

export default PageTitle;