import { supabase } from '../supabase';

export const createPlayerAwardsTable = async () => {
  try {
    // Create the table
    const { error: tableError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS player_awards (
          id SERIAL PRIMARY KEY,
          jugador_id UUID NOT NULL,
          partido_id INTEGER NOT NULL,
          award_type VARCHAR(50) NOT NULL,
          otorgado_por UUID,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `,
    });

    if (tableError) throw tableError;

    // Enable RLS
    const { error: rlsError } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE player_awards ENABLE ROW LEVEL SECURITY;
      `,
    });

    if (rlsError) throw rlsError;

    // Create policies
    const { error: policyError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE POLICY IF NOT EXISTS "Anyone can view player awards" ON player_awards
          FOR SELECT USING (true);

        CREATE POLICY IF NOT EXISTS "Authenticated users can insert player awards" ON player_awards
          FOR INSERT WITH CHECK (auth.role() = 'authenticated');
      `,
    });

    if (policyError) throw policyError;

    console.log('✅ player_awards table created successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Error creating player_awards table:', error);
    return { success: false, error };
  }
};