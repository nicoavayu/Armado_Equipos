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

  const [formData, setFormData] = useState({
    numero: 10,
    nombre: '',
    email: '',
    nacionalidad: 'Argentina',
    pais_codigo: 'AR',
    posicion: 'DEF',
    fecha_nacimiento: '',
    social: '',
    localidad: '',
    latitud: null,
    longitud: null,
    partidos_jugados: 0,
    partidos_abandonados: 0,
    ranking: 4.5,
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
        posicion: profile.posicion || profile.rol_favorito || 'DEF', // Fallback to rol_favorito for backward compatibility
        fecha_nacimiento: profile.fecha_nacimiento || '',
        social: profile.social || '',
        localidad: profile.localidad || '',
        latitud: profile.latitud || null,
        longitud: profile.longitud || null,
        partidos_jugados: profile.partidos_jugados || 0,
        ranking: profile.ranking || profile.calificacion || 4.5, // Support both ranking and calificacion for backward compatibility
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

  const countries = [
    { key: 'AF', label: 'Afganistán' },
    { key: 'AL', label: 'Albania' },
    { key: 'DE', label: 'Alemania' },
    { key: 'AD', label: 'Andorra' },
    { key: 'AO', label: 'Angola' },
    { key: 'AI', label: 'Anguila' },
    { key: 'AQ', label: 'Antártida' },
    { key: 'AG', label: 'Antigua y Barbuda' },
    { key: 'SA', label: 'Arabia Saudita' },
    { key: 'DZ', label: 'Argelia' },
    { key: 'AR', label: 'Argentina' },
    { key: 'AM', label: 'Armenia' },
    { key: 'AW', label: 'Aruba' },
    { key: 'AU', label: 'Australia' },
    { key: 'AT', label: 'Austria' },
    { key: 'AZ', label: 'Azerbaiyán' },
    { key: 'BS', label: 'Bahamas' },
    { key: 'BD', label: 'Bangladés' },
    { key: 'BB', label: 'Barbados' },
    { key: 'BH', label: 'Baréin' },
    { key: 'BE', label: 'Bélgica' },
    { key: 'BZ', label: 'Belice' },
    { key: 'BJ', label: 'Benín' },
    { key: 'BM', label: 'Bermudas' },
    { key: 'BY', label: 'Bielorrusia' },
    { key: 'BO', label: 'Bolivia' },
    { key: 'BA', label: 'Bosnia y Herzegovina' },
    { key: 'BW', label: 'Botsuana' },
    { key: 'BR', label: 'Brasil' },
    { key: 'BN', label: 'Brunéi' },
    { key: 'BG', label: 'Bulgaria' },
    { key: 'BF', label: 'Burkina Faso' },
    { key: 'BI', label: 'Burundi' },
    { key: 'BT', label: 'Bután' },
    { key: 'CV', label: 'Cabo Verde' },
    { key: 'KH', label: 'Camboya' },
    { key: 'CM', label: 'Camerún' },
    { key: 'CA', label: 'Canadá' },
    { key: 'TD', label: 'Chad' },
    { key: 'CL', label: 'Chile' },
    { key: 'CN', label: 'China' },
    { key: 'CY', label: 'Chipre' },
    { key: 'VA', label: 'Ciudad del Vaticano' },
    { key: 'CO', label: 'Colombia' },
    { key: 'KM', label: 'Comoras' },
    { key: 'CG', label: 'Congo' },
    { key: 'KP', label: 'Corea del Norte' },
    { key: 'KR', label: 'Corea del Sur' },
    { key: 'CR', label: 'Costa Rica' },
    { key: 'CI', label: 'Costa de Marfil' },
    { key: 'HR', label: 'Croacia' },
    { key: 'CU', label: 'Cuba' },
    { key: 'CW', label: 'Curazao' },
    { key: 'DK', label: 'Dinamarca' },
    { key: 'DM', label: 'Dominica' },
    { key: 'EC', label: 'Ecuador' },
    { key: 'EG', label: 'Egipto' },
    { key: 'SV', label: 'El Salvador' },
    { key: 'AE', label: 'Emiratos Árabes Unidos' },
    { key: 'ER', label: 'Eritrea' },
    { key: 'SK', label: 'Eslovaquia' },
    { key: 'SI', label: 'Eslovenia' },
    { key: 'ES', label: 'España' },
    { key: 'US', label: 'Estados Unidos' },
    { key: 'EE', label: 'Estonia' },
    { key: 'ET', label: 'Etiopía' },
    { key: 'PH', label: 'Filipinas' },
    { key: 'FI', label: 'Finlandia' },
    { key: 'FJ', label: 'Fiyi' },
    { key: 'FR', label: 'Francia' },
    { key: 'GA', label: 'Gabón' },
    { key: 'GM', label: 'Gambia' },
    { key: 'GE', label: 'Georgia' },
    { key: 'GH', label: 'Ghana' },
    { key: 'GI', label: 'Gibraltar' },
    { key: 'GD', label: 'Granada' },
    { key: 'GR', label: 'Grecia' },
    { key: 'GL', label: 'Groenlandia' },
    { key: 'GP', label: 'Guadalupe' },
    { key: 'GU', label: 'Guam' },
    { key: 'GT', label: 'Guatemala' },
    { key: 'GF', label: 'Guayana Francesa' },
    { key: 'GG', label: 'Guernsey' },
    { key: 'GN', label: 'Guinea' },
    { key: 'GQ', label: 'Guinea Ecuatorial' },
    { key: 'GW', label: 'Guinea-Bisáu' },
    { key: 'GY', label: 'Guyana' },
    { key: 'HT', label: 'Haití' },
    { key: 'HN', label: 'Honduras' },
    { key: 'HK', label: 'Hong Kong' },
    { key: 'HU', label: 'Hungría' },
    { key: 'IN', label: 'India' },
    { key: 'ID', label: 'Indonesia' },
    { key: 'IQ', label: 'Irak' },
    { key: 'IR', label: 'Irán' },
    { key: 'IE', label: 'Irlanda' },
    { key: 'IS', label: 'Islandia' },
    { key: 'IL', label: 'Israel' },
    { key: 'IT', label: 'Italia' },
    { key: 'JM', label: 'Jamaica' },
    { key: 'JP', label: 'Japón' },
    { key: 'JE', label: 'Jersey' },
    { key: 'JO', label: 'Jordania' },
    { key: 'KZ', label: 'Kazajistán' },
    { key: 'KE', label: 'Kenia' },
    { key: 'KG', label: 'Kirguistán' },
    { key: 'KI', label: 'Kiribati' },
    { key: 'KW', label: 'Kuwait' },
    { key: 'LA', label: 'Laos' },
    { key: 'LS', label: 'Lesoto' },
    { key: 'LV', label: 'Letonia' },
    { key: 'LB', label: 'Líbano' },
    { key: 'LR', label: 'Liberia' },
    { key: 'LY', label: 'Libia' },
    { key: 'LI', label: 'Liechtenstein' },
    { key: 'LT', label: 'Lituania' },
    { key: 'LU', label: 'Luxemburgo' },
    { key: 'MO', label: 'Macao' },
    { key: 'MK', label: 'Macedonia del Norte' },
    { key: 'MG', label: 'Madagascar' },
    { key: 'MY', label: 'Malasia' },
    { key: 'MW', label: 'Malaui' },
    { key: 'MV', label: 'Maldivas' },
    { key: 'ML', label: 'Malí' },
    { key: 'MT', label: 'Malta' },
    { key: 'MA', label: 'Marruecos' },
    { key: 'MQ', label: 'Martinica' },
    { key: 'MU', label: 'Mauricio' },
    { key: 'MR', label: 'Mauritania' },
    { key: 'YT', label: 'Mayotte' },
    { key: 'MX', label: 'México' },
    { key: 'FM', label: 'Micronesia' },
    { key: 'MD', label: 'Moldavia' },
    { key: 'MC', label: 'Mónaco' },
    { key: 'MN', label: 'Mongolia' },
    { key: 'ME', label: 'Montenegro' },
    { key: 'MS', label: 'Montserrat' },
    { key: 'MZ', label: 'Mozambique' },
    { key: 'MM', label: 'Myanmar' },
    { key: 'NA', label: 'Namibia' },
    { key: 'NR', label: 'Nauru' },
    { key: 'NP', label: 'Nepal' },
    { key: 'NI', label: 'Nicaragua' },
    { key: 'NE', label: 'Níger' },
    { key: 'NG', label: 'Nigeria' },
    { key: 'NU', label: 'Niue' },
    { key: 'NO', label: 'Noruega' },
    { key: 'NC', label: 'Nueva Caledonia' },
    { key: 'NZ', label: 'Nueva Zelanda' },
    { key: 'OM', label: 'Omán' },
    { key: 'NL', label: 'Países Bajos' },
    { key: 'PK', label: 'Pakistán' },
    { key: 'PW', label: 'Palaos' },
    { key: 'PS', label: 'Palestina' },
    { key: 'PA', label: 'Panamá' },
    { key: 'PG', label: 'Papúa Nueva Guinea' },
    { key: 'PY', label: 'Paraguay' },
    { key: 'PE', label: 'Perú' },
    { key: 'PF', label: 'Polinesia Francesa' },
    { key: 'PL', label: 'Polonia' },
    { key: 'PT', label: 'Portugal' },
    { key: 'PR', label: 'Puerto Rico' },
    { key: 'QA', label: 'Qatar' },
    { key: 'GB', label: 'Reino Unido' },
    { key: 'CF', label: 'República Centroafricana' },
    { key: 'CZ', label: 'República Checa' },
    { key: 'CD', label: 'República Democrática del Congo' },
    { key: 'DO', label: 'República Dominicana' },
    { key: 'RE', label: 'Reunión' },
    { key: 'RW', label: 'Ruanda' },
    { key: 'RO', label: 'Rumania' },
    { key: 'RU', label: 'Rusia' },
    { key: 'EH', label: 'Sahara Occidental' },
    { key: 'WS', label: 'Samoa' },
    { key: 'AS', label: 'Samoa Americana' },
    { key: 'BL', label: 'San Bartolomé' },
    { key: 'KN', label: 'San Cristóbal y Nieves' },
    { key: 'SM', label: 'San Marino' },
    { key: 'MF', label: 'San Martín' },
    { key: 'PM', label: 'San Pedro y Miquelón' },
    { key: 'VC', label: 'San Vicente y las Granadinas' },
    { key: 'SH', label: 'Santa Elena, Ascensión y Tristán de Acuña' },
    { key: 'LC', label: 'Santa Lucía' },
    { key: 'ST', label: 'Santo Tomé y Príncipe' },
    { key: 'SN', label: 'Senegal' },
    { key: 'RS', label: 'Serbia' },
    { key: 'SC', label: 'Seychelles' },
    { key: 'SL', label: 'Sierra Leona' },
    { key: 'SG', label: 'Singapur' },
    { key: 'SX', label: 'Sint Maarten' },
    { key: 'SY', label: 'Siria' },
    { key: 'SO', label: 'Somalia' },
    { key: 'LK', label: 'Sri Lanka' },
    { key: 'SZ', label: 'Suazilandia' },
    { key: 'ZA', label: 'Sudáfrica' },
    { key: 'SD', label: 'Sudán' },
    { key: 'SS', label: 'Sudán del Sur' },
    { key: 'SE', label: 'Suecia' },
    { key: 'CH', label: 'Suiza' },
    { key: 'SR', label: 'Surinam' },
    { key: 'SJ', label: 'Svalbard y Jan Mayen' },
    { key: 'TH', label: 'Tailandia' },
    { key: 'TW', label: 'Taiwán' },
    { key: 'TZ', label: 'Tanzania' },
    { key: 'TJ', label: 'Tayikistán' },
    { key: 'IO', label: 'Territorio Británico del Océano Índico' },
    { key: 'TF', label: 'Territorios Australes Franceses' },
    { key: 'TL', label: 'Timor Oriental' },
    { key: 'TG', label: 'Togo' },
    { key: 'TK', label: 'Tokelau' },
    { key: 'TO', label: 'Tonga' },
    { key: 'TT', label: 'Trinidad y Tobago' },
    { key: 'TN', label: 'Túnez' },
    { key: 'TM', label: 'Turkmenistán' },
    { key: 'TR', label: 'Turquía' },
    { key: 'TV', label: 'Tuvalu' },
    { key: 'UA', label: 'Ucrania' },
    { key: 'UG', label: 'Uganda' },
    { key: 'UY', label: 'Uruguay' },
    { key: 'UZ', label: 'Uzbekistán' },
    { key: 'VU', label: 'Vanuatu' },
    { key: 'VE', label: 'Venezuela' },
    { key: 'VN', label: 'Vietnam' },
    { key: 'WF', label: 'Wallis y Futuna' },
    { key: 'YE', label: 'Yemen' },
    { key: 'DJ', label: 'Yibuti' },
    { key: 'ZM', label: 'Zambia' },
    { key: 'ZW', label: 'Zimbabue' }
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
            {/* Avatar, Name and Number in one row */}
            <div className="avatar-name-row">
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
              
              <div className="name-number-container">
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