import { useState, useEffect } from 'react';
import { supabase } from '../supabase';

/**
 * Hook to fetch and track pending join requests count
 * @param {string} matchId - Match ID to fetch requests for
 * @returns {number} Count of pending requests
 */
export const usePendingRequestsCount = (matchId) => {
    const [count, setCount] = useState(0);

    useEffect(() => {
        if (!matchId) return;

        const fetchCount = async () => {
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
        };

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
    }, [matchId]);

    return count;
};

export default usePendingRequestsCount;
