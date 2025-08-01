import React, { useState } from 'react';
import AutocompleteSede from './AutocompleteSede';
import { crearPartidoFrecuente, crearPartidoDesdeFrec, crearPartido, supabase } from './supabase';

import PageTitle from './components/PageTitle';

import './FormularioNuevoPartidoFlow.css';

const STEPS = {
  NAME: 1,
  WHEN: 2,
  WHERE: 3,
  CONFIRM: 4,
};

export default function FormularioNuevoPartidoFlow({ onConfirmar, onVolver }) {
  const [step, setStep] = useState(STEPS.NAME);
  const [nombrePartido, setNombrePartido] = useState('');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [sede, setSede] = useState('');
  const [sedeInfo, setSedeInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [_animation, setAnimation] = useState('slide-in');
  const [editMode, setEditMode] = useState(false);

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
    setTimeout(() => {
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

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let partido;
      if (user) {
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
        const partidoFrecuente = await crearPartidoFrecuente({
          nombre: nombrePartido.trim(),
          sede: sede.trim(),
          hora: hora.trim(),
          jugadores_frecuentes: [],
          dia_semana: new Date(fecha).getDay(),
          habilitado: true,
          imagen_url: imagenUrl,
          tipo_partido: tipoPartido,
        });
        partido = await crearPartidoDesdeFrec(partidoFrecuente, fecha, modalidad, cupo);
        partido.from_frequent_match_id = partidoFrecuente.id;
        partido.tipo_partido = tipoPartido;
      } else {
        partido = await crearPartido({
          nombre: nombrePartido.trim(), // Pasar el nombre como parámetro
          fecha,
          hora: hora.trim(),
          sede: sede.trim(),
          sedeMaps: sedeInfo?.place_id || '',
          modalidad,
          cupo_jugadores: cupo,
          falta_jugadores: false,
          tipo_partido: tipoPartido,
        });
      }
      if (!partido) {
        setError('No se pudo crear el partido');
        return;
      }
      await onConfirmar(partido);
      // Partido creado correctamente
    } catch (err) {
      setError(err.message || 'Error al procesar la solicitud');
    } finally {
      setLoading(false);
    }
  };

  // --- Todas las vistas van sobre el fondo sin wrappers adicionales ---
  const mainStyles = {
    minHeight: '100vh',
    width: '100vw',
    background: 'linear-gradient(180deg, #202020 0%, #20.-.2020 100%)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '0',
    paddingBottom: '2.5rem',
  };

  const innerStyles = {
    width: '100%',
    maxWidth: 440,
    margin: '0 auto',
    padding: '0 1rem',
    paddingBottom: '2.5rem',
  };

  // ------ Paso 1: NOMBRE ------
  if (step === STEPS.NAME) {
    return (
      <div style={mainStyles}>
        <PageTitle onBack={onVolver}>NUEVO PARTIDO</PageTitle>
        <div style={innerStyles}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1rem', marginTop: '5.5rem' }}>
            <div
              className="voting-photo-box"
              onClick={() => document.getElementById('partido-foto-input').click()}
              style={{
                cursor: 'pointer', width: 112, height: 112,
                borderRadius: 12, border: '2px dashed #fff4',
                background: 'rgba(130,120,255,0.05)',
                overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={fotoPreview ? 'Cambiar foto' : 'Agregar foto opcional'}
            >
              {fotoPreview ? (
                <img src={fotoPreview} alt="foto partido"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span className="photo-plus" style={{ fontSize: 48, color: '#fff7' }}>+</span>
              )}
              <input
                id="partido-foto-input"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFile}
              />
            </div>
            <div style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.7)',
              textAlign: 'center',
              marginTop: 11,
              fontFamily: "'Oswald', Arial, sans-serif",
            }}>
              Agregá una imagen para el partido (opcional)
            </div>
          </div>
          <div style={{ width: '100%', marginBottom: '1.2rem', marginTop: '0.3rem' }}>
            <label style={{ fontWeight: 500, color: '#fff', marginBottom: 12, marginLeft: 2, display: 'block', fontFamily: "'Oswald', Arial, sans-serif" }}>
              Ingresá un nombre para el partido
            </label>
            <input
              className="input-modern"
              type="text"
              placeholder="Ej: Partido del Viernes"
              value={nombrePartido}
              onChange={(e) => setNombrePartido(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
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
      </div>
    );
  }

  // ------ Paso 2: FECHA/HORA ------
  if (step === STEPS.WHEN) {
    return (
      <div style={mainStyles}>
        <PageTitle onBack={onVolver}>NUEVO PARTIDO</PageTitle>
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
        <PageTitle onBack={onVolver}>NUEVO PARTIDO</PageTitle>
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
        <PageTitle onBack={onVolver}>NUEVO PARTIDO</PageTitle>
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
              <span className="confirmation-item-score">{new Date(fecha).toLocaleDateString()}</span>
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
          {error && (
            <div style={{
              color: '#ff5555',
              padding: '10px',
              marginBottom: '15px',
              fontSize: '16px',
              textAlign: 'center',
              background: 'rgba(255,0,0,0.1)',
              borderRadius: '8px',
            }}>
              {error}
            </div>
          )}
          <button
            className="voting-confirm-btn"
            style={{ marginBottom: 12 }}
            disabled={loading}
            onClick={handleSubmit}
          >
            {loading ? 'CREANDO...' : 'CREAR PARTIDO'}
          </button>
          <button
            className="voting-confirm-btn"
            style={{
              background: 'rgba(255,255,255,0.1)',
              borderColor: '#fff',
              color: '#fff',
              fontSize: '1.2rem',
              height: '54px',
            }}
            onClick={prevStep}
            disabled={loading}
          >
            VOLVER ATRÁS
          </button>
        </div>
      </div>
    );
  }

  return null;
}
