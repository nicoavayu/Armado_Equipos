BEGIN;

DO $$
DECLARE
  v_ref record;
  v_constraint_name text;
BEGIN
  FOR v_ref IN
    SELECT *
    FROM (
      VALUES
        (
          'public',
          'jugadores',
          'usuario_id',
          'public',
          'usuarios',
          'id',
          'fk_usuario',
          'SET NULL'
        ),
        (
          'public',
          'survey_results',
          'user_id',
          'auth',
          'users',
          'id',
          'survey_results_user_id_fkey',
          'SET NULL'
        ),
        (
          'public',
          'survey_results',
          'usuario_id',
          'auth',
          'users',
          'id',
          'survey_results_usuario_id_fkey',
          'SET NULL'
        ),
        (
          'public',
          'jugadores_sin_partido',
          'user_id',
          'auth',
          'users',
          'id',
          'jugadores_sin_partido_user_id_fkey',
          'CASCADE'
        )
    ) AS refs(
      table_schema,
      table_name,
      column_name,
      foreign_schema,
      foreign_table,
      foreign_column,
      desired_constraint_name,
      delete_action
    )
  LOOP
    IF to_regclass(format('%I.%I', v_ref.table_schema, v_ref.table_name)) IS NULL
      OR to_regclass(format('%I.%I', v_ref.foreign_schema, v_ref.foreign_table)) IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = v_ref.table_schema
          AND table_name = v_ref.table_name
          AND column_name = v_ref.column_name
      ) THEN
      CONTINUE;
    END IF;

    FOR v_constraint_name IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN unnest(con.conkey) fk_col(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid
        AND att.attnum = fk_col.attnum
      WHERE nsp.nspname = v_ref.table_schema
        AND rel.relname = v_ref.table_name
        AND con.contype = 'f'
        AND att.attname = v_ref.column_name
    LOOP
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
        v_ref.table_schema,
        v_ref.table_name,
        v_constraint_name
      );
    END LOOP;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I(%I) ON DELETE %s',
      v_ref.table_schema,
      v_ref.table_name,
      v_ref.desired_constraint_name,
      v_ref.column_name,
      v_ref.foreign_schema,
      v_ref.foreign_table,
      v_ref.foreign_column,
      v_ref.delete_action
    );
  END LOOP;
END $$;

COMMIT;
