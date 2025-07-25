// src/components/PlayerRegisterSupabase.js
import React, { useState } from 'react';
import { supabase } from '../supabase';

export default function PlayerRegisterSupabase({ onSuccess }) {
  const [nombre, setNombre] = useState('');
  const [apodo, setApodo] = useState('');
  const [file, setFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  // Previsualiza la foto antes de subir
  const handleFile = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setPhotoPreview(URL.createObjectURL(e.target.files[0]));
    }
  };

  // Registro y subida a Supabase
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) return alert('Poné el nombre');
    setLoading(true);

    let foto_url = '';
    // Si hay foto, sube a Storage
    if (file) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${nombre.trim().replace(/\s/g, '_')}_${Date.now()}.${fileExt}`;
      const { data, error } = await supabase.storage
        .from('jugadores-fotos')
        .upload(fileName, file);
      if (error) {
        alert('Error subiendo foto: ' + error.message);
        setLoading(false);
        return;
      }
      // Link público
      const { data: publicUrlData } = supabase.storage
        .from('jugadores-fotos')
        .getPublicUrl(fileName);
      foto_url = publicUrlData.publicUrl;
    }

    // Guarda jugador en tabla
    const { data, error } = await supabase
      .from('jugadores')
      .insert([{ nombre, apodo, foto_url }])
      .select()
      .single();

    setLoading(false);

    if (error) {
      alert('Error guardando jugador: ' + error.message);
      return;
    }

    setNombre('');
    setApodo('');
    setFile(null);
    setPhotoPreview(null);
    if (onSuccess) onSuccess(data);
    alert('¡Jugador registrado!');
  };

  return (
    <form onSubmit={handleSubmit} style={{
      background: '#fff', borderRadius: 16, padding: 18, boxShadow: '0 2px 18px 0 rgba(34,40,80,0.10)', maxWidth: 350, margin: '20px auto',
    }}>
      <h2>Registrar jugador</h2>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', marginBottom: 7 }}>Foto:</label>
        <input type="file" accept="image/*" onChange={handleFile} />
        {photoPreview && <img src={photoPreview} alt="preview" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: '50%', marginTop: 7 }} />}
      </div>
      <div>
        <label>Nombre:</label>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ width: '100%', marginBottom: 9 }} />
      </div>
      <div>
        <label>Apodo:</label>
        <input value={apodo} onChange={(e) => setApodo(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
      </div>
      <button disabled={loading} type="submit" style={{
        width: '100%', background: 'linear-gradient(90deg,#DE1C49 0%,#0EA9C6 100%)', color: '#fff', fontWeight: 700, border: 'none', borderRadius: 18, padding: '10px 0', fontSize: '1.1em', cursor: 'pointer',
      }}>
        {loading ? 'Guardando...' : 'Registrar'}
      </button>
    </form>
  );
}
