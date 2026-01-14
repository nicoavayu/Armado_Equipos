import React, { useState, useEffect } from 'react';
import AutocompleteSede from './AutocompleteSede';
import { crearPartidoDesdeFrec, crearPartido, supabase } from './supabase';
import { insertPartidoFrecuenteFromPartido } from './services/db/frequentMatches';
import { weekdayFromYMD, formatLocalDateShort } from './utils/dateLocal';
import { useTimeout } from './hooks/useTimeout';

import PageTitle from './components/PageTitle';
import ListaPartidosFrecuentes from './ListaPartidosFrecuentes';
import { toast } from 'react-toastify';

import './FormularioNuevoPartidoFlow.css';

const STEPS = {
  NAME: 1,
  WHEN: 2,
  WHERE: 3,
  CONFIRM: 4,
};

export default function FormularioNuevoPartidoFlow({ onConfirmar, onVolver }) {
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
  const [error, setError] = useState('');
  const [_animation, setAnimation] = useState('slide-in');
  const [editMode, setEditMode] = useState(false);

  const [showFrecuentes, setShowFrecuentes] = useState(false);
  // New: toggle to save created party as frequent
  const [saveAsFrequent, setSaveAsFrequent] = useState(false);

  // Ensure toggle is reset when the flow component mounts (covers modal open case)
  React.useEffect(() => {
    setSaveAsFrequent(false);
  }, []);

  // Also reset the toggle whenever the flow returns to the first step
  React.useEffect(() => {
    if (step === STEPS.NAME) {
      setSaveAsFrequent(false);
    }
  }, [step]);

  const modalidadToCupo = React.useMemo(() => ({ 
    F5: 10, F6: 12, F7: 14, F8: 16, F9: 18, F11: 22, 
  }), []);
  const [modalidad, setModalidad] = useState('F5');
  const [cupo, setCupo] = useState(modalidadToCupo['F5']);
  const [tipoPartido, setTipoPartido] = useState('Masculino');
  React.useEffect(() => { setCupo(modalidadToCupo[modalidad]); }, [modalidad, modalidadToCupo]);

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
      toast.success("Plantilla aplicada ✅");
      setShowFrecuentes(false);
      setStep(STEPS.NAME);
    }
  };

  const handleEditarFrecuenteFromList = (p) => {
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
      const { data: { user } } = await supabase.auth.getUser();
      let partido;

      // Upload image if present (unchanged)
      let imagenUrl = null;
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
          imagenUrl = data?.publicUrl;
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
  const mainStyles = /** @type {any} */ ({
    minHeight: '100vh',
    width: '100vw',
    background: 'linear-gradient(135deg, #24c6dc 10%, #514a9d 100%)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '0',
    paddingBottom: '2.5rem',
  });

  const innerStyles = /** @type {any} */ ({
    width: '100%',
    maxWidth: 440,
    margin: '0 auto',
    padding: '0 1rem',
    paddingBottom: '2.5rem',
  });

  // ------ Paso 1: NOMBRE ------
  if (step === STEPS.NAME) {
    return (
      <div style={mainStyles}>
        <PageTitle title="NUEVO PARTIDO" onBack={onVolver}>NUEVO PARTIDO</PageTitle>
        <div style={innerStyles}>

          {/* Secondary button to open frequent matches list */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setShowFrecuentes(true)}
              style={{
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.06)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: "'Oswald', Arial, sans-serif",
                fontWeight: 700,
              }}
            >
              PARTIDOS FRECUENTES
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1rem', marginTop: '5.5rem' }}>
            {/*
              // BEFORE: large image upload area
              // (was a big dashed box 112x112 with optional preview and large "+" placeholder)

              // AFTER: compact inline image + name field
              // Thumbnail (48-64px) left, text input right. Image optional and clickable to open file selector.
            */}

            {/* Label moved ABOVE the inline block so thumbnail aligns with the input */}
            <label className="name-image-label" style={{ width: '100%', color: '#fff', fontWeight: 500, marginBottom: 8, fontFamily: "'Oswald', Arial, sans-serif" }}>
              Nombre del partido
            </label>

            <div className="name-image-block">
              <div
                className="match-thumbnail"
                role="button"
                aria-label={fotoPreview ? 'Cambiar imagen del partido' : 'Agregar imagen opcional'}
                onClick={() => document.getElementById('partido-foto-input').click()}
                title={fotoPreview ? 'Cambiar imagen' : 'Agregar imagen opcional'}
              >
                {fotoPreview ? (
                  <img src={fotoPreview} alt="foto partido" />
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
                  className="input-modern input-modern--grow"
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
              fontFamily: "'Oswald', Arial, sans-serif",
            }}>
              La imagen es opcional. El nombre es obligatorio.
            </div>
          </div>

          {/* Selector de modalidad */}
          <div style={{ width: '100%', marginBottom: '2rem', marginTop: '0.3rem' }}>
            <label style={{ fontWeight: 500, color: '#fff', marginBottom: 12, display: 'block', fontFamily: "'Oswald', Arial, sans-serif" }}>
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
                    fontFamily: "'Oswald', Arial, sans-serif",
                    border: modalidad === tipo ? '2px solid #0864b2' : '1.5px solid #ffffffff',
                    borderRadius: '6px',
                    background: modalidad === tipo ? '#0864b2' : 'rgba(255,255,255,0.9)',
                    color: modalidad === tipo ? '#fff' : '#333',
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
            <label style={{ fontWeight: 500, color: '#fff', marginBottom: 12, display: 'block', fontFamily: "'Oswald', Arial, sans-serif" }}>
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
                    fontFamily: "'Oswald', Arial, sans-serif",
                    border: tipoPartido === tipo ? '2px solid #0864b2' : '1.5px solid #ffffffff',
                    borderRadius: '6px',
                    background: tipoPartido === tipo ? '#0864b2' : 'rgba(255,255,255,0.9)',
                    color: tipoPartido === tipo ? '#fff' : '#333',
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
            className="voting-confirm-btn"
            disabled={!nombrePartido.trim()}
            style={{ opacity: nombrePartido.trim() ? 1 : 0.4, marginBottom: 12 }}
            onClick={editMode ? saveAndReturn : nextStep}
          >
            {editMode ? 'GUARDAR' : 'CONTINUAR'}
          </button>
          {editMode && (
            <button
              className="voting-confirm-btn"
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
    );
  }

  // ------ Paso 2: FECHA/HORA ------
  if (step === STEPS.WHEN) {
    return (
      <div style={mainStyles}>
        <PageTitle title="NUEVO PARTIDO" onBack={onVolver}>NUEVO PARTIDO</PageTitle>
        <div style={innerStyles}>
          <div style={{
            fontSize: 18,
            color: 'rgba(255,255,255)',
            textAlign: 'center',
            marginBottom: 24,
            marginTop: '5.2rem',
            fontFamily: "'Oswald', Arial, sans-serif",
          }}>
            Seleccioná la fecha y hora del partido
          </div>
          <input
            className="input-modern"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            style={{ marginBottom: 22, width: '100%' }}
          />
          <input
            className="input-modern"
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            style={{ marginBottom: 22, width: '100%', height: 55 }}
          />
          <button
            className="voting-confirm-btn"
            disabled={!fecha || !hora}
            style={{ opacity: (fecha && hora) ? 1 : 0.4, marginBottom: 12 }}
            onClick={editMode ? saveAndReturn : nextStep}
          >
            {editMode ? 'GUARDAR' : 'CONTINUAR'}
          </button>
          <button
            className="voting-confirm-btn"
            style={{ background: 'rgba(255,255,255,0.1)', borderColor: '#fff', color: '#fff' }}
            onClick={editMode ? saveAndReturn : prevStep}
          >
            {editMode ? 'CANCELAR' : 'VOLVER ATRÁS'}
          </button>
        </div>
      </div>
    );
  }

  // ------ Paso 3: SEDE ------
  if (step === STEPS.WHERE) {
    return (
      <div style={mainStyles}>
        <PageTitle title="NUEVO PARTIDO" onBack={onVolver}>NUEVO PARTIDO</PageTitle>
        <div style={innerStyles}>
          <div style={{
            fontSize: 18,
            color: 'rgba(255,255,255)',
            textAlign: 'center',
            marginBottom: 24,
            marginTop: '5.2rem',
            fontFamily: "'Oswald', Arial, sans-serif",
          }}>
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
            <label style={{ fontWeight: 500, color: '#fff', marginBottom: 8, display: 'block', fontFamily: "'Oswald', Arial, sans-serif" }}>
              Valor de la cancha (por persona) — opcional
            </label>
            <input
              className="input-modern"
              type="number"
              placeholder="Ej: 300"
              value={valorCancha}
              onChange={(e) => setValorCancha(e.target.value)}
              style={{ marginBottom: 6 }}
              min="0"
            />
          </div>
          <button
            className="voting-confirm-btn"
            disabled={!sede}
            style={{ opacity: sede ? 1 : 0.4, marginBottom: 12 }}
            onClick={editMode ? saveAndReturn : nextStep}
          >
            {editMode ? 'GUARDAR' : 'CONTINUAR'}
          </button>
          <button
            className="voting-confirm-btn"
            style={{ background: 'rgba(255,255,255,0.1)', borderColor: '#fff', color: '#fff' }}
            onClick={editMode ? saveAndReturn : prevStep}
          >
            {editMode ? 'CANCELAR' : 'VOLVER ATRÁS'}
          </button>
        </div>
      </div>
    );
  }

  // ------ Paso 4: CONFIRMAR ------
  if (step === STEPS.CONFIRM) {
    return (
      <div style={mainStyles}>
        <PageTitle title="NUEVO PARTIDO" onBack={onVolver}>NUEVO PARTIDO</PageTitle>
        <div style={innerStyles}>
          <div style={{ marginTop: '8.2rem' }}></div>
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
          <ul className="confirmation-list">
            <li className="confirmation-item">
              <span className="confirmation-item-name">Nombre:</span>
              <span className="confirmation-item-score">{nombrePartido}</span>
              <button className="confirmation-item-edit-btn" onClick={() => editField(STEPS.NAME)}>EDITAR</button>
            </li>
            <li className="confirmation-item">
              <span className="confirmation-item-name">Valor cancha:</span>
              <span className="confirmation-item-score">{(valorCancha !== undefined && valorCancha !== null && String(valorCancha).trim() !== '') ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(String(valorCancha).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'))) : 'Sin precio'}</span>
              <button className="confirmation-item-edit-btn" onClick={() => editField(STEPS.WHERE)}>EDITAR</button>
            </li>
            <li className="confirmation-item">
              <span className="confirmation-item-name">Modalidad:</span>
              <span className="confirmation-item-score">{modalidad.replace('F', 'Fútbol ')} ({cupo} jugadores)</span>
              <button className="confirmation-item-edit-btn" onClick={() => editField(STEPS.NAME)}>EDITAR</button>
            </li>
            <li className="confirmation-item">
              <span className="confirmation-item-name">Tipo:</span>
              <span className="confirmation-item-score">{tipoPartido}</span>
              <button className="confirmation-item-edit-btn" onClick={() => editField(STEPS.NAME)}>EDITAR</button>
            </li>
            <li className="confirmation-item">
              <span className="confirmation-item-name">Fecha:</span>
              <span className="confirmation-item-score">{formatLocalDateShort(fecha)}</span>
              <button className="confirmation-item-edit-btn" onClick={() => editField(STEPS.WHEN)}>EDITAR</button>
            </li>
            <li className="confirmation-item">
              <span className="confirmation-item-name">Hora:</span>
              <span className="confirmation-item-score">{hora}</span>
              <button className="confirmation-item-edit-btn" onClick={() => editField(STEPS.WHEN)}>EDITAR</button>
            </li>
            <li className="confirmation-item">
              <span className="confirmation-item-name">Sede:</span>
              <span className="confirmation-item-score" style={{ fontSize: 16, textAlign: 'right' }}>
                {sede.length > 30 ? sede.substring(0, 30) + '...' : sede}
              </span>
              <button className="confirmation-item-edit-btn" onClick={() => editField(STEPS.WHERE)}>EDITAR</button>
            </li>
          </ul>

          {/* Toggle: Guardar como partido frecuente (placed just above main action) */}
          <div className="pf-save-frequent-container" style={{ marginTop: 14, marginBottom: 12 }}>
            <div className="save-frequent-block" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="pf-switch" aria-label="Guardar como partido frecuente">
                <input
                  type="checkbox"
                  className="pf-switch-input"
                  checked={saveAsFrequent}
                  disabled={loading}
                  onChange={(e) => setSaveAsFrequent(e.target.checked)}
                />
                <span className="pf-switch-slider" aria-hidden="true" />
                <span className="pf-switch-label" style={{ marginLeft: 12, color: '#fff', fontWeight: 700, fontFamily: "'Oswald', Arial, sans-serif" }}>Guardar como partido frecuente</span>
              </label>
              <div className="pf-switch-note" style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginLeft: 40 }}>
                Guarda lugar, hora y precio para reutilizarlo luego. (fecha opcional)
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="voting-confirm-btn" onClick={handleSubmit} disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
              {loading ? 'CREANDO…' : 'CREAR PARTIDO'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
