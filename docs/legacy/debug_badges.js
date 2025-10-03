import { supabase } from './src/supabase.js';

const debugBadges = async () => {
  console.log('🔍 Checking player_awards table...');
  
  try {
    // Check if table exists and has data
    const { data, error } = await supabase
      .from('player_awards')
      .select('*')
      .limit(10);
    
    if (error) {
      console.error('❌ Error querying player_awards:', error);
      return;
    }
    
    console.log('✅ player_awards data:', data);
    console.log('📊 Total records:', data?.length || 0);
    
    if (data && data.length > 0) {
      console.log('🏆 Sample record:', data[0]);
    }
    
    // Check usuarios table structure
    const { data: usuarios, error: usuariosError } = await supabase
      .from('usuarios')
      .select('id, nombre')
      .limit(3);
      
    if (usuariosError) {
      console.error('❌ Error querying usuarios:', usuariosError);
    } else {
      console.log('👥 Sample usuarios:', usuarios);
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
};

debugBadges();