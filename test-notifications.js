// Test script para verificar el sistema de notificaciones de amistad
// Ejecutar en la consola del navegador

const testFriendNotifications = async () => {
  console.log('🧪 Testing Friend Notifications System...');
  
  // 1. Verificar que la tabla notifications existe
  console.log('1. Checking notifications table...');
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('❌ Notifications table error:', error);
      return;
    }
    console.log('✅ Notifications table accessible');
  } catch (err) {
    console.error('❌ Error accessing notifications table:', err);
    return;
  }
  
  // 2. Verificar que la tabla amigos existe
  console.log('2. Checking amigos table...');
  try {
    const { data, error } = await supabase
      .from('amigos')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('❌ Amigos table error:', error);
      return;
    }
    console.log('✅ Amigos table accessible');
  } catch (err) {
    console.error('❌ Error accessing amigos table:', err);
    return;
  }
  
  // 3. Verificar usuario actual
  console.log('3. Checking current user...');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    console.error('❌ No authenticated user found');
    return;
  }
  console.log('✅ Current user:', user.id);
  
  // 4. Verificar suscripción en tiempo real
  console.log('4. Testing real-time subscription...');
  const channel = supabase
    .channel('test-notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${user.id}`,
    }, (payload) => {
      console.log('🔔 Real-time notification received:', payload.new);
    })
    .subscribe();
  
  // 5. Crear notificación de prueba
  console.log('5. Creating test notification...');
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert([{
        user_id: user.id,
        type: 'friend_request',
        title: 'Test Notification',
        message: 'This is a test friend request notification',
        data: { test: true },
        read: false,
      }])
      .select()
      .single();
    
    if (error) {
      console.error('❌ Error creating test notification:', error);
    } else {
      console.log('✅ Test notification created:', data);
      
      // Limpiar notificación de prueba después de 5 segundos
      setTimeout(async () => {
        await supabase
          .from('notifications')
          .delete()
          .eq('id', data.id);
        console.log('🧹 Test notification cleaned up');
      }, 5000);
    }
  } catch (err) {
    console.error('❌ Error in test notification creation:', err);
  }
  
  // Limpiar suscripción después de 10 segundos
  setTimeout(() => {
    supabase.removeChannel(channel);
    console.log('🧹 Test subscription cleaned up');
  }, 10000);
  
  console.log('✅ Friend notifications test completed!');
  console.log('📋 Check the console for real-time notifications and toasts');
};

// Ejecutar el test
testFriendNotifications();