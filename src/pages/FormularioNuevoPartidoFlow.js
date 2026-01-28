import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../components/AuthProvider';
import AutocompleteSede from '../components/AutocompleteSede';
import { crearPartido, supabase } from '../supabase';
import { insertPartidoFrecuenteFromPartido } from '../services/db/frequentMatches';
import { formatLocalDateShort } from '../utils/dateLocal';
import { useTimeout } from '../hooks/useTimeout';

import PageTitle from '../components/PageTitle';
import ListaPartidosFrecuentes from './ListaPartidosFrecuentes';
import { toast } from 'react-toastify';

const STEPS = {
  NAME: 1,
  WHEN: 2,
  WHERE: 3,
  CONFIRM: 4,
};

const INPUT_MODERN_CLASS = 'appearance-none bg-white/10 border border-white/20 text-white font-sans text-lg px-4 py-3 rounded-xl w-full h-12 transition-all focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 placeholder:text-white/40 focus:bg-white/15 mb-2 box-border shadow-none backdrop-blur-md';
const CONFIRM_BTN_CLASS = 'text-xl text-white bg-primary border-2 border-white/20 rounded-2xl tracking-[0.05em] w-full min-h-[48px] font-bold transition-all duration-300 hover:brightness-110 hover:shadow-[0_8px_32px_rgba(129,120,229,0.4)] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center relative overflow-hidden box-border mt-4 mb-0';
const CONFIRM_ITEM_CLASS = 'bg-white/5 border border-white/10 backdrop-blur-md rounded-xl p-4 mb-3 flex justify-between items-center text-white font-sans shadow-lg';

const STEP_TITLE_STYLE = {
  color: '#fff',
  textAlign: 'left',
  marginBottom: '1rem',
  marginTop: '0',
  fontFamily: "'Inter', sans-serif",
  fontWeight: 500,
  width: '100%',
  display: 'block',
};

const isDateInPast = (dateStr) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selectedDate = new Date(dateStr);
  selectedDate.setHours(0, 0, 0, 0);
  return selectedDate < today;
};


export default function FormularioNuevoPartidoFlow({ onConfirmar, onVolver }) {
  const { user } = useAuth();
  const { setTimeoutSafe } = useTimeout();
  const [step, setStep] = useState(STEPS.NAME);
  const [nombrePartido, setNombrePartido] = useState('');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [sede, setSede] = useState('');
  const [sedeInfo, setSedeInfo] = useState(null);
  // NEW: optional campo para valor de cancha por persona (UI-only)
  const [valorCancha, setValorCancha] = useState('');
  const [loading, setLoading] = useState(false);
  const [_error, setError] = useState('');
  const [_animation, setAnimation] = useState('slide-in');
  const [editMode, setEditMode] = useState(false);

  const [showFrecuentes, setShowFrecuentes] = useState(false);
  // New: toggle to save created party as frequent
  const [saveAsFrequent, setSaveAsFrequent] = useState(false);

  // Ensure toggle is reset when the flow component mounts (covers modal open case)
  useEffect(() => {
    setSaveAsFrequent(false);
  }, []);

  // Also reset the toggle whenever the flow returns to the first step
  useEffect(() => {
    if (step === STEPS.NAME) {
      setSaveAsFrequent(false);
    }
  }, [step]);

  const modalidadToCupo = useMemo(() => ({
    F5: 10, F6: 12, F7: 14, F8: 16, F9: 18, F11: 22,
  }), []);
  const [modalidad, setModalidad] = useState('F5');
  const [cupo, setCupo] = useState(modalidadToCupo['F5']);
  const [tipoPartido, setTipoPartido] = useState('Masculino');
  useEffect(() => { setCupo(modalidadToCupo[modalidad]); }, [modalidad, modalidadToCupo]);

  const [file, setFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const handleFile = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setFotoPreview(URL.createObjectURL(e.target.files[0]));
    }
  };
  const nextStep = () => {
    setAnimation('slide-out');
    setTimeoutSafe(() => {
      setStep((prev) => prev + 1);
      setAnimation('slide-in');
    }, 300);
  };
  const prevStep = () => {
    setAnimation('slide-out');
    setTimeout(() => {
      setStep((prev) => prev - 1);
      setAnimation('slide-in');
    }, 300);
  };
  const editField = (targetStep) => {
    setEditMode(true);
    setAnimation('slide-out');
    setTimeout(() => {
      setStep(targetStep);
      setAnimation('slide-in');
    }, 300);
  };
  const saveAndReturn = () => {
    setEditMode(false);
    setAnimation('slide-out');
    setTimeout(() => {
      setStep(STEPS.CONFIRM);
      setAnimation('slide-in');
    }, 300);
  };

  // Lock body scroll when modal open
  useEffect(() => {
    if (!showFrecuentes) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showFrecuentes]);

  const handleSelectFrecuente = (partidoFrecuente) => {
    try {
      setNombrePartido(partidoFrecuente?.nombre || '');
      setSede(partidoFrecuente?.sede || '');
      setTipoPartido(partidoFrecuente?.tipo_partido || 'Masculino');
      setValorCancha(partidoFrecuente?.precio_cancha !== undefined && partidoFrecuente?.precio_cancha !== null ? String(partidoFrecuente.precio_cancha) : '');
      if (partidoFrecuente?.imagen_url) {
        // Only set preview from template if there is currently no preview
        if (!fotoPreview) {
          setFotoPreview(partidoFrecuente.imagen_url);
          setFile(null);
        }
      }
    } catch (e) {
      console.error('Error preloading partido frecuente into form', e);
    } finally {
      toast.success('Plantilla aplicada ✅');
      setShowFrecuentes(false);
      setStep(STEPS.NAME);
    }
  };

  const handleEditarFrecuenteFromList = (_p) => {
    toast.info('Editar desde la lista no disponible aquí');
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    // Snapshot the toggle now to avoid stale closures — strict boolean check
    const shouldSaveFrequent = (saveAsFrequent === true);

    // TEMP logs for one run only (remove after verification)
    console.log('[NuevoPartido] saveAsFrequent:', saveAsFrequent, 'shouldSaveFrequent:', shouldSaveFrequent);

    try {
      let partido;

      // Upload image if present (unchanged)
      let _imagenUrl = null;
      if (file) {
        try {
          const fileExt = file.name.split('.').pop();
          const fileName = `partido_${Date.now()}.${fileExt}`;
          const { error: uploadError } = await supabase.storage
            .from('jugadores-fotos')
            .upload(fileName, file, { upsert: true });
          if (uploadError) throw uploadError;
          const { data } = supabase.storage
            .from('jugadores-fotos')
            .getPublicUrl(fileName);
          _imagenUrl = data?.publicUrl;
        } catch (error) { /* ignore */ }
      }

      // Normalize numeric precio value (used only for the frequent template insert)
      const precioVal = (valorCancha !== undefined && valorCancha !== null && String(valorCancha).trim() !== '')
        ? Number(String(valorCancha).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'))
        : undefined;

      // Build payload for crearPartido - include precio_cancha_por_persona when provided
      const payload = {
        nombre: nombrePartido.trim(),
        fecha,
        hora: hora.trim(),
        sede: sede.trim(),
        sedeMaps: sedeInfo?.place_id || '',
        modalidad,
        cupo_jugadores: cupo,
        falta_jugadores: false,
        tipo_partido: tipoPartido,
        creado_por: user?.id,
        ...(precioVal !== undefined ? { precio_cancha_por_persona: precioVal } : {}),
      };

      // Finally, create the match in partidos (never with valor_cancha)
      console.log('CREAR PARTIDO payload (final)', payload);
      partido = await crearPartido(payload);

      if (!partido) {
        setError('No se pudo crear el partido');
        return;
      }

      console.log('[CREATE] created partido', { id: partido?.id, shouldSaveFrequent });

      // Only after the partido is successfully created, optionally save a frequent template
      if (shouldSaveFrequent === true) {
        console.log('[NuevoPartido] will insert frequent template for partido id:', partido?.id);
        try {
          await insertPartidoFrecuenteFromPartido(partido?.id);
          toast.success('Plantilla guardada ✅');
        } catch (err) {
          console.error('[Guardar frecuente] error inserting frequent template:', err);
          toast.warning('Partido creado, pero no se pudo guardar como frecuente');
        }
      }

      await onConfirmar(partido);
      // Partido creado correctamente
    } catch (err) {
      setError(err.message || 'Error al procesar la solicitud');
    } finally {
      setLoading(false);
      // Always reset the saveAsFrequent toggle after submit completes (success or error)
      setSaveAsFrequent(false);
    }
  };


  // --- Todas las vistas van sobre el fondo sin wrappers adicionales ---
  // mainStyles replaced by Tailwind classes: min-h-[100dvh] w-screen bg-gradient-to-br from-[#24c6dc] via-[#514a9d] to-[#514a9d] overflow-y-auto flex flex-col items-center p-0 pb-10
  // innerStyles replaced by Tailwind classes: w-full max-w-[440px] mx-auto px-4 pb-10


  // ------ Paso 1: NOMBRE ------
  if (step === STEPS.NAME) {
    return (
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden pt-[110px]">
        <PageTitle title="NUEVO PARTIDO" onBack={onVolver}>NUEVO PARTIDO</PageTitle>
        <div className="w-full flex flex-col items-center pb-10">
          <div className="w-full max-w-[440px] px-4">

            {/* Secondary button to open frequent matches list */}
            {/* Button "PARTIDOS FRECUENTES" removed as requested */}

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1rem' }}>
              {/*
              // BEFORE: large image upload area
              // (was a big dashed box 112x112 with optional preview and large "+" placeholder)

              // AFTER: compact inline image + name field
              // Thumbnail (48-64px) left, text input right. Image optional and clickable to open file selector.
            */}

              {/* Label moved ABOVE the inline block so thumbnail aligns with the input */}
              <label className="block w-full text-white font-medium mb-2 font-sans" style={STEP_TITLE_STYLE}>
                Nombre del partido
              </label>

              <div className="flex items-center gap-3 w-full mb-2">
                <div
                  className="w-12 h-12 min-w-[48px] rounded-lg bg-white/6 border-[1.5px] border-dashed border-white/12 flex items-center justify-center overflow-hidden cursor-pointer"
                  role="button"
                  aria-label={fotoPreview ? 'Cambiar imagen del partido' : 'Agregar imagen opcional'}
                  onClick={() => document.getElementById('partido-foto-input').click()}
                  title={fotoPreview ? 'Cambiar imagen' : 'Agregar imagen opcional'}
                >
                  {fotoPreview ? (
                    <img src={fotoPreview} alt="foto partido" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <span className="thumbnail-placeholder">📷</span>
                  )}
                  <input
                    id="partido-foto-input"
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleFile}
                  />
                </div>

                <div style={{ flex: 1 }}>
                  <input
                    className={`input-modern input-modern--grow ${INPUT_MODERN_CLASS}`}
                    type="text"
                    placeholder="Ej: Partido del Viernes"
                    value={nombrePartido}
                    onChange={(e) => setNombrePartido(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              {/* Small helper text kept subtle */}
              <div style={{
                fontSize: 13,
                color: 'rgba(255,255,255,0.7)',
                textAlign: 'center',
                marginTop: 8,
                fontFamily: "'Inter', sans-serif",
              }}>
                La imagen es opcional. El nombre es obligatorio.
              </div>
            </div>

            {/* Selector de modalidad */}
            <div style={{ width: '100%', marginBottom: '2rem', marginTop: '0.3rem' }}>
              <label style={{ fontWeight: 500, color: '#fff', marginBottom: 12, display: 'block', fontFamily: "'Inter', sans-serif" }}>
                Modalidad
              </label>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                marginBottom: 12,
                width: '100%',
              }}>
                {['F5', 'F6', 'F7', 'F8', 'F9', 'F11'].map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => setModalidad(tipo)}
                    style={{
                      padding: '12px 8px',
                      fontSize: '16px',
                      fontWeight: modalidad === tipo ? '700' : '500',
                      fontFamily: "'Inter', sans-serif",
                      border: modalidad === tipo ? '2px solid transparent' : '1.5px solid rgba(255,255,255,0.2)',
                      borderRadius: '12px',
                      background: modalidad === tipo ? 'var(--btn-primary)' : 'rgba(255,255,255,0.05)',
                      color: '#fff',
                      backdropFilter: 'blur(8px)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      minHeight: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {tipo.replace('F', 'F')}
                  </button>
                ))}
              </div>
              <div style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>
                Cupo máximo: <b>{cupo} jugadores</b>
              </div>
            </div>
            {/* Selector de tipo de partido */}
            <div style={{ width: '100%', marginBottom: '3rem', marginTop: '0.3rem' }}>
              <label style={{ fontWeight: 500, color: '#fff', marginBottom: 12, display: 'block', fontFamily: "'Inter', sans-serif" }}>
                Tipo de partido
              </label>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                marginBottom: 12,
                width: '100%',
              }}>
                {['Masculino', 'Femenino', 'Mixto'].map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => setTipoPartido(tipo)}
                    style={{
                      padding: '12px 8px',
                      fontSize: '16px',
                      fontWeight: tipoPartido === tipo ? '700' : '500',
                      fontFamily: "'Inter', sans-serif",
                      border: tipoPartido === tipo ? '2px solid transparent' : '1.5px solid rgba(255,255,255,0.2)',
                      borderRadius: '12px',
                      background: tipoPartido === tipo ? 'var(--btn-primary)' : 'rgba(255,255,255,0.05)',
                      color: '#fff',
                      backdropFilter: 'blur(8px)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      minHeight: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {tipo}
                  </button>
                ))}
              </div>
            </div>
            <button
              className={CONFIRM_BTN_CLASS}
              disabled={!nombrePartido.trim()}
              style={{ opacity: nombrePartido.trim() ? 1 : 0.4, marginBottom: 12 }}
              onClick={editMode ? saveAndReturn : nextStep}
            >
              {editMode ? 'GUARDAR' : 'CONTINUAR'}
            </button>
            {editMode && (
              <button
                className={CONFIRM_BTN_CLASS}
                style={{ background: 'rgba(255,255,255,0.1)', borderColor: '#fff', color: '#fff' }}
                onClick={saveAndReturn}
              >
                CANCELAR
              </button>
            )}
          </div>

          {/* Overlay modal for ListaPartidosFrecuentes */}
          {showFrecuentes && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.6)',
                zIndex: 3000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
              onClick={() => setShowFrecuentes(false)}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 520,
                  maxHeight: '90vh',
                  background: '#1a1a2e',
                  borderRadius: 12,
                  overflow: 'auto',
                  boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <ListaPartidosFrecuentes
                  onEntrar={(p) => handleSelectFrecuente(p)}
                  onVolver={() => setShowFrecuentes(false)}
                  onEditar={(p) => handleEditarFrecuenteFromList(p)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ------ Paso 2: FECHA/HORA ------
  if (step === STEPS.WHEN) {
    return (
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden pt-[110px]">
        <PageTitle title="NUEVO PARTIDO" onBack={onVolver}>NUEVO PARTIDO</PageTitle>
        <div className="w-full flex flex-col items-center pb-10">
          <div className="w-full max-w-[440px] px-4">
            <div style={STEP_TITLE_STYLE}>
              Seleccioná la fecha y hora del partido
            </div>
            <input
              className={INPUT_MODERN_CLASS}
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              style={{ marginBottom: 22, width: '100%' }}
            />
            <input
              className={INPUT_MODERN_CLASS}
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              style={{ marginBottom: 22, width: '100%', height: 55 }}
            />
            <button
              className={CONFIRM_BTN_CLASS}
              disabled={!fecha || !hora}
              style={{ opacity: (fecha && hora) ? 1 : 0.4, marginBottom: 12 }}
              onClick={() => {
                if (isDateInPast(fecha)) {
                  toast.error('No se puede crear un partido anterior a hoy');
                  return;
                }
                editMode ? saveAndReturn() : nextStep();
              }}
            >
              {editMode ? 'GUARDAR' : 'CONTINUAR'}
            </button>
            <button
              className={CONFIRM_BTN_CLASS}
              style={{ background: 'rgba(255,255,255,0.1)', borderColor: '#fff', color: '#fff' }}
              onClick={editMode ? saveAndReturn : prevStep}
            >
              {editMode ? 'CANCELAR' : 'VOLVER ATRÁS'}
            </button>
          </div>
        </div>
      </div >
    );
  }

  // ------ Paso 3: SEDE ------
  if (step === STEPS.WHERE) {
    return (
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden pt-[110px]">
        <PageTitle title="NUEVO PARTIDO" onBack={onVolver}>NUEVO PARTIDO</PageTitle>
        <div className="w-full flex flex-col items-center pb-10">
          <div className="w-full max-w-[440px] px-4">
            <div style={STEP_TITLE_STYLE}>
              Ingresá la dirección o nombre del lugar
            </div>
            <AutocompleteSede
              value={sede}
              onSelect={(info) => {
                setSede(info.description);
                setSedeInfo(info);
              }}
            />

            {/* Optional: valor de la cancha por persona */}
            <div style={{ width: '100%', marginTop: 12, marginBottom: 12 }}>
              <label style={{ fontWeight: 500, color: '#fff', marginBottom: 8, display: 'block', fontFamily: "'Inter', sans-serif" }}>
                Valor de la cancha (por persona) — opcional
              </label>
              <input
                className={INPUT_MODERN_CLASS}
                type="number"
                placeholder="Ej: 300"
                value={valorCancha}
                onChange={(e) => setValorCancha(e.target.value)}
                style={{ marginBottom: 6 }}
                min="0"
              />
            </div>
            <button
              className={CONFIRM_BTN_CLASS}
              disabled={!sede}
              style={{ opacity: sede ? 1 : 0.4, marginBottom: 12 }}
              onClick={editMode ? saveAndReturn : nextStep}
            >
              {editMode ? 'GUARDAR' : 'CONTINUAR'}
            </button>
            <button
              className={CONFIRM_BTN_CLASS}
              style={{ background: 'rgba(255,255,255,0.1)', borderColor: '#fff', color: '#fff' }}
              onClick={editMode ? saveAndReturn : prevStep}
            >
              {editMode ? 'CANCELAR' : 'VOLVER ATRÁS'}
            </button>
          </div>
        </div>
      </div >
    );
  }

  // ------ Paso 4: CONFIRMAR ------
  if (step === STEPS.CONFIRM) {
    return (
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden pt-[110px]">
        <PageTitle title="NUEVO PARTIDO" onBack={onVolver}>NUEVO PARTIDO</PageTitle>
        <div className="w-full flex flex-col items-center pb-10">
          <div className="w-full max-w-[440px] px-4">
            <div style={{ marginTop: '0.4rem' }}></div>
            {fotoPreview && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
                <img
                  src={fotoPreview}
                  alt="foto partido"
                  style={{
                    width: 120,
                    height: 120,
                    objectFit: 'cover',
                    borderRadius: 12,
                    border: '2px solid rgba(255,255,255,0.3)',
                  }}
                />
              </div>
            )}
            <ul className="bg-transparent border-none shadow-none p-0 mt-[10px] mb-0 list-none">
              <li className={CONFIRM_ITEM_CLASS}>
                <span className="font-semibold text-base text-white/90">Nombre:</span>
                <span className="font-normal text-base text-white flex-1 text-center mx-3">{nombrePartido}</span>
                <button className="bg-white/20 border border-white/40 text-white px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-all font-oswald hover:bg-white/30 hover:border-white/60" onClick={() => editField(STEPS.NAME)}>EDITAR</button>
              </li>
              <li className={CONFIRM_ITEM_CLASS}>
                <span className="font-semibold text-base text-white/90">Valor cancha:</span>
                <span className="font-normal text-base text-white flex-1 text-center mx-3">{(valorCancha !== undefined && valorCancha !== null && String(valorCancha).trim() !== '') ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(String(valorCancha).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'))) : 'Sin precio'}</span>
                <button className="bg-white/20 border border-white/40 text-white px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-all font-oswald hover:bg-white/30 hover:border-white/60" onClick={() => editField(STEPS.WHERE)}>EDITAR</button>
              </li>
              <li className={CONFIRM_ITEM_CLASS}>
                <span className="font-semibold text-base text-white/90">Modalidad:</span>
                <span className="font-normal text-base text-white flex-1 text-center mx-3">{modalidad.replace('F', 'Fútbol ')} ({cupo} jugadores)</span>
                <button className="bg-white/20 border border-white/40 text-white px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-all font-oswald hover:bg-white/30 hover:border-white/60" onClick={() => editField(STEPS.NAME)}>EDITAR</button>
              </li>
              <li className={CONFIRM_ITEM_CLASS}>
                <span className="font-semibold text-base text-white/90">Tipo:</span>
                <span className="font-normal text-base text-white flex-1 text-center mx-3">{tipoPartido}</span>
                <button className="bg-white/20 border border-white/40 text-white px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-all font-oswald hover:bg-white/30 hover:border-white/60" onClick={() => editField(STEPS.NAME)}>EDITAR</button>
              </li>
              <li className={CONFIRM_ITEM_CLASS}>
                <span className="font-semibold text-base text-white/90">Fecha:</span>
                <span className="font-normal text-base text-white flex-1 text-center mx-3">{formatLocalDateShort(fecha)}</span>
                <button className="bg-white/20 border border-white/40 text-white px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-all font-oswald hover:bg-white/30 hover:border-white/60" onClick={() => editField(STEPS.WHEN)}>EDITAR</button>
              </li>
              <li className={CONFIRM_ITEM_CLASS}>
                <span className="font-semibold text-base text-white/90">Hora:</span>
                <span className="font-normal text-base text-white flex-1 text-center mx-3">{hora}</span>
                <button className="bg-white/20 border border-white/40 text-white px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-all font-oswald hover:bg-white/30 hover:border-white/60" onClick={() => editField(STEPS.WHEN)}>EDITAR</button>
              </li>
              <li className={CONFIRM_ITEM_CLASS}>
                <span className="font-semibold text-base text-white/90">Sede:</span>
                <span className="font-normal text-base text-white flex-1 text-center mx-3" style={{ fontSize: 16, textAlign: 'right' }}>
                  {sede.length > 30 ? sede.substring(0, 30) + '...' : sede}
                </span>
                <button className="bg-white/20 border border-white/40 text-white px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-all font-sans hover:bg-white/30 hover:border-white/60" onClick={() => editField(STEPS.WHERE)}>EDITAR</button>
              </li>
            </ul>

            {/* Toggle: Guardar como partido frecuente (placed just above main action) */}
            <div className="bg-white/8 border border-white/15 rounded-lg p-3 mb-2" style={{ marginTop: 14, marginBottom: 12 }}>
              <div className="save-frequent-block" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="flex items-center gap-2 cursor-pointer select-none" aria-label="Guardar como partido frecuente">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={saveAsFrequent}
                    disabled={loading}
                    onChange={(e) => setSaveAsFrequent(e.target.checked)}
                  />
                  <span
                    className="w-11 h-[26px] bg-white/10 rounded-full relative transition-all duration-150 shadow-inner flex-none peer-checked:bg-primary peer-disabled:opacity-45 peer-disabled:cursor-not-allowed after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-all after:duration-150 after:ease-[cubic-bezier(.2,.9,.3,1)] after:shadow-md peer-checked:after:translate-x-[18px]"
                    aria-hidden="true"
                  />
                  <span className="inline-block ml-3 text-white font-bold font-sans peer-disabled:opacity-45 peer-disabled:cursor-not-allowed">Guardar como partido frecuente</span>
                </label>
                <div className="pf-switch-note" style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginLeft: 40 }}>
                  Guarda lugar, hora y precio para reutilizarlo luego. (fecha opcional)
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className={CONFIRM_BTN_CLASS} onClick={handleSubmit} disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
                {loading ? 'CREANDO…' : 'CREAR PARTIDO'}
              </button>
            </div>
          </div>
        </div>
      </div >
    );
  }

  return null;
}
