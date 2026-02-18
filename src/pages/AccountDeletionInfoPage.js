import React from 'react';
import { Link } from 'react-router-dom';

export default function AccountDeletionInfoPage() {
  return (
    <div className="min-h-screen w-full bg-[#0f172a] text-white px-5 py-10">
      <div className="mx-auto w-full max-w-3xl bg-white/5 border border-white/10 rounded-2xl p-6 md:p-8">
        <h1 className="text-3xl font-oswald tracking-wide mb-4">Eliminación de Cuenta</h1>

        <ol className="list-decimal list-inside space-y-3 text-white/90 leading-relaxed">
          <li>Ingresá a tu cuenta.</li>
          <li>Andá a <strong>Perfil</strong>.</li>
          <li>Presioná <strong>Eliminar cuenta</strong> y confirmá.</li>
          <li>La app eliminará tu cuenta y cerrará sesión.</li>
        </ol>

        <p className="mt-6 text-white/80">
          Si no podés iniciar sesión, contactanos por soporte para validar identidad y procesar la
          baja manual.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/privacy"
            className="px-4 py-2 rounded-lg border border-white/20 bg-white/10 hover:bg-white/20 transition-colors"
          >
            Política de Privacidad
          </Link>
          <Link
            to="/terms"
            className="px-4 py-2 rounded-lg border border-white/20 bg-transparent hover:bg-white/10 transition-colors"
          >
            Términos
          </Link>
        </div>
      </div>
    </div>
  );
}
