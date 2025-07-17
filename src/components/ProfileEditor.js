import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from './AuthProvider';
import { updateProfile, calculateProfileCompletion, uploadFoto, supabase } from '../supabase';
import ProfileCard from './ProfileCard';
import ModernToggle from './ModernToggle';
import './ProfileEditor.css';

export default function ProfileEditor({ isOpen, onClose }) {
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [liveProfile, setLiveProfile] = useState(profile);
  const [hasChanges, setHasChanges] = useState(false);
  const fileInputRef = useRef(null);

  const [formData, setFormData] = useState({
    numero: 10,
    nombre: '',
    email: '',
    nacionalidad: 'Argentina',
    pais_codigo: 'AR',
    rol_favorito: 'DEF',
    rango_edad: '31-45',
    social: '',
    localidad: '',
    latitud: null,
    longitud: null,
    partidos_jugados: 0,
    partidos_abandonados: 0,
    calificacion: 4.5,
    bio: '',
    acepta_invitaciones: true
  });

  useEffect(() => {
    if (profile) {
      // Asegurar que tengamos la URL del avatar desde todas las fuentes posibles
      const avatarUrl = profile.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
      
      console.log('ProfileEditor: profile loaded', {
        profile_email: profile.email,
        user_email: user?.email,
        profile_avatar_url: profile.avatar_url,
        user_metadata_avatar: user?.user_metadata?.avatar_url,
        user_metadata_picture: user?.user_metadata?.picture,
        final_avatar_url: avatarUrl
      });
      
      // Si tenemos un avatar en los metadatos pero no en el perfil, actualizar el perfil
      if (!profile.avatar_url && (user?.user_metadata?.avatar_url || user?.user_metadata?.picture)) {
        console.log('Updating profile with avatar from user metadata');
        updateProfile(user.id, { avatar_url: avatarUrl })
          .then(() => refreshProfile())
          .catch(err => console.error('Error updating profile with avatar:', err));
      }
      
      const newFormData = {
        numero: profile.numero || 10,
        nombre: profile.nombre || '',
        email: profile.email || user?.email || '',
        nacionalidad: profile.nacionalidad || 'Argentina',
        pais_codigo: profile.pais_codigo || 'AR',
        rol_favorito: profile.rol_favorito || 'DEF',
        rango_edad: profile.rango_edad || '31-45',
        social: profile.social || '',
        localidad: profile.localidad || '',
        latitud: profile.latitud || null,
        longitud: profile.longitud || null,
        partidos_jugados: profile.partidos_jugados || 0,
        calificacion: profile.calificacion || 4.5,
        bio: profile.bio || '',
        acepta_invitaciones: profile.acepta_invitaciones !== false
      };
      setFormData(newFormData);
      
      // Asegurar que el liveProfile tenga el avatar_url correcto
      setLiveProfile({ 
        ...profile, 
        ...newFormData, 
        avatar_url: avatarUrl, 
        user: user // Pasar el objeto user completo
      });
      setHasChanges(false);
    }
  }, [profile, user, refreshProfile]);

  const handleInputChange = (field, value) => {
    const newData = { ...formData, [field]: value };
    setFormData(newData);
    setHasChanges(true);
    
    // Update live profile for real-time card updates
    setLiveProfile({ ...liveProfile, ...newData });
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('La imagen debe ser menor a 5MB');
      return;
    }

    // Create a local preview immediately
    const localPreviewUrl = URL.createObjectURL(file);
    
    // Update UI immediately with local preview
    setLiveProfile(prev => ({
      ...prev,
      avatar_url: localPreviewUrl
    }));

    setLoading(true);
    try {
      // Upload to storage
      const fileExt = file.name.split('.').pop() || 'jpg';
      const fileName = `${user.id}_${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('jugadores-fotos')
        .upload(fileName, file, { upsert: true, cacheControl: '0' });
      
      if (uploadError) throw uploadError;
      
      // Get public URL
      const { data } = supabase.storage
        .from('jugadores-fotos')
        .getPublicUrl(fileName);
      
      const fotoUrl = data?.publicUrl;
      if (!fotoUrl) throw new Error('No se pudo obtener la URL pública de la foto.');
      
      // Update profile in database
      await updateProfile(user.id, { avatar_url: fotoUrl });
      
      // Update user metadata
      await supabase.auth.updateUser({
        data: { avatar_url: fotoUrl }
      });
      
      // Update local state with permanent URL
      setLiveProfile(prev => ({
        ...prev,
        avatar_url: fotoUrl
      }));
      
      setHasChanges(true);
      toast.success('Foto actualizada correctamente');
      
    } catch (error) {
      console.error('Error uploading photo:', error);
      toast.error('Error subiendo foto: ' + error.message);
      
      // Revert to previous avatar if upload fails
      setLiveProfile(prev => ({
        ...prev,
        avatar_url: profile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.nombre.trim()) {
      toast.error('El nombre es obligatorio');
      return;
    }

    setLoading(true);
    try {
      const updatedProfile = await updateProfile(user.id, formData);
      
      const completion = calculateProfileCompletion(updatedProfile);
      if (completion === 100 && (profile?.profile_completion || 0) < 100) {
        toast.success('¡Perfil completado al 100%! 🎉');
      } else {
        toast.success('Perfil guardado correctamente');
      }
      
      await refreshProfile();
      setHasChanges(false);
      onClose();
    } catch (error) {
      toast.error('Error guardando perfil: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose();
  };

  const handleGeolocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          handleInputChange('latitud', position.coords.latitude);
          handleInputChange('longitud', position.coords.longitude);
          toast.success('Ubicación obtenida');
        },
        (error) => {
          toast.error('Error obteniendo ubicación');
        }
      );
    } else {
      toast.error('Geolocalización no disponible');
    }
  };

  const positions = [
    { key: 'ARQ', label: 'ARQ' },
    { key: 'DEF', label: 'DEF' },
    { key: 'MED', label: 'MED' },
    { key: 'DEL', label: 'DEL' }
  ];

  const ageRanges = [
    { key: '0-15', label: '0-15' },
    { key: '16-30', label: '16-30' },
    { key: '31-45', label: '31-45' },
    { key: '46-60', label: '46-60' },
    { key: '+60', label: '+60' }
  ];

  const countries = [
    { key: 'AR', label: 'Argentina' },
    { key: 'BR', label: 'Brasil' },
    { key: 'UY', label: 'Uruguay' },
    { key: 'CL', label: 'Chile' },
    { key: 'CO', label: 'Colombia' },
    { key: 'PE', label: 'Perú' }
  ];

  if (!isOpen) return null;

  return (
    <div className="profile-editor-overlay">
      <div className="profile-editor-container">
        {/* Left Side - Player Card */}
        <div className="profile-card-side">
          <ProfileCard
            profile={{
              ...liveProfile,
              avatar_url: liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture
            }}
            isVisible={true}
            key={`profile-card-${Date.now()}`} // Force re-render on every render
          />
        </div>

        {/* Right Side - Edit Menu */}
        <div className="profile-menu-side">
          <div className="profile-menu-header">
            <h2>Editar Perfil</h2>
            <button className="close-editor-btn" onClick={onClose}>×</button>
          </div>

          <div className="profile-menu-content">
            {/* Photo Section */}
            <div className="form-group">
              <label>Foto de Perfil</label>
              <div className="photo-upload-section">
                <div 
                  className="current-photo" 
                  onClick={(e) => {
                    e.preventDefault();
                    if (fileInputRef.current) {
                      fileInputRef.current.click();
                    }
                  }}
                >
                  {liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture ? (
                    <img 
                      src={liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture} 
                      alt="Perfil" 
                      key={`profile-photo-${Date.now()}`} // Force re-render
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="photo-placeholder">👤</div>
                  )}
                </div>
                <button 
                  className="change-photo-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (fileInputRef.current) {
                      fileInputRef.current.click();
                    }
                  }}
                  disabled={loading}
                  type="button"
                >
                  {loading ? 'Subiendo...' : 'Cambiar Foto'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg, image/png, image/gif, image/webp"
                  style={{ display: 'none' }}
                  onChange={handlePhotoChange}
                  onClick={(e) => e.stopPropagation()}
                  capture="environment"
                />
              </div>
            </div>

            {/* Name and Number (FIFA style - on same line) */}
            <div className="name-number-row">
              <div className="form-group">
                <label>Nombre *</label>
                <input
                  className="input-modern-small"
                  type="text"
                  value={formData.nombre}
                  onChange={(e) => handleInputChange('nombre', e.target.value)}
                  placeholder="Tu nombre completo"
                />
              </div>
              
              <div className="form-group">
                <label>Número</label>
                <input
                  className="input-modern-small"
                  type="number"
                  min="1"
                  max="99"
                  value={formData.numero}
                  onChange={(e) => handleInputChange('numero', parseInt(e.target.value) || 10)}
                  placeholder="10"
                />
              </div>
            </div>

            {/* Email */}
            <div className="form-group">
              <label>Email</label>
              <input
                className="input-modern-small"
                type="email"
                value={user?.email || formData.email || ''}
                readOnly
                style={{ opacity: 0.8, cursor: 'not-allowed' }}
              />
            </div>

            {/* Nationality (with real-time flag update) */}
            <div className="form-group">
              <label>Nacionalidad</label>
              <select
                className="input-modern-small"
                value={formData.pais_codigo}
                onChange={(e) => {
                  const country = countries.find(c => c.key === e.target.value);
                  handleInputChange('pais_codigo', e.target.value);
                  handleInputChange('nacionalidad', country?.label || 'Argentina');
                  
                  // Ensure immediate update of the profile card
                  setLiveProfile(prev => ({
                    ...prev,
                    pais_codigo: e.target.value,
                    nacionalidad: country?.label || 'Argentina'
                  }));
                }}
              >
                {countries.map(country => (
                  <option key={country.key} value={country.key}>
                    {country.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Position */}
            <div className="form-group">
              <label>Posición</label>
              <div className="position-buttons">
                {positions.map(pos => (
                  <button
                    key={pos.key}
                    type="button"
                    className={`position-btn ${formData.rol_favorito === pos.key ? 'selected' : ''}`}
                    onClick={() => handleInputChange('rol_favorito', pos.key)}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Age Range */}
            <div className="form-group">
              <label>Rango de Edad</label>
              <select
                className="input-modern-small"
                value={formData.rango_edad}
                onChange={(e) => handleInputChange('rango_edad', e.target.value)}
              >
                {ageRanges.map(range => (
                  <option key={range.key} value={range.key}>
                    {range.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Social Handle */}
            <div className="form-group">
              <label>Social Handle</label>
              <input
                className="input-modern-small"
                type="text"
                value={formData.social}
                onChange={(e) => handleInputChange('social', e.target.value)}
                placeholder="@usuario"
              />
            </div>

            {/* Location */}
            <div className="form-group">
              <label>Localidad</label>
              <div className="location-input">
                <input
                  className="input-modern-small"
                  type="text"
                  value={formData.localidad}
                  onChange={(e) => handleInputChange('localidad', e.target.value)}
                  placeholder="Tu ciudad"
                />
                <button 
                  className="geo-btn"
                  onClick={handleGeolocation}
                  type="button"
                >
                  📍
                </button>
              </div>
            </div>

            {/* Accept Invitations */}
            <div className="form-group">
              <label>Acepta Invitaciones</label>
              <ModernToggle
                checked={formData.acepta_invitaciones}
                onChange={(value) => handleInputChange('acepta_invitaciones', value)}
                label="Recibir invitaciones a partidos"
              />
            </div>

            {/* Bio */}
            <div className="form-group">
              <label>Bio</label>
              <textarea
                className="input-modern-small"
                value={formData.bio}
                onChange={(e) => handleInputChange('bio', e.target.value)}
                placeholder="Contanos algo sobre vos..."
                rows={3}
              />
            </div>
          </div>

          {/* Footer Buttons */}
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
      </div>
    </div>
  );
}