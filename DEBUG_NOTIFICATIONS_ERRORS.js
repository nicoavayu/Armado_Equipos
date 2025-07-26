// SCRIPT PARA DEBUGGEAR ERRORES DE NOTIFICACIONES
// Ejecutar en consola del navegador

// 1. VERIFICAR ESTRUCTURA DE LA TABLA NOTIFICATIONS
const checkNotificationsTable = async () => {
  console.log('🔍 === VERIFICANDO ESTRUCTURA DE TABLA NOTIFICATIONS ===');
  
  try {
    // Intentar hacer un SELECT para ver la estructura
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('❌ Error accediendo a tabla notifications:', error);
      return;
    }
    
    console.log('✅ Tabla notifications accesible');
    if (data && data.length > 0) {
      console.log('📋 Estructura de campos:', Object.keys(data[0]));
      console.log('📄 Ejemplo de registro:', data[0]);
    } else {
      console.log('📋 Tabla vacía, pero accesible');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

// 2. VERIFICAR POLÍTICAS RLS
const checkRLSPolicies = async () => {
  console.log('🔒 === VERIFICANDO POLÍTICAS RLS ===');
  
  try {
    // Intentar insertar una notificación de prueba
    const testNotification = {
      user_id: 'test-uuid-12345678-1234-1234-1234-123456789012', // UUID falso pero válido
      type: 'test',
      title: 'Test RLS',
      message: 'Testing RLS policies',
      data: {},
      read: false,
    };
    
    const { data, error } = await supabase
      .from('notifications')
      .insert([testNotification])
      .select();
    
    if (error) {
      console.error('❌ Error RLS:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      
      if (error.code === '42501') {
        console.error('🚨 PROBLEMA: Política RLS bloquea INSERT');
        console.log('💡 SOLUCIÓN: Revisar política "Service role can insert notifications"');
      }
    } else {
      console.log('✅ RLS permite INSERT');
      // Limpiar el registro de prueba
      if (data && data[0]) {
        await supabase.from('notifications').delete().eq('id', data[0].id);
      }
    }
  } catch (error) {
    console.error('❌ Error verificando RLS:', error);
  }
};

// 3. VERIFICAR USUARIO ACTUAL
const checkCurrentUser = async () => {
  console.log('👤 === VERIFICANDO USUARIO ACTUAL ===');
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error) {
      console.error('❌ Error obteniendo usuario:', error);
      return null;
    }
    
    if (!user) {
      console.error('❌ No hay usuario autenticado');
      return null;
    }
    
    console.log('✅ Usuario autenticado:', {
      id: user.id,
      email: user.email,
      role: user.role,
    });
    
    // Verificar que existe en tabla usuarios
    const { data: profile, error: profileError } = await supabase
      .from('usuarios')
      .select('id, nombre, email')
      .eq('id', user.id)
      .single();
    
    if (profileError) {
      console.error('❌ Usuario no existe en tabla usuarios:', profileError);
    } else {
      console.log('✅ Perfil encontrado:', profile);
    }
    
    return user;
  } catch (error) {
    console.error('❌ Error:', error);
    return null;
  }
};

// 4. TEST COMPLETO DE INSERT
const testNotificationInsert = async (recipientUserId) => {
  console.log('🧪 === TEST COMPLETO DE INSERT ===');
  
  const user = await checkCurrentUser();
  if (!user) return;
  
  const testData = {
    user_id: recipientUserId || user.id, // Si no se especifica, usar el mismo usuario
    type: 'test_invite',
    title: 'Test Notification',
    message: 'Esta es una notificación de prueba',
    data: {
      testField: 'test value',
      timestamp: new Date().toISOString(),
    },
    read: false,
  };
  
  console.log('📤 Intentando insertar:', testData);
  
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert([testData])
      .select()
      .single();
    
    if (error) {
      console.error('❌ === ERROR EN INSERT ===');
      console.error('Code:', error.code);
      console.error('Message:', error.message);
      console.error('Details:', error.details);
      console.error('Hint:', error.hint);
      
      // Análisis específico
      switch (error.code) {
        case '42501':
          console.error('🚨 PROBLEMA: Sin permisos para INSERT');
          console.log('💡 SOLUCIÓN: Revisar política RLS de INSERT');
          break;
        case '23502':
          console.error('🚨 PROBLEMA: Campo requerido es NULL');
          console.log('💡 SOLUCIÓN: Verificar que todos los campos requeridos estén presentes');
          break;
        case '23503':
          console.error('🚨 PROBLEMA: Foreign key violation (user_id no existe)');
          console.log('💡 SOLUCIÓN: Verificar que el user_id existe en auth.users');
          break;
        case '22P02':
          console.error('🚨 PROBLEMA: UUID inválido');
          console.log('💡 SOLUCIÓN: Verificar formato del user_id');
          break;
        default:
          console.error('🚨 PROBLEMA: Error desconocido');
      }
      
      return false;
    }
    
    console.log('✅ INSERT exitoso:', data);
    
    // Limpiar
    await supabase.from('notifications').delete().eq('id', data.id);
    console.log('🧹 Registro de prueba eliminado');
    
    return true;
  } catch (error) {
    console.error('❌ Error en test:', error);
    return false;
  }
};

// 5. DIAGNÓSTICO COMPLETO
const runFullDiagnostic = async (recipientUserId) => {
  console.log('🏥 === DIAGNÓSTICO COMPLETO DE NOTIFICACIONES ===');
  
  await checkNotificationsTable();
  await checkCurrentUser();
  await checkRLSPolicies();
  await testNotificationInsert(recipientUserId);
  
  console.log('🏁 === DIAGNÓSTICO COMPLETADO ===');
  console.log('📋 Revisa los logs anteriores para identificar problemas');
};

// INSTRUCCIONES
console.log(`
🔧 === INSTRUCCIONES DE DEBUG ===

1. Para verificar la tabla:
   checkNotificationsTable()

2. Para verificar usuario actual:
   checkCurrentUser()

3. Para verificar políticas RLS:
   checkRLSPolicies()

4. Para test de insert:
   testNotificationInsert('uuid-del-destinatario')

5. Para diagnóstico completo:
   runFullDiagnostic('uuid-del-destinatario')

🚨 ERRORES COMUNES Y SOLUCIONES:

❌ Error 42501 (RLS): 
   - Política de INSERT no permite la operación
   - Solución: Revisar "Service role can insert notifications"

❌ Error 23502 (NULL):
   - Campo requerido es null/undefined
   - Solución: Verificar que user_id, type, title, message estén presentes

❌ Error 23503 (Foreign Key):
   - user_id no existe en auth.users
   - Solución: Verificar que el UUID del destinatario sea válido

❌ Error 22P02 (Invalid UUID):
   - user_id no es un UUID válido
   - Solución: Verificar formato del UUID (36 caracteres)
`);

// Exportar funciones
window.checkNotificationsTable = checkNotificationsTable;
window.checkCurrentUser = checkCurrentUser;
window.checkRLSPolicies = checkRLSPolicies;
window.testNotificationInsert = testNotificationInsert;
window.runFullDiagnostic = runFullDiagnostic;