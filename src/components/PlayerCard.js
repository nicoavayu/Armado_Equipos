import React from 'react';
import ReactCountryFlag from 'react-country-flag';
import PlayerAwards from './PlayerAwards';


const PlayerCard = ({ profile, user, isVisible }) => {
  const getPositionAbbr = (position) => {
    const positions = {
      'ARQ': 'ARQ',
      'DEF': 'DEF',
      'MED': 'MED',
      'DEL': 'DEL',
    };
    return positions[position] || 'DEF';
  };

  // Use usuarios.avatar_url as primary source
  const playerPhoto = profile?.avatar_url || user?.user_metadata?.avatar_url;
  const playerNumber = profile?.numero || 10;
  const playerName = profile?.nombre || 'LIONEL MESSI';
  console.log('[AMIGOS] Processing position field in PlayerCard:', { posicion: profile?.posicion });
  const position = getPositionAbbr(profile?.posicion);
  const email = profile?.email || user?.email;
  const countryCode = profile?.pais_codigo || 'AR';
  console.log('[AMIGOS] Processing ranking field in PlayerCard:', { ranking: profile?.ranking, calificacion: profile?.calificacion });
  const rating = profile?.ranking || profile?.calificacion || 4.5; // Support both ranking and calificacion for backward compatibility
  const matchesPlayed = profile?.partidos_jugados || 28;
  const ageRange = profile?.rango_edad || '31-45';
  const social = profile?.social || '@leomessi';

  const renderStars = (rating) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;

    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(<span key={i} className="text-lg text-[#f4d03f] drop-shadow-sm">★</span>);
      } else if (i === fullStars && hasHalfStar) {
        stars.push(<span key={i} className="text-lg text-[#f4d03f] opacity-70 drop-shadow-sm">★</span>);
      } else {
        stars.push(<span key={i} className="text-lg text-[#666] drop-shadow-sm">☆</span>);
      }
    }
    return stars;
  };

  return (
    <div className={`w-[320px] h-[480px] bg-gradient-to-b from-[#f5f5f5] from-0% via-[#f5f5f5] via-65% to-[#2a2a2a] to-65% rounded-xl overflow-hidden shadow-2xl relative opacity-0 -translate-x-8 transition-all duration-400 ease-in-out border-2 border-[#333] flex flex-col md:w-[280px] md:h-[420px] sm:w-[260px] sm:h-[380px] ${isVisible ? 'opacity-100 translate-x-0' : ''}`}>
      {/* Header with Number and Position */}
      <div className="absolute top-5 left-5 right-5 flex justify-between items-start z-10">
        <div className="text-[56px] font-black text-[#f4d03f] font-sans drop-shadow-md leading-none md:text-[44px] sm:text-[36px]">{playerNumber}</div>
        <div className="text-2xl font-black text-[#f4d03f] font-sans drop-shadow-md mt-2 md:text-xl">{position}</div>
        <div className="bg-white/90 p-2 rounded-md border border-[#ddd] shadow-sm">
          <ReactCountryFlag
            countryCode={countryCode}
            svg
            style={{ width: '2em', height: '1.5em' }}
          />
        </div>
      </div>

      {/* Photo Section */}
      <div className="h-[65%] bg-[#f5f5f5] flex items-center justify-center pt-20 px-5 pb-5 relative">
        {playerPhoto ? (
          <img
            src={playerPhoto}
            alt="Player"
            className="w-[200px] h-[200px] object-cover rounded-xl border-[3px] border-[#ddd] shadow-lg md:w-[160px] md:h-[160px] sm:w-[140px] sm:h-[140px]"
          />
        ) : (
          <div className="w-[200px] h-[200px] bg-[#e0e0e0] rounded-xl border-[3px] border-[#ddd] flex items-center justify-center shadow-lg md:w-[160px] md:h-[160px] sm:w-[140px] sm:h-[140px]">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="#999">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
        )}
      </div>

      {/* Name and Email */}
      <div className="bg-[#f5f5f5] py-4 px-5 text-center border-b-[3px] border-[#f4d03f]">
        <div className="text-2xl font-black text-black font-sans tracking-wide mb-1 leading-none md:text-xl">{playerName.toUpperCase()}</div>
        <div className="text-sm text-[#666] font-medium font-sans">{email}</div>
      </div>

      {/* Stats Section */}
      <div className="flex-1 bg-[#2a2a2a] p-5 flex flex-col justify-between md:p-4">
        <div className="flex justify-between mb-4">
          <div className="flex flex-col items-center flex-1">
            <span className="text-base font-bold text-[#f4d03f] font-sans mb-0.5 text-center break-all md:text-sm">{matchesPlayed}</span>
            <span className="text-[10px] text-white font-medium uppercase tracking-wider">PJ</span>
          </div>
          <div className="flex flex-col items-center flex-1">
            <span className="text-base font-bold text-[#f4d03f] font-sans mb-0.5 text-center break-all md:text-sm">{ageRange}</span>
            <span className="text-[10px] text-white font-medium uppercase tracking-wider">EDAD</span>
          </div>
          <div className="flex flex-col items-center flex-1">
            <span className="text-base font-bold text-[#f4d03f] font-sans mb-0.5 text-center break-all md:text-sm">{social}</span>
            <span className="text-[10px] text-white font-medium uppercase tracking-wider">SOCIAL</span>
          </div>
        </div>

        <div className="flex justify-between items-center">
          <div className="text-[48px] font-black text-[#f4d03f] font-sans leading-none drop-shadow-md md:text-[36px] sm:text-[32px]">{rating.toFixed(1)}</div>
          <div className="flex gap-1">
            {renderStars(rating)}
          </div>
          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}>
            <PlayerAwards playerId={profile?.uuid || profile?.id} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerCard;