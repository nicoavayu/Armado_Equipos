import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase';

/**
 * Hook to fetch and track pending join requests count
 * @param {string} matchId - Match ID to fetch requests for
 * @returns {{count: number, refreshCount: Function}} Count of pending requests + manual refresh
 */
export const usePendingRequestsCount = (matchId) => {
    const [count, setCount] = useState(0);

    const fetchCount = useCallback(async () => {
        if (!matchId) {
            setCount(0);
            return;
        }

        try {
            const { count: requestCount, error } = await supabase
                .from('match_join_requests')
                .select('*', { count: 'exact', head: true })
                .eq('match_id', matchId)
                .eq('status', 'pending');

            if (error) throw error;
            setCount(requestCount || 0);
        } catch (error) {
            console.error('Error fetching requests count:', error);
        }
    }, [matchId]);

    useEffect(() => {
        if (!matchId) {
            setCount(0);
            return;
        }

        fetchCount();

        // Set up realtime subscription for updates
        const channel = supabase
            .channel(`match_requests_${matchId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'match_join_requests',
                    filter: `match_id=eq.${matchId}`,
                },
                () => {
                    fetchCount();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [matchId, fetchCount]);

    return { count, refreshCount: fetchCount };
};

export default usePendingRequestsCount;
