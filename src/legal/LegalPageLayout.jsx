import React from 'react';
import { Link } from 'react-router-dom';
import LegalFooter from './LegalFooter';
import './legal.css';

/** Marco común de las páginas legales (mismo estilo que las páginas /terms y /privacy existentes). */
export default function LegalPageLayout({ title, updatedAt, children }) {
  return (
    <div className="min-h-screen w-full bg-[#0f172a] text-white px-5 py-10">
      <div className="mx-auto w-full max-w-3xl bg-white/5 border border-white/10 rounded-2xl p-6 md:p-8">
        <h1 className="text-3xl font-oswald tracking-wide mb-2">{title}</h1>
        {updatedAt && <p className="text-white/70 text-sm mb-6">Última actualización: {updatedAt}</p>}
        <div className="legal-body space-y-4 text-white/90 leading-relaxed">{children}</div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/login" className="px-4 py-2 rounded-lg border border-white/20 bg-transparent hover:bg-white/10 transition-colors">
            Volver
          </Link>
        </div>
      </div>
      <LegalFooter className="mx-auto mt-6 max-w-3xl" />
    </div>
  );
}
