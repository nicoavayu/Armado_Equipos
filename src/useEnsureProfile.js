// useEnsureProfile.js
import { useEffect } from "react";
import { supabase, upsertProfile } from "./supabase";

export default function useEnsureProfile() {
  useEffect(() => {
    async function crearPerfilSiNoExiste() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Crea el perfil aunque no haya datos, pero sí el ID
      await upsertProfile({
        id: user.id,
        nombre: user.user_metadata?.full_name || "",
        avatar_url: user.user_metadata?.avatar_url || ""
      });
    }
    crearPerfilSiNoExiste();
  }, []);
}
