import React, { useState, useEffect } from 'react';
import { supabase } from '../services/api/supabase';
import './NotificationsDebugPanel.css';

/**
 * Debug panel for notification delivery tracking
 * Shows delivery logs with filtering by partido_id and type
 */
const NotificationsDebugPanel = ({ partidoId = null }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({
        partidoId: partidoId || '',
        type: '',
        status: '',
    });

    useEffect(() => {
        fetchLogs();
    }, [filters]);

    const fetchLogs = async () => {
        setLoading(true);
        console.log('[NOTIF_DEBUG] Fetching delivery logs with filters:', filters);

        try {
            let query = supabase
                .from('notification_delivery_log')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);

            if (filters.partidoId) {
                query = query.eq('partido_id', filters.partidoId);
            }
            if (filters.type) {
                query = query.eq('notification_type', filters.type);
            }
            if (filters.status) {
                query = query.eq('status', filters.status);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[NOTIF_DEBUG] Error fetching logs:', error);
                return;
            }

            console.log('[NOTIF_DEBUG] Fetched logs:', data?.length || 0);
            setLogs(data || []);
        } catch (err) {
            console.error('[NOTIF_DEBUG] Exception:', err);
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'sent': return '#4caf50';
            case 'failed': return '#f44336';
            case 'queued': return '#ff9800';
            case 'skipped': return '#9e9e9e';
            default: return '#666';
        }
    };

    return (
        <div className="notif-debug-panel">
            <div className="notif-debug-header">
                <h3>🔍 Notification Delivery Logs</h3>
                <button onClick={fetchLogs} disabled={loading}>
                    {loading ? 'Loading...' : 'Refresh'}
                </button>
            </div>

            <div className="notif-debug-filters">
                <input
                    type="text"
                    placeholder="Partido ID"
                    value={filters.partidoId}
                    onChange={(e) => setFilters({ ...filters, partidoId: e.target.value })}
                />
                <select
                    value={filters.type}
                    onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                >
                    <option value="">All Types</option>
                    <option value="match_cancelled">Match Cancelled</option>
                    <option value="match_deleted">Match Deleted</option>
                    <option value="survey_start">Survey Start</option>
                    <option value="survey_results_ready">Survey Results Ready</option>
                    <option value="match_invite">Match Invite</option>
                </select>
                <select
                    value={filters.status}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                >
                    <option value="">All Status</option>
                    <option value="queued">Queued</option>
                    <option value="sent">Sent</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                </select>
            </div>

            <div className="notif-debug-logs">
                {logs.length === 0 ? (
                    <div className="no-logs">No logs found</div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Partido</th>
                                <th>User</th>
                                <th>Type</th>
                                <th>Channel</th>
                                <th>Status</th>
                                <th>Attempts</th>
                                <th>Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map((log) => (
                                <tr key={log.id}>
                                    <td>{new Date(log.created_at).toLocaleString()}</td>
                                    <td>{log.partido_id || '-'}</td>
                                    <td title={log.user_id}>{log.user_id?.substring(0, 8)}...</td>
                                    <td>{log.notification_type}</td>
                                    <td>{log.channel}</td>
                                    <td>
                                        <span
                                            className="status-badge"
                                            style={{ backgroundColor: getStatusColor(log.status) }}
                                        >
                                            {log.status}
                                        </span>
                                    </td>
                                    <td>{log.attempt_count}</td>
                                    <td className="error-cell" title={log.error_text}>
                                        {log.error_text ? log.error_text.substring(0, 50) + '...' : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default NotificationsDebugPanel;
