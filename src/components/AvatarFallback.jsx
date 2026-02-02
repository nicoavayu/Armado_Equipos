import React from 'react';

/**
 * Helper to get initials from name
 * 1 letter if single word, 2 letters (first + last) if multiple words.
 */
export const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
        return parts[0].charAt(0).toUpperCase();
    }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

const AvatarFallback = ({ name, size = 'w-8 h-8', className = '' }) => {
    return (
        <div className={`${size} rounded-full bg-gradient-to-br from-blue-500 to-purple-600 border border-white/20 flex items-center justify-center font-bold text-white uppercase shrink-0 ${className}`}>
            <span className="leading-none">{getInitials(name)}</span>
        </div>
    );
};

export default AvatarFallback;
