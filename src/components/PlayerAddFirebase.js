import React, { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';

export default function PlayerAddFirebase({ onSuccess }) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [file, setFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleFile = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setPhotoPreview(URL.createObjectURL(e.target.files[0]));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return alert('Poné el nombre!');
    setLoading(true);
    let photoUrl = '';
    if (file) {
      // Subir foto a Firebase Storage
      const storageRef = ref(storage, `jugadores/${name}_${Date.now()}`);
      await uploadBytes(storageRef, file);
      photoUrl = await getDownloadURL(storageRef);
    }
    // Guardar datos en Firestore
    await addDoc(collection(db, 'jugadores'), {
      name,
      nickname,
      photoUrl,
    });
    setName('');
    setNickname('');
    setFile(null);
    setPhotoPreview(null);
    setLoading(false);
    if (onSuccess) onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} style={{
      background: '#fff', borderRadius: 16, padding: 18, boxShadow: '0 2px 18px 0 rgba(34,40,80,0.10)', maxWidth: 350, margin: '20px auto',
    }}>
      <h2>Agregar jugador</h2>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', marginBottom: 7 }}>Foto:</label>
        <input type="file" accept="image/*" onChange={handleFile} />
        {photoPreview && <img src={photoPreview} alt="preview" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: '50%', marginTop: 7 }} />}
      </div>
      <div>
        <label>Nombre:</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginBottom: 9 }} />
      </div>
      <div>
        <label>Apodo:</label>
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
      </div>
      <button disabled={loading} type="submit" style={{
        width: '100%', background: 'linear-gradient(90deg,#DE1C49 0%,#0EA9C6 100%)', color: '#fff', fontWeight: 700, border: 'none', borderRadius: 18, padding: '10px 0', fontSize: '1.1em', cursor: 'pointer',
      }}>
        {loading ? 'Guardando...' : 'Agregar jugador'}
      </button>
    </form>
  );
}
