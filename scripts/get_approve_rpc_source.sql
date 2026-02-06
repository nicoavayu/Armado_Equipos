
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'approve_join_request';
