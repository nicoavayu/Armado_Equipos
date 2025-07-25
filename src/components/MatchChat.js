import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import './MatchChat.css';

export default function MatchChat({ partidoId, isOpen, onClose }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [userName, setUserName] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [showNameInput, setShowNameInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (isOpen && partidoId) {
      fetchMessages();
      markAsRead();
      const interval = setInterval(fetchMessages, 5000);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, partidoId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('mensajes_partido')
        .select('*')
        .eq('partido_id', partidoId)
        .order('timestamp', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const markAsRead = () => {
    localStorage.setItem(`chat_read_${partidoId}`, Date.now().toString());
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getUserName = () => {
    const stored = localStorage.getItem(`chat_user_${partidoId}`);
    if (stored) return stored;
    
    const name = prompt('Ingresá tu nombre para el chat:');
    if (name?.trim()) {
      localStorage.setItem(`chat_user_${partidoId}`, name.trim());
      return name.trim();
    }
    return null;
  };

  // Referencia al input para poder enfocar después de enviar
  const inputRef = useRef(null);

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    let author = userName;
    if (!author) {
      author = getUserName();
      if (!author) return;
      setUserName(author);
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('mensajes_partido')
        .insert([{
          partido_id: partidoId,
          autor: author,
          mensaje: newMessage.trim(),
        }]);

      if (error) throw error;

      setNewMessage('');
      fetchMessages();
      
      // Devolver el foco al campo de texto
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
    } catch (error) {
      toast.error('Error enviando mensaje: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="chat-overlay">
      <div className="chat-modal">
        <div className="chat-header">
          <h3>Chat del Partido</h3>
          <button className="chat-close" onClick={onClose}>×</button>
        </div>
        
        <div className="chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className="chat-message">
              <div className="message-header">
                <span className="message-author">{msg.autor}</span>
                <span className="message-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="message-text">{msg.mensaje}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-container">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Escribí tu mensaje..."
            className="chat-input"
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            disabled={loading}
            ref={inputRef}
            autoFocus
          />
          <button
            onClick={handleSendMessage}
            className="chat-send-btn"
            disabled={loading || !newMessage.trim()}
          >
            {loading ? '...' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}