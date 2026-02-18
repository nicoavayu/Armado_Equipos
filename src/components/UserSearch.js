import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useAmigos } from '../hooks/useAmigos';
import { useAuth } from './AuthProvider';
import { notifyBlockingError } from 'utils/notifyBlockingError';

const UserSearch = ({ onClose }) => {
  const { user } = useAuth();
  const { sendFriendRequest, getRelationshipStatus } = useAmigos(user?.id);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [relationshipStatuses, setRelationshipStatuses] = useState({});

  // Search users by name or email
  const searchUsers = async (term) => {
    if (!term.trim() || term.length < 2) {
      setSearchResults([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, email, avatar_url, localidad')
        .or(`nombre.ilike.%${term}%,email.ilike.%${term}%`)
        .neq('id', user?.id) // Exclude current user
        .limit(10);

      if (error) throw error;

      setSearchResults(data || []);

      // Check relationship status for each user
      if (data && data.length > 0) {
        const statuses = {};
        for (const searchUser of data) {
          const status = await getRelationshipStatus(searchUser.id);
          statuses[searchUser.id] = status;
        }
        setRelationshipStatuses(statuses);
      }
    } catch (error) {
      console.error('Error searching users:', error);
      notifyBlockingError('Error al buscar usuarios');
    } finally {
      setLoading(false);
    }
  };

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchUsers(searchTerm);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  const handleSendFriendRequest = async (targetUserId) => {
    try {
      const result = await sendFriendRequest(targetUserId);
      if (result.success) {
        console.info('Solicitud de amistad enviada');
        // Update relationship status
        setRelationshipStatuses((prev) => ({
          ...prev,
          [targetUserId]: { id: result.data.id, status: 'pending' },
        }));
      } else {
        notifyBlockingError(result.message || 'Error al enviar solicitud');
      }
    } catch (error) {
      notifyBlockingError('Error al enviar solicitud');
    }
  };

  const getButtonText = (userId) => {
    const status = relationshipStatuses[userId];
    if (!status) return 'Enviar solicitud';

    switch (status.status) {
      case 'pending':
        return 'Solicitud pendiente';
      case 'accepted':
        return 'Ya son amigos';
      case 'rejected':
        return 'Solicitar amistad';
      default:
        return 'Enviar solicitud';
    }
  };

  const isButtonDisabled = (userId) => {
    const status = relationshipStatuses[userId];
    return status && ['pending', 'accepted'].includes(status.status);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]">
      <div className="bg-gradient-to-b from-[#62c1ff] to-[#b579f8] rounded-xl w-[90%] max-w-[500px] max-h-[80vh] overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <div className="flex justify-between items-center p-5 border-b border-white/20">
          <h3 className="m-0 text-white font-oswald text-xl">Buscar usuarios</h3>
          <button
            className="bg-none border-none text-white text-2xl cursor-pointer p-0 w-[30px] h-[30px] flex items-center justify-center rounded-full transition-colors duration-200 hover:bg-white/20"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="p-5">
          <input
            type="text"
            placeholder="Buscar por nombre o email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full p-[12px_16px] border border-white/30 rounded-lg bg-white/10 text-white text-base box-border placeholder:text-white/70 focus:outline-none focus:border-white/50 focus:bg-white/15"
            autoFocus
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto px-5 pb-5">
          {loading && (
            <div className="text-center text-white/70 p-5 italic">Buscando usuarios...</div>
          )}

          {!loading && searchTerm.length >= 2 && searchResults.length === 0 && (
            <div className="text-center text-white/70 p-5 italic">No se encontraron usuarios</div>
          )}

          {!loading && searchResults.map((searchUser) => (
            <div key={searchUser.id} className="flex items-center justify-between p-3 bg-white/10 rounded-lg mb-2 border border-white/10">
              <div className="flex items-center flex-1">
                <div className="w-10 h-10 rounded-full overflow-hidden mr-3 bg-white/20 flex items-center justify-center">
                  {searchUser.avatar_url ? (
                    <img src={searchUser.avatar_url} alt={searchUser.nombre} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-xl text-white/70">👤</div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-white font-semibold mb-[2px]">{searchUser.nombre}</div>
                  <div className="text-white/80 text-sm mb-[2px]">{searchUser.email}</div>
                  {searchUser.localidad && (
                    <div className="text-white/60 text-xs">{searchUser.localidad}</div>
                  )}
                </div>
              </div>
              <button
                className={`bg-[#4CAF50] text-white border-none p-[8px_16px] rounded-md cursor-pointer text-sm font-medium transition-all duration-200 whitespace-nowrap hover:not-disabled:bg-[#45a049] hover:not-disabled:-translate-y-[1px] ${isButtonDisabled(searchUser.id) ? 'bg-white/30 text-white/70 cursor-not-allowed hover:bg-white/30 hover:transform-none' : ''
                }`}
                onClick={() => handleSendFriendRequest(searchUser.id)}
                disabled={isButtonDisabled(searchUser.id)}
              >
                {getButtonText(searchUser.id)}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default UserSearch;