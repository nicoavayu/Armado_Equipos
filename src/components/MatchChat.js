import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { useAuth } from './AuthProvider';
import { useKeyboard } from '../hooks/useKeyboard';
import { Capacitor } from '@capacitor/core';
import './MatchChat.css';

export default function MatchChat({ partidoId, isOpen, onClose }) {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { keyboardHeight, isKeyboardOpen } = useKeyboard();
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (isOpen && partidoId) {
      fetchMessages();
      markAsRead();
      // Interval disabled to prevent ERR_INSUFFICIENT_RESOURCES
      // const interval = setInterval(fetchMessages, 5000);
      // return () => clearInterval(interval);
    }
  }, [isOpen, partidoId]);

  useEffect(() => {
    if (isKeyboardOpen) {
      // Scroll to bottom when keyboard appears
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    }
  }, [isKeyboardOpen]);

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

  const getUserInfo = () => {
    // Siempre usar datos del usuario logueado
    if (user && profile) {
      return {
        name: profile.nombre || user.email?.split('@')[0] || 'Usuario',
        userId: user.id,
      };
    }
    return null;
  };

  // Referencia al input para poder enfocar después de enviar
  const inputRef = useRef(null);

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    const userInfo = getUserInfo();
    if (!userInfo) {
      toast.error('Error: Usuario no identificado');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('mensajes_partido')
        .insert([{
          partido_id: partidoId,
          autor: userInfo.name,
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
    <div className="chat-overlay" style={{
      paddingBottom: keyboardHeight > 0 ? `${keyboardHeight}px` : undefined
    }}>
      <div className="chat-modal" style={{
        marginBottom: keyboardHeight > 0 ? 0 : undefined,
        maxHeight: keyboardHeight > 0 
          ? `calc(100vh - ${keyboardHeight + 40}px)` 
          : undefined
      }}>
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