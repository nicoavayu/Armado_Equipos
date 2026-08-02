# Canonical Migrations

This is the single source of truth for database schema/data migrations.

## Rules

- Add new SQL files only in this folder.
- Prefer timestamped names (`YYYYMMDDHHMMSS_description.sql`) for new migrations.
- Apply with:
  - `npm run db:list`
  - `npm run db:push`

## Notes

- `migrations/` at repo root is a legacy archive and should not receive new SQL files.
