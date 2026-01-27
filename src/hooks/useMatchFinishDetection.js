import { useEffect, useRef } from 'react';
import { useAuth } from '../components/AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { checkAndNotifyMatchFinish } from '../services/matchFinishService';
import { supabase } from '../supabase';

/**
 * Hook to automatically detect when matches finish and send notifications
 * @param {Array} partidos - Array of matches to monitor
 */
export const useMatchFinishDetection = (partidos) => {
  const { user } = useAuth();
  const { createNotification } = useNotifications();
  const notifiedMatches = useRef(new Set());

  useEffect(() => {
    if (!user || !partidos || partidos.length === 0) return;

    const checkFinishedMatches = async () => {
      const now = new Date();
      
      for (const partido of partidos) {
        // Skip if already notified
        if (notifiedMatches.current.has(partido.id)) continue;
        
        // Check if match just finished
        if (isMatchJustFinished(partido, now)) {
          try {
            // Avoid duplicate notifications: if DB already has a survey_start/post_match_survey for this partido, skip
            const { data: existing, error: existingError } = await supabase
              .from('notifications')
              .select('id, type')
              .eq('partido_id', partido.id)
              .in('type', ['survey_start', 'post_match_survey'])
              .limit(1);

            if (existingError) {
              console.error('Error checking existing notifications for partido', partido.id, existingError);
            }
            if (existing && existing.length > 0) {
              // Mark as notified to avoid re-checking
              notifiedMatches.current.add(partido.id);
              console.log(`Skipping client-side survey notification for match ${partido.id} because DB already has one.`);
              continue;
            }

            // --- CANONICAL MODE CHECK: prevent client creation when DB is canonical ---
            const SURVEY_FANOUT_MODE = process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE || 'db';
            if (SURVEY_FANOUT_MODE === 'db') {
              notifiedMatches.current.add(partido.id);
              console.log(`Client-side skipped creating post_match_survey because SURVEY_FANOUT_MODE=db for match ${partido.id}`);
              continue;
            }
                 
            // Send notification through context
            await createNotification(
              'post_match_survey',
              '¡Encuesta lista!',
              `La encuesta ya está lista para completar sobre el partido ${partido.nombre || formatMatchDate(partido.fecha)}.`,
              {
                partido_id: partido.id,
                partido_nombre: partido.nombre,
                partido_fecha: partido.fecha,
                partido_hora: partido.hora,
                partido_sede: partido.sede,
              },
            );
             
            // Mark as notified
            notifiedMatches.current.add(partido.id);
             
            console.log(`Sent survey notification for finished match ${partido.id}`);
          } catch (error) {
            console.error('Error sending match finish notification:', error);
          }
        }
      }
    };

    // Check immediately
    checkFinishedMatches();

    // Set up interval to check every minute
    const interval = setInterval(checkFinishedMatches, 60000);

    return () => clearInterval(interval);
  }, [partidos, user, createNotification]);

  // Clean up notified matches when partidos change
  useEffect(() => {
    if (!partidos || partidos.length === 0) {
      notifiedMatches.current.clear();
      return;
    }

    // Remove notifications for matches that are no longer in the list
    const currentMatchIds = new Set(partidos.map((p) => p.id));
    const notifiedIds = Array.from(notifiedMatches.current);
    
    notifiedIds.forEach((id) => {
      if (!currentMatchIds.has(id)) {
        notifiedMatches.current.delete(id);
      }
    });
  }, [partidos]);
};

/**
 * Checks if a match just finished (within the last 5 minutes)
 * @param {Object} partido - Match object
 * @param {Date} now - Current time
 * @returns {boolean} - True if match just finished
 */
const isMatchJustFinished = (partido, now) => {
  if (!partido.fecha || !partido.hora) return false;
  
  try {
    const [hours, minutes] = partido.hora.split(':').map(Number);
    const partidoDateTime = new Date(partido.fecha);
    partidoDateTime.setHours(hours, minutes, 0, 0);
    
    // Check if match finished within the last 5 minutes
    const timeDiff = now - partidoDateTime;
    return timeDiff >= 0 && timeDiff <= 5 * 60 * 1000;
  } catch (error) {
    console.error('Error checking match finish time:', error);
    return false;
  }
};

/**
 * Formats match date for display
 * @param {string} fecha - Date string
 * @returns {string} - Formatted date
 */
const formatMatchDate = (fecha) => {
  try {
    return new Date(fecha).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'numeric',
    });
  } catch {
    return fecha;
  }
};