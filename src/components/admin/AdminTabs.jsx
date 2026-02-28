import React from 'react';

/**
 * Tab selector component for AdminPanel
 * @param {Object} props - Component props
 */
const AdminTabs = ({ activeTab, onTabChange, pendingCount = 0 }) => {
    return (
        <div className="w-full max-w-full mx-auto mb-3">
            <div className="flex gap-2 bg-white/[0.05] border border-white/10 rounded-xl p-1">
                <button
                    className={`flex-1 h-11 px-4 rounded-lg font-bebas text-sm tracking-wider transition-colors ${activeTab === 'jugadores'
                            ? 'bg-white/[0.14] text-white'
                            : 'text-white/55 hover:text-white/75 hover:bg-white/[0.06]'
                        }`}
                    onClick={() => onTabChange('jugadores')}
                >
                    JUGADORES
                </button>
                <button
                    className={`flex-1 h-11 px-4 rounded-lg font-bebas text-sm tracking-wider transition-colors relative ${activeTab === 'solicitudes'
                            ? 'bg-white/[0.14] text-white'
                            : 'text-white/55 hover:text-white/75 hover:bg-white/[0.06]'
                        }`}
                    onClick={() => onTabChange('solicitudes')}
                >
                    SOLICITUDES
                    {pendingCount > 0 && (
                        <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-white/20 text-white text-[10px] font-bold rounded-full border border-white/25">
                            {pendingCount}
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
};

export default AdminTabs;
