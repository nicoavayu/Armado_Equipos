import { supabase } from '../../lib/supabaseClient';

/**
 * Fetch teams from the database for a specific match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Array|null>} Array of teams or null
 */
export const getTeamsFromDatabase = async (partidoId) => {
    const pid = Number(partidoId);
    if (!pid || Number.isNaN(pid)) {
        console.error('getTeamsFromDatabase: Invalid match ID', partidoId);
        return null;
    }

    const { data, error } = await supabase
        .from('partidos')
        .select('equipos_json')
        .eq('id', pid)
        .single();

    if (error) {
        console.error('Error fetching teams:', error);
        return null;
    }

    // equipos_json might be a string (if returned as JSON text) or object depending on Supabase client config.
    // Assuming it handles JSONB columns effectively as objects/arrays.
    return data?.equipos_json || null;
};

/**
 * Save teams to the database
 * @param {number} partidoId - Match ID
 * @param {Array} teams - Array of team objects
 * @returns {Promise<void>}
 */
export const saveTeamsToDatabase = async (partidoId, teams) => {
    const pid = Number(partidoId);
    if (!pid || Number.isNaN(pid)) {
        throw new Error('Invalid match ID');
    }

    if (!Array.isArray(teams)) {
        throw new Error('Teams must be an array');
    }

    const { error } = await supabase
        .from('partidos')
        .update({ equipos_json: teams })
        .eq('id', pid);

    if (error) {
        throw new Error(`Error saving teams: ${error.message}`);
    }
};

/**
 * Subscribe to realtime team changes for a match
 * @param {number} partidoId - Match ID
 * @param {Function} callback - Callback function(teams)
 * @returns {Object} Subscription object
 */
export const subscribeToTeamsChanges = (partidoId, callback) => {
    const pid = Number(partidoId);
    if (!pid || Number.isNaN(pid)) return null;

    const channelName = `public:partidos:id=eq.${pid}`;

    return supabase
        .channel(channelName)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'partidos',
                filter: `id=eq.${pid}`,
            },
            (payload) => {
                const newTeams = payload.new.equipos_json;
                if (newTeams) {
                    callback(newTeams);
                }
            }
        )
        .subscribe();
};

/**
 * Unsubscribe from team changes
 * @param {Object} subscription - Subscription object returned by subscribeToTeamsChanges
 */
export const unsubscribeFromTeamsChanges = (subscription) => {
    if (subscription) {
        supabase.removeChannel(subscription);
    }
};
