// src/components/MatchChat.js
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { useAuth } from './AuthProvider';
import { useKeyboard } from '../hooks/useKeyboard';
// Eliminado import de Capacitor si no se usa, pero lo mantengo por si acaso
import { Capacitor } from '@capacitor/core';
// import './MatchChat.css'; // REMOVED

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
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] p-5 pb-24 sm:p-[15px] sm:pt-[max(15px,env(safe-area-inset-top,15px))] sm:items-start sm:h-[100dvh]"
      style={{
        paddingBottom: keyboardHeight > 0 ? `${keyboardHeight}px` : undefined,
      }}
    >
      <div
        className="bg-slate-900 border-2 border-white/20 w-full max-w-[500px] h-[75vh] max-h-[600px] rounded-xl flex flex-col shadow-[0_30px_120px_rgba(0,0,0,0.55)] mb-5 min-h-[300px] sm:mt-4 sm:h-auto sm:max-h-[calc(100vh-30px)] sm:mb-0 sm:overflow-hidden"
        style={{
          marginBottom: keyboardHeight > 0 ? 0 : undefined,
          maxHeight: keyboardHeight > 0
            ? `calc(100vh - ${keyboardHeight + 40}px)`
            : undefined,
        }}
      >
        <div className="flex flex-col px-5 py-3 border-b border-white/10 bg-slate-800 rounded-t-xl sm:px-4 sm:py-2.5 sm:shrink-0">
          <div className="flex justify-between items-center">
            <h3 className="m-0 font-bebas text-xl font-bold text-white tracking-wide uppercase">Chat del Partido</h3>
            <button
              className="bg-transparent border-none text-white/70 text-2xl cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white"
              onClick={onClose}
              aria-label="Cerrar chat"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-[200px] touch-pan-y sm:p-3 bg-slate-900">
          {messages.map((msg) => (
            <div key={msg.id} className="bg-slate-800 rounded-lg p-3 border-l-[3px] border-[#0EA9C6]">
              <div className="flex justify-between items-center mb-1.5">
                <span className="font-semibold text-[#0EA9C6] font-oswald text-sm">{msg.autor}</span>
                <span className="text-xs text-white/50">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="text-white/90 leading-[1.4] break-words text-sm">{msg.mensaje}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="flex py-3 px-4 border-t border-white/10 gap-2 bg-slate-800 min-h-[64px] rounded-b-xl items-center sm:p-3 sm:relative sm:z-10 sm:shrink-0">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Escribí un mensaje…"
            className="flex-1 py-3 px-4 border border-slate-700 rounded-xl outline-none font-oswald text-base transition-all focus:border-[#0EA9C6] focus:ring-2 focus:ring-[#0EA9C6]/20 sm:text-base sm:relative sm:z-20 bg-slate-900 text-white placeholder:text-white/40"
            onKeyPress={(e) => e.key === 'Enter' && !loading && newMessage.trim() && handleSendMessage()}
            disabled={loading}
            ref={inputRef}
            autoFocus
          />
          <button
            onClick={handleSendMessage}
            className="bg-[#0EA9C6] border-none rounded-xl w-11 h-11 text-white text-lg cursor-pointer flex items-center justify-center transition-all hover:bg-[#0c94a8] active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed"
            disabled={loading || !newMessage.trim()}
            aria-label="Enviar mensaje"
          >
            {loading ? '...' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}