import logger from '../utils/logger';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchPendingMatchJoinRequests } from '../services/db/matchJoinRequests';
import { useRefreshOnVisibility } from './useRefreshOnVisibility';
import { useSupabaseRealtime } from './useSupabaseRealtime';
import { useInterval } from './useInterval';

/**
 * Hook to fetch and track pending join requests count
 * @param {string} matchId - Match ID to fetch requests for
 * @returns {{count: number, refreshCount: Function}} Count of pending requests + manual refresh
 */
export const usePendingRequestsCount = (matchId) => {
    const [count, setCount] = useState(0);
    const fetchInFlightRef = useRef(false);
    const queuedSilentRefreshRef = useRef(false);
    const { setIntervalSafe, clearIntervalSafe } = useInterval();

    const fetchCount = useCallback(async ({ silent = false } = {}) => {
        if (!matchId) {
            setCount(0);
            return;
        }
        if (fetchInFlightRef.current) {
            if (silent) {
                queuedSilentRefreshRef.current = true;
            }
            return;
        }

        try {
            fetchInFlightRef.current = true;
            const requests = await fetchPendingMatchJoinRequests(matchId);
            setCount(requests.length);
        } catch (error) {
            logger.error('Error fetching requests count:', error);
            setCount(0);
        } finally {
            fetchInFlightRef.current = false;
            if (queuedSilentRefreshRef.current) {
                queuedSilentRefreshRef.current = false;
                void fetchCount({ silent: true });
            }
        }
    }, [matchId]);

    useEffect(() => {
        if (!matchId) {
            setCount(0);
            return;
        }

        fetchCount();
    }, [matchId, fetchCount]);

    useRefreshOnVisibility(() => {
        fetchCount({ silent: true });
    }, {
        enabled: Boolean(matchId),
    });

    useEffect(() => {
        if (!matchId) {
            clearIntervalSafe();
            return undefined;
        }

        setIntervalSafe(() => {
            if (document.visibilityState !== 'visible') return;
            fetchCount({ silent: true });
        }, 2500);

        return clearIntervalSafe;
    }, [clearIntervalSafe, fetchCount, matchId, setIntervalSafe]);

    const realtimeEvents = useMemo(() => (
        matchId ? [
            {
                event: '*',
                schema: 'public',
                table: 'match_join_requests',
                filter: `match_id=eq.${matchId}`,
                handler: () => {
                    fetchCount({ silent: true });
                },
            },
        ] : []
    ), [fetchCount, matchId]);

    useSupabaseRealtime({
        enabled: Boolean(matchId),
        channelName: matchId ? `match-requests-count-${matchId}` : null,
        deps: [matchId],
        events: realtimeEvents,
    });

    return { count, refreshCount: fetchCount };
};

export default usePendingRequestsCount;
