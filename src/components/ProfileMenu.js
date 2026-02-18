import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { updateProfile, calculateProfileCompletion, uploadFoto, supabase } from '../supabase';
import AvatarWithProgress from './AvatarWithProgress';
import ModernToggle from './ModernToggle';
import PartidosPendientesNotification from './PartidosPendientesNotification';
import { addFreePlayer, removeFreePlayer } from '../services';
import InlineNotice from './ui/InlineNotice';
import useInlineNotice from '../hooks/useInlineNotice';
import { notifyBlockingError } from 'utils/notifyBlockingError';

export default function ProfileMenu({ isOpen, onClose, onProfileChange }) {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    nombre: '',
    email: '',
    telefono: '',
    localidad: '',
    fecha_nacimiento: '',
    posicion_favorita: '',
    acepta_invitaciones: true,
    bio: '',
  });
  const [hasChanges, setHasChanges] = useState(false);
  const { notice, showInlineNotice, clearInlineNotice } = useInlineNotice();
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (profile) {
      const newFormData = {
        nombre: profile.nombre || '',
        email: profile.email || '',
        telefono: profile.telefono || '',
        localidad: profile.localidad || '',
        fecha_nacimiento: profile.fecha_nacimiento || '',
        posicion_favorita: profile.posicion_favorita || '',
        acepta_invitaciones: profile.acepta_invitaciones !== false,
        bio: profile.bio || '',
      };
      setFormData(newFormData);
      setHasChanges(false);

      // Initialize live profile
      if (onProfileChange) {
        onProfileChange(profile);
      }
    }
  }, [profile, onProfileChange]);

  const handleInputChange = (field, value) => {
    const newData = { ...formData, [field]: value };
    setFormData(newData);
    setHasChanges(true);

    // Update card in real-time
    if (onProfileChange) {
      onProfileChange({ ...profile, ...newData });
    }
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showInlineNotice({
        key: 'profile_menu_image_too_large',
        type: 'warning',
        message: 'La imagen debe ser menor a 5MB.',
      });
      return;
    }

    setLoading(true);
    try {
      const fotoUrl = await uploadFoto(file, { uuid: user.id });
      // Add a cache buster parameter so clients reload the new image immediately
      const cacheBusted = fotoUrl ? `${fotoUrl}${fotoUrl.includes('?') ? '&' : '?'}cb=${Date.now()}` : fotoUrl;

      // Update profile in database with cache-busted url
      await updateProfile(user.id, { avatar_url: cacheBusted });

      // Update user metadata
      await supabase.auth.updateUser({
        data: { avatar_url: cacheBusted },
      });

      // Inform parent/component about profile change if callback provided
      if (onProfileChange) onProfileChange({ ...profile, avatar_url: cacheBusted });

      setHasChanges(true);
      // Refresh global profile so other components reflect the change
      await refreshProfile();
      console.info('Foto actualizada correctamente');

    } catch (error) {
      console.error('Error uploading photo:', error);
      notifyBlockingError('Error subiendo foto: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Optional: expose availability toggle through profile menu as well
  const handleSetAvailability = async (value) => {
    if (!user) return;
    try {
      await updateProfile(user.id, { acepta_invitaciones: value });
      // keep jugadores_sin_partido in sync
      if (value) {
        await addFreePlayer();
      } else {
        await removeFreePlayer();
      }
      await refreshProfile();
      console.info(value ? 'Ahora estás disponible' : 'Ahora estás no disponible');
    } catch (err) {
      console.error('Error updating availability from ProfileMenu:', err);
      notifyBlockingError('Error actualizando estado');
    }
  };

  const handleSave = async () => {
    if (!formData.nombre.trim()) {
      showInlineNotice({
        key: 'profile_menu_name_required',
        type: 'warning',
        message: 'El nombre es obligatorio.',
      });
      return;
    }

    setLoading(true);
    try {
      const updatedData = { ...formData };
      const updatedProfile = await updateProfile(user.id, updatedData);

      const completion = calculateProfileCompletion(updatedProfile);
      if (completion === 100 && (profile?.profile_completion || 0) < 100) {
        console.info('Perfil completado al 100%');
      } else {
        console.info('Perfil actualizado');
      }

      await refreshProfile();
    } catch (error) {
      notifyBlockingError('Error actualizando perfil: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const completion = profile?.profile_completion || 0;
  const isIncomplete = completion < 100;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose();
    navigate('/login', { replace: true });
  };

  const positions = [
    { key: 'arquero', label: 'ARQ' },
    { key: 'defensor', label: 'DEF' },
    { key: 'mediocampista', label: 'MED' },
    { key: 'delantero', label: 'DEL' },
  ];

  if (!isOpen) {
    console.log('ProfileMenu not open, returning null');
    return null;
  }

  console.log('ProfileMenu rendering with profile:', profile);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[999] backdrop-blur-[2px]" onClick={onClose} />

      {/* Menu */}
      <div className={`fixed top-0 right-[-400px] w-[400px] max-[600px]:w-screen max-[600px]:right-[-100vw] h-[100dvh] bg-gradient-to-br from-[#667eea] to-[#764ba2] z-[1000] flex flex-col transition-[right] duration-300 ease-in-out shadow-[-4px_0_20px_rgba(0,0,0,0.3)] ${isOpen ? '!right-0' : ''}`}>
        {/* Header with Avatar */}
        <div className="p-6 text-center relative border-b border-white/20 max-[600px]:p-5 max-[600px]:px-4">
          <div className="mb-4 flex justify-center">
            <AvatarWithProgress
              profile={profile}
              size={80}
              onClick={() => fileInputRef.current?.click()}
            />
          </div>

          <button
            className="bg-white/20 border border-white/30 text-white py-2 px-4 rounded-[20px] text-sm font-[Oswald,Arial,sans-serif] cursor-pointer transition-all duration-200 hover:not-disabled:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            {loading ? 'Subiendo...' : 'Cambiar Foto'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoChange}
          />

          <button className="absolute top-4 right-4 bg-transparent border-none text-white text-[28px] cursor-pointer w-10 h-10 flex items-center justify-center rounded-full transition-colors duration-200 hover:bg-white/20" onClick={onClose}>
            ×
          </button>
        </div>

        {/* Completion Banner */}
        {isIncomplete && (
          <div className="bg-[rgba(255,193,7,0.9)] text-[#333] py-3 px-5 flex items-center gap-3 mx-5 mt-5 rounded-lg max-[600px]:mx-4 max-[600px]:mb-4 max-[600px]:mt-4">
            <span>📋</span>
            <div>
              <div className="font-semibold text-sm font-[Oswald,Arial,sans-serif]">Completá tu perfil</div>
              <div className="text-xs opacity-80">Para la mejor experiencia ({completion}% completo)</div>
            </div>
          </div>
        )}

        {/* Notificación de partidos pendientes */}
        {user && (
          <PartidosPendientesNotification userId={user.id} />
        )}

        {/* Form Fields */}
        <div className="flex-1 overflow-y-auto px-5 py-0 flex flex-col gap-4 max-[600px]:px-4">
          <div className="min-h-[52px]">
            <InlineNotice
              type={notice?.type}
              message={notice?.message}
              autoHideMs={notice?.type === 'warning' ? null : 3000}
              onClose={clearInlineNotice}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-white text-[13px] font-medium mb-1.5 font-[Oswald,Arial,sans-serif]">Nombre *</label>
            <input
              className="bg-white/10 border border-white/30 text-white text-sm px-3 py-2.5 focus:border-white/60 focus:bg-white/15 placeholder:text-white/60 outline-none rounded"
              type="text"
              value={formData.nombre}
              onChange={(e) => handleInputChange('nombre', e.target.value)}
              placeholder="Tu nombre completo"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-white text-[13px] font-medium mb-1.5 font-[Oswald,Arial,sans-serif]">Email</label>
            <input
              className="bg-white/10 border border-white/30 text-white text-sm px-3 py-2.5 outline-none rounded opacity-70 cursor-not-allowed"
              type="email"
              value={formData.email}
              readOnly
            />
            <div className="text-xs text-white/70 mt-1">El email no se puede modificar</div>
          </div>

          <div className="flex flex-col">
            <label className="text-white text-[13px] font-medium mb-1.5 font-[Oswald,Arial,sans-serif]">Teléfono</label>
            <input
              className="bg-white/10 border border-white/30 text-white text-sm px-3 py-2.5 focus:border-white/60 focus:bg-white/15 placeholder:text-white/60 outline-none rounded"
              type="tel"
              value={formData.telefono}
              onChange={(e) => handleInputChange('telefono', e.target.value)}
              placeholder="Tu número de teléfono"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-white text-[13px] font-medium mb-1.5 font-[Oswald,Arial,sans-serif]">Ciudad/Localidad</label>
            <input
              className="bg-white/10 border border-white/30 text-white text-sm px-3 py-2.5 focus:border-white/60 focus:bg-white/15 placeholder:text-white/60 outline-none rounded"
              type="text"
              value={formData.localidad}
              onChange={(e) => handleInputChange('localidad', e.target.value)}
              placeholder="Tu ciudad o barrio"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-white text-[13px] font-medium mb-1.5 font-[Oswald,Arial,sans-serif]">Fecha de Nacimiento</label>
            <input
              className="bg-white/10 border border-white/30 text-white text-sm px-3 py-2.5 focus:border-white/60 focus:bg-white/15 placeholder:text-white/60 outline-none rounded"
              type="date"
              value={formData.fecha_nacimiento}
              onChange={(e) => handleInputChange('fecha_nacimiento', e.target.value)}
            />
          </div>

          <div className="flex flex-col">
            <label className="text-white text-[13px] font-medium mb-1.5 font-[Oswald,Arial,sans-serif]">Posición</label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {positions.map((pos) => (
                <button
                  key={pos.key}
                  type="button"
                  className={`bg-white/10 border-2 border-white/30 text-white p-3 rounded-lg text-base font-bold font-[Oswald,Arial,sans-serif] cursor-pointer transition-all duration-200 hover:bg-white/20 hover:border-white/50 ${formData.posicion_favorita === pos.key ? 'bg-[linear-gradient(45deg,#d4af37,#f4d03f)] !border-[#d4af37] text-black shadow-[0_4px_8px_rgba(212,175,55,0.3)]' : ''}`}
                  onClick={() => handleInputChange('posicion_favorita', pos.key)}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col">
            <label className="text-white text-[13px] font-medium mb-1.5 font-[Oswald,Arial,sans-serif]">Acepta Invitaciones</label>
            <ModernToggle
              checked={formData.acepta_invitaciones}
              onChange={(value) => { handleInputChange('acepta_invitaciones', value); handleSetAvailability(value); }}
              label="Recibir invitaciones a partidos"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-white text-[13px] font-medium mb-1.5 font-[Oswald,Arial,sans-serif]">Bio</label>
            <textarea
              className="bg-white/10 border border-white/30 text-white text-sm px-3 py-2.5 focus:border-white/60 focus:bg-white/15 placeholder:text-white/60 outline-none rounded resize-y"
              value={formData.bio}
              onChange={(e) => handleInputChange('bio', e.target.value)}
              placeholder="Contanos algo sobre vos..."
              rows={3}
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="p-5 border-t border-white/20 max-[600px]:p-4">
          <button
            className={`w-full bg-[linear-gradient(45deg,#0EA9C6,#25d366)] border-none text-white p-3.5 rounded-lg text-base font-semibold font-[Oswald,Arial,sans-serif] cursor-pointer transition-all duration-200 shadow-[0_4px_12px_rgba(14,169,198,0.3)] hover:not-disabled:-translate-y-0.5 hover:not-disabled:shadow-[0_6px_16px_rgba(14,169,198,0.4)] disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none ${hasChanges ? '!bg-[linear-gradient(45deg,#d4af37,#f4d03f)] !shadow-[0_4px_12px_rgba(212,175,55,0.4)]' : ''}`}
            onClick={handleSave}
            disabled={loading || !hasChanges}
          >
            {loading ? 'Guardando...' : 'Guardar Perfil'}
          </button>

          <button
            className="w-full bg-[#dc3545]/80 border border-[#dc3545] text-white p-3 rounded-lg text-sm font-semibold font-[Oswald,Arial,sans-serif] cursor-pointer transition-all duration-200 mt-2 hover:not-disabled:bg-[#dc3545]"
            onClick={handleLogout}
            disabled={loading}
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
    </>
  );
}
