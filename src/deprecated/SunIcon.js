// src/components/SunIcon.js
import React from 'react';

const SunIcon = (props) => (
  <svg height="18" width="18" viewBox="0 0 20 20" fill="gold" {...props}><circle cx="10" cy="10" r="6"/><g stroke="gold" strokeWidth="2"><line x1="10" y1="1" x2="10" y2="4"/><line x1="10" y1="16" x2="10" y2="19"/><line x1="1" y1="10" x2="4" y2="10"/><line x1="16" y1="10" x2="19" y2="10"/><line x1="4.5" y1="4.5" x2="6.5" y2="6.5"/><line x1="13.5" y1="13.5" x2="15.5" y2="15.5"/><line x1="4.5" y1="15.5" x2="6.5" y2="13.5"/><line x1="13.5" y1="6.5" x2="15.5" y2="4.5"/></g></svg>
);

export default SunIcon;