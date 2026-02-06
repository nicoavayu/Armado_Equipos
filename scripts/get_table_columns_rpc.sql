CREATE OR REPLACE FUNCTION get_table_columns(tbl_name text)
RETURNS TABLE (column_name text, data_type text) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY 
  SELECT c.column_name::text, c.data_type::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' 
    AND c.table_name = tbl_name;
END;
$$;
