import logger from './logger';
import { supabase } from '../supabase';

/**
 * Debug utility to check why matches don't appear in upcoming matches
 * Run in browser console: window.debugProximosPartidos()
 */
window.debugProximosPartidos = async () => {
  logger.log('=== PROXIMOS PARTIDOS DEBUG START ===');
  
  // 1. Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) {
    logger.error('❌ Error getting user:', userError);
    return;
  }
  logger.log('✅ Current user:', user.id);
  
  // 2. Check matches where user is a player
  logger.log('\n--- Test 1: Matches as player ---');
  const { data: jugadoresData, error: jugadoresError } = await supabase
    .from('jugadores')
    .select('partido_id, nombre, usuario_id')
    .eq('usuario_id', user.id);
  
  logger.log('Jugadores data:', { count: jugadoresData?.length, data: jugadoresData, error: jugadoresError });
  
  // 3. Check matches where user is admin
  logger.log('\n--- Test 2: Matches as admin ---');
  const { data: partidosComoAdmin, error: adminError } = await supabase
    .from('partidos')
    .select('id, nombre, creado_por')
    .eq('creado_por', user.id);
    
  logger.log('Admin matches:', { count: partidosComoAdmin?.length, data: partidosComoAdmin, error: adminError });
  
  // 4. Get all match IDs
  const partidosComoJugador = jugadoresData?.map((j) => j.partido_id) || [];
  const partidosAdminIds = partidosComoAdmin?.map((p) => p.id) || [];
  const todosLosPartidosIds = [...new Set([...partidosComoJugador, ...partidosAdminIds])];
  
  logger.log('\n--- Test 3: All match IDs ---');
  logger.log('As player:', partidosComoJugador);
  logger.log('As admin:', partidosAdminIds);
  logger.log('Combined:', todosLosPartidosIds);
  
  if (todosLosPartidosIds.length === 0) {
    logger.log('❌ No matches found for user');
    return;
  }
  
  // 5. Get full match data
  logger.log('\n--- Test 4: Full match data ---');
  const { data: partidosData, error: partidosError } = await supabase
    .from('partidos')
    .select(`
      *,
      jugadores(count)
    `)
    .in('id', todosLosPartidosIds)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });
    
  logger.log('Full matches:', { count: partidosData?.length, data: partidosData, error: partidosError });
  
  // 6. Check cleared matches
  logger.log('\n--- Test 5: Cleared matches ---');
  const { data: clearedData, error: clearedError } = await supabase
    .from('cleared_matches')
    .select('partido_id')
    .eq('user_id', user.id);
    
  logger.log('Cleared matches:', { count: clearedData?.length, data: clearedData, error: clearedError });
  
  // 7. Check completed surveys
  logger.log('\n--- Test 6: Completed surveys ---');
  const { data: userJugadorIdsData, error: jugadorError } = await supabase
    .from('jugadores')
    .select('id, partido_id')
    .eq('usuario_id', user.id);
    
  if (!jugadorError && userJugadorIdsData && userJugadorIdsData.length > 0) {
    const jugadorIds = userJugadorIdsData.map((j) => j.id);
    
    const { data: surveysData, error: surveysError } = await supabase
      .from('post_match_surveys')
      .select('partido_id')
      .in('votante_id', jugadorIds);
      
    logger.log('Completed surveys:', { count: surveysData?.length, data: surveysData, error: surveysError });
  }
  
  logger.log('\n=== PROXIMOS PARTIDOS DEBUG END ===');
  logger.log('\n📋 ANALYSIS:');
  logger.log('1. If no jugadores data → User not added to any match');
  logger.log('2. If no admin matches → User not admin of any match');
  logger.log('3. If matches exist but not showing → Check date/time filters');
  logger.log('4. If cleared matches exist → They are hidden from list');
  logger.log('5. If completed surveys exist → Matches are hidden after survey');
};

logger.log('✅ ProximosPartidos debug utility loaded. Run: window.debugProximosPartidos()');