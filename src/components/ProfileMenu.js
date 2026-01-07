import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from './AuthProvider';
import { updateProfile, calculateProfileCompletion, uploadFoto, supabase } from '../supabase';
import AvatarWithProgress from './AvatarWithProgress';
import ModernToggle from './ModernToggle';
import PartidosPendientesNotification from './PartidosPendientesNotification';
import './ProfileMenu.css';
import { addFreePlayer, removeFreePlayer } from '../services';

export default function ProfileMenu({ isOpen, onClose, onProfileChange }) {
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
      toast.error('La imagen debe ser menor a 5MB');
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
      toast.success('Foto actualizada correctamente');

    } catch (error) {
      console.error('Error uploading photo:', error);
      toast.error('Error subiendo foto: ' + error.message);
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
      toast.success(value ? 'Ahora estás disponible' : 'Ahora estás no disponible');
    } catch (err) {
      console.error('Error updating availability from ProfileMenu:', err);
      toast.error('Error actualizando estado');
    }
  };

  const handleSave = async () => {
    if (!formData.nombre.trim()) {
      toast.error('El nombre es obligatorio');
      return;
    }

    setLoading(true);
    try {
      const updatedData = { ...formData };
      const updatedProfile = await updateProfile(user.id, updatedData);
      
      const completion = calculateProfileCompletion(updatedProfile);
      if (completion === 100 && (profile?.profile_completion || 0) < 100) {
        toast.success('¡Perfil completado al 100%! 🎉');
      } else {
        toast.success('Perfil actualizado');
      }
      
      await refreshProfile();
    } catch (error) {
      toast.error('Error actualizando perfil: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const completion = profile?.profile_completion || 0;
  const isIncomplete = completion < 100;
  
  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose();
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
      <div className="profile-menu-backdrop" onClick={onClose} />
      
      {/* Menu */}
      <div className={`profile-menu ${isOpen ? 'open' : ''}`}>
        {/* Header with Avatar */}
        <div className="profile-menu-header">
          <div className="profile-menu-avatar">
            <AvatarWithProgress 
              profile={profile} 
              size={80}
              onClick={() => fileInputRef.current?.click()}
            />
          </div>
          
          <button 
            className="change-photo-btn"
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
          
          <button className="close-menu-btn" onClick={onClose}>
            ×
          </button>
        </div>

        {/* Completion Banner */}
        {isIncomplete && (
          <div className="completion-banner">
            <span>📋</span>
            <div>
              <div className="banner-title">Completá tu perfil</div>
              <div className="banner-subtitle">Para la mejor experiencia ({completion}% completo)</div>
            </div>
          </div>
        )}
        
        {/* Notificación de partidos pendientes */}
        {user && (
          <PartidosPendientesNotification />
        )}

        {/* Form Fields */}
        <div className="profile-menu-content">
          <div className="form-group">
            <label>Nombre *</label>
            <input
              className="input-modern"
              type="text"
              value={formData.nombre}
              onChange={(e) => handleInputChange('nombre', e.target.value)}
              placeholder="Tu nombre completo"
            />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              className="input-modern"
              type="email"
              value={formData.email}
              readOnly
              style={{ opacity: 0.7, cursor: 'not-allowed' }}
            />
            <div className="field-note">El email no se puede modificar</div>
          </div>

          <div className="form-group">
            <label>Teléfono</label>
            <input
              className="input-modern"
              type="tel"
              value={formData.telefono}
              onChange={(e) => handleInputChange('telefono', e.target.value)}
              placeholder="Tu número de teléfono"
            />
          </div>

          <div className="form-group">
            <label>Ciudad/Localidad</label>
            <input
              className="input-modern"
              type="text"
              value={formData.localidad}
              onChange={(e) => handleInputChange('localidad', e.target.value)}
              placeholder="Tu ciudad o barrio"
            />
          </div>

          <div className="form-group">
            <label>Fecha de Nacimiento</label>
            <input
              className="input-modern"
              type="date"
              value={formData.fecha_nacimiento}
              onChange={(e) => handleInputChange('fecha_nacimiento', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Posición</label>
            <div className="position-buttons">
              {positions.map((pos) => (
                <button
                  key={pos.key}
                  type="button"
                  className={`position-btn ${formData.posicion_favorita === pos.key ? 'selected' : ''}`}
                  onClick={() => handleInputChange('posicion_favorita', pos.key)}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Acepta Invitaciones</label>
            <ModernToggle
              checked={formData.acepta_invitaciones}
              onChange={(value) => { handleInputChange('acepta_invitaciones', value); handleSetAvailability(value); }}
              label="Recibir invitaciones a partidos"
            />
          </div>

          <div className="form-group">
            <label>Bio</label>
            <textarea
              className="input-modern"
              value={formData.bio}
              onChange={(e) => handleInputChange('bio', e.target.value)}
              placeholder="Contanos algo sobre vos..."
              rows={3}
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="profile-menu-footer">
          <button
            className={`save-profile-btn ${hasChanges ? 'has-changes' : ''}`}
            onClick={handleSave}
            disabled={loading || !hasChanges}
          >
            {loading ? 'Guardando...' : 'Guardar Perfil'}
          </button>
          
          <button
            className="logout-btn"
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