// Test badge insertion
const testBadgeInsert = async () => {
  console.log('🧪 Testing badge insertion...');
  
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('❌ No authenticated user');
      return;
    }
    
    console.log('👤 Current user:', user.id);
    
    // Get a partido
    const { data: partidos, error: partidoError } = await supabase
      .from('partidos')
      .select('id')
      .limit(1);
      
    if (partidoError || !partidos?.length) {
      console.error('❌ No partidos found');
      return;
    }
    
    const partidoId = partidos[0].id;
    console.log('⚽ Using partido:', partidoId);
    
    // Try to insert a test badge
    const testBadge = {
      jugador_id: user.id,
      partido_id: partidoId,
      award_type: 'mvp',
      otorgado_por: user.id,
    };
    
    console.log('📝 Inserting test badge:', testBadge);
    
    const { data, error } = await supabase
      .from('player_awards')
      .insert([testBadge])
      .select();
      
    if (error) {
      console.error('❌ Insert error:', error);
    } else {
      console.log('✅ Badge inserted successfully:', data);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
};

// Add this to browser console and run
window.testBadgeInsert = testBadgeInsert;