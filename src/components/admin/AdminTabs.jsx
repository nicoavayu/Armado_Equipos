import React from 'react';

const TAB_SKEW_X = 6;

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
            <style>{`
                .admin-tabs-shell {
                    position: relative;
                    display: flex;
                    width: 100%;
                    height: 44px;
                    overflow: hidden;
                }
                .admin-tab-btn {
                    position: relative;
                    flex: 1 1 50%;
                    min-width: 0;
                    margin: 0;
                    padding: 0;
                    border: 1px solid rgba(106, 126, 202, 0.4);
                    border-radius: 0;
                    background: rgba(17, 26, 59, 0.96);
                    color: rgba(255, 255, 255, 0.66);
                    transform: skewX(-${TAB_SKEW_X}deg);
                    backface-visibility: hidden;
                    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
                    overflow: hidden;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1;
                }
                .admin-tab-btn + .admin-tab-btn {
                    border-left: 0;
                }
                .admin-tab-btn.is-active {
                    background: #31239f;
                    border-color: rgba(132, 112, 255, 0.64);
                    color: #fff;
                    box-shadow: inset 0 0 0 1px rgba(160, 142, 255, 0.26);
                    z-index: 2;
                }
                .admin-tab-btn.is-active::after {
                    content: '';
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 3px;
                    background: #644dff;
                    pointer-events: none;
                }
                .admin-tab-label {
                    width: 100%;
                    height: 100%;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    transform: skewX(${TAB_SKEW_X}deg);
                    font-size: 0.95rem;
                    letter-spacing: 0.04em;
                }
                .admin-tab-divider {
                    position: absolute;
                    left: 50%;
                    top: 0;
                    width: 1px;
                    height: 100%;
                    transform: translateX(-50%) skewX(-${TAB_SKEW_X}deg);
                    background: rgba(149, 166, 232, 0.45);
                    pointer-events: none;
                    z-index: 3;
                }
            `}</style>
            <div className="admin-tabs-shell">
                <button
                    className={`admin-tab-btn ${activeTab === 'jugadores' ? 'is-active' : ''}`}
                    onClick={() => onTabChange('jugadores')}
                >
                    <span className="admin-tab-label font-bebas">
                        JUGADORES
                    </span>
                </button>
                <button
                    className={`admin-tab-btn ${activeTab === 'solicitudes' ? 'is-active' : ''}`}
                    onClick={() => onTabChange('solicitudes')}
                >
                    <span className="admin-tab-label font-bebas">
                        SOLICITUDES
                        {pendingCount > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-white/16 text-white text-[10px] font-bold border border-white/25 font-sans tracking-normal rounded-none">
                                {pendingCount}
                            </span>
                        )}
                    </span>
                </button>
                <span aria-hidden="true" className="admin-tab-divider" />
            </div>
        </div>
    );
};

export default AdminTabs;
