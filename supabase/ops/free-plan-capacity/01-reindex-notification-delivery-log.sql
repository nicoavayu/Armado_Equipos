-- Core — step 1 of the Free-plan capacity remediation. NO ROW CHANGES.
-- public.notification_delivery_log keeps a handful of live rows (the daily retention deletes the rest), but its
-- indexes kept every page they ever used: in Production, 67 MB of indexes for 16 rows (2026-10-07). REINDEX TABLE
-- CONCURRENTLY builds each index again next to the old one and swaps them; reads and writes keep running (it only waits
-- for transactions already open). Run with psql (it cannot run inside a transaction block, so not in the SQL editor).
-- If it is interrupted, PostgreSQL leaves the half-built copies marked invalid (<index>_ccnew): drop them with
-- `drop index concurrently public.<index>_ccnew;` and run this step again. Rehearsal: lab-rehearsal.sh.
\set ON_ERROR_STOP on
set lock_timeout = '5s';
reindex table concurrently public.notification_delivery_log;
