import { supabase } from '../lib/supabaseClient';

export async function checkNotificationsView() {
  const { data, error } = await supabase
    .from('notifications_ext')
    .select('id, match_id_text')
    .limit(1);
  
  console.debug('[CHECK_VIEW]', { data, error });
  return { data, error };
}
