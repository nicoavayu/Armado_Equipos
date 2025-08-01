// RENDER MÍNIMO FUNCIONANDO DE AMIGOS
// Reemplaza la sección de friends en AmigosView.js con esto:

const AmigosRenderMinimo = ({ amigos, currentUserId }) => {
  console.log('[RENDER_MINIMO] Starting render with:', {
    amigosCount: amigos?.length || 0,
    amigosType: typeof amigos,
    isArray: Array.isArray(amigos),
    firstAmigo: amigos?.[0],
  });

  // Verificación de datos
  if (!Array.isArray(amigos)) {
    console.log('[RENDER_MINIMO] amigos is not an array:', amigos);
    return <div>Error: amigos no es un array</div>;
  }

  if (amigos.length === 0) {
    console.log('[RENDER_MINIMO] No friends found');
    return (
      <div className="amigos-empty">
        <p>No tienes amigos agregados todavía.</p>
        <p>DEBUG: Array length = {amigos.length}</p>
      </div>
    );
  }

  console.log('[RENDER_MINIMO] Rendering', amigos.length, 'friends');

  return (
    <div className="amigos-section">
      <h3>Mis Amigos ({amigos.length})</h3>
      <div className="amigos-list">
        {amigos.map((amigo, index) => {
          console.log(`[RENDER_MINIMO] Rendering friend ${index}:`, {
            id: amigo.id,
            profileName: amigo.profile?.nombre,
            profileId: amigo.profile?.id,
          });

          return (
            <div 
              key={amigo.profile?.id || amigo.id || index}
              style={{
                border: '1px solid #ddd',
                padding: '10px',
                margin: '5px',
                borderRadius: '5px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <img 
                src={amigo.profile?.avatar_url || '/profile.svg'}
                alt={amigo.profile?.nombre || 'Usuario'}
                style={{ width: '40px', height: '40px', borderRadius: '50%' }}
                onError={(e) => { e.target.src = '/profile.svg'; }}
              />
              <div>
                <strong>{amigo.profile?.nombre || 'Sin nombre'}</strong>
                <br />
                <small>{amigo.profile?.email || 'Sin email'}</small>
              </div>
              <button 
                onClick={() => console.log('Remove friend:', amigo.id)}
                style={{ marginLeft: 'auto', padding: '5px 10px' }}
              >
                Eliminar
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// USO EN AmigosView.js:
// Reemplaza la sección {/* Friends list section */} con:
/*
<AmigosRenderMinimo 
  amigos={amigos} 
  currentUserId={currentUserId} 
/>
*/