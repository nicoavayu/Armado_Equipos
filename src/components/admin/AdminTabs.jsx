import React from 'react';

/**
 * Tab selector component for AdminPanel
 * @param {Object} props - Component props
 */
const AdminTabs = ({ activeTab, onTabChange, pendingCount = 0 }) => {
    return (
        <div className="relative mt-4 mb-3 overflow-visible px-4">
            <style>{`
                .admin-tabs-shell {
                    position: relative;
                    display: flex;
                    gap: 4px;
                    width: 100%;
                    max-width: 560px;
                    margin: 0 auto;
                    height: 44px;
                    padding: 4px;
                    overflow: hidden;
                    border-radius: 999px;
                    border: 1px solid rgba(148, 134, 255, 0.22);
                    background: rgba(20, 16, 41, 0.85);
                    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 6px 16px rgba(5, 3, 16, 0.35);
                }
                .admin-tab-btn {
                    position: relative;
                    flex: 1 1 50%;
                    min-width: 0;
                    margin: 0;
                    padding: 0;
                    border: 0;
                    border-radius: 999px;
                    background: transparent;
                    color: rgba(255, 255, 255, 0.6);
                    backface-visibility: hidden;
                    transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
                    overflow: hidden;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1;
                }
                .admin-tab-btn:hover:not(.is-active) {
                    background: rgba(255, 255, 255, 0.06);
                    color: rgba(255, 255, 255, 0.9);
                }
                .admin-tab-btn.is-active {
                    background: linear-gradient(135deg, #8b5cff 0%, #6a43ff 52%, #5430e0 100%);
                    color: #fff;
                    box-shadow: 0 4px 14px rgba(106, 67, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2);
                    z-index: 2;
                }
                .admin-tab-label {
                    width: 100%;
                    height: 100%;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    font-size: 12.5px;
                    font-weight: 600;
                    letter-spacing: 0.04em;
                }
            `}</style>
            <div className="admin-tabs-shell">
                <button
                    className={`admin-tab-btn ${activeTab === 'jugadores' ? 'is-active' : ''}`}
                    onClick={() => onTabChange('jugadores')}
                >
                    <span className="admin-tab-label font-sans">
                        JUGADORES
                    </span>
                </button>
                <button
                    className={`admin-tab-btn ${activeTab === 'solicitudes' ? 'is-active' : ''}`}
                    onClick={() => onTabChange('solicitudes')}
                >
                    <span className="admin-tab-label font-sans">
                        SOLICITUDES
                        {pendingCount > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-[#ec007d] text-white text-[10px] font-bold font-sans tracking-normal rounded-full shadow-[0_0_10px_rgba(236,0,125,0.45)]">
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
