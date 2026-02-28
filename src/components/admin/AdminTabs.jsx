import React from 'react';

const TAB_SKEW_X = 4;

/**
 * Tab selector component for AdminPanel
 * @param {Object} props - Component props
 */
const AdminTabs = ({ activeTab, onTabChange, pendingCount = 0 }) => {
    return (
        <div className="w-full max-w-full mx-auto mb-3">
            <div className="flex gap-2 bg-white/[0.05] border border-white/10 rounded-[12px] p-1">
                <button
                    className={`flex-1 h-11 px-0 border rounded-[10px] transition-colors ${activeTab === 'jugadores'
                            ? 'bg-[#1a2147] border-[rgba(122,102,255,0.45)] text-white'
                            : 'bg-transparent border-white/15 text-white/55 hover:text-white/75 hover:border-white/30'
                        }`}
                    style={{ transform: `skewX(-${TAB_SKEW_X}deg)` }}
                    onClick={() => onTabChange('jugadores')}
                >
                    <span
                        className="h-full w-full inline-flex items-center justify-center font-bebas text-sm tracking-wider"
                        style={{ transform: `skewX(${TAB_SKEW_X}deg)` }}
                    >
                        JUGADORES
                    </span>
                </button>
                <button
                    className={`flex-1 h-11 px-0 border rounded-[10px] transition-colors ${activeTab === 'solicitudes'
                            ? 'bg-[#1a2147] border-[rgba(122,102,255,0.45)] text-white'
                            : 'bg-transparent border-white/15 text-white/55 hover:text-white/75 hover:border-white/30'
                        }`}
                    style={{ transform: `skewX(-${TAB_SKEW_X}deg)` }}
                    onClick={() => onTabChange('solicitudes')}
                >
                    <span
                        className="h-full w-full inline-flex items-center justify-center gap-1.5 font-bebas text-sm tracking-wider"
                        style={{ transform: `skewX(${TAB_SKEW_X}deg)` }}
                    >
                        SOLICITUDES
                        {pendingCount > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-white/20 text-white text-[10px] font-bold rounded-full border border-white/25 font-sans tracking-normal">
                                {pendingCount}
                            </span>
                        )}
                        </span>
                </button>
            </div>
        </div>
    );
};

export default AdminTabs;
