import React from 'react';

/**
 * Tab selector component for AdminPanel
 * @param {Object} props - Component props
 */
const AdminTabs = ({ activeTab, onTabChange, pendingCount = 0 }) => {
    return (
        <div className="w-full max-w-full mx-auto mb-3">
            <div className="grid grid-cols-2 gap-0 h-11 w-full overflow-visible">
                <button
                    className={`h-full px-0 border transition-colors ${activeTab === 'jugadores'
                            ? 'bg-[#31239f] border-[rgba(132,112,255,0.62)] text-white'
                            : 'bg-[#141b3d] border-[rgba(106,126,202,0.42)] text-white/70 hover:text-white/85'
                        }`}
                    style={{ transform: 'skewX(-5deg)', borderRadius: 0 }}
                    onClick={() => onTabChange('jugadores')}
                >
                    <span
                        className="h-full w-full inline-flex items-center justify-center font-bebas text-sm tracking-wider"
                        style={{ transform: 'skewX(5deg)' }}
                    >
                        JUGADORES
                    </span>
                </button>
                <button
                    className={`h-full px-0 border transition-colors ${activeTab === 'solicitudes'
                            ? 'bg-[#31239f] border-[rgba(132,112,255,0.62)] text-white'
                            : 'bg-[#141b3d] border-[rgba(106,126,202,0.42)] text-white/70 hover:text-white/85'
                        }`}
                    style={{ transform: 'skewX(-5deg)', borderRadius: 0 }}
                    onClick={() => onTabChange('solicitudes')}
                >
                    <span
                        className="h-full w-full inline-flex items-center justify-center gap-1.5 font-bebas text-sm tracking-wider"
                        style={{ transform: 'skewX(5deg)' }}
                    >
                        SOLICITUDES
                        {pendingCount > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-white/16 text-white text-[10px] font-bold border border-white/25 font-sans tracking-normal rounded-none">
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
