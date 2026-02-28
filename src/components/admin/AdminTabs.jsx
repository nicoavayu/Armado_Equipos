import React from 'react';

/**
 * Tab selector component for AdminPanel
 * @param {Object} props - Component props
 */
const AdminTabs = ({ activeTab, onTabChange, pendingCount = 0 }) => {
    return (
        <div className="w-full max-w-full mx-auto mb-3">
            <div className="grid grid-cols-2 h-11 bg-white/[0.04] border border-white/12 rounded-[6px] p-[2px]">
                <button
                    className={`h-full px-0 border-0 rounded-[4px] transition-colors ${activeTab === 'jugadores'
                            ? 'bg-white/[0.14] text-white'
                            : 'bg-transparent text-white/55 hover:text-white/75'
                        }`}
                    onClick={() => onTabChange('jugadores')}
                >
                    <span className="h-full w-full inline-flex items-center justify-center font-bebas text-sm tracking-wider">
                        JUGADORES
                    </span>
                </button>
                <button
                    className={`h-full px-0 border-0 rounded-[4px] transition-colors ${activeTab === 'solicitudes'
                            ? 'bg-white/[0.14] text-white'
                            : 'bg-transparent text-white/55 hover:text-white/75'
                        }`}
                    onClick={() => onTabChange('solicitudes')}
                >
                    <span className="h-full w-full inline-flex items-center justify-center gap-1.5 font-bebas text-sm tracking-wider">
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
