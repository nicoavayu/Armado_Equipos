-- ACCOUNT ERASURE 0021 — operator RECONCILE query (READ ONLY; run as the installer inside BEGIN TRANSACTION READ ONLY).
-- Lists the erasures Torneos did that Core never confirmed (state torneos_erased) older than the threshold below:
-- the Core deletion failed after Torneos anonymised and nobody retried, or Core finished but its confirmation was lost.
-- No cron runs this; the operator does, by hand (procedure in ../README.md «Reconciliación»). It prints no names, no
-- emails and no Core ids: only the ledger id, the sha256 of the Core user id (to look the user up in Core), the request
-- id and timestamps, and whether an identity for the same Core user exists again in Torneos (a session opened after the
-- erasure: the confirmation's sweep would erase it).
-- Threshold: change only the literal interval (default 24 hours).
select e.id as erasure_id,
       e.core_user_sha256,
       e.request_id,
       e.erased_at,
       date_trunc('minute', now() - e.erased_at) as age,
       jsonb_array_length(e.pending_storage_objects) as pending_storage_objects,
       exists (
         select 1 from public.torneos_identity i
         where encode(sha256(convert_to(i.core_user_id::text, 'UTF8')), 'hex') = e.core_user_sha256
       ) as identity_recreated
from private.tournament_account_erasures e
where e.state = 'torneos_erased'
  and e.erased_at < now() - interval '24 hours'
order by e.erased_at;
