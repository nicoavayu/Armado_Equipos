import { supabase } from '../supabase';

/**
 * Service to handle player absences, notifications, and replacements
 */

/**
 * Record a player absence notification
 * @param {string} userId - Player user ID
 * @param {number} partidoId - Match ID
 * @param {string} reason - Reason for absence
 * @param {boolean} foundReplacement - Whether player found a replacement
 * @returns {Object} Result of the operation
 */
export const recordAbsenceNotification = async (userId, partidoId, reason = '', foundReplacement = false) => {
  if (!userId || !partidoId) {
    throw new Error('User ID and Match ID are required');
  }

  try {
    // Get match details to check timing
    const { data: match, error: matchError } = await supabase
      .from('partidos')
      .select('fecha, hora')
      .eq('id', partidoId)
      .single();

    if (matchError) throw matchError;

    // Calculate if notification is 4+ hours before match
    const matchDateTime = new Date(`${match.fecha}T${match.hora}`);
    const now = new Date();
    const hoursBeforeMatch = (matchDateTime - now) / (1000 * 60 * 60);
    const notifiedInTime = hoursBeforeMatch >= 4;

    // Record the absence notification
    const { data, error } = await supabase
      .from('player_absences')
      .insert([{
        user_id: userId,
        partido_id: partidoId,
        reason,
        found_replacement: foundReplacement,
        notified_in_time: notifiedInTime,
        hours_before_match: Math.max(0, hoursBeforeMatch),
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) throw error;

    console.log('[ABSENCE] Recorded absence notification:', {
      userId,
      partidoId,
      notifiedInTime,
      foundReplacement,
      hoursBeforeMatch: hoursBeforeMatch.toFixed(1),
    });

    return {
      success: true,
      data,
      notifiedInTime,
      foundReplacement,
    };

  } catch (error) {
    console.error('[ABSENCE] Error recording absence:', error);
    throw error;
  }
};

/**
 * Get absence data for a player in a specific match
 * @param {string} userId - Player user ID
 * @param {number} partidoId - Match ID
 * @returns {Object|null} Absence data or null if not found
 */
export const getPlayerAbsenceData = async (userId, partidoId) => {
  if (!userId || !partidoId) return null;

  try {
    const { data, error } = await supabase
      .from('player_absences')
      .select('*')
      .eq('user_id', userId)
      .eq('partido_id', partidoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return data;

  } catch (error) {
    console.error('[ABSENCE] Error getting absence data:', error);
    return null;
  }
};

/**
 * Check if a player should receive rating penalty for absence
 * @param {string} userId - Player user ID
 * @param {number} partidoId - Match ID
 * @returns {boolean} Whether player should receive penalty
 */
export const shouldApplyAbsencePenalty = async (userId, partidoId) => {
  try {
    const absenceData = await getPlayerAbsenceData(userId, partidoId);
    
    if (!absenceData) {
      // No absence record means they didn't notify - apply penalty
      return true;
    }

    // Apply penalty only if they didn't notify in time AND didn't find replacement
    return !absenceData.notified_in_time && !absenceData.found_replacement;

  } catch (error) {
    console.error('[ABSENCE] Error checking penalty eligibility:', error);
    // Default to applying penalty if we can't determine
    return true;
  }
};

/**
 * Update the processPostMatchSurveys function to use absence data
 * This function should be called from the main survey processing
 */
export const getAbsenceDataForSurveyProcessing = async (partidoId, absentPlayerIds) => {
  if (!partidoId || !absentPlayerIds || absentPlayerIds.length === 0) {
    return {};
  }

  try {
    const absencePromises = absentPlayerIds.map((playerId) => 
      getPlayerAbsenceData(playerId, partidoId),
    );

    const absenceResults = await Promise.all(absencePromises);
    
    const absenceData = {};
    absentPlayerIds.forEach((playerId, index) => {
      const data = absenceResults[index];
      absenceData[playerId] = {
        notifiedInTime: data?.notified_in_time || false,
        foundReplacement: data?.found_replacement || false,
        shouldApplyPenalty: !data?.notified_in_time && !data?.found_replacement,
      };
    });

    return absenceData;

  } catch (error) {
    console.error('[ABSENCE] Error getting absence data for survey processing:', error);
    // Return default penalty data if we can't get absence info
    const defaultData = {};
    absentPlayerIds.forEach((playerId) => {
      defaultData[playerId] = {
        notifiedInTime: false,
        foundReplacement: false,
        shouldApplyPenalty: true,
      };
    });
    return defaultData;
  }
};