import { useEffect } from 'react';
import { supabase } from '../supabase';

// Este componente es una solución temporal para forzar la actualización del avatar
// Se debe importar en App.js y usar una vez para corregir el problema

const DirectFix = () => {
  useEffect(() => {
    const fixAvatarUrls = async () => {
      try {
        // 1. Obtener el usuario actual
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        // 2. Obtener el perfil del usuario
        const { data: profile } = await supabase.from('usuarios')
          .select('*')
          .eq('id', user.id)
          .single();
          
        if (!profile) return;
        
        // 3. Obtener la URL del avatar desde los metadatos del usuario
        const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
        
        if (avatarUrl) {
          console.log('Fixing avatar URL:', { 
            current: profile.avatar_url,
            new: avatarUrl,
          });
          
          // 4. Actualizar el perfil con la URL del avatar
          await supabase.from('usuarios')
            .update({ avatar_url: avatarUrl })
            .eq('id', user.id);
            
          console.log('Avatar URL fixed successfully');
        }
      } catch (error) {
        console.error('Error fixing avatar URL:', error);
      }
    };
    
    fixAvatarUrls();
  }, []);
  
  return null; // Este componente no renderiza nada
};

export default DirectFix;