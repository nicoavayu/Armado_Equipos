# Survey Notifications Migration

## Overview
This migration ensures that `survey_start` notifications are ONLY created by the scheduled fanout function, not at match creation time.

## Changes Made

### 1. SQL Cleanup (`cleanup_early_survey_notifications.sql`)
- **Dropped triggers**: Removed any triggers that create survey notifications when a match is created
- **Dropped functions**: Removed legacy notification functions
- **Cleaned data**: Deleted early/invalid `survey_start` notifications that were created before match start time

### 2. JavaScript Service Updates

#### `src/services/db/matches.js`
- Removed call to `scheduleSurveyReminderForMatch()` in `crearPartido()` function
- Added comment explaining that survey notifications are now handled by cron job

#### `src/services/db/notifications.js`
- Deprecated `scheduleSurveyReminderForMatch()` function
- Function now returns empty result and logs deprecation warning

## How Survey Notifications Work Now

### Single Source of Truth
Survey notifications are ONLY created by:
```sql
public.fanout_survey_start_notifications()
```

### Cron Job Schedule
- **Frequency**: Every 1 minute
- **Function**: `SELECT public.fanout_survey_start_notifications();`
- **Setup**: Configure in Supabase Dashboard > Database > Cron Jobs

### Notification Logic
1. Function runs every minute
2. Selects matches where:
   - `(fecha + hora) <= NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires'`
   - `surveys_sent = false`
3. For each match:
   - Gets all participants (from `jugadores` JSONB array)
   - Gets match admin (`creado_por`)
   - Inserts notification for each user with:
     - `type = 'survey_start'`
     - `title = '¡HORA DE CALIFICAR!'`
     - `message = 'Completá la encuesta del partido.'`
     - `data = { match_id, link: '/encuesta/{match_id}' }`
4. Marks match as `surveys_sent = true`
5. Returns count of notifications created

### Duplicate Prevention
- Unique index: `uniq_notif_user_match_type` on `(user_id, data->>'match_id', type)`
- Uses `ON CONFLICT DO NOTHING` to prevent duplicates

## Migration Steps

1. Run `cleanup_early_survey_notifications.sql` in Supabase SQL Editor
2. Deploy updated JavaScript code
3. Configure cron job in Supabase Dashboard:
   - Name: `survey_fanout`
   - Schedule: `* * * * *` (every minute)
   - Command: `SELECT public.fanout_survey_start_notifications();`

## Verification

### Check for early notifications
```sql
SELECT COUNT(*) 
FROM notifications 
WHERE type = 'survey_start';
```

### View recent survey notifications
```sql
SELECT n.*, p.fecha, p.hora, p.nombre
FROM notifications n
JOIN partidos p ON (n.data->>'match_id')::bigint = p.id
WHERE n.type = 'survey_start'
ORDER BY n.created_at DESC
LIMIT 10;
```

### Check cron job status
```sql
SELECT * FROM cron.job WHERE jobname = 'survey_fanout';
```

## Rollback (if needed)

If you need to rollback:
1. Stop the cron job in Supabase Dashboard
2. Revert JavaScript changes
3. Delete survey_start notifications: `DELETE FROM notifications WHERE type = 'survey_start';`
