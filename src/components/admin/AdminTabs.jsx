import React from 'react';

/**
 * Tab selector component for AdminPanel
 * @param {Object} props - Component props
 */
const AdminTabs = ({ activeTab, onTabChange, pendingCount = 0 }) => {
    return (
        <div className="w-[90vw] max-w-[90vw] mx-auto mb-3">
            <div className="flex gap-2 bg-slate-900/50 border border-slate-800 rounded-xl p-1">
                <button
                    className={`flex-1 py-2.5 px-4 rounded-lg font-bebas text-sm tracking-wider transition-all ${activeTab === 'jugadores'
                            ? 'bg-primary text-white shadow-lg'
                            : 'text-white/60 hover:text-white/80 hover:bg-slate-800/50'
                        }`}
                    onClick={() => onTabChange('jugadores')}
                >
                    JUGADORES
                </button>
                <button
                    className={`flex-1 py-2.5 px-4 rounded-lg font-bebas text-sm tracking-wider transition-all relative ${activeTab === 'solicitudes'
                            ? 'bg-primary text-white shadow-lg'
                            : 'text-white/60 hover:text-white/80 hover:bg-slate-800/50'
                        }`}
                    onClick={() => onTabChange('solicitudes')}
                >
                    SOLICITUDES
                    {pendingCount > 0 && (
                        <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full">
                            {pendingCount}
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
};

export default AdminTabs;
