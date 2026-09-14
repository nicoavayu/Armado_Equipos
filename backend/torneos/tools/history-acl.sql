-- Mirror certified executable ACL hook for new public functions (steps 12–48).
-- No operator SQL, migration ledger, production connection or runtime is used.
CREATE SCHEMA lab_reference;
CREATE TABLE lab_reference.seen_functions AS SELECT oid FROM pg_proc;
CREATE FUNCTION lab_reference.revoke_new_function_defaults() RETURNS event_trigger
LANGUAGE plpgsql AS $$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid,p.oid::regprocedure AS identity FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND NOT EXISTS(SELECT 1 FROM lab_reference.seen_functions e WHERE e.oid=p.oid)
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.identity);
 INSERT INTO lab_reference.seen_functions VALUES(r.oid); END LOOP;
END $$;
CREATE EVENT TRIGGER lab_new_function_acl ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION') EXECUTE FUNCTION lab_reference.revoke_new_function_defaults();
