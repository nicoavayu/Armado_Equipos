import { supabase } from '../supabase';

/**
 * Sets up the cleared_matches table in the database
 */
const setupClearedMatchesTable = async () => {
  try {
    console.log('Setting up cleared_matches table...');
    
    // Read the SQL file content
    const sqlContent = `
      -- Create cleared_matches table to track users who cleared matches from their list
      CREATE TABLE IF NOT EXISTS public.cleared_matches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        partido_id INTEGER NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        UNIQUE(user_id, partido_id)
      );

      -- Add indexes for better performance
      CREATE INDEX IF NOT EXISTS cleared_matches_user_id_idx ON public.cleared_matches(user_id);
      CREATE INDEX IF NOT EXISTS cleared_matches_partido_id_idx ON public.cleared_matches(partido_id);

      -- Add RLS policies
      ALTER TABLE public.cleared_matches ENABLE ROW LEVEL SECURITY;

      -- Policy to allow users to view only their own cleared matches
      DROP POLICY IF EXISTS "Users can view their own cleared matches" ON public.cleared_matches;
      CREATE POLICY "Users can view their own cleared matches" 
        ON public.cleared_matches 
        FOR SELECT 
        USING (auth.uid() = user_id);

      -- Policy to allow users to insert their own cleared matches
      DROP POLICY IF EXISTS "Users can insert their own cleared matches" ON public.cleared_matches;
      CREATE POLICY "Users can insert their own cleared matches" 
        ON public.cleared_matches 
        FOR INSERT 
        WITH CHECK (auth.uid() = user_id);

      -- Policy to allow users to delete their own cleared matches
      DROP POLICY IF EXISTS "Users can delete their own cleared matches" ON public.cleared_matches;
      CREATE POLICY "Users can delete their own cleared matches" 
        ON public.cleared_matches 
        FOR DELETE 
        USING (auth.uid() = user_id);
    `;
    
    // Execute the SQL
    const { error } = await supabase.rpc('exec_sql', { sql: sqlContent });
    
    if (error) {
      console.error('Error setting up cleared_matches table:', error);
      return false;
    }
    
    console.log('✅ cleared_matches table setup completed successfully');
    return true;
    
  } catch (error) {
    console.error('Error in setupClearedMatchesTable:', error);
    return false;
  }
};

// Run the setup if this file is executed directly
if (typeof window === 'undefined') {
  setupClearedMatchesTable()
    .then((success) => {
      if (success) {
        console.log('Database setup completed successfully');
        process.exit(0);
      } else {
        console.error('Database setup failed');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}

export { setupClearedMatchesTable };