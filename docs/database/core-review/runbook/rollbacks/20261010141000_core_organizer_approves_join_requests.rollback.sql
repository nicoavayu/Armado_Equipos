-- Rollback of 20261010141000 (organizer approves join requests). Run as postgres, in one
-- transaction, before the rollback of 140000. Data: none. Effect: back to the canonical
-- allowlist — approve-join-request answers "forbidden" again and organizers cannot approve
-- join requests (since 140000 the normal way for an outsider to get into a match).
revoke execute on function public.approve_join_request(bigint) from authenticated;
delete from supabase_migrations.schema_migrations where version = '20261010141000';
