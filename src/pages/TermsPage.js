import React from 'react';
import { Link } from 'react-router-dom';

const updatedAt = '14 de febrero de 2026';

export default function TermsPage() {
  return (
    <div className="min-h-screen w-full bg-[#0f172a] text-white px-5 py-10">
      <div className="mx-auto w-full max-w-3xl bg-white/5 border border-white/10 rounded-2xl p-6 md:p-8">
        <h1 className="text-3xl font-oswald tracking-wide mb-2">Términos y Condiciones</h1>
        <p className="text-white/70 text-sm mb-6">Última actualización: {updatedAt}</p>

        <section className="space-y-3 text-white/90 leading-relaxed">
          <p>
            Team Balancer es una plataforma para organizar partidos y coordinar jugadores. Al
            usar la app aceptás estos términos.
          </p>
          <p>
            Sos responsable del contenido que cargás y de mantener tus credenciales seguras. No
            está permitido usar la app para actividades ilegales o abusivas.
          </p>
          <p>
            El servicio puede actualizarse, modificarse o suspenderse parcialmente por razones
            técnicas, operativas o legales.
          </p>
          <p>
            Podés cerrar sesión en cualquier momento y eliminar tu cuenta desde la app en la
            sección Perfil.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/privacy"
            className="px-4 py-2 rounded-lg border border-white/20 bg-white/10 hover:bg-white/20 transition-colors"
          >
            Ver Política de Privacidad
          </Link>
          <Link
            to="/login"
            className="px-4 py-2 rounded-lg border border-white/20 bg-transparent hover:bg-white/10 transition-colors"
          >
            Volver
          </Link>
        </div>
      </div>
    </div>
  );
}
