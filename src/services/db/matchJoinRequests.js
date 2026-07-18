import { supabase } from '../../supabase';

export const fetchPendingMatchJoinRequests = async (matchId) => {
  if (!matchId) return [];

  const { data, error } = await supabase
    .from('match_join_requests')
    .select('id, match_id, user_id, status, role, created_at')
    .eq('match_id', matchId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
};

export default fetchPendingMatchJoinRequests;
