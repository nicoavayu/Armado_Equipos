import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { toast } from 'react-toastify';
import { useInterval } from '../hooks/useInterval';
import { supabase, updateProfile } from '../supabase';
import { parseLocalDateTime } from '../utils/dateLocal';
import ProximosPartidos from './ProximosPartidos';
import NotificationsBell from './NotificationsBell';

const FifaHomeContent = ({ onCreateMatch, onViewHistory, onViewInvitations, onViewActivePlayers }) => {
  const { user, profile, refreshProfile } = useAuth();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();
  const { setIntervalSafe } = useInterval();
  const [activeMatches, setActiveMatches] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showProximosPartidos, setShowProximosPartidos] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusDropdownRef = useRef(null);
  const [isMounted, setIsMounted] = useState(false);

  const handleVerPremiacion = () => {
    const targetMatch = activeMatches?.[0];
    if (!targetMatch?.id) {
      toast.info('No hay un partido activo para mostrar premiación.');
      return;
    }
    navigate(`/resultados-encuesta/${targetMatch.id}?demoAwards=true`);
  };

  useEffect(() => {
    const timer = setTimeout(() => setIsMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const cardClass = `bg-white/10 border border-white/20 rounded-2xl p-5 cursor-pointer ${isMounted ? 'transition-all duration-300' : ''} aspect-square relative overflow-hidden flex flex-col justify-start min-h-[120px] no-underline text-white backdrop-blur-[15px] z-[1] hover:-translate-y-1.5 hover:scale-[1.02] hover:bg-white/20 hover:border-white/40 active:translate-y-0 active:scale-100 sm:min-h-[100px] sm:p-4 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]`;

  // Agregar aquí los ítems estáticos que antes provenían de PanelInfo
  const panelInfoItems = [
    { id: 'panel-1', message: 'Hoy jugás a las 20:00 en Sede Palermo', type: 'match' },
    { id: 'panel-2', message: 'Se sumó Juan al partido del viernes', type: 'player' },
    { id: 'panel-3', message: 'Faltan 3 jugadores para el partido', type: 'alert' },
  ];

  useEffect(() => {
    if (user) {
      fetchActiveMatches();
      fetchRecentActivity();

      // Actualizar cada 10 segundos para tiempo real
      setIntervalSafe(() => {
        fetchActiveMatches();
      }, 10000);
    } else {
      setLoading(false);
    }
  }, [user, setIntervalSafe]);

  const fetchActiveMatches = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      // Usar la misma lógica que ProximosPartidos.js
      const { data: jugadoresData, error: jugadoresError } = await supabase
        .from('jugadores')
        .select('partido_id')
        .eq('usuario_id', user.id);

      if (jugadoresError) throw jugadoresError;

      const partidosComoJugador = jugadoresData?.map((j) => j.partido_id) || [];

      const { data: partidosComoAdmin, error: adminError } = await supabase
        .from('partidos')
        .select('id')
        .eq('creado_por', user.id);

      if (adminError) throw adminError;

      const partidosAdminIds = partidosComoAdmin?.map((p) => p.id) || [];
      const todosLosPartidosIds = Array.from(new Set([...partidosComoJugador, ...partidosAdminIds]));

      if (todosLosPartidosIds.length === 0) {
        setActiveMatches([]);
        return;
      }

      // Obtener cleared matches
      let clearedMatchIds = new Set();
      try {
        const { data: clearedData, error: clearedError } = await supabase
          .from('cleared_matches')
          .select('partido_id')
          .eq('user_id', user.id);

        if (clearedError) {
          const key = `cleared_matches_${user.id}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          clearedMatchIds = new Set(existing);
        } else {
          clearedMatchIds = new Set(clearedData?.map((c) => c.partido_id) || []);
        }
      } catch (error) {
        const key = `cleared_matches_${user.id}`;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        clearedMatchIds = new Set(existing);
      }

      // Obtener completed surveys
      let completedSurveys = new Set();
      try {
        const { data: userJugadorIdsData } = await supabase
          .from('jugadores')
          .select('id, partido_id')
          .eq('usuario_id', user.id);

        if (userJugadorIdsData?.length > 0) {
          const jugadorIds = userJugadorIdsData.map(j => j.id);
          const { data: surveysData } = await supabase
            .from('post_match_surveys')
            .select('partido_id')
            .in('votante_id', jugadorIds);
          completedSurveys = new Set(surveysData?.map((s) => s.partido_id) || []);
        }
      } catch (error) {
        console.error('Error fetching completed surveys:', error);
      }

      const { data: partidosData, error: partidosError } = await supabase
        .from('partidos')
        .select('*')
        .in('id', todosLosPartidosIds)
        .order('fecha', { ascending: true })
        .order('hora', { ascending: true });

      if (partidosError) throw partidosError;

      const now = new Date();
      const partidosFiltrados = partidosData?.filter((partido) => {
        if (clearedMatchIds.has(partido.id) || completedSurveys.has(partido.id)) {
          return false;
        }

        if (!partido.fecha || !partido.hora) return true;

        try {
          const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
          if (!partidoDateTime) return true;
          const partidoMasUnaHora = new Date(partidoDateTime.getTime() + 60 * 60 * 1000);
          return now <= partidoMasUnaHora;
        } catch {
          return true;
        }
      }) || [];


      setActiveMatches(partidosFiltrados);
    } catch (error) {
      console.error('Error fetching active matches:', error);
    } finally {
      setLoading(false);
    }
  };



  const fetchRecentActivity = async () => {
    try {
      const { data, error } = await supabase
        .from('partidos')
        .select('id, fecha, hora, sede, created_at, precio_cancha_por_persona')
        .order('created_at', { ascending: false })
        .limit(3);

      if (error) throw error;
      setRecentActivity(data || []);
    } catch (error) {
      console.error('Error fetching recent activity:', error);
    }
  };

  const getInitial = () => {
    if (profile?.avatar_url) return null;
    return profile?.nombre?.charAt(0) || user?.email?.charAt(0) || '?';
  };

  const userName = profile?.nombre || user?.email?.split('@')[0] || 'Usuario';
  const truncatedName = userName.length > 15 ? `${userName.substring(0, 15)}...` : userName;
  const isAvailable = profile?.acepta_invitaciones !== false;
  const statusText = isAvailable ? 'Disponible' : 'Ocupado';

  const toggleStatusDropdown = (e) => {
    e.stopPropagation();
    setShowStatusDropdown(!showStatusDropdown);
  };

  const handleNotificationsClick = () => {
    navigate('/notifications');
    setShowStatusDropdown(false);
  };

  const updateAvailabilityStatus = async (status) => {
    if (!user) return;

    try {
      await updateProfile(user.id, { acepta_invitaciones: status });
      await refreshProfile();
      setShowStatusDropdown(false);
    } catch (error) {
      console.error('Error updating availability status:', error);
    }
  };

  // Mostrar ProximosPartidos si está activo
  if (showProximosPartidos) {
    return (
      <ProximosPartidos
        onClose={() => setShowProximosPartidos(false)}
      />
    );
  }

  // Combinar los ítems estáticos con la actividad reciente traída desde la BD
  const combinedActivity = [
    ...panelInfoItems,
    ...(recentActivity || []).map((activity) => ({
      id: `recent-${activity.id}`,
      message: `Partido creado en ${activity.sede} para el ${new Date(activity.fecha).toLocaleDateString()}`,
      type: 'match',
    })),
  ];

  return (
    <div className="w-full max-w-[800px] mx-auto px-4 pb-[100px] bg-transparent shadow-none">
      {/* Header elements - Avatar and Notifications */}
      {user && (
        <div className="flex items-center justify-between -mx-4 mb-5 px-4 py-3 bg-white/5 border-b border-white/10 backdrop-blur-[20px] w-screen ml-[calc(-50vw+50%)] shadow-lg">
          <div className="flex flex-row items-center justify-center cursor-pointer relative z-[10000]" ref={statusDropdownRef}>
            <div className="relative mr-4" onClick={toggleStatusDropdown}>
              <div className="w-10 h-10 rounded-full overflow-hidden bg-white/20 flex items-center justify-center text-white font-bold text-base">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div>
                    {getInitial()}
                  </div>
                )}
              </div>
              <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white/80 ${isAvailable ? 'bg-[#4CAF50]' : 'bg-[#F44336]'}`}></div>
            </div>

            <div className="flex flex-col" onClick={toggleStatusDropdown}>
              <div className="flex items-baseline">
                <div className="text-white font-oswald text-sm mr-[5px] opacity-90 drop-shadow-[0_1px_2px_rgba(255,255,255,0.2)]">Hola,</div>
                <div className="text-white font-bebas text-lg font-bold drop-shadow-[0_1px_2px_rgba(255,255,255,0.2)]">{truncatedName}</div>
              </div>
              <div className={`font-oswald text-xs mt-[2px] ${isAvailable ? 'text-[#4CAF50]' : 'text-[#F44336]'}`}>{statusText}</div>
            </div>

            {showStatusDropdown && createPortal(
              <div className="fixed top-20 left-4 bg-black/90 rounded-xl w-[180px] z-[2147483647] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.4)] border border-white/10 origin-top-left transition-all duration-200 animate-[dropdownSlideIn_0.2s_ease-out]">
                <div className="px-4 py-2.5 font-bold text-white border-b border-white/20 font-bebas">
                  Estado
                </div>
                <div
                  className={`flex items-center px-4 py-2.5 cursor-pointer transition-colors duration-200 text-white hover:bg-white/10 ${isAvailable ? 'bg-white/20' : ''}`}
                  onClick={() => updateAvailabilityStatus(true)}
                >
                  <div className="w-2.5 h-2.5 rounded-full mr-2.5 bg-[#4CAF50]"></div>
                  <span>Disponible</span>
                </div>
                <div
                  className={`flex items-center px-4 py-2.5 cursor-pointer transition-colors duration-200 text-white hover:bg-white/10 ${!isAvailable ? 'bg-white/20' : ''}`}
                  onClick={() => updateAvailabilityStatus(false)}
                >
                  <div className="w-2.5 h-2.5 rounded-full mr-2.5 bg-[#F44336]"></div>
                  <span>No disponible</span>
                </div>
              </div>,
              document.body
            )}
            <style>{`
              @keyframes dropdownSlideIn {
                from { opacity: 0; transform: translateY(-10px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
              }
            `}</style>
          </div>

          <div className="flex items-center justify-end">
            <NotificationsBell
              unreadCount={unreadCount}
              onClick={handleNotificationsClick}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-5 bg-transparent shadow-none sm:gap-2">
        {/* Create New Match */}
        <Link to="/nuevo-partido" className={cardClass}>
          <div className="text-white font-bebas text-[20px] font-bold uppercase leading-none drop-shadow-[0_2px_10px_rgba(129,120,229,0.5)] sm:text-[17px]">PARTIDO<br />NUEVO</div>
          <div className="absolute bottom-5 right-5 text-primary text-[28px] w-[52px] h-[52px] flex items-center justify-center sm:w-11 sm:h-11 sm:bottom-4 sm:right-4 sm:text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={60} height={60}>
              <path d="M320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320C64 461.4 178.6 576 320 576zM296 408L296 344L232 344C218.7 344 208 333.3 208 320C208 306.7 218.7 296 232 296L296 296L296 232C296 218.7 306.7 208 320 208C333.3 208 344 218.7 344 232L344 296L408 296C421.3 296 432 306.7 432 320C432 333.3 421.3 344 408 344L344 344L344 408C344 421.3 333.3 432 320 432C306.7 432 296 421.3 296 408z" />
            </svg>
          </div>
        </Link>

        {/* Próximos Partidos */}
        <div
          className={cardClass}
          onClick={() => user && setShowProximosPartidos(true)}
        >
          <div className="text-white font-bebas text-[20px] font-bold uppercase leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.11)] sm:text-[17px]">PRÓXIMOS<br />PARTIDOS</div>
          <div className="absolute bottom-5 right-5 text-white/95 text-[28px] w-[52px] h-[52px] flex items-center justify-center sm:w-11 sm:h-11 sm:bottom-4 sm:right-4 sm:text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={48} height={48}>
              <path d="M64 320C64 461.4 178.6 576 320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320zM305 441C295.6 450.4 280.4 450.4 271.1 441C261.8 431.6 261.7 416.4 271.1 407.1L358.1 320.1L271.1 233.1C261.7 223.7 261.7 208.5 271.1 199.2C280.5 189.9 295.7 189.8 305 199.2L409 303C418.4 312.4 418.4 327.6 409 336.9L305 441z" />
            </svg>
          </div>
          {activeMatches && activeMatches.length > 0 && (
            <div className="absolute top-3 right-3 bg-[#ff3366] text-white rounded-full w-5 h-5 flex items-center justify-center font-bold text-[11px] shadow-[0_2px_6px_rgba(0,0,0,0.18)] sm:w-[18px] sm:h-[18px] sm:text-[10px] sm:top-2.5 sm:right-2.5">{activeMatches.length}</div>
          )}
        </div>

        {/* Historial */}
        <Link to="/historial" className={cardClass}>
          <div className="text-white font-bebas text-[20px] font-bold uppercase leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.11)] sm:text-[17px]">HISTORIAL</div>
          <div className="absolute bottom-5 right-5 text-white/95 text-[28px] w-[52px] h-[52px] flex items-center justify-center sm:w-11 sm:h-11 sm:bottom-4 sm:right-4 sm:text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={48} height={48}>
              <path d="M320 128C426 128 512 214 512 320C512 426 426 512 320 512C254.8 512 197.1 479.5 162.4 429.7C152.3 415.2 132.3 411.7 117.8 421.8C103.3 431.9 99.8 451.9 109.9 466.4C156.1 532.6 233 576 320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C234.3 64 158.5 106.1 112 170.7L112 144C112 126.3 97.7 112 80 112C62.3 112 48 126.3 48 144L48 256C48 273.7 62.3 288 80 288L104.6 288C105.1 288 105.6 288 106.1 288L192.1 288C209.8 288 224.1 273.7 224.1 256C224.1 238.3 209.8 224 192.1 224L153.8 224C186.9 166.6 249 128 320 128zM344 216C344 202.7 333.3 192 320 192C306.7 192 296 202.7 296 216L296 320C296 326.4 298.5 332.5 303 337L375 409C384.4 418.4 399.6 418.4 408.9 409C418.2 399.6 418.3 384.4 408.9 375.1L343.9 310.1L343.9 216z" />
            </svg>
          </div>
        </Link>

        {/* Estadísticas */}
        <Link to="/stats" className={cardClass}>
          <div className="text-white font-bebas text-[20px] font-bold uppercase leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.11)] sm:text-[17px]">ESTADÍSTICAS</div>
          <div className="absolute bottom-5 right-5 text-white/95 text-[28px] w-[52px] h-[52px] flex items-center justify-center sm:w-11 sm:h-11 sm:bottom-4 sm:right-4 sm:text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={48} height={48}>
              <path d="M256 144C256 117.5 277.5 96 304 96L336 96C362.5 96 384 117.5 384 144L384 496C384 522.5 362.5 544 336 544L304 544C277.5 544 256 522.5 256 496L256 144zM64 336C64 309.5 85.5 288 112 288L144 288C170.5 288 192 309.5 192 336L192 496C192 522.5 170.5 544 144 544L112 544C85.5 544 64 522.5 64 496L64 336zM496 160L528 160C554.5 160 576 181.5 576 208L576 496C576 522.5 554.5 544 528 544L496 544C469.5 544 448 522.5 448 496L448 208C448 181.5 469.5 160 496 160z" />
            </svg>
          </div>
        </Link>


      </div>

      {/* CTA for Awards Preview */}
      <div className="mt-2 mb-6">
        <button
          onClick={handleVerPremiacion}
          className="w-full py-3 rounded-xl bg-primary text-white font-bebas text-lg uppercase tracking-widest shadow-[0_8px_24px_rgba(129,120,229,0.35)] hover:brightness-110 hover:-translate-y-[1px] active:translate-y-0 transition-all text-center border border-white/20"
        >
          Ver Premiación
        </button>
      </div>

      {/* Recent Activity */}
      <div className="bg-white/5 border border-white/10 backdrop-blur-[15px] rounded-2xl p-6 mt-5 mb-10 shadow-xl">
        <h3 className="font-bebas text-[28px] m-0 mb-4 text-white/90 uppercase font-bold tracking-tight">ACTIVIDAD RECIENTE</h3>
        <div className="flex flex-col gap-3 max-h-[250px] overflow-y-auto pr-1 custom-scrollbar">
          {combinedActivity.length > 0 ? (
            combinedActivity.map((item) => (
              <div key={item.id} className="flex items-center p-3.5 bg-white/5 rounded-xl border border-white/5 transition-all duration-200 hover:bg-white/10 hover:border-white/10">
                <div className="mr-3 text-xl">
                  {item.type === 'match' && '🏆'}
                  {item.type === 'player' && '👤'}
                  {item.type === 'alert' && '⚠️'}
                </div>
                <div className="text-white/90 text-sm">{item.message}</div>
              </div>
            ))
          ) : (
            <div className="text-white/50 text-center py-5">No hay actividad reciente</div>
          )}
        </div>
      </div>


    </div>
  );
};

export default FifaHomeContent;