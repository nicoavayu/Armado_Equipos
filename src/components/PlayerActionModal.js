import React from 'react';
import { User, UserPlus, Trophy, X } from 'lucide-react';

const PlayerActionModal = ({
    isOpen,
    onClose,
    player,
    onInvite,
    onViewProfile,
    onAddFriend,
}) => {
    if (!isOpen || !player) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-auto p-4 animate-fade-in">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Modal Content - Centered Card */}
            <div className="relative w-full max-w-[340px] bg-[#1e293b] border border-white/20 p-6 rounded-2xl shadow-2xl transform transition-transform duration-200 ease-out scale-100 animate-pulse-zoom-in">

                {/* Close Button Absolute */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>

                {/* Mini Profile Header */}
                <div className="flex flex-col items-center text-center gap-3 mb-6">
                    <div className="w-20 h-20 rounded-full border-2 border-white/20 overflow-hidden bg-slate-800 flex items-center justify-center shrink-0 shadow-lg">
                        {player.avatar_url ? (
                            <img src={player.avatar_url} alt={player.nombre} className="w-full h-full object-cover" />
                        ) : (
                            <User size={40} className="text-white/50" />
                        )}
                    </div>
                    <div>
                        <h3 className="text-white font-bebas text-3xl tracking-wide leading-none mb-1">{player.nombre}</h3>
                        <div className="flex items-center justify-center gap-2 text-white/60 text-sm font-oswald uppercase tracking-wider">
                            <span>{player.posicion || 'Jugador'}</span>
                            <span>•</span>
                            <span className="text-[#FFD700] flex items-center gap-1 font-bold">
                                ⭐ {player.rating || 5.0}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Actions Grid */}
                <div className="flex flex-col gap-3 font-oswald text-sm">
                    <button
                        onClick={() => { onInvite?.(player); onClose(); }}
                        className="w-full bg-[#128BE9] text-white py-4 rounded-xl font-bold uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg"
                    >
                        <Trophy size={18} />
                        INVITAR A UN PARTIDO
                    </button>

                    <div className="grid grid-cols-2 gap-3 mt-1">
                        <button
                            onClick={() => { onViewProfile?.(player); onClose(); }}
                            className="bg-white/5 border border-white/10 text-white py-3 rounded-xl font-bold uppercase tracking-wide hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center gap-2"
                        >
                            <User size={16} />
                            VER PERFIL
                        </button>
                        <button
                            onClick={() => { onAddFriend?.(player); onClose(); }}
                            className="bg-white/5 border border-white/10 text-white py-3 rounded-xl font-bold uppercase tracking-wide hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center gap-2"
                        >
                            <UserPlus size={16} />
                            AGREGAR
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PlayerActionModal;
