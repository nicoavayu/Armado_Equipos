-- Rollback of 20261010141000 (organizer approves join requests). Run as postgres, in one
-- transaction, before the rollback of 140000. Data: none. Effect: back to the canonical
-- allowlist — approve-join-request answers "forbidden" again and organizers cannot approve
-- join requests (since 140000 the normal way for an outsider to get into a match).
-- Exactly the grants it had before (Core Production: also authenticated and anon).
select app_private.alignment_restore_function_acl('public.approve_join_request(bigint)'::regprocedure);
delete from supabase_migrations.schema_migrations where version = '20261010141000';
