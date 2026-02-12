# Legacy Migration Archive

`migrations/` is now a legacy archive.

## Canonical Location

All new SQL migrations must be created in:

`supabase/migrations/`

## Deployment Commands

Run migrations using:

```bash
npm run db:list
npm run db:push
```

Both commands include a guard (`npm run migrations:guard`) that blocks accidental new SQL files in this legacy folder.

## Why this folder still exists

Older migrations are kept here for historical reference and manual forensic checks only.
