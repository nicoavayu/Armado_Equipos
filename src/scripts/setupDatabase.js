import { supabase } from '../supabase';

const setupPlayerAwardsTable = async () => {
  console.log('🚀 Setting up player_awards table...');
  
  try {
    // Create table directly with SQL
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS player_awards (
        id SERIAL PRIMARY KEY,
        jugador_id UUID NOT NULL,
        partido_id INTEGER NOT NULL,
        award_type VARCHAR(50) NOT NULL,
        otorgado_por UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      ALTER TABLE player_awards ENABLE ROW LEVEL SECURITY;
      
      DROP POLICY IF EXISTS "Anyone can view player awards" ON player_awards;
      DROP POLICY IF EXISTS "Authenticated users can insert player awards" ON player_awards;
      
      CREATE POLICY "Anyone can view player awards" ON player_awards
        FOR SELECT USING (true);
        
      CREATE POLICY "Authenticated users can insert player awards" ON player_awards
        FOR INSERT WITH CHECK (auth.role() = 'authenticated');
    `;

    // Execute the SQL
    const { error } = await supabase.rpc('exec_sql', { sql: createTableSQL });
    
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    console.log('✅ player_awards table created successfully!');
    console.log('🎉 Database setup complete. You can now use badges in your app.');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
};

// Run the setup
setupPlayerAwardsTable();