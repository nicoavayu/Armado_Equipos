import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from './AuthProvider';
import { updateProfile, calculateProfileCompletion, uploadFoto, supabase } from '../supabase';
import ProfileCard from './ProfileCard';
import ModernToggle from './ModernToggle';
import { useTutorial } from '../context/TutorialContext';
import './ProfileEditor.css';

export default function ProfileEditor({ isOpen, onClose }) {
  const { user, profile, refreshProfile } = useAuth();
  const { replayTutorial } = useTutorial();
  const [loading, setLoading] = useState(false);
  const [liveProfile, setLiveProfile] = useState(profile);
  const [hasChanges, setHasChanges] = useState(false);
  const fileInputRef = useRef(null);

  const cleanDate = (dateString) => dateString ? dateString.split('T')[0] : null;

  const [formData, setFormData] = useState({
    nombre: '',
    email: '',
    telefono: '',
    nacionalidad: 'Argentina',
    pais_codigo: 'AR',
    posicion: 'DEF',
    fecha_nacimiento: null,
    social: '',
    localidad: '',
    latitud: null,
    longitud: null,
    partidos_jugados: 0,
    partidos_abandonados: 0,
    ranking: 4.5,
    bio: '',
    acepta_invitaciones: true,
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
        final_avatar_url: avatarUrl,
      });

      // Si tenemos un avatar en los metadatos pero no en el perfil, actualizar el perfil
      if (!profile.avatar_url && (user?.user_metadata?.avatar_url || user?.user_metadata?.picture)) {
        console.log('Updating profile with avatar from user metadata');
        updateProfile(user.id, { avatar_url: avatarUrl })
          .then(() => refreshProfile())
          .catch((err) => console.error('Error updating profile with avatar:', err));
      }

      const newFormData = {
        nombre: profile.nombre || '',
        email: profile.email || user?.email || '',
        telefono: profile.telefono || '',
        nacionalidad: profile.nacionalidad || 'Argentina',
        pais_codigo: profile.pais_codigo || 'AR',
        posicion: profile.posicion || profile.rol_favorito || 'DEF', // Fallback to rol_favorito for backward compatibility
        fecha_nacimiento: cleanDate(profile.fecha_nacimiento),
        social: profile.red_social || '',
        localidad: profile.localidad || '',
        latitud: profile.latitud || null,
        longitud: profile.longitud || null,
        partidos_jugados: profile.partidos_jugados || 0,
        ranking: profile.ranking || profile.calificacion || 4.5, // Support both ranking and calificacion for backward compatibility
        bio: profile.bio || '',
        acepta_invitaciones: profile.acepta_invitaciones !== false,
      };
      setFormData(newFormData);

      // Asegurar que el liveProfile tenga el avatar_url correcto
      setLiveProfile({
        ...profile,
        ...newFormData,
        avatar_url: avatarUrl,
        user: user, // Pasar el objeto user completo
      });
      setHasChanges(false);
    }
  }, [profile, user, refreshProfile]);

  const handleInputChange = (field, value) => {
    // Add debug log for position and ranking fields
    if (field === 'posicion') {
      console.log('[AMIGOS] Updating position field in ProfileEditor:', { oldValue: formData.posicion, newValue: value });
    }
    if (field === 'ranking') {
      console.log('[AMIGOS] Updating ranking field in ProfileEditor:', { oldValue: formData.ranking, newValue: value });
    }

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
    setLiveProfile((prev) => ({
      ...prev,
      avatar_url: localPreviewUrl,
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
        data: { avatar_url: fotoUrl },
      });

      // Update local state with permanent URL
      setLiveProfile((prev) => ({
        ...prev,
        avatar_url: fotoUrl,
      }));

      setHasChanges(true);
      toast.success('Foto actualizada correctamente');

    } catch (error) {
      console.error('Error uploading photo:', error);
      toast.error('Error subiendo foto: ' + error.message);

      // Revert to previous avatar if upload fails
      setLiveProfile((prev) => ({
        ...prev,
        avatar_url: profile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture,
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
    if (!formData.email.trim()) {
      toast.error('El email es obligatorio');
      return;
    }

    setLoading(true);
    try {
      const profileDataToSave = {
        ...formData,
        fecha_nacimiento: cleanDate(formData.fecha_nacimiento),
      };

      console.log('[DEBUG] Enviando a updateProfile:', profileDataToSave);
      const updatedProfile = await updateProfile(user.id, profileDataToSave);
      console.log('[DEBUG] Resultado de updateProfile:', updatedProfile);

      // Check if updateProfile returned an error
      if (updatedProfile?.error) {
        toast.error('Error guardando perfil: ' + updatedProfile.error.message);
        return;
      }

      const completion = calculateProfileCompletion(updatedProfile);
      if (completion === 100 && (profile?.profile_completion || 0) < 100) {
        toast.success('¡Perfil completado al 100%! 🎉');
      } else {
        toast.success('Perfil guardado correctamente');
      }

      await refreshProfile();
      setHasChanges(false);
      onClose(); // Only close if successful
    } catch (error) {
      console.error('[DEBUG] Error en handleSave:', error);
      toast.error('Error guardando perfil: ' + error.message);
      // Don't close modal on error
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose();
  };

  const handleGeolocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalización no disponible en este dispositivo');
      return;
    }

    toast.info('Obteniendo ubicación...');
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        handleInputChange('latitud', position.coords.latitude);
        handleInputChange('longitud', position.coords.longitude);
        toast.success('Ubicación obtenida correctamente');
      },
      (error) => {
        let errorMessage = 'Error obteniendo ubicación';
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Permiso de ubicación denegado. Ve a Configuración > Privacidad > Ubicación para habilitarlo.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'No se puede determinar la ubicación. Intenta moverte a un área con mejor señal GPS o conexión a internet.';
            break;
          case error.TIMEOUT:
            errorMessage = 'Tiempo agotado. La ubicación está tardando mucho en obtenerse, intenta nuevamente.';
            break;
          default:
            errorMessage = `Error de ubicación (código ${error.code}). Verifica que los servicios de ubicación estén habilitados.`;
            break;
        }
        
        console.error('Geolocation error:', error);
        toast.error(errorMessage);
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 600000
      }
    );
  };

  const positions = [
    { key: 'ARQ', label: 'ARQ' },
    { key: 'DEF', label: 'DEF' },
    { key: 'MED', label: 'MED' },
    { key: 'DEL', label: 'DEL' },
  ];

  const countries = [
    { key: 'AF', label: 'Afganistán' },
    { key: 'AL', label: 'Albania' },
    { key: 'DE', label: 'Alemania' },
    { key: 'AD', label: 'Andorra' },
    { key: 'AO', label: 'Angola' },


    { key: 'AR', label: 'Argentina' },
    { key: 'AM', label: 'Armenia' },
    { key: 'AW', label: 'Aruba' },
    { key: 'AU', label: 'Australia' },
    { key: 'AT', label: 'Austria' },

    { key: 'BS', label: 'Bahamas' },



    { key: 'BE', label: 'Bélgica' },
    { key: 'BZ', label: 'Belice' },
    { key: 'BJ', label: 'Benín' },

    { key: 'BY', label: 'Bielorrusia' },
    { key: 'BO', label: 'Bolivia' },
    { key: 'BA', label: 'Bosnia y Herzegovina' },

    { key: 'BR', label: 'Brasil' },

    { key: 'BG', label: 'Bulgaria' },



    { key: 'CM', label: 'Camerún' },
    { key: 'CA', label: 'Canadá' },

    { key: 'CL', label: 'Chile' },
    { key: 'CN', label: 'China' },
    { key: 'CO', label: 'Colombia' },
    { key: 'KM', label: 'Comoras' },
    { key: 'KR', label: 'Corea del Sur' },
    { key: 'CR', label: 'Costa Rica' },
    { key: 'CI', label: 'Costa de Marfil' },
    { key: 'HR', label: 'Croacia' },
    { key: 'CU', label: 'Cuba' },
    { key: 'DK', label: 'Dinamarca' },
    { key: 'DM', label: 'Dominica' },
    { key: 'EC', label: 'Ecuador' },
    { key: 'EG', label: 'Egipto' },
    { key: 'SV', label: 'El Salvador' },
    { key: 'SK', label: 'Eslovaquia' },
    { key: 'SI', label: 'Eslovenia' },
    { key: 'ES', label: 'España' },
    { key: 'US', label: 'Estados Unidos' },
    { key: 'EE', label: 'Estonia' },
    { key: 'FI', label: 'Finlandia' },
    { key: 'FJ', label: 'Fiyi' },
    { key: 'FR', label: 'Francia' },
    { key: 'GH', label: 'Ghana' },
    { key: 'GI', label: 'Gibraltar' },
    { key: 'GR', label: 'Grecia' },
    { key: 'GL', label: 'Groenlandia' },
    { key: 'GT', label: 'Guatemala' },
    { key: 'GF', label: 'Guayana Francesa' },
    { key: 'GY', label: 'Guyana' },
    { key: 'HT', label: 'Haití' },
    { key: 'HN', label: 'Honduras' },
    { key: 'HK', label: 'Hong Kong' },
    { key: 'HU', label: 'Hungría' },
    { key: 'IN', label: 'India' },
    { key: 'ID', label: 'Indonesia' },
    { key: 'IE', label: 'Irlanda' },
    { key: 'IS', label: 'Islandia' },
    { key: 'IL', label: 'Israel' },
    { key: 'IT', label: 'Italia' },
    { key: 'JM', label: 'Jamaica' },
    { key: 'JP', label: 'Japón' },
    { key: 'LV', label: 'Letonia' },

    { key: 'LT', label: 'Lituania' },
    { key: 'LU', label: 'Luxemburgo' },

    { key: 'MA', label: 'Marruecos' },

    { key: 'MX', label: 'México' },

    { key: 'MC', label: 'Mónaco' },

    { key: 'NI', label: 'Nicaragua' },

    { key: 'NO', label: 'Noruega' },

    { key: 'NZ', label: 'Nueva Zelanda' },

    { key: 'NL', label: 'Países Bajos' },

    { key: 'PA', label: 'Panamá' },

    { key: 'PY', label: 'Paraguay' },
    { key: 'PE', label: 'Perú' },

    { key: 'PL', label: 'Polonia' },
    { key: 'PT', label: 'Portugal' },
    { key: 'PR', label: 'Puerto Rico' },

    { key: 'GB', label: 'Reino Unido' },

    { key: 'CZ', label: 'República Checa' },

    { key: 'DO', label: 'República Dominicana' },

    { key: 'RO', label: 'Rumania' },
    { key: 'RU', label: 'Rusia' },

    { key: 'SN', label: 'Senegal' },
    { key: 'RS', label: 'Serbia' },

    { key: 'ZA', label: 'Sudáfrica' },
    { key: 'SE', label: 'Suecia' },
    { key: 'CH', label: 'Suiza' },
    { key: 'SR', label: 'Surinam' },

    { key: 'TT', label: 'Trinidad y Tobago' },
    { key: 'TN', label: 'Túnez' },

    { key: 'TR', label: 'Turquía' },

    { key: 'UA', label: 'Ucrania' },

    { key: 'UY', label: 'Uruguay' },
    { key: 'VE', label: 'Venezuela' },
    { key: 'VN', label: 'Vietnam' },

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
              avatar_url: liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture,
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
            {/* Avatar and Name in one row */}
            <div className="avatar-name-section">
              <div className="avatar-container">
                <div
                  className="profile-avatar"
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
                    />
                  ) : (
                    <div className="photo-placeholder">👤</div>
                  )}
                  <div className="avatar-overlay">
                    <span className="avatar-edit-icon">📷</span>
                  </div>
                </div>
                <button 
                  className="change-photo-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    if (fileInputRef.current) {
                      fileInputRef.current.click();
                    }
                  }}
                  type="button"
                >
                  Cambiar Foto
                </button>
              </div>

              <div className="form-group" style={{ flex: 1, marginLeft: '12px' }}>
                <label>Nombre *</label>
                <input
                  className="input-modern-small"
                  type="text"
                  value={formData.nombre}
                  onChange={(e) => handleInputChange('nombre', e.target.value)}
                  placeholder="Tu nombre completo"
                />
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handlePhotoChange}
                onClick={(e) => e.stopPropagation()}
              />
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

            {/* Teléfono */}
            <div className="form-group">
              <label>Teléfono <span style={{ fontSize: '12px', opacity: 0.7 }}>(solo visible para admins)</span></label>
              <input
                className="input-modern-small"
                type="tel"
                value={formData.telefono}
                onChange={(e) => handleInputChange('telefono', e.target.value)}
                placeholder="+54 9 11 1234-5678"
              />
            </div>

            {/* Nationality (with real-time flag update) */}
            <div className="form-group">
              <label>Nacionalidad</label>
              <select
                className="input-modern-small"
                value={formData.pais_codigo}
                onChange={(e) => {
                  const country = countries.find((c) => c.key === e.target.value);
                  handleInputChange('pais_codigo', e.target.value);
                  handleInputChange('nacionalidad', country?.label || 'Argentina');

                  // Ensure immediate update of the profile card
                  setLiveProfile((prev) => ({
                    ...prev,
                    pais_codigo: e.target.value,
                    nacionalidad: country?.label || 'Argentina',
                  }));
                }}
              >
                {countries.map((country) => (
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
                {positions.map((pos) => (
                  <button
                    key={pos.key}
                    type="button"
                    className={`position-btn ${formData.posicion === pos.key ? 'selected' : ''}`}
                    onClick={() => handleInputChange('posicion', pos.key)}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Fecha de Nacimiento */}
            <div className="form-group">
              <label>Fecha de Nacimiento</label>
              <input
                className="input-modern-small"
                type="date"
                value={formData.fecha_nacimiento}
                onChange={(e) => handleInputChange('fecha_nacimiento', e.target.value)}
                max={new Date().toISOString().split('T')[0]}
              />
            </div>

            {/* Social Handle */}
            <div className="form-group">
              <label>Instagram</label>
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
                  title="Obtener ubicación actual - Asegúrate de tener los servicios de ubicación habilitados"
                >
                  📍
                </button>
              </div>
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



            {/* Availability toggle removed - now in HomeHeader */}

            {/* Footer Buttons - Ahora dentro del contenido scrolleable */}
            <div className="profile-menu-footer">
              <button
                className={`save-profile-btn ${hasChanges ? 'has-changes' : ''}`}
                onClick={handleSave}
                disabled={loading || !hasChanges}
              >
                {loading ? 'Guardando...' : 'Guardar Perfil'}
              </button>

              <div className="profile-menu-actions">
                <button
                  className="tutorial-btn"
                  onClick={() => {
                    onClose();
                    replayTutorial();
                  }}
                  disabled={loading}
                >
                  Ver Tutorial
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
      </div>
    </div>
  );
}