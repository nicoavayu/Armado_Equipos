import React from 'react';

export default function ModernToggle({ checked, onChange, label }) {
  return (
    <div className="my-4">
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="hidden peer"
        />
        <div className={'relative w-[60px] h-[32px] bg-white/20 rounded-2xl border-2 border-white/30 transition-all duration-300 ease-out hover:bg-white/30 peer-checked:bg-[linear-gradient(45deg,#d4af37,#f4d03f)] peer-checked:border-[#d4af37] peer-checked:hover:bg-[linear-gradient(45deg,#e6c547,#f7dc6f)]'}>
          <div className={`absolute top-[2px] left-[2px] w-[24px] h-[24px] bg-white rounded-full transition-transform duration-300 ease-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${checked ? 'translate-x-[28px]' : ''}`}></div>
        </div>
        <span className="text-white text-sm font-medium font-[Oswald,Arial,sans-serif]">{label}</span>
      </label>
    </div>
  );
}