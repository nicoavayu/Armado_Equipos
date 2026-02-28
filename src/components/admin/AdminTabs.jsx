import React from 'react';

const TAB_SKEW_X = 6;
const TAB_CENTER_OVERLAP_PX = 3;

/**
 * Tab selector component for AdminPanel
 * @param {Object} props - Component props
 */
const AdminTabs = ({ activeTab, onTabChange, pendingCount = 0 }) => {
    return (
        <div
            className="relative mb-3 overflow-visible"
            style={{
                width: '100vw',
                marginLeft: 'calc(50% - 50vw)',
                marginRight: 'calc(50% - 50vw)',
            }}
        >
            <div className="relative flex h-11 w-full overflow-visible">
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 z-[3]"
                    style={{
                        backgroundColor: 'rgba(132,112,255,0.56)',
                        transform: `translateX(-50%) skewX(-${TAB_SKEW_X}deg)`,
                    }}
                />
                <button
                    className={`w-1/2 shrink-0 h-full px-0 border-r-0 border transition-colors relative z-[2] ${activeTab === 'jugadores'
                            ? 'bg-[#31239f] border-[rgba(132,112,255,0.64)] text-white'
                            : 'bg-[#111a3b] border-[rgba(106,126,202,0.4)] text-white/66 hover:text-white/84'
                        }`}
                    style={{
                        transform: `skewX(-${TAB_SKEW_X}deg)`,
                        borderRadius: 0,
                        backfaceVisibility: 'hidden',
                        marginRight: `-${TAB_CENTER_OVERLAP_PX}px`,
                    }}
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
                    className={`w-1/2 shrink-0 h-full px-0 border-l-0 border transition-colors relative z-[2] ${activeTab === 'solicitudes'
                            ? 'bg-[#31239f] border-[rgba(132,112,255,0.64)] text-white'
                            : 'bg-[#111a3b] border-[rgba(106,126,202,0.4)] text-white/66 hover:text-white/84'
                        }`}
                    style={{
                        transform: `skewX(-${TAB_SKEW_X}deg)`,
                        borderRadius: 0,
                        backfaceVisibility: 'hidden',
                        marginLeft: `-${TAB_CENTER_OVERLAP_PX}px`,
                    }}
                    onClick={() => onTabChange('solicitudes')}
                >
                    <span
                        className="h-full w-full inline-flex items-center justify-center gap-1.5 font-bebas text-sm tracking-wider"
                        style={{ transform: `skewX(${TAB_SKEW_X}deg)` }}
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
