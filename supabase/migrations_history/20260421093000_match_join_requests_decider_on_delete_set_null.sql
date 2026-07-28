BEGIN;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  IF to_regclass('public.match_join_requests') IS NULL
    OR to_regclass('public.usuarios') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_join_requests'
      AND column_name = 'decided_by'
  ) THEN
    FOR v_constraint_name IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN unnest(con.conkey) fk_col(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid
        AND att.attnum = fk_col.attnum
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'match_join_requests'
        AND con.contype = 'f'
        AND att.attname = 'decided_by'
    LOOP
      EXECUTE format(
        'ALTER TABLE public.match_join_requests DROP CONSTRAINT IF EXISTS %I',
        v_constraint_name
      );
    END LOOP;

    ALTER TABLE public.match_join_requests
      ADD CONSTRAINT match_join_requests_decided_by_fkey
      FOREIGN KEY (decided_by)
      REFERENCES public.usuarios(id)
      ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_join_requests'
      AND column_name = 'reconciled_decided_by'
  ) THEN
    FOR v_constraint_name IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN unnest(con.conkey) fk_col(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid
        AND att.attnum = fk_col.attnum
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'match_join_requests'
        AND con.contype = 'f'
        AND att.attname = 'reconciled_decided_by'
    LOOP
      EXECUTE format(
        'ALTER TABLE public.match_join_requests DROP CONSTRAINT IF EXISTS %I',
        v_constraint_name
      );
    END LOOP;

    ALTER TABLE public.match_join_requests
      ADD CONSTRAINT match_join_requests_reconciled_decided_by_fkey
      FOREIGN KEY (reconciled_decided_by)
      REFERENCES public.usuarios(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
