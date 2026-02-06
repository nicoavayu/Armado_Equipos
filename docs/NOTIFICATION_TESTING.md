# Testing Checklist: Notification System

## Prerequisites
1. Run `20260206_notification_system.sql` in Supabase SQL Editor
2. Run `20260206_cron_setup.sql` in Supabase SQL Editor
3. Restart dev server (`npm start`)

## Test Case A: Match Cancellation
**Goal:** Verify logged-in player receives cancellation notification

1. Create a match as admin
2. Add yourself as a player (or invite yourself)
3. Log in as that player in another browser/incognito
4. As admin, delete the match from "Próximos Partidos"
5. **Expected:**
   - Toast: "Partido eliminado"
   - Check `notification_delivery_log` table:
     ```sql
     SELECT * FROM notification_delivery_log 
     WHERE notification_type = 'match_deleted' 
     ORDER BY created_at DESC LIMIT 5;
     ```
   - Should see `status = 'queued'` for your user_id
   - In player browser, check notifications panel - should see "Partido eliminado"

## Test Case B: Survey Start
**Goal:** All participants receive survey_start notification

1. Create a match with 2+ players
2. Mark match as finished (enable survey)
3. **Expected:**
   - Check `notification_delivery_log`:
     ```sql
     SELECT * FROM notification_delivery_log 
     WHERE notification_type = 'survey_start' 
     ORDER BY created_at DESC;
     ```
   - Should see one row per participant + admin
   - All players should see "Encuesta disponible" notification

## Test Case C: 2-Minute Timeout
**Goal:** Survey closes after 2 minutes with 1+ response

1. Enable survey for a match
2. Submit 1 vote
3. Wait 2 minutes (cron runs every minute)
4. **Expected:**
   - After ~2 minutes, check:
     ```sql
     SELECT * FROM survey_progress WHERE partido_id = <your_match_id>;
     ```
   - `results_notified` should be `true`
   - Check delivery log for `survey_results_ready` with `reason: '2min_timeout'`

## Test Case D: 3 Responses
**Goal:** Immediate notification when 3 responses submitted

1. Enable survey for a match
2. Submit 3 votes quickly (can use different browsers/users)
3. **Expected:**
   - Immediately after 3rd vote:
     ```sql
     SELECT * FROM survey_progress WHERE partido_id = <your_match_id>;
     ```
   - `results_notified` should be `true`
   - `response_count` should be `3`
   - Check delivery log for `survey_results_ready` with `reason: '3_responses'`

## Debug Panel Usage
1. Add `<NotificationsDebugPanel partidoId={265} />` to any admin page
2. Filter by match ID, type, or status
3. Check for failed deliveries (red status badges)
4. Review error_text for any failures
