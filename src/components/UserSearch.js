import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useAmigos } from '../hooks/useAmigos';
import { useAuth } from './AuthProvider';
import { toast } from 'react-toastify';
import './UserSearch.css';

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
      toast.error('Error al buscar usuarios');
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
        toast.success('Solicitud de amistad enviada');
        // Update relationship status
        setRelationshipStatuses((prev) => ({
          ...prev,
          [targetUserId]: { id: result.data.id, status: 'pending' },
        }));
      } else {
        toast.error(result.message || 'Error al enviar solicitud');
      }
    } catch (error) {
      toast.error('Error al enviar solicitud');
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
        return 'Solicitud rechazada';
      default:
        return 'Enviar solicitud';
    }
  };

  const isButtonDisabled = (userId) => {
    const status = relationshipStatuses[userId];
    return status && ['pending', 'accepted'].includes(status.status);
  };

  return (
    <div className="user-search-overlay">
      <div className="user-search-modal">
        <div className="user-search-header">
          <h3>Buscar usuarios</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="search-input-container">
          <input
            type="text"
            placeholder="Buscar por nombre o email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
            autoFocus
          />
        </div>

        <div className="search-results">
          {loading && (
            <div className="loading-message">Buscando usuarios...</div>
          )}
          
          {!loading && searchTerm.length >= 2 && searchResults.length === 0 && (
            <div className="no-results">No se encontraron usuarios</div>
          )}
          
          {!loading && searchResults.map((searchUser) => (
            <div key={searchUser.id} className="user-result">
              <div className="user-info">
                <div className="user-avatar">
                  {searchUser.avatar_url ? (
                    <img src={searchUser.avatar_url} alt={searchUser.nombre} />
                  ) : (
                    <div className="avatar-placeholder">👤</div>
                  )}
                </div>
                <div className="user-details">
                  <div className="user-name">{searchUser.nombre}</div>
                  <div className="user-email">{searchUser.email}</div>
                  {searchUser.localidad && (
                    <div className="user-location">{searchUser.localidad}</div>
                  )}
                </div>
              </div>
              <button
                className={`friend-request-btn ${isButtonDisabled(searchUser.id) ? 'disabled' : ''}`}
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