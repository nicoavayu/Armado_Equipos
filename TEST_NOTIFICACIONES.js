// SCRIPT DE TESTING PARA NOTIFICACIONES EN TIEMPO REAL
// Copia este código en la consola del navegador para probar

// TEST 1: Verificar que la notificación se insertó en la base de datos
const testNotificationInsert = async (userId) => {
  console.log('=== TEST 1: VERIFICAR INSERCIÓN EN BASE DE DATOS ===');
  
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.error('❌ Error fetching notifications:', { message: encodeURIComponent(error?.message || '') });
      return;
    }
    
    console.log('✅ Últimas 5 notificaciones para user:', encodeURIComponent(userId || ''));
    console.table(data.map((n) => ({
      id: n.id.substring(0, 8),
      type: n.type,
      title: n.title,
      read: n.read,
      created_at: new Date(n.created_at).toLocaleString(),
    })));
    
    const matchInvites = data.filter((n) => n.type === 'match_invite');
    console.log(`📊 Match invites encontradas: ${matchInvites.length}`);
    
    return data;
  } catch (error) {
    console.error('❌ Test failed:', { message: encodeURIComponent(error?.message || '') });
  }
};

// TEST 2: Verificar suscripción realtime
const testRealtimeSubscription = (userId) => {
  console.log('=== TEST 2: VERIFICAR SUSCRIPCIÓN REALTIME ===');
  console.log('👂 Escuchando notificaciones para user:', encodeURIComponent(userId || ''));
  
  const subscription = supabase
    .channel(`test-notifications-${userId}`)
    .on('postgres_changes', 
      { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, 
      (payload) => {
        console.log('🔔 === NOTIFICACIÓN RECIBIDA EN TIEMPO REAL ===');
        console.log('📅 Timestamp:', new Date().toLocaleTimeString());
        console.log('👤 Para usuario:', encodeURIComponent(payload.new.user_id || ''));
        console.log('📝 Tipo:', encodeURIComponent(payload.new.type || ''));
        console.log('💬 Mensaje:', encodeURIComponent(payload.new.message || ''));
        console.log('🆔 ID:', encodeURIComponent(payload.new.id || ''));
        console.log('✅ REALTIME FUNCIONANDO CORRECTAMENTE');
      },
    )
    .subscribe((status) => {
      console.log('📡 Subscription status:', status);
      if (status === 'SUBSCRIBED') {
        console.log('✅ Suscripción activa - esperando notificaciones...');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Error en el canal - realtime NO funciona');
      }
    });
  
  // Limpiar después de 30 segundos
  setTimeout(() => {
    supabase.removeChannel(subscription);
    console.log('🛑 Test de realtime terminado');
  }, 30000);
  
  return subscription;
};

// TEST 3: Insertar notificación de prueba
const testInsertNotification = async (recipientUserId, senderName = 'Test User') => {
  console.log('=== TEST 3: INSERTAR NOTIFICACIÓN DE PRUEBA ===');
  
  const testNotification = {
    user_id: recipientUserId,
    type: 'match_invite',
    title: 'Test - Invitación a partido',
    message: `${senderName} te invitó a un partido de prueba`,
    data: {
      matchId: 999,
      matchName: 'Partido de Prueba',
      inviterId: 'test-sender-id',
      inviterName: senderName,
    },
    read: false,
  };
  
  console.log('📤 Insertando notificación de prueba para:', encodeURIComponent(recipientUserId || ''));
  
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert([testNotification])
      .select()
      .single();
    
    if (error) {
      console.error('❌ Error insertando notificación:', { message: encodeURIComponent(error?.message || '') });
      return;
    }
    
    console.log('✅ Notificación insertada exitosamente:');
    console.log('🆔 ID:', encodeURIComponent(data.id || ''));
    console.log('👤 Para usuario:', encodeURIComponent(data.user_id || ''));
    console.log('📝 Tipo:', encodeURIComponent(data.type || ''));
    console.log('⏰ Creada:', new Date(data.created_at).toLocaleString());
    console.log('🔔 El usuario debería recibir esta notificación en tiempo real');
    
    return data;
  } catch (error) {
    console.error('❌ Test failed:', { message: encodeURIComponent(error?.message || '') });
  }
};

// FUNCIÓN COMPLETA DE TESTING
const runFullNotificationTest = async (recipientUserId, senderName = 'Test User') => {
  console.log('🚀 === INICIANDO TEST COMPLETO DE NOTIFICACIONES ===');
  console.log('👤 Usuario receptor:', encodeURIComponent(recipientUserId || ''));
  console.log('👤 Usuario emisor:', encodeURIComponent(senderName || ''));
  
  // 1. Verificar notificaciones existentes
  await testNotificationInsert(recipientUserId);
  
  // 2. Configurar listener de realtime
  const subscription = testRealtimeSubscription(recipientUserId);
  
  // 3. Esperar 2 segundos y luego insertar notificación de prueba
  setTimeout(async () => {
    await testInsertNotification(recipientUserId, senderName);
  }, 2000);
  
  console.log('⏳ Test en progreso... Revisa los logs en los próximos 30 segundos');
  
  return subscription;
};

// INSTRUCCIONES DE USO:
console.log(`
🔧 === INSTRUCCIONES PARA TESTING ===

1. Para verificar notificaciones existentes:
   testNotificationInsert('user-uuid-aqui')

2. Para escuchar notificaciones en tiempo real:
   testRealtimeSubscription('user-uuid-aqui')

3. Para insertar una notificación de prueba:
   testInsertNotification('recipient-user-uuid', 'Nombre del Emisor')

4. Para ejecutar test completo:
   runFullNotificationTest('recipient-user-uuid', 'Nombre del Emisor')

📝 PASOS PARA PROBAR CON DOS USUARIOS:

1. Usuario A (emisor): Abre la app y obtén su user ID
2. Usuario B (receptor): Abre la app en otra pestaña/navegador
3. En la consola del Usuario B, ejecuta:
   testRealtimeSubscription('user-id-del-usuario-b')
4. Usuario A invita al Usuario B a un partido
5. Usuario B debería ver la notificación en tiempo real en la consola
6. Verificar que aparece en el panel de notificaciones del Usuario B

🐛 SI NO FUNCIONA, REVISAR:
- ✅ RLS policies permiten INSERT y SELECT
- ✅ Tabla notifications está en supabase_realtime publication
- ✅ user_id en la notificación es el UUID correcto del destinatario
- ✅ Suscripción realtime está activa (status: SUBSCRIBED)
`);

// Exportar funciones para uso global
window.testNotificationInsert = testNotificationInsert;
window.testRealtimeSubscription = testRealtimeSubscription;
window.testInsertNotification = testInsertNotification;
window.runFullNotificationTest = runFullNotificationTest;