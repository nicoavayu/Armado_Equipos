import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { updateProfile, calculateProfileCompletion, supabase } from '../supabase';
import ProfileCard from './ProfileCard';
import InlineNotice from './ui/InlineNotice';
import { notifyBlockingError } from 'utils/notifyBlockingError';

const GEO_LOG_PREFIX = '[PROFILE_GEO]';
const AWARDS_PREVIEW_INCREMENT = 1; // TEMP test: remove when no longer needed.

const withAwardsPreview = (profile, avatarUrl) => {
  const safeProfile = profile || {};
  const currentMvp = Number(safeProfile.mvp_badges ?? safeProfile.mvps ?? 0) || 0;
  const currentGk = Number(safeProfile.gk_badges ?? safeProfile.guantes_dorados ?? 0) || 0;
  const currentRed = Number(safeProfile.red_badges ?? safeProfile.tarjetas_rojas ?? 0) || 0;

  return {
    ...safeProfile,
    avatar_url: avatarUrl,
    mvp_badges: currentMvp + AWARDS_PREVIEW_INCREMENT,
    gk_badges: currentGk + AWARDS_PREVIEW_INCREMENT,
    red_badges: currentRed + AWARDS_PREVIEW_INCREMENT,
  };
};

const extractCityFromGeocodeResults = (results = []) => {
  if (!Array.isArray(results) || results.length === 0) return null;

  const priorityTypes = [
    'locality',
    'administrative_area_level_2',
    'administrative_area_level_1',
    'sublocality',
    'neighborhood',
  ];

  for (const geocodeResult of results) {
    const components = Array.isArray(geocodeResult?.address_components) ? geocodeResult.address_components : [];
    for (const type of priorityTypes) {
      const match = components.find((component) => Array.isArray(component?.types) && component.types.includes(type));
      if (match?.long_name) return match.long_name;
    }
  }

  return null;
};

const reverseGeocodeCity = async (latitude, longitude) => {
  if (typeof window === 'undefined' || !window.google?.maps?.Geocoder) {
    return null;
  }

  const geocoder = new window.google.maps.Geocoder();

  const results = await new Promise((resolve, reject) => {
    geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (geocodeResults, status) => {
      if (status === 'OK') {
        resolve(geocodeResults || []);
        return;
      }

      reject(new Error(`Google Geocoder status: ${status}`));
    });
  });

  return extractCityFromGeocodeResults(results);
};

// Form Component
const ProfileEditorForm = ({
  liveProfile,
  setLiveProfile,
  user,
  formData,
  handleInputChange,
  fileInputRef,
  handlePhotoChange,
  handleGeolocation,
  inputClass,
  labelClass,
  formGroupClass,
  MAX_NOMBRE,
  countries,
  positions,
  footOptions,
  levelOptions,
  loading,
  hasChanges,
  handleSave,
  handleLogout,
  handleDeleteAccount,
  inlineNotice,
  onClearInlineNotice,
}) => {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-3 flex flex-col gap-2 min-w-0">
      <InlineNotice
        type={inlineNotice?.type}
        message={inlineNotice?.message}
        autoHideMs={3200}
        onClose={onClearInlineNotice}
      />
      {/* ProfileCard fixed within form flow */}
      <div className="w-full flex justify-center -mt-5 -mb-12">
        <ProfileCard
          profile={withAwardsPreview(
            liveProfile,
            liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture,
          )}
          isVisible={true}
          performanceMode={false}
          awardsLayout="space-left"
          enableTilt={false}
        />
      </div>

      <div className="w-full flex flex-col gap-3 min-w-0">
        {/* Header Info: Photo + Name (COMPACT ROW) */}
        <div className="flex flex-row items-center gap-3 w-full min-w-0">
          {/* Square Photo Avatar */}
          <div
            className="w-[44px] h-[44px] rounded-xl overflow-hidden border border-white/20 relative cursor-pointer group shadow-lg bg-white/5 shrink-0"
            onClick={(e) => {
              e.preventDefault();
              fileInputRef.current?.click();
            }}
            title="Cambiar Foto"
          >
            {liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture ? (
              <img
                src={liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
                alt="Perfil"
                className="w-full h-full object-cover object-center"
              />
            ) : (
              <div className="w-full h-full bg-white/5 flex items-center justify-center text-base text-white/40">👤</div>
            )}
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <span className="text-base">📷</span>
            </div>
          </div>

          {/* Name Column (Integrated in row) */}
          <div className="flex-1 flex flex-col gap-0.5 min-w-0 justify-center">
            <label className={labelClass + ' !mb-0 !text-[11px]'}>Nombre Completo *</label>
            <input
              className={`${inputClass} w-full min-w-0 !py-2 !h-[40px] !text-sm`}
              type="text"
              value={formData.nombre}
              maxLength={MAX_NOMBRE}
              onChange={(e) => handleInputChange('nombre', e.target.value.slice(0, MAX_NOMBRE))}
              placeholder="Tu nombre..."
            />
            <span className="text-[10px] text-gray-400 mt-0.5">{formData.nombre?.length || 0}/{MAX_NOMBRE}</span>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoChange}
          onClick={(e) => e.stopPropagation()}
        />

        {/* Email Field */}
        <div className={formGroupClass}>
          <label className={labelClass}>Email</label>
          <input
            className={inputClass}
            type="email"
            value={user?.email || formData.email || ''}
            readOnly
            style={{ opacity: 0.8, cursor: 'not-allowed' }}
          />
        </div>

        {/* Teléfono Field */}
        <div className={formGroupClass}>
          <label className={labelClass}>Teléfono <span className="text-xs opacity-70">(solo visible para admins)</span></label>
          <input
            className={inputClass}
            type="tel"
            value={formData.telefono}
            onChange={(e) => handleInputChange('telefono', e.target.value)}
            placeholder="+54 9 11 1234-5678"
          />
        </div>

        {/* Nacionalidad Field */}
        <div className={formGroupClass}>
          <label className={labelClass}>Nacionalidad</label>
          <select
            className={inputClass}
            value={formData.pais_codigo}
            onChange={(e) => {
              const country = countries.find((c) => c.key === e.target.value);
              handleInputChange('pais_codigo', e.target.value);
              handleInputChange('nacionalidad', country?.label || 'Argentina');
              setLiveProfile((prev) => ({
                ...prev,
                pais_codigo: e.target.value,
                nacionalidad: country?.label || 'Argentina',
              }));
            }}
          >
            {countries.map((country) => (
              <option key={country.key} value={country.key} className="bg-[#2a2a40] text-white">
                {country.label}
              </option>
            ))}
          </select>
        </div>

        {/* Posición Field */}
        <div className={formGroupClass}>
          <label className={labelClass}>Posición</label>
          <div className="grid grid-cols-4 gap-2 md:gap-1.5 mt-1">
            {positions.map((pos) => (
              <button
                key={pos.key}
                type="button"
                className={`
                  bg-white/10 border-2 border-white/30 text-white p-2 rounded-md text-xs sm:text-sm font-bold font-oswald cursor-pointer transition-all hover:bg-white/20 hover:border-white/50
                  ${formData.posicion === pos.key ? 'bg-gradient-to-r from-[#f4d03f] to-[#f7dc6f] !border-[#f4d03f] !text-black shadow-md' : ''}
                `}
                onClick={() => handleInputChange('posicion', pos.key)}
              >
                {pos.label}
              </button>
            ))}
          </div>
        </div>

        <div className={formGroupClass}>
          <label className={labelClass}>Pierna hábil</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {footOptions.map((option) => {
              const isActive = (formData.pierna_habil || '') === option.key;
              return (
                <button
                  key={option.key || 'empty'}
                  type="button"
                  className={`
                    h-[40px] px-2 rounded-xl text-[12px] sm:text-[13px] font-semibold tracking-[0.01em] transition-all border
                    ${isActive
                      ? 'bg-primary border-primary text-white shadow-[0_6px_16px_rgba(129,120,229,0.35)]'
                      : 'bg-white/5 border-white/20 text-white/85 hover:bg-white/10 hover:border-white/30'}
                  `}
                  onClick={() => handleInputChange('pierna_habil', option.key)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={formGroupClass}>
          <label className={labelClass}>Nivel autopercibido</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {levelOptions.map((option) => {
              const isActive = (formData.nivel ?? null) === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`
                    h-[40px] px-2 rounded-xl text-[12px] sm:text-[13px] font-semibold tracking-[0.01em] transition-all border
                    ${isActive
                      ? 'bg-primary border-primary text-white shadow-[0_6px_16px_rgba(129,120,229,0.35)]'
                      : 'bg-white/5 border-white/20 text-white/85 hover:bg-white/10 hover:border-white/30'}
                  `}
                  onClick={() => handleInputChange('nivel', option.value)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Localidad Field */}
        <div className={formGroupClass}>
          <label className={labelClass}>Localidad</label>
          <div className="flex gap-2 items-center">
            <input
              className={`${inputClass} flex-1`}
              type="text"
              value={formData.localidad}
              onChange={(e) => handleInputChange('localidad', e.target.value)}
              placeholder="Tu ciudad"
            />
            <button
              className="bg-[#f4d03f]/20 border border-[#f4d03f] text-[#f4d03f] px-3 py-2 rounded-md text-base cursor-pointer transition-all hover:bg-[#f4d03f]/30 flex items-center justify-center min-w-[44px] h-[38px]"
              onClick={handleGeolocation}
              type="button"
              title="Obtener ubicación actual"
            >
              📍
            </button>
          </div>
        </div>

        {/* Bio Field */}
        <div className={formGroupClass}>
          <label className={labelClass}>Bio</label>
          <textarea
            className={inputClass}
            value={formData.bio}
            onChange={(e) => handleInputChange('bio', e.target.value)}
            placeholder="Contanos algo sobre vos..."
            rows={3}
          />
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-4 mt-8 pt-10 border-t border-white/10 w-full min-w-0 pb-16">
          <button
            className={`
              col-span-2 w-full h-[54px] rounded-2xl text-[18px] font-semibold tracking-[0.01em] font-oswald cursor-pointer transition-all flex items-center justify-center
              ${hasChanges ? 'bg-primary text-white shadow-[0_10px_30px_rgba(129,120,229,0.4)] hover:-translate-y-1 active:translate-y-0 active:scale-[0.98]' : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'}
            `}
            onClick={handleSave}
            disabled={loading || !hasChanges}
          >
            {loading ? 'Procesando...' : 'Guardar Cambios'}
          </button>

          <button
            className="col-span-2 h-[48px] bg-red-500/5 border border-red-500/10 text-red-400 rounded-2xl text-[16px] font-semibold tracking-[0.01em] font-oswald cursor-pointer transition-all hover:bg-red-500/10 hover:text-red-300 active:scale-95 flex items-center justify-center"
            onClick={handleLogout}
            disabled={loading}
          >
            Cerrar sesión
          </button>

          <button
            className="col-span-2 h-[48px] bg-red-600/15 border border-red-500/30 text-red-300 rounded-2xl text-[16px] font-semibold tracking-[0.01em] font-oswald cursor-pointer transition-all hover:bg-red-600/25 hover:text-red-200 active:scale-95 flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={handleDeleteAccount}
            disabled={loading}
          >
            Eliminar cuenta
          </button>
        </div>
      </div>
    </div>
  );
};

const DeleteAccountModal = ({
  isOpen,
  loading,
  confirmationText,
  onConfirmationTextChange,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  const canConfirm = confirmationText.trim().toUpperCase() === 'ELIMINAR' && !loading;

  return (
    <div className="fixed inset-0 z-[1300] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-[560px] bg-[#0f172a]/95 border border-red-500/30 rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl md:text-2xl font-oswald tracking-wide text-red-300">Eliminar cuenta</h3>
            <p className="text-white/75 text-sm mt-1">
              Esta acción es permanente y no se puede deshacer.
            </p>
          </div>
          <button
            type="button"
            className="w-9 h-9 rounded-full border border-white/20 text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onClose}
            disabled={loading}
            aria-label="Cerrar modal"
          >
            ×
          </button>
        </div>

        <form
          className="px-5 py-5 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canConfirm) onConfirm();
          }}
        >
          <p className="text-white/85 leading-relaxed">
            Se eliminará tu perfil, tus datos asociados y se cerrará tu sesión automáticamente.
          </p>

          <div className="space-y-2">
            <label className="block text-white/85 text-sm font-semibold tracking-wide">
              Escribí <span className="text-red-300">ELIMINAR</span> para confirmar
            </label>
            <input
              className="w-full bg-white/10 border border-white/20 text-white px-4 py-3 rounded-xl text-base transition-all focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/30 placeholder:text-white/40"
              type="text"
              value={confirmationText}
              onChange={(e) => onConfirmationTextChange(e.target.value)}
              placeholder="ELIMINAR"
              autoComplete="off"
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="h-[46px] rounded-xl border border-white/25 text-white/90 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onClose}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="h-[46px] rounded-xl border border-red-500/40 bg-red-600/25 text-red-200 hover:bg-red-600/35 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!canConfirm}
            >
              {loading ? 'Eliminando...' : 'Eliminar cuenta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

function ProfileEditor({ isOpen, onClose, isEmbedded = false }) {
  const navigate = useNavigate();
  const { user, profile, refreshProfile, updateLocalProfile, localEditMode } = useAuth();
  const isLocalDevSession = localEditMode && user?.app_metadata?.provider === 'local-dev';
  const [loading, setLoading] = useState(false);
  const [liveProfile, setLiveProfile] = useState(profile);
  const [hasChanges, setHasChanges] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState('');
  const [inlineNotice, setInlineNotice] = useState(null);
  const fileInputRef = useRef(null);
  const noticeRef = useRef({ type: '', message: '', ts: 0 });

  const cleanDate = (dateString) => dateString ? dateString.split('T')[0] : null;

  const [formData, setFormData] = useState({
    nombre: '',
    email: '',
    telefono: '',
    nacionalidad: 'Argentina',
    pais_codigo: 'AR',
    posicion: 'DEF',
    pierna_habil: '',
    nivel: null,
    fecha_nacimiento: null,
    localidad: '',
    latitud: null,
    longitud: null,
    partidos_jugados: 0,
    partidos_abandonados: 0,
    ranking: 5,
    bio: '',
    acepta_invitaciones: true,
  });

  useEffect(() => {
    if (profile) {
      // Asegurar que tengamos la URL del avatar desde todas las fuentes posibles
      const avatarUrl = profile.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

      // Si tenemos un avatar en los metadatos pero no en el perfil, actualizar el perfil
      if (
        !isLocalDevSession &&
        !profile.avatar_url &&
        (user?.user_metadata?.avatar_url || user?.user_metadata?.picture)
      ) {
        updateProfile(user.id, { avatar_url: avatarUrl })
          .then(() => refreshProfile())
          .catch((err) => console.error('Error updating profile with avatar:', err));
      }

      const parseLevel = (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) return null;
        return parsed;
      };

      const newFormData = {
        nombre: profile.nombre || '',
        email: profile.email || user?.email || '',
        telefono: profile.telefono || '',
        nacionalidad: profile.nacionalidad || 'Argentina',
        pais_codigo: profile.pais_codigo || 'AR',
        posicion: profile.posicion || profile.rol_favorito || 'DEF',
        pierna_habil: ['right', 'left', 'both'].includes(profile.pierna_habil) ? profile.pierna_habil : '',
        nivel: parseLevel(profile.nivel),
        fecha_nacimiento: cleanDate(profile.fecha_nacimiento),
        localidad: profile.localidad || '',
        latitud: profile.latitud || null,
        longitud: profile.longitud || null,
        partidos_jugados: profile.partidos_jugados || 0,
        partidos_abandonados: profile.partidos_abandonados || 0,
        ranking: profile.ranking || profile.calificacion || 5,
        bio: profile.bio || '',
        acepta_invitaciones: profile.acepta_invitaciones !== false,
      };
      setFormData(newFormData);

      setLiveProfile({
        ...profile,
        ...newFormData,
        avatar_url: avatarUrl,
        user: user,
      });
      setHasChanges(false);
    }
  }, [profile, user, refreshProfile, isLocalDevSession]);

  const MAX_NOMBRE = 12;

  const showInlineNotice = useCallback((type, message) => {
    const now = Date.now();
    const previous = noticeRef.current;
    if (previous.type === type && previous.message === message && now - previous.ts < 2000) {
      return;
    }
    noticeRef.current = { type, message, ts: now };
    setInlineNotice({ type, message });
  }, []);

  const clearInlineNotice = useCallback(() => setInlineNotice(null), []);

  const handleInputChange = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
    setLiveProfile((prev) => ({ ...(prev || {}), [field]: value }));
  }, [setFormData, setHasChanges, setLiveProfile]);

  const handlePhotoChange = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showInlineNotice('warning', 'La imagen debe ser menor a 5MB.');
      return;
    }

    const localPreviewUrl = URL.createObjectURL(file);

    setLiveProfile((prev) => ({
      ...prev,
      avatar_url: localPreviewUrl,
    }));

    if (isLocalDevSession) {
      updateLocalProfile({ avatar_url: localPreviewUrl });
      setHasChanges(true);
      showInlineNotice('success', 'Foto actualizada en modo local.');
      return;
    }

    setLoading(true);
    try {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const fileName = `${user.id}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('jugadores-fotos')
        .upload(fileName, file, { upsert: true, cacheControl: '0' });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('jugadores-fotos')
        .getPublicUrl(fileName);

      const fotoUrl = data?.publicUrl;
      if (!fotoUrl) throw new Error('No se pudo obtener la URL pública de la foto.');

      await updateProfile(user.id, { avatar_url: fotoUrl });

      await supabase.auth.updateUser({
        data: { avatar_url: fotoUrl },
      });

      setLiveProfile((prev) => ({
        ...prev,
        avatar_url: fotoUrl,
      }));

      setHasChanges(true);
      showInlineNotice('success', 'Foto actualizada correctamente.');

    } catch (error) {
      console.error('Error uploading photo:', error);
      notifyBlockingError('Error subiendo foto: ' + error.message);

      setLiveProfile((prev) => ({
        ...prev,
        avatar_url: profile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture,
      }));
    } finally {
      setLoading(false);
    }
  }, [user, profile, setLiveProfile, setLoading, setHasChanges, showInlineNotice, isLocalDevSession, updateLocalProfile]);

  const handleSave = useCallback(async () => {
    if (!formData.nombre.trim()) {
      showInlineNotice('warning', 'El nombre es obligatorio.');
      return;
    }
    if (!formData.email.trim()) {
      showInlineNotice('warning', 'El email es obligatorio.');
      return;
    }

    setLoading(true);
    try {
      const profileDataToSave = {
        ...formData,
        fecha_nacimiento: cleanDate(formData.fecha_nacimiento),
      };

      if (isLocalDevSession) {
        updateLocalProfile(profileDataToSave);
        setHasChanges(false);
        showInlineNotice('success', 'Perfil guardado en modo local.');
        onClose();
        return;
      }

      const updatedProfile = await updateProfile(user.id, profileDataToSave);

      if (updatedProfile?.error) {
        notifyBlockingError('Error guardando perfil: ' + updatedProfile.error.message);
        return;
      }

      const completion = calculateProfileCompletion(updatedProfile);
      if (completion === 100 && (profile?.profile_completion || 0) < 100) {
        showInlineNotice('success', 'Perfil completado al 100%.');
      } else {
        showInlineNotice('success', 'Perfil guardado correctamente.');
      }

      await refreshProfile();
      setHasChanges(false);
      onClose();
    } catch (error) {
      notifyBlockingError('Error guardando perfil: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [formData, user, refreshProfile, onClose, setLoading, setHasChanges, profile?.profile_completion, showInlineNotice, isLocalDevSession, updateLocalProfile]);

  const handleLogout = useCallback(async () => {
    if (isLocalDevSession) {
      onClose();
      navigate('/', { replace: true });
      return;
    }
    await supabase.auth.signOut();
    onClose();
    navigate('/login', { replace: true });
  }, [onClose, navigate, isLocalDevSession]);

  const handleDeleteAccount = useCallback(() => {
    if (isLocalDevSession) {
      showInlineNotice('warning', 'Deshabilitado en modo local.');
      return;
    }
    if (!user?.id) {
      showInlineNotice('warning', 'No se pudo identificar la cuenta actual.');
      return;
    }

    setDeleteAccountConfirmation('');
    setShowDeleteAccountModal(true);
  }, [showInlineNotice, user?.id, isLocalDevSession]);

  const closeDeleteAccountModal = useCallback(() => {
    if (loading) return;
    setShowDeleteAccountModal(false);
    setDeleteAccountConfirmation('');
  }, [loading]);

  const confirmDeleteAccount = useCallback(async () => {
    if (deleteAccountConfirmation.trim().toUpperCase() !== 'ELIMINAR') {
      showInlineNotice('warning', 'Para confirmar, escribí ELIMINAR.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: { confirm: true },
      });

      if (error) {
        throw new Error(error.message || 'No se pudo eliminar la cuenta.');
      }

      if (!data?.ok) {
        throw new Error(data?.message || 'No se pudo eliminar la cuenta.');
      }

      setShowDeleteAccountModal(false);
      setDeleteAccountConfirmation('');
      showInlineNotice('success', 'Cuenta eliminada correctamente.');
      await supabase.auth.signOut();
      onClose();
      navigate('/login', { replace: true });
    } catch (error) {
      notifyBlockingError(`Error eliminando cuenta: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [deleteAccountConfirmation, navigate, onClose, showInlineNotice]);

  const handleGeolocation = useCallback(() => {
    if (!navigator.geolocation) {
      showInlineNotice('warning', 'Geolocalización no disponible en este dispositivo.');
      return;
    }

    console.debug(`${GEO_LOG_PREFIX} requesting current position`);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);

        console.debug(`${GEO_LOG_PREFIX} coordinates resolved`, { latitude, longitude });

        handleInputChange('latitud', latitude);
        handleInputChange('longitud', longitude);

        try {
          const city = await reverseGeocodeCity(latitude, longitude);
          if (city) {
            handleInputChange('localidad', city);
            console.debug(`${GEO_LOG_PREFIX} city resolved`, { city });
          } else {
            console.warn(`${GEO_LOG_PREFIX} city could not be resolved from coordinates`);
          }
        } catch (reverseError) {
          console.warn(`${GEO_LOG_PREFIX} reverse geocode failed`, reverseError);
        }

        showInlineNotice('success', 'Ubicación obtenida correctamente.');
      },
      (error) => {
        let errorMessage = 'Error obteniendo ubicación';
        console.warn(`${GEO_LOG_PREFIX} geolocation error`, error);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Permiso denegado. Habilita la ubicación en tu dispositivo.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Ubicación no disponible.';
            break;
          case error.TIMEOUT:
            errorMessage = 'Tiempo agotado.';
            break;
          default:
            break;
        }
        showInlineNotice('warning', errorMessage);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  }, [handleInputChange, showInlineNotice]);

  const positions = useMemo(() => [
    { key: 'ARQ', label: 'ARQ' },
    { key: 'DEF', label: 'DEF' },
    { key: 'MED', label: 'MED' },
    { key: 'DEL', label: 'DEL' },
  ], []);

  const footOptions = useMemo(() => [
    { key: '', label: 'Sin definir' },
    { key: 'right', label: 'Derecha (DER)' },
    { key: 'left', label: 'Izquierda (IZQ)' },
    { key: 'both', label: 'Ambas (AMB)' },
  ], []);

  const levelOptions = useMemo(() => [
    { value: null, label: 'Sin definir' },
    { value: 1, label: 'Recreativo' },
    { value: 2, label: 'Amateur' },
    { value: 3, label: 'Intermedio' },
    { value: 4, label: 'Competitivo' },
    { value: 5, label: 'Avanzado' },
  ], []);

  const countries = useMemo(() => [
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
  ], []);

  if (!isOpen) return null;

  // Shared classes
  const inputClass = 'w-full bg-white/10 border border-white/20 text-white px-4 py-3 rounded-xl text-base transition-all focus:outline-none focus:border-primary focus:bg-white/15 focus:ring-2 focus:ring-primary/30 placeholder:text-white/40 read-only:opacity-70 read-only:cursor-not-allowed shadow-inner backdrop-blur-sm';
  const labelClass = 'text-white/90 text-sm font-bold mb-2 block uppercase tracking-wider';
  const formGroupClass = 'flex flex-col w-full';

  if (isEmbedded) {
    return (
      <div className="w-full relative bg-transparent overflow-x-hidden" style={{ overflowX: 'clip' }}>
        <ProfileEditorForm
          liveProfile={liveProfile}
          setLiveProfile={setLiveProfile}
          user={user}
          formData={formData}
          handleInputChange={handleInputChange}
          fileInputRef={fileInputRef}
          handlePhotoChange={handlePhotoChange}
          handleGeolocation={handleGeolocation}
          inputClass={inputClass}
          labelClass={labelClass}
          formGroupClass={formGroupClass}
          MAX_NOMBRE={MAX_NOMBRE}
          countries={countries}
          positions={positions}
          footOptions={footOptions}
          levelOptions={levelOptions}
          loading={loading}
          hasChanges={hasChanges}
          handleSave={handleSave}
          handleLogout={handleLogout}
          handleDeleteAccount={handleDeleteAccount}
          inlineNotice={inlineNotice}
          onClearInlineNotice={clearInlineNotice}
        />
        <DeleteAccountModal
          isOpen={showDeleteAccountModal}
          loading={loading}
          confirmationText={deleteAccountConfirmation}
          onConfirmationTextChange={setDeleteAccountConfirmation}
          onClose={closeDeleteAccountModal}
          onConfirm={confirmDeleteAccount}
        />
      </div>
    );
  }

  // Overlay Mode (Default)
  return (
    <div className="fixed inset-0 bg-black/90 z-[1000] flex items-center justify-center backdrop-blur-xl overflow-y-auto overflow-x-hidden py-5 px-0 sm:items-start sm:p-[10px_10px_20px] md:items-center md:py-5">
      <div className="flex flex-col md:flex-row w-full md:w-[90vw] max-w-[1200px] min-h-[95vh] md:min-h-[80vh] bg-white/5 backdrop-blur-2xl rounded-none md:rounded-[30px] overflow-hidden shadow-[0_32px_64px_rgba(0,0,0,0.6)] border border-white/10 m-0 md:m-auto">

        {/* Left Side - Player Card */}
        <div className="flex-none w-full md:w-[400px] flex items-center justify-center p-5 md:p-10 bg-white/5 md:bg-white/10 border-b md:border-b-0 md:border-r border-white/20 relative">
          <div className="w-full flex justify-center overflow-visible">
            <ProfileCard
              profile={withAwardsPreview(
                liveProfile,
                liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture,
              )}
              isVisible={true}
              awardsLayout="space-left"
              enableTilt={false}
            />
          </div>
        </div>

        {/* Right Side - Edit Menu */}
        <div className="flex-1 flex flex-col bg-white/5 min-h-0">
          <div className="p-[12px_16px] md:p-[20px_30px] border-b border-white/20 flex justify-between items-center">
            <h2 className="text-white text-xl md:text-2xl font-semibold font-oswald m-0">Editar Perfil</h2>
            <button
              className="bg-transparent border-none text-white text-[32px] cursor-pointer w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
              onClick={onClose}
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-[12px_16px] md:p-[20px_30px] flex flex-col gap-4 pb-20 items-center">
            <div className="w-full max-w-[520px] flex flex-col gap-4">
              <InlineNotice
                type={inlineNotice?.type}
                message={inlineNotice?.message}
                autoHideMs={3200}
                onClose={clearInlineNotice}
              />
              {/* Avatar and Name (COMPACT ROW OVERLAY) */}
              <div className="flex items-end gap-3 w-full mt-4 mb-2">
                <div className="flex flex-col items-center shrink-0">
                  <div
                    className="w-[50px] h-[50px] rounded-xl overflow-hidden border border-white/30 relative cursor-pointer group shadow-lg"
                    onClick={(e) => {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }}
                    title="Cambiar Foto"
                  >
                    {liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture ? (
                      <img
                        src={liveProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
                        alt="Perfil"
                        className="w-full h-full object-cover object-center"
                        key={`profile-photo-ov-${liveProfile?.avatar_url || 'default'}`}
                      />
                    ) : (
                      <div className="w-full h-full bg-white/10 flex items-center justify-center text-xl text-white/70">👤</div>
                    )}
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <span className="text-xl">📷</span>
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <label className={labelClass}>Nombre *</label>
                  <input
                    className={`${inputClass} !py-3`}
                    type="text"
                    value={formData.nombre}
                    maxLength={MAX_NOMBRE}
                    onChange={(e) => handleInputChange('nombre', e.target.value.slice(0, MAX_NOMBRE))}
                    placeholder="Tu nombre completo"
                  />
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            <div className={formGroupClass}>
              <label className={labelClass}>Email</label>
              <input
                className={inputClass}
                type="email"
                value={user?.email || formData.email || ''}
                readOnly
                style={{ opacity: 0.8, cursor: 'not-allowed' }}
              />
            </div>

            <div className={formGroupClass}>
              <label className={labelClass}>Teléfono <span className="text-xs opacity-70">(solo visible para admins)</span></label>
              <input
                className={inputClass}
                type="tel"
                value={formData.telefono}
                onChange={(e) => handleInputChange('telefono', e.target.value)}
                placeholder="+54 9 11 1234-5678"
              />
            </div>

            <div className={formGroupClass}>
              <label className={labelClass}>Nacionalidad</label>
              <select
                className={inputClass}
                value={formData.pais_codigo}
                onChange={(e) => {
                  const country = countries.find((c) => c.key === e.target.value);
                  handleInputChange('pais_codigo', e.target.value);
                  handleInputChange('nacionalidad', country?.label || 'Argentina');
                  setLiveProfile((prev) => ({
                    ...prev,
                    pais_codigo: e.target.value,
                    nacionalidad: country?.label || 'Argentina',
                  }));
                }}
              >
                {countries.map((country) => (
                  <option key={country.key} value={country.key} className="bg-[#2a2a40] text-white">
                    {country.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={formGroupClass}>
              <label className={labelClass}>Posición</label>
              <div className="grid grid-cols-4 gap-2 md:gap-1.5 mt-1">
                {positions.map((pos) => (
                  <button
                    key={pos.key}
                    type="button"
                    className={`
                          bg-white/10 border-2 border-white/30 text-white p-2 rounded-md text-xs sm:text-sm font-bold font-oswald cursor-pointer transition-all hover:bg-white/20 hover:border-white/50
                          ${formData.posicion === pos.key ? 'bg-gradient-to-r from-[#f4d03f] to-[#f7dc6f] !border-[#f4d03f] !text-black shadow-md' : ''}
                        `}
                    onClick={() => handleInputChange('posicion', pos.key)}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={formGroupClass}>
              <label className={labelClass}>Pierna hábil</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {footOptions.map((option) => {
                  const isActive = (formData.pierna_habil || '') === option.key;
                  return (
                    <button
                      key={option.key || 'empty'}
                      type="button"
                      className={`
                        h-[40px] px-2 rounded-xl text-[12px] sm:text-[13px] font-semibold tracking-[0.01em] transition-all border
                        ${isActive
                          ? 'bg-primary border-primary text-white shadow-[0_6px_16px_rgba(129,120,229,0.35)]'
                          : 'bg-white/5 border-white/20 text-white/85 hover:bg-white/10 hover:border-white/30'}
                      `}
                      onClick={() => handleInputChange('pierna_habil', option.key)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={formGroupClass}>
              <label className={labelClass}>Nivel autopercibido</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {levelOptions.map((option) => {
                  const isActive = (formData.nivel ?? null) === option.value;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={`
                        h-[40px] px-2 rounded-xl text-[12px] sm:text-[13px] font-semibold tracking-[0.01em] transition-all border
                        ${isActive
                          ? 'bg-primary border-primary text-white shadow-[0_6px_16px_rgba(129,120,229,0.35)]'
                          : 'bg-white/5 border-white/20 text-white/85 hover:bg-white/10 hover:border-white/30'}
                      `}
                      onClick={() => handleInputChange('nivel', option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={formGroupClass}>
              <label className={labelClass}>Localidad</label>
              <div className="flex gap-2 items-center">
                <input
                  className={`${inputClass} flex-1`}
                  type="text"
                  value={formData.localidad}
                  onChange={(e) => handleInputChange('localidad', e.target.value)}
                  placeholder="Tu ciudad"
                />
                <button
                  className="bg-[#f4d03f]/20 border border-[#f4d03f] text-[#f4d03f] px-3 py-2 rounded-md text-base cursor-pointer transition-all hover:bg-[#f4d03f]/30 flex items-center justify-center min-w-[44px] h-[38px]"
                  onClick={handleGeolocation}
                  type="button"
                  title="Obtener ubicación actual"
                >
                  📍
                </button>
              </div>
            </div>

            <div className={formGroupClass}>
              <label className={labelClass}>Bio</label>
              <textarea
                className={inputClass}
                value={formData.bio}
                onChange={(e) => handleInputChange('bio', e.target.value)}
                placeholder="Contanos algo sobre vos..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5 pt-5 border-t border-white/20 w-full relative pb-5 md:pb-0">
              <button
                className={`
                      col-span-2 w-full h-[50px] bg-white/10 border border-white/20 text-white rounded-xl text-[18px] font-semibold font-oswald tracking-[0.01em] cursor-pointer transition-all backdrop-blur-md flex items-center justify-center
                      ${hasChanges ? 'bg-primary !border-primary shadow-[0_5px_15px_rgba(129,120,229,0.3)] -translate-y-[2px]' : ''}
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none
                    `}
                onClick={handleSave}
                disabled={loading || !hasChanges}
              >
                {loading ? 'Procesando...' : 'Guardar Cambios'}
              </button>

              <button
                className="col-span-2 h-[44px] bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[16px] font-semibold font-oswald tracking-[0.01em] cursor-pointer transition-all hover:bg-red-500/20 flex items-center justify-center disabled:opacity-50"
                onClick={handleLogout}
                disabled={loading}
              >
                Cerrar sesión
              </button>

              <button
                className="col-span-2 h-[44px] bg-red-600/20 border border-red-500/30 text-red-300 rounded-lg text-[16px] font-semibold font-oswald tracking-[0.01em] cursor-pointer transition-all hover:bg-red-600/30 flex items-center justify-center disabled:opacity-50"
                onClick={handleDeleteAccount}
                disabled={loading}
              >
                Eliminar cuenta
              </button>
            </div>
          </div>
        </div>
        <DeleteAccountModal
          isOpen={showDeleteAccountModal}
          loading={loading}
          confirmationText={deleteAccountConfirmation}
          onConfirmationTextChange={setDeleteAccountConfirmation}
          onClose={closeDeleteAccountModal}
          onConfirm={confirmDeleteAccount}
        />
      </div>
    </div>
  );
}

export default ProfileEditor;
