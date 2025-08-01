// EJEMPLO BÁSICO DE RENDER DE AMIGOS PARA TESTING
// Copiar este código en AmigosView.js temporalmente para probar

const AmigosViewSimple = () => {
  const [amigos, setAmigos] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);

  useEffect(() => {
    const testAmigos = async () => {
      console.log('[DEBUG] Testing getAmigos function directly...');
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[DEBUG] No user found');
        return;
      }
      
      console.log('[DEBUG] Current user:', user.id);
      setCurrentUserId(user.id);
      
      // Test getAmigos function directly
      try {
        const { getAmigos } = await import('./supabase');
        const friends = await getAmigos(user.id);
        
        console.log('[DEBUG] getAmigos result:', {
          count: friends?.length || 0,
          friends: friends,
        });
        
        setAmigos(friends || []);
      } catch (error) {
        console.error('[DEBUG] Error testing getAmigos:', error);
      }
    };
    
    testAmigos();
  }, []);

  return (
    <div style={{ padding: '20px' }}>
      <h2>DEBUG: Amigos Test</h2>
      <p>Current User: {currentUserId}</p>
      <p>Friends Count: {amigos.length}</p>
      
      {amigos.length > 0 ? (
        <div>
          <h3>Friends List:</h3>
          {amigos.map((amigo, index) => (
            <div key={amigo.id || index} style={{ 
              border: '1px solid #ccc', 
              padding: '10px', 
              margin: '5px 0',
              borderRadius: '5px',
            }}>
              <strong>ID:</strong> {amigo.id}<br/>
              <strong>Nombre:</strong> {amigo.nombre}<br/>
              <strong>Email:</strong> {amigo.email}<br/>
              <strong>Avatar:</strong> {amigo.avatar_url ? 'Sí' : 'No'}<br/>
              <img 
                src={amigo.avatar_url || '/profile.svg'} 
                alt={amigo.nombre}
                style={{ width: '40px', height: '40px', borderRadius: '50%' }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: '#666' }}>
          No friends found or still loading...
        </div>
      )}
    </div>
  );
};

export default AmigosViewSimple;