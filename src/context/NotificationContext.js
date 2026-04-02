import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { supabase } from '../supabase';
import { useAuth } from '../components/AuthProvider';
import { flushPendingPushToken, getPushTokenSyncState } from '../services/pushTokenService';
import { handleError } from '../lib/errorHandler';
import { logger } from '../lib/logger';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';
import { useSupabaseRealtime } from '../hooks/useSupabaseRealtime';
import { getSurveyReminderMessage, getSurveyResultsReadyMessage, getSurveyStartMessage } from '../utils/surveyNotificationCopy';
import {
  applyMatchNameQuotes,
  formatMatchReminderMessage,
  formatMatchReminderTitle,
  formatTeamInviteMessage,
  quoteMatchName,
  resolveNotificationMatchName,
} from '../utils/notificationText';
import { extractTeamMatchId, isTeamChallengeNotification } from '../utils/notificationRoutes';
import {
  filterNotificationsForInbox,
  isPlayerJoinedMatchUpdateNotification,
  isPlayerLeftMatchUpdateNotification,
} from '../utils/notificationInviteState';
import { AWARDS_READY_NOTIFICATION_TYPES, isAwardsTrulyReady, toNumericMatchId } from '../utils/awardsReadiness';
import {
  getNotificationDisplayTimestampMs,
  getNotificationsUiCutoffIso,
} from '../utils/notificationRetentionPolicy';
import { track } from '../utils/monitoring/analytics';
import { parseLocalDateTime } from '../utils/dateLocal';

const NotificationContext = createContext();

/**
 * Hook to access notification context
 * Provides notifications state, unread counts, and notification management functions
 * @returns {Object} Notification context value
 */
export const useNotifications = () => useContext(NotificationContext);
// Rebuild trace

/**
 * Notification provider component
 * Manages real-time notifications, unread counts, and notification state
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export const NotificationProvider = ({ children }) => {
  const { user, authResolved } = useAuth();
  const [notifications, setNotifications] = useState([]);
  // Notifications that are scheduled for the future (send_at > now)
  const [scheduledNotifications, setScheduledNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState({
    friends: 0,
    teamInvites: 0,
    matches: 0,
    total: 0,
  });
  const [currentUserId, setCurrentUserId] = useState(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [lastFetchCount, setLastFetchCount] = useState(null);
  const [lastRealtimeAt, setLastRealtimeAt] = useState(null);
  const [lastRealtimePayloadType, setLastRealtimePayloadType] = useState(null);
  const notificationsRef = useRef([]);
  const refreshRunningRef = useRef(false);
  const lastRefreshMsRef = useRef(0);
  const authResolvedRef = useRef(authResolved);
  const pushUserIdRef = useRef(user?.id || null);
  const initialAuthCheckedRef = useRef(false);
  const lastObservedPushUserIdRef = useRef(null);
  const extractNumericInboxMatchId = useCallback((notification) => {
    const data = notification?.data || {};
    const explicitCandidate = (
      notification?.partido_id
      ?? data?.partido_id
      ?? data?.partidoId
      ?? data?.match_id
      ?? data?.matchId
      ?? notification?.match_ref
      ?? null
    );
    const normalizedExplicit = String(explicitCandidate ?? '').trim();
    if (/^\d+$/.test(normalizedExplicit)) {
      return normalizedExplicit;
    }

    const linkCandidate = (
      data?.link
      || data?.deep_link
      || data?.deepLink
      || notification?.deep_link
      || notification?.deepLink
      || ''
    );
    const linkText = String(linkCandidate || '').trim();
    if (!linkText) return null;

    const pathMatch = linkText.match(/\/(?:admin|partido-publico|partido|encuesta|resultados-encuesta)\/(\d+)/i);
    if (pathMatch?.[1]) return pathMatch[1];

    const queryMatch = linkText.match(/[?&]partidoId=(\d+)/i);
    if (queryMatch?.[1]) return queryMatch[1];

    return null;
  }, []);
  const resolveNotificationMatchId = useCallback((notification) => {
    if (!notification) return null;
    const data = notification.data || {};
    const type = String(notification?.type || '').trim().toLowerCase();
    const isSurveyLike = (
      type === 'survey'
      || type === 'survey_start'
      || type === 'post_match_survey'
      || type === 'survey_reminder'
      || type === 'survey_reminder_12h'
      || type === 'survey_results_ready'
      || type === 'awards_ready'
      || type === 'award_won'
      || type === 'survey_finished'
    );

    if (isSurveyLike) {
      const surveyCandidate = (
        notification.partido_id
        ?? data.partido_id
        ?? data.partidoId
        ?? data.match_id
        ?? data.matchId
        ?? notification.match_ref
        ?? null
      );
      if (surveyCandidate !== null && surveyCandidate !== undefined && String(surveyCandidate).trim() !== '') {
        return String(surveyCandidate);
      }

      const surveyLink = data.link || data.resultsUrl || '';
      const surveyMatch = String(surveyLink).match(/\/(?:encuesta|resultados-encuesta)\/(\d+)/);
      return surveyMatch?.[1] || null;
    }

    if (isTeamChallengeNotification(notification)) {
      const challengeId = data.challenge_id ?? data.challengeId ?? null;
      if (challengeId !== null && challengeId !== undefined && String(challengeId).trim() !== '') {
        return `challenge:${String(challengeId)}`;
      }
    }

    const candidate = (
      data.team_match_id
      ?? data.teamMatchId
      ?? notification.partido_id
      ?? notification.match_ref
      ?? data.partido_id
      ?? data.partidoId
      ?? data.match_id
      ?? data.matchId
      ?? data.match_ref
      ?? null
    );

    if (candidate !== null && candidate !== undefined && String(candidate).trim() !== '') {
      return String(candidate);
    }

    const link = data.link || data.resultsUrl || '';
    const match = String(link).match(/\/(?:encuesta|resultados-encuesta)\/(\d+)/);
    return match?.[1] || null;
  }, []);
  const enrichNotificationMatchStarts = useCallback(async (notificationsList = []) => {
    const rows = Array.isArray(notificationsList) ? notificationsList : [];
    if (rows.length === 0) return rows;

    const numericMatchIds = [...new Set(
      rows
        .map((notification) => {
          const data = notification?.data || {};
          return extractNumericInboxMatchId(notification);
        })
        .filter(Boolean),
    )];

    const teamMatchIds = [...new Set(
      rows
        .map((notification) => {
          const teamMatchId = extractTeamMatchId(notification);
          const normalized = String(teamMatchId || '').trim();
          return normalized || null;
        })
        .filter(Boolean),
    )];

    const partidoStartIsoById = new Map();
    const partidoSurveyClosesAtById = new Map();
    const partidoNameById = new Map();
    const teamMatchStartIsoById = new Map();

    if (numericMatchIds.length > 0) {
      try {
        const { data: partidosRows, error: partidosError } = await supabase
          .from('partidos')
          .select('id, nombre, fecha, hora, survey_closes_at')
          .in('id', numericMatchIds);
        if (partidosError) throw partidosError;

        (partidosRows || []).forEach((row) => {
          const parsedLocal = parseLocalDateTime(row?.fecha || null, row?.hora || null);
          const normalizedName = String(row?.nombre || '').trim();
          const surveyClosesAt = Date.parse(String(row?.survey_closes_at || ''));
          if (parsedLocal instanceof Date && !Number.isNaN(parsedLocal.getTime())) {
            partidoStartIsoById.set(String(row.id), parsedLocal.toISOString());
          }
          if (normalizedName) {
            partidoNameById.set(String(row.id), normalizedName);
          }
          if (Number.isFinite(surveyClosesAt)) {
            partidoSurveyClosesAtById.set(String(row.id), new Date(surveyClosesAt).toISOString());
          }
        });
      } catch (error) {
        logger.warn('[NOTIFICATIONS] Could not enrich partido start times for inbox filtering:', error);
      }
    }

    if (teamMatchIds.length > 0) {
      try {
        const { data: teamMatchRows, error: teamMatchError } = await supabase
          .from('team_matches')
          .select('id, scheduled_at, played_at')
          .in('id', teamMatchIds);
        if (teamMatchError) throw teamMatchError;

        (teamMatchRows || []).forEach((row) => {
          const rawStart = row?.played_at || row?.scheduled_at || null;
          const parsed = new Date(rawStart || '');
          if (Number.isNaN(parsed.getTime())) return;
          teamMatchStartIsoById.set(String(row.id), parsed.toISOString());
        });
      } catch (error) {
        logger.warn('[NOTIFICATIONS] Could not enrich team match start times for inbox filtering:', error);
      }
    }

    return rows.map((notification) => {
      const teamMatchId = String(extractTeamMatchId(notification) || '').trim();
      const data = notification?.data || {};
      const normalizedMatchId = String(extractNumericInboxMatchId(notification) ?? '').trim();
      const resolvedStart =
        (teamMatchId ? teamMatchStartIsoById.get(teamMatchId) : null)
        || (/^\d+$/.test(normalizedMatchId) ? partidoStartIsoById.get(normalizedMatchId) : null)
        || null;
      const resolvedMatchName = /^\d+$/.test(normalizedMatchId)
        ? (partidoNameById.get(normalizedMatchId) || null)
        : null;
      const resolvedSurveyClosesAt = /^\d+$/.test(normalizedMatchId)
        ? (partidoSurveyClosesAtById.get(normalizedMatchId) || null)
        : null;
      const existingMatchName = String(
        data?.partido_nombre
        || data?.match_name
        || data?.matchName
        || notification?.partido_nombre
        || notification?.match_name
        || '',
      ).trim();

      if (!resolvedStart && !resolvedSurveyClosesAt && (!resolvedMatchName || existingMatchName)) return notification;

      return {
        ...notification,
        ...(resolvedStart ? { _resolved_match_start_at: resolvedStart } : {}),
        ...(resolvedSurveyClosesAt ? { _resolved_survey_closes_at: resolvedSurveyClosesAt } : {}),
        ...(!existingMatchName && resolvedMatchName ? { partido_nombre: resolvedMatchName, match_name: resolvedMatchName } : {}),
        data: {
          ...data,
          ...(resolvedStart ? { _resolved_match_start_at: resolvedStart } : {}),
          ...(resolvedSurveyClosesAt ? { _resolved_survey_closes_at: resolvedSurveyClosesAt } : {}),
          ...(!existingMatchName && resolvedMatchName ? { partido_nombre: resolvedMatchName, match_name: resolvedMatchName } : {}),
        },
      };
    });
  }, [extractNumericInboxMatchId]);
  const isAwardsReadyNotificationType = useCallback((notificationType) => (
    AWARDS_READY_NOTIFICATION_TYPES.has(String(notificationType || '').trim().toLowerCase())
  ), []);

  const fetchAwardsReadinessByMatchIds = useCallback(async (matchIds = []) => {
    const normalizedIds = [...new Set(
      (Array.isArray(matchIds) ? matchIds : [])
        .map((value) => toNumericMatchId(value))
        .filter((value) => value != null),
    )];

    const readinessByMatchId = new Map();
    if (normalizedIds.length === 0) return readinessByMatchId;

    const { data, error } = await supabase
      .from('player_awards')
      .select('partido_id')
      .in('partido_id', normalizedIds);

    if (error) throw error;

    normalizedIds.forEach((matchId) => readinessByMatchId.set(matchId, false));
    (data || []).forEach((row) => {
      const partidoId = toNumericMatchId(row?.partido_id);
      if (partidoId == null) return;
      readinessByMatchId.set(partidoId, true);
    });

    return readinessByMatchId;
  }, []);

  const filterPrematureAwardsNotifications = useCallback(async (notificationsList = []) => {
    const rows = Array.isArray(notificationsList) ? notificationsList : [];
    const candidateRows = rows.filter((notification) => isAwardsReadyNotificationType(notification?.type));
    if (candidateRows.length === 0) return rows;

    const candidateMatchIds = [...new Set(
      candidateRows
        .map((notification) => toNumericMatchId(resolveNotificationMatchId(notification)))
        .filter((value) => value != null),
    )];

    if (candidateMatchIds.length === 0) {
      return rows.filter((notification) => !isAwardsReadyNotificationType(notification?.type));
    }

    try {
      const readinessByMatchId = await fetchAwardsReadinessByMatchIds(candidateMatchIds);
      return rows.filter((notification) => {
        if (!isAwardsReadyNotificationType(notification?.type)) return true;
        const matchId = toNumericMatchId(resolveNotificationMatchId(notification));
        if (matchId == null) return false;
        return readinessByMatchId.get(matchId) === true;
      });
    } catch (error) {
      logger.warn('[NOTIFICATIONS] Could not validate awards-ready notifications. Hiding them to avoid false positives.', error);
      return rows.filter((notification) => !isAwardsReadyNotificationType(notification?.type));
    }
  }, [fetchAwardsReadinessByMatchIds, isAwardsReadyNotificationType, resolveNotificationMatchId]);
  // Umbral para ignorar eventos realtime con created_at <= al último clear
  const ignoreBeforeRef = useRef(null);

  useEffect(() => {
    authResolvedRef.current = authResolved;
    pushUserIdRef.current = user?.id || null;
  }, [authResolved, user?.id]);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  useEffect(() => {
    if (!authResolved) return;

    if (user?.id) {
      logger.log('[NOTIFICATIONS] Current user available from auth context:', user.id);
      setCurrentUserId(user.id);
      return;
    }

    logger.log('[NOTIFICATIONS] No authenticated user available after auth resolution');
    setCurrentUserId(null);
  }, [authResolved, user?.id]);

  useEffect(() => {
    let source = null;
    const previousUserId = lastObservedPushUserIdRef.current;

    if (authResolved && !initialAuthCheckedRef.current) {
      initialAuthCheckedRef.current = true;
      if (user?.id) {
        source = 'auth_restored';
      }
    } else if (authResolved && user?.id && !previousUserId) {
      source = 'login_success';
    } else if (authResolved && user?.id && previousUserId && previousUserId !== user.id) {
      source = 'login_success';
    }

    lastObservedPushUserIdRef.current = user?.id || null;

    if (!source || !authResolved || !user?.id) return;

    (async () => {
      const state = await getPushTokenSyncState();
      console.info('[PUSH] auth_ready', {
        source,
        authResolved,
        userId: user.id,
        hasPending: state.hasPending,
        hasKnown: state.hasKnown,
        lastSyncedTokenSuffix: state.lastSyncedTokenSuffix,
      });
      await flushPendingPushToken({ source });
    })().catch((error) => {
      console.warn('[PUSH] auth_ready flush failed', {
        source,
        userId: user.id,
        message: error?.message || String(error || 'unknown_error'),
      });
    });
  }, [authResolved, user?.id]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let listenerHandle = null;

    CapacitorApp.addListener('resume', () => {
      if (!authResolvedRef.current || !pushUserIdRef.current) return;

      Promise.resolve()
        .then(async () => {
          const state = await getPushTokenSyncState();
          console.info('[PUSH] auth_ready', {
            source: 'app_resume',
            authResolved: authResolvedRef.current,
            userId: pushUserIdRef.current,
            hasPending: state.hasPending,
            hasKnown: state.hasKnown,
            lastSyncedTokenSuffix: state.lastSyncedTokenSuffix,
          });
          await flushPendingPushToken({ source: 'app_resume' });
        })
        .catch((error) => {
          console.warn('[PUSH] app_resume flush failed', {
            userId: pushUserIdRef.current,
            message: error?.message || String(error || 'unknown_error'),
          });
        });
    })
      .then((handle) => {
        listenerHandle = handle;
      })
      .catch((error) => {
        console.warn('[PUSH] Failed to attach app resume listener', error);
      });

    return () => {
      if (listenerHandle?.remove) {
        listenerHandle.remove().catch(() => null);
      }
    };
  }, []);

  // Fetch all notifications for the current user
  const fetchNotifications = useCallback(async () => {
    if (!currentUserId) {
      logger.log('[NOTIFICATIONS] fetchNotifications: No currentUserId, skipping');
      return;
    }

    logger.log('[NOTIFICATIONS] Fetching notifications for user:', currentUserId);
    try {
      // Only fetch notifications from the recent UI window to keep the inbox lightweight.
      const cutoffISO = getNotificationsUiCutoffIso();

      let data;
      try {
        const res = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', currentUserId)
          .gte('created_at', cutoffISO)
          .order('send_at', { ascending: false });
        data = res.data;
        if (res.error) {
          throw res.error;
        }
      } catch (selectErr) {
        throw selectErr;
      }

      // Fallback for social notifications:
      // If friend requests exist in `amigos` but notification inserts were blocked (e.g. RLS),
      // synthesize in-app friend_request notifications so users still see them in the bell/feed.
      let syntheticFriendRequestNotifications = [];
      try {
        const { data: pendingFriendRequests, error: pendingError } = await supabase
          .from('amigos')
          .select('id, user_id, created_at')
          .eq('friend_id', currentUserId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (pendingError) {
          logger.warn('[NOTIFICATIONS] Pending friend requests fallback query failed:', pendingError);
        } else if (Array.isArray(pendingFriendRequests) && pendingFriendRequests.length > 0) {
          const existingUnreadRequestIds = new Set();
          const existingUnreadSenderIds = new Set();

          (data || []).forEach((notification) => {
            if (notification?.type !== 'friend_request' || notification?.read) return;
            const requestId = notification?.data?.requestId;
            const senderId = notification?.data?.senderId;
            if (requestId) existingUnreadRequestIds.add(String(requestId));
            if (senderId) existingUnreadSenderIds.add(String(senderId));
          });

          const missingPendingRequests = pendingFriendRequests.filter((request) => (
            !existingUnreadRequestIds.has(String(request?.id))
            && !existingUnreadSenderIds.has(String(request?.user_id))
          ));

          if (missingPendingRequests.length > 0) {
            const senderIds = [...new Set(missingPendingRequests.map((request) => request?.user_id).filter(Boolean))];
            const senderNameById = new Map();

            if (senderIds.length > 0) {
              const { data: senderRows, error: senderError } = await supabase
                .from('usuarios')
                .select('id, nombre')
                .in('id', senderIds);

              if (senderError) {
                logger.warn('[NOTIFICATIONS] Pending friend requests fallback sender lookup failed:', senderError);
              } else {
                (senderRows || []).forEach((row) => {
                  if (row?.id) senderNameById.set(row.id, row?.nombre || 'Alguien');
                });
              }
            }

            syntheticFriendRequestNotifications = missingPendingRequests.map((request) => {
              const senderId = request?.user_id || null;
              const senderName = senderNameById.get(senderId) || 'Alguien';
              const createdAtMs = new Date(request?.created_at || Date.now()).getTime();
              const syntheticCreatedAt = Number.isFinite(createdAtMs)
                ? new Date(createdAtMs + 1).toISOString()
                : new Date().toISOString();

              return {
                id: request.id, // Keep UUID-like id to avoid invalid-id update errors in markAsRead
                user_id: currentUserId,
                type: 'friend_request',
                title: 'Nueva solicitud de amistad',
                message: `${senderName} te ha enviado una solicitud de amistad`,
                data: {
                  requestId: request.id,
                  senderId,
                  senderName,
                  source: 'amigos_pending_fallback',
                },
                read: false,
                created_at: syntheticCreatedAt,
                updated_at: syntheticCreatedAt,
                send_at: null,
                status: 'sent',
              };
            });
          }
        }
      } catch (pendingFallbackError) {
        logger.warn('[NOTIFICATIONS] Pending friend requests fallback failed:', pendingFallbackError);
      }

      const mergedData = [
        ...(Array.isArray(data) ? data : []),
        ...syntheticFriendRequestNotifications,
      ];
      const enrichedData = await enrichNotificationMatchStarts(mergedData);

      setLastFetchAt(new Date().toISOString());
      setLastFetchCount((data && data.length) || 0);

      logger.log('[NOTIFICATIONS] Fetched notifications (total):', data?.length || 0);

      // Split visible vs scheduled based on send_at
      const now = Date.now();
      const visibleRaw = [];
      const scheduledRaw = [];
      for (const n of enrichedData) {
        try {
          const sendAt = n.send_at ? new Date(n.send_at).getTime() : null;
          if (!sendAt || sendAt <= now) visibleRaw.push(n);
          else scheduledRaw.push(n);
        } catch (e) {
          // If parsing fails, treat as visible to avoid hiding notifications
          visibleRaw.push(n);
        }
      }

      logger.log('[NOTIFICATIONS] Visible fetched:', visibleRaw.length, 'Scheduled fetched:', scheduledRaw.length);

      // Hide stale/false-positive awards-ready notifications unless awards are truly persisted.
      const visibleAwardsValidated = await filterPrematureAwardsNotifications(visibleRaw);

      // Hide stale invite/kick rows before dedupe so lists stay actionable.
      const visibleForDisplay = filterNotificationsForInbox(visibleAwardsValidated);

      // Deduplicate only the visible notifications for display
      const dedupedVisible = dedupeNotificationsForDisplay(visibleForDisplay);

      setNotifications(dedupedVisible);
      setScheduledNotifications(scheduledRaw);
      updateUnreadCount(dedupedVisible);
    } catch (error) {
      handleError(error, { showToast: false, onError: () => { } });
    }
  }, [currentUserId, enrichNotificationMatchStarts, filterPrematureAwardsNotifications]);

  const refreshNotificationsSafely = useCallback(async ({ force = false } = {}) => {
    if (!currentUserId) return;
    if (refreshRunningRef.current) return;

    const now = Date.now();
    if (!force && now - lastRefreshMsRef.current < 5000) {
      return;
    }

    refreshRunningRef.current = true;
    lastRefreshMsRef.current = now;
    try {
      await fetchNotifications();
    } catch (error) {
      logger.warn('[NOTIFICATIONS] Refresh failed:', error);
    } finally {
      refreshRunningRef.current = false;
    }
  }, [currentUserId, fetchNotifications]);

  // Deduplicate notifications per user+partido, preferring survey-related types
  const dedupeNotificationsForDisplay = (notifs = []) => {
    const normalizeToken = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

    const buildSurveyReminderSignature = (notification) => {
      if (!notification) return '';
      const type = String(notification?.type || '').trim().toLowerCase();
      if (type !== 'survey_reminder' && type !== 'survey_reminder_12h') return '';

      const data = notification?.data || {};
      const reminderType = String(
        data?.reminder_type
        || data?.reminderType
        || (type === 'survey_reminder_12h' ? '12h_before_deadline' : '1h_before_deadline')
        || '',
      ).trim().toLowerCase();

      const matchName = normalizeToken(resolveNotificationMatchName(notification, ''));
      const matchDate = String(data?.match_date || data?.fecha || '').trim();
      const matchTime = String(data?.match_time || data?.hora || '').trim();
      const deadline = String(data?.survey_deadline_at || data?.surveyDeadlineAt || '').trim();

      const signature = [matchName, matchDate, matchTime, deadline, reminderType]
        .filter(Boolean)
        .join('|');

      return signature || '';
    };

    // Ensure awards_ready is considered a survey-related notification and gets proper priority
    const preferredOrder = [
      'survey_finished',
      'survey_results_ready',
      'awards_ready',
      'survey_start',
      'post_match_survey',
      'survey_reminder',
      'survey_reminder_12h',
      'call_to_vote',
    ];
    const keepMap = new Map(); // key -> notification for partido-linked
    const othersMap = new Map(); // key -> notification for non-partido notifications (group by type+title+message)

    for (const n of notifs) {
      const pid = resolveNotificationMatchId(n);
      if (pid === null || pid === undefined) {
        // group generic notifications by type+title+message to avoid duplicate cards
        const compKey = `${n.type}::${(n.title || '').trim()}::${(n.message || '').trim()}`;
        const existingOther = othersMap.get(compKey);
        if (!existingOther) {
          othersMap.set(compKey, n);
          continue;
        }
        // keep the newest
        if (new Date(n.created_at) > new Date(existingOther.created_at)) {
          othersMap.set(compKey, n);
        }
        continue;
      }

      const surveyGroup = (
        n.type === 'survey_start' || n.type === 'post_match_survey'
          ? 'survey_open'
          : n.type === 'survey_reminder' || n.type === 'survey_reminder_12h'
            ? 'survey_reminder'
            : n.type === 'challenge_squad_open'
              ? 'team_challenge_squad_open'
              : isTeamChallengeNotification(n)
                ? 'team_challenge_accepted'
                : String(n.type || 'default')
      );
      const reminderSignature = buildSurveyReminderSignature(n);
      const key = reminderSignature
        ? `${n.user_id}::${surveyGroup}::sig:${reminderSignature}`
        : `${n.user_id}::${String(pid)}::${surveyGroup}`;
      const existing = keepMap.get(key);
      if (!existing) {
        keepMap.set(key, n);
        continue;
      }

      const eIdx = preferredOrder.indexOf(existing.type);
      const nIdx = preferredOrder.indexOf(n.type);

      if (nIdx === -1 && eIdx === -1) {
        // neither in preferred list => keep newest
        if (new Date(n.created_at) > new Date(existing.created_at)) {
          keepMap.set(key, n);
        }
      } else if (nIdx === -1) {
        // existing has priority - do nothing
      } else if (eIdx === -1) {
        // new has priority
        keepMap.set(key, n);
      } else {
        // both have priority positions, smaller index = higher priority
        if (nIdx < eIdx) {
          keepMap.set(key, n);
        } else if (nIdx === eIdx) {
          // same priority type => newest
          if (new Date(n.created_at) > new Date(existing.created_at)) {
            keepMap.set(key, n);
          }
        }
      }
    }

    // If there's a survey-related notification for a partido, we should suppress lower-priority
    // notifications (like 'call_to_vote') that reference the same partido even if they were stored
    // as non-partido grouped notifications. Build a set of partido ids that have survey notifications.
    const surveyTypes = new Set(['survey_start', 'post_match_survey', 'survey_reminder', 'survey_reminder_12h', 'survey_results_ready', 'awards_ready', 'survey_finished']);
    const surveyPartidoIds = new Set();
    for (const n of Array.from(keepMap.values())) {
      if (surveyTypes.has(n.type)) {
      const pid = resolveNotificationMatchId(n);
      if (pid !== null && pid !== undefined) surveyPartidoIds.add(String(pid));
      }
    }
    for (const n of Array.from(othersMap.values())) {
      if (surveyTypes.has(n.type)) {
      const pid = resolveNotificationMatchId(n);
      if (pid !== null && pid !== undefined) surveyPartidoIds.add(String(pid));
      }
    }

    // Build result: non-partido grouped notifications first, then deduped partido notifications
    const nonPartido = Array.from(othersMap.values())
      .filter((n) => {
        // If this non-partido notification references a partido that already has a survey,
        // and this notification is a lower-priority type (call_to_vote), suppress it.
        const pid = resolveNotificationMatchId(n);
        if (pid !== null && pid !== undefined && surveyPartidoIds.has(String(pid)) && n.type === 'call_to_vote') {
          return false;
        }
        return true;
      })
      .sort((a, b) => getNotificationDisplayTimestampMs(b) - getNotificationDisplayTimestampMs(a));
    const deduped = Array.from(keepMap.values())
      .sort((a, b) => getNotificationDisplayTimestampMs(b) - getNotificationDisplayTimestampMs(a));
    // Merge and sort globally by send_at (or created_at) so updated rows keep expected order
    const merged = [...nonPartido, ...deduped];
    merged.sort((a, b) => getNotificationDisplayTimestampMs(b) - getNotificationDisplayTimestampMs(a));
    return merged;
  };

  // Handle new notification
  const handleNewNotification = async (notification) => {
    logger.log('[NOTIFICATIONS] New realtime notification:', {
      id: notification.id,
      type: notification.type,
      isForCurrentUser: notification.user_id === currentUserId,
    });

    // Verificar que la notificación es para el usuario actual
    if (notification.user_id !== currentUserId) {
      logger.warn('[NOTIFICATIONS] Notification not for current user, ignoring');
      return;
    }

    const notificationType = String(notification?.type || '').trim();
    track('push_received', {
      notification_type: notificationType || undefined,
      match_id: resolveNotificationMatchId(notification) || undefined,
      notification_id: String(notification?.id || '').trim() || undefined,
      source: 'notification_realtime',
    });

    // If notification is scheduled for the future, keep it in scheduledNotifications and don't show it yet
    try {
      if (notification.send_at) {
        const sendAt = new Date(notification.send_at).getTime();
        if (!Number.isNaN(sendAt) && sendAt > Date.now()) {
          logger.log('[NOTIFICATIONS] Received scheduled notification, queuing for later:', notification.id, notification.type, notification.send_at);
          setScheduledNotifications((prev) => {
            if (prev.find((n) => n.id === notification.id)) return prev;
            return [notification, ...prev];
          });
          // Don't add to visible list or show toast yet
          return;
        }
      }
    } catch (e) {
      logger.warn('[NOTIFICATIONS] Error parsing send_at for new notification, proceeding to show it:', e);
    }

    // Ignorar eventos antiguos (realtime que llegó tarde) si son <= último clear
    try {
      if (ignoreBeforeRef.current) {
        const createdAt = new Date(notification.created_at).getTime();
        const ignoreBefore = new Date(ignoreBeforeRef.current).getTime();
        if (!Number.isNaN(createdAt) && !Number.isNaN(ignoreBefore) && createdAt <= ignoreBefore) {
          logger.log('[NOTIFICATIONS] Ignoring old notification');
          return;
        }
      }
    } catch (e) {
      logger.warn('[NOTIFICATIONS] Error comparing timestamps:', e);
    }

    if (isAwardsReadyNotificationType(notification?.type)) {
      try {
        const matchId = toNumericMatchId(resolveNotificationMatchId(notification));
        if (matchId == null) {
          logger.log('[NOTIFICATIONS] Dropping awards-ready notification without valid match id:', notification?.id);
          return;
        }
        const readinessByMatchId = await fetchAwardsReadinessByMatchIds([matchId]);
        if (readinessByMatchId.get(matchId) !== true) {
          logger.log('[NOTIFICATIONS] Suppressing premature awards-ready notification:', {
            notificationId: notification?.id,
            matchId,
            type: notification?.type,
          });
          return;
        }
      } catch (error) {
        logger.warn('[NOTIFICATIONS] Failed to validate awards-ready realtime notification. Hiding it to avoid false positives.', error);
        return;
      }
    }

    // If the user is currently on the survey page for the same partido, or viewing the partido page,
    // don't insert the realtime notification. This prevents the survey UI from being reset by realtime inserts.
    try {
      const notifPid = notification.partido_id ?? (notification.data?.match_id ?? notification.data?.matchId ?? null);
      if (notifPid && typeof window !== 'undefined' && window.location && window.location.pathname) {
        const path = window.location.pathname;
        const search = window.location.search || '';

        // Common patterns used in the app:
        // - /encuesta/:id
        // - /partido/:id (survey might be embedded there)
        // - query ?codigo= (matchCode)

        const isOnEncuestaPath = path.includes('/encuesta') && path.includes(String(notifPid));
        const isOnPartidoPath = path.includes(`/partido/${String(notifPid)}`) || path.includes(`/partido/${String(notifPid)}/`);
        const isOnPartidoGeneric = path.includes('/partido/') && path.includes(String(notifPid));

        // also check query string for matchCode if provided in notification
        const matchCode = notification.data?.matchCode ?? notification.data?.match_code ?? null;
        const isOnQueryCodigo = matchCode && search.includes(`codigo=${matchCode}`);

        if (
          (isOnEncuestaPath || isOnPartidoPath || isOnPartidoGeneric || isOnQueryCodigo) &&
          notification.type !== 'awards_ready'
        ) {
          logger.log('[NOTIFICATIONS] Suppressing realtime notification while user is on survey/partido page for partido:', notifPid);
          return;
        }
      }
    } catch (e) {
      logger.warn('[NOTIFICATIONS] Error while checking current path for survey suppression:', e);
    }

    // Insert and dedupe using the same logic as fetch (to avoid duplicate cards)
      setNotifications((prev) => {
        logger.log('[NOTIFICATIONS] Current notifications count:', prev.length);
        // Evitar duplicados por id
        if (prev.find((n) => n.id === notification.id)) {
          logger.log('[NOTIFICATIONS] Notification already exists, skipping');
          return prev;
        }

        const updated = [notification, ...prev];
        const visibleUpdated = filterNotificationsForInbox(updated);

        try {
          const deduped = dedupeNotificationsForDisplay(visibleUpdated);
          logger.log('[NOTIFICATIONS] Updated notifications count after dedupe:', deduped.length);
          updateUnreadCount(deduped);
          return deduped;
        } catch (e) {
          logger.error('[NOTIFICATIONS] Error during dedupe, falling back to raw list:', e);
          updateUnreadCount(visibleUpdated);
          return visibleUpdated;
        }
      });

    handleRealtimeNotificationSideEffects(notification);
    logger.log('[NOTIFICATIONS] Notification processed successfully');
  };

  useEffect(() => {
    if (!currentUserId) return undefined;

    logger.log('[NOTIFICATIONS] Setting up for user:', currentUserId);
    refreshNotificationsSafely({ force: true });

    const intervalId = window.setInterval(() => {
      refreshNotificationsSafely();
    }, 300000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentUserId, refreshNotificationsSafely]);

  useRefreshOnVisibility(() => {
    refreshNotificationsSafely();
  }, {
    enabled: Boolean(currentUserId),
  });

  // Notification center is the source of truth for passive updates.
  // Keep only side effects that are still required when a realtime event lands.
  const handleRealtimeNotificationSideEffects = (notification) => {
    if (notification?.type !== 'admin_transfer') return;

    if (notification.data?.forceRefresh) {
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    }
  };

  // Update unread count
  const updateUnreadCount = (notifs) => {
    const unread = notifs.filter((n) => !n.read);
    const friendRequests = unread.filter((n) => n.type === 'friend_request').length;
    const matchInvites = unread.filter((n) => n.type === 'match_invite').length;
    const matchUpdates = unread.filter((n) => n.type === 'match_update').length;
    const matchKicked = unread.filter((n) => n.type === 'match_kicked').length;
    const teamInvites = unread.filter((n) => n.type === 'team_invite').length;
    const captainTransfers = unread.filter((n) => n.type === 'team_captain_transfer').length;
    const matchJoinRequests = unread.filter((n) => n.type === 'match_join_request').length;
    const matchJoinApproved = unread.filter((n) => n.type === 'match_join_approved').length;
    const callToVote = unread.filter((n) => n.type === 'call_to_vote').length;
    const surveyStarts = unread.filter((n) => n.type === 'survey_start').length;
    const postMatchSurveys = unread.filter((n) => n.type === 'post_match_survey').length;
    const surveyReminders = unread.filter((n) => n.type === 'survey_reminder' || n.type === 'survey_reminder_12h').length;
    const surveyResults = unread.filter((n) => n.type === 'survey_results_ready').length;
    const awardsReady = unread.filter((n) => n.type === 'awards_ready').length;
    const awardWon = unread.filter((n) => n.type === 'award_won').length;
    const surveyFinished = unread.filter((n) => n.type === 'survey_finished').length;
    const noShowPenalty = unread.filter((n) => n.type === 'no_show_penalty_applied').length;
    const noShowRecovery = unread.filter((n) => n.type === 'no_show_recovery_applied').length;
    const challengeAccepted = unread.filter((n) => n.type === 'challenge_accepted').length;
    const teamMatchCreated = unread.filter((n) => n.type === 'team_match_created').length;
    const challengeSquadOpen = unread.filter((n) => n.type === 'challenge_squad_open').length;

    setUnreadCount({
      friends: friendRequests,
      teamInvites,
      matches: matchInvites + matchUpdates + matchKicked + teamInvites + captainTransfers + matchJoinRequests + matchJoinApproved + callToVote + surveyStarts + postMatchSurveys + surveyReminders + surveyResults + awardsReady + awardWon + surveyFinished + noShowPenalty + noShowRecovery + challengeAccepted + teamMatchCreated + challengeSquadOpen,
      total: unread.length,
    });
  };

  // Mark notification as read
  const markAsRead = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

      if (error) throw error;

      // Update local state
      setNotifications((prev) =>
        prev.map((n) => n.id === notificationId ? { ...n, read: true } : n),
      );

      // Update unread count
      const updatedNotifications = notifications.map((n) =>
        n.id === notificationId ? { ...n, read: true } : n,
      );
      updateUnreadCount(updatedNotifications);
    } catch (error) {
      handleError(error, { showToast: false, onError: () => { } });
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', currentUserId)
        .eq('read', false);

      if (error) throw error;

      // Update local state
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount({ friends: 0, teamInvites: 0, matches: 0, total: 0 });
    } catch (error) {
      logger.error('Error marking all notifications as read:', error);
    }
  };

  // Mark notifications of a specific type as read
  const markTypeAsRead = async (type) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', currentUserId)
        .eq('type', type)
        .eq('read', false);

      if (error) throw error;

      // Update local state
      setNotifications((prev) =>
        prev.map((n) => n.type === type ? { ...n, read: true } : n),
      );

      // Update unread count
      const updatedNotifications = notifications.map((n) =>
        n.type === type ? { ...n, read: true } : n,
      );
      updateUnreadCount(updatedNotifications);
    } catch (error) {
      logger.error(`Error marking ${type} notifications as read:`, error);
    }
  };

  const markTeamInvitationAsHandled = async (invitationId) => {
    const normalizedInvitationId = String(invitationId || '').trim();
    if (!normalizedInvitationId) return;

    const updatedNotifications = notifications.map((notification) => {
      const notificationInvitationId = String(
        notification?.data?.invitation_id
        || notification?.data?.invitationId
        || '',
      ).trim();

      if (
        notification?.type === 'team_invite'
        && notificationInvitationId === normalizedInvitationId
        && !notification?.read
      ) {
        return { ...notification, read: true };
      }

      return notification;
    });

    const matchedNotificationIds = updatedNotifications
      .filter((notification, index) => (
        notification?.id
        && notifications[index]?.read !== true
        && notification?.read === true
        && notifications[index]?.type === 'team_invite'
      ))
      .map((notification) => notification.id);

    setNotifications(updatedNotifications);
    updateUnreadCount(updatedNotifications);

    if (matchedNotificationIds.length === 0) return;

    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', matchedNotificationIds);

      if (error) throw error;
    } catch (error) {
      logger.error('Error marking team invitation notifications as handled:', error);
      refreshNotificationsSafely({ force: true });
    }
  };

  // Clear all notifications (local state update)
  const clearAllNotifications = () => {
    // Registrar el instante de limpieza para ignorar eventos realtime antiguos
    ignoreBeforeRef.current = new Date().toISOString();
    setNotifications([]);
    setScheduledNotifications([]);
    setUnreadCount({ friends: 0, teamInvites: 0, matches: 0, total: 0 });
  };

  useSupabaseRealtime({
    enabled: Boolean(currentUserId),
    channelName: currentUserId ? `notifications:${currentUserId}` : null,
    deps: [currentUserId],
    onStatusChange: setSubscriptionStatus,
    events: currentUserId ? [
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUserId}`,
        handler: (payload) => {
          if (payload.eventType === 'INSERT' && payload.new) {
            setLastRealtimeAt(new Date().toISOString());
            setLastRealtimePayloadType(payload.new.type || null);
            handleNewNotification(payload.new);
            return;
          }

          if (payload.eventType === 'UPDATE' && payload.new) {
            setLastRealtimeAt(new Date().toISOString());
            setLastRealtimePayloadType(payload.new.type || null);

            const isKnownNotification = notificationsRef.current.some(
              (notification) => notification.id === payload.new.id,
            );

            if (!isKnownNotification) {
              handleNewNotification(payload.new);
              return;
            }

            setNotifications((prev) => {
              const updated = prev.map((notification) => (
                notification.id === payload.new.id
                  ? { ...notification, ...payload.new }
                  : notification
              ));

              const visibleUpdated = filterNotificationsForInbox(updated);

              try {
                const deduped = dedupeNotificationsForDisplay(visibleUpdated);
                updateUnreadCount(deduped);
                return deduped;
              } catch (error) {
                logger.warn('[NOTIFICATIONS] Failed to re-dedupe updated notification. Using merged list.', error);
                updateUnreadCount(visibleUpdated);
                return visibleUpdated;
              }
            });
            return;
          }

          if (payload.eventType === 'DELETE' && payload.old?.id) {
            setNotifications((prev) => {
              const updated = prev.filter((notification) => notification.id !== payload.old.id);
              updateUnreadCount(updated);
              return updated;
            });
          }
        },
      },
    ] : [],
  });

  // Create a new notification (for testing or manual creation)
  const createNotification = async (type, title, message, data = {}, partidoId = null) => {
    if (!currentUserId) return { ok: false, error: { message: 'no_current_user' } };

    // --- CANONICAL MODE CHECK: prevent client creation of survey notifications when DB is canonical ---
    const SURVEY_FANOUT_MODE =
      process.env.REACT_APP_SURVEY_FANOUT_MODE
      || process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE
      || 'db';
    if (SURVEY_FANOUT_MODE === 'db' && (type === 'survey_start' || type === 'post_match_survey')) {
      return { ok: false, error: { message: 'blocked_by_survey_fanout_mode' } };
    }

    try {
      const now = new Date().toISOString();
      const pidFromArg = partidoId != null ? Number(partidoId) : null;
      const pidFromData = data?.matchId ?? data?.match_id ?? data?.partido_id ?? data?.match_id_text ?? null;
      const pidNumber = pidFromArg != null ? (Number.isFinite(Number(pidFromArg)) ? Number(pidFromArg) : null) : (pidFromData != null ? (Number.isFinite(Number(pidFromData)) ? Number(pidFromData) : null) : null);

      // If this is a survey_start or post_match_survey we require a partido_id to avoid creating null-match rows
      if ((type === 'survey_start' || type === 'post_match_survey') && pidNumber == null) {
        console.error('[NOTIFICATIONS] Attempt to create survey_start/post_match_survey without partido_id. Aborting insert.', { type, data, partidoId });
        return { ok: false, error: { message: 'missing_partido_id_for_survey_notification' } };
      }

      const notification = {
        user_id: currentUserId,
        type,
        title,
        message,
        partido_id: pidNumber != null ? pidNumber : null,
        data: { ...data },
        send_at: data?.send_at ?? null,
        read: false,
        created_at: now,
      };

      // Log session user for extra diagnostics
      try {
        await supabase.auth.getSession();
      } catch (sessErr) {
        logger.warn('[NOTIFICATIONS] getSession error:', sessErr);
      }

      // Attempt insert
      const res = await supabase
        .from('notifications')
        .insert([notification])
        .select()
        .single();

      if (res.error) {
        const errCode = String(res.error?.code || res.error?.message || '');

        // If unique constraint violation (duplicate), perform an update for the existing row
        if (errCode === '23505') {
          try {
            const upd = await supabase
              .from('notifications')
              .update({ title, message, data: { ...data }, read: false, created_at: now, send_at: notification.send_at })
              .eq('user_id', currentUserId)
              .eq('partido_id', partidoId != null ? partidoId : null)
              .eq('type', type)
              .select()
              .single();

            if (upd.error) {
              logger.warn('[NOTIFICATIONS] createNotification update-after-duplicate error:', upd.error);
              return { ok: false, error: { code: upd.error.code, message: upd.error.message, details: upd.error.details, hint: upd.error.hint } };
            }

            const updatedRow = upd.data;
            try { await fetchNotifications(); } catch (e) { logger.warn('[NOTIFICATIONS] fetchNotifications after update failed:', e); }
            // Update local notifications array immediately to reflect the updated row (force re-render even if id unchanged)
            try {
              setNotifications((prev) => {
                const next = prev.map((n) => (n.id === updatedRow.id ? { ...n, ...updatedRow } : n));
                return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
              });
            } catch (stateErr) {
              logger.warn('[NOTIFICATIONS] Error updating local notifications after duplicate update:', stateErr);
            }
            return { ok: true, mode: 'updated', row: updatedRow };
          } catch (updateException) {
            logger.warn('[NOTIFICATIONS] exception during update-after-duplicate:', updateException);
            return { ok: false, error: { message: String(updateException) } };
          }
        }

        // Non-duplicate insert error: return structured error
        const errObj = {
          code: res.error?.code || null,
          message: res.error?.message || null,
          details: res.error?.details || null,
          hint: res.error?.hint || null,
        };
        logger.warn('[NOTIFICATIONS] createNotification insert failed with error:', errObj);
        return { ok: false, error: errObj };
      }

      // Successful insert
      const newNotification = res.data;

      // After successful insert, force a fetch to update UI
      try {
        await fetchNotifications();
      } catch (e) {
        logger.warn('[NOTIFICATIONS] fetchNotifications after createNotification failed:', e);
      }

      return { ok: true, mode: 'inserted', row: newNotification };
    } catch (error) {
      const errObj = {
        code: error?.code || null,
        message: error?.message || String(error),
        details: error?.details || null,
        hint: error?.hint || null,
      };
      logger.warn('[NOTIFICATIONS] createNotification unexpected error:', errObj);
      return { ok: false, error: errObj };
    }
  };

  const value = useMemo(() => ({
    notifications,
    scheduledNotifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    markTypeAsRead,
    markTeamInvitationAsHandled,
    createNotification,
    fetchNotifications,
    clearAllNotifications,
    // Debug fields
    currentUserId,
    subscriptionStatus,
    lastFetchAt,
    lastFetchCount,
    lastRealtimeAt,
    lastRealtimePayloadType,
  }), [notifications, scheduledNotifications, unreadCount, markAsRead, markAllAsRead, markTypeAsRead, markTeamInvitationAsHandled, createNotification, fetchNotifications, clearAllNotifications, currentUserId, subscriptionStatus, lastFetchAt, lastFetchCount, lastRealtimeAt, lastRealtimePayloadType]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export default NotificationContext;
