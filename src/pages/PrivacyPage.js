import React from 'react';
import { Link } from 'react-router-dom';

const updatedAt = '14 de febrero de 2026';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen w-full bg-[#0f172a] text-white px-5 py-10">
      <div className="mx-auto w-full max-w-3xl bg-white/5 border border-white/10 rounded-2xl p-6 md:p-8">
        <h1 className="text-3xl font-oswald tracking-wide mb-2">Política de Privacidad</h1>
        <p className="text-white/70 text-sm mb-6">Última actualización: {updatedAt}</p>

        <section className="space-y-3 text-white/90 leading-relaxed">
          <p>
            Team Balancer recopila y procesa datos para permitir el funcionamiento de la app:
            autenticación, perfil de jugador, partidos, invitaciones y notificaciones.
          </p>
          <p>
            Datos que podemos procesar: email, nombre, foto de perfil, ubicación aproximada
            (si la habilitás), actividad dentro de partidos y notificaciones relacionadas.
          </p>
          <p>
            Usamos proveedores de infraestructura para operar el servicio (por ejemplo, base de
            datos y autenticación). No vendemos tus datos personales.
          </p>
          <p>
            Podés solicitar la eliminación de tu cuenta y datos desde la app en la sección
            Perfil, opción <strong>Eliminar cuenta</strong>.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/terms"
            className="px-4 py-2 rounded-lg border border-white/20 bg-white/10 hover:bg-white/20 transition-colors"
          >
            Ver Términos y Condiciones
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
