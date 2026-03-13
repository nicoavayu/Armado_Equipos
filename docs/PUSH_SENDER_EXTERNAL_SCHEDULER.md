# Push Sender External Scheduler (GitHub Actions)

This repo uses a GitHub Actions workflow as the production automation path for `push-sender` dispatch.

## Why

The SQL scheduler path created by `20260312213000_push_sender_scheduler_automation.sql` remains in DB as legacy, but is not reliable in this project because it depends on `vault` and currently lands in `vault_extension_missing`.

## Active automation path

Workflow file:

- `.github/workflows/push-sender-dispatch.yml`

Schedule:

- Every 5 minutes (`*/5 * * * *`) due to GitHub Actions cron limits.

Invocation:

- `POST` to `push-sender` URL
- Headers:
  - `Authorization: Bearer <service_role_jwt>`
  - `apikey: <service_role_jwt>`
  - `x-push-sender-secret: <push_sender_secret>`
  - `Content-Type: application/json`
- Body:
  - `worker_id`
  - `limit`
  - `dry_run`

## Required GitHub secrets

Configure repository secrets:

- `SUPABASE_PUSH_SENDER_URL`
  - Example: `https://rcyuuoaqfwcembdajcss.supabase.co/functions/v1/push-sender`
- `SUPABASE_SERVICE_ROLE_KEY`
  - Service role JWT for project `rcyuuoaqfwcembdajcss`
- `PUSH_SENDER_SECRET`
  - Must match the Supabase Function secret already configured in `push-sender`

Optional repository variable:

- `PUSH_SENDER_BATCH_LIMIT` (default `120`)

## Manual validation

1. Run workflow manually from Actions tab (`workflow_dispatch`).
2. Check workflow logs:
   - `HTTP status: 200`
   - summary line with `ok=true`
3. Distinguish errors:
   - `401 unauthorized`: auth header or `x-push-sender-secret` mismatch
   - `500 sender_misconfigured`: missing function env (for example sender secret)
   - `ok=false` with `reason`: internal sender/runtime issue
4. Verify queue behavior in Supabase:
   - `notification_delivery_log` should move push rows from `queued` to `sent` / `failed` / `retryable_failed`.

## Notes

- The DB scheduler objects remain present for now (legacy path).
- No SQL cleanup is performed in this step.
