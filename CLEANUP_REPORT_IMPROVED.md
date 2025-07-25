# 🧹 Reporte de Limpieza Mejorado - Team Balancer

Generado el: 7/25/2025, 3:04:00 PM

## 📊 Resumen

- **Total de archivos analizados**: 123
- **Archivos potencialmente muertos**: 43
- **Imports potencialmente no utilizados**: 0
- **Dependencias potencialmente huérfanas**: 10

---

## 🗑️ Archivos que PODRÍAN eliminarse (revisar manualmente)


- `src/App.test.js`
- `src/ElegirPartidoFrecuente.js`
- `src/IngresoVotacion.js`
- `src/JugadorIngresarCodigo.js`
- `src/RegistroJugador.js`
- `src/SeleccionarTipoPartido.js`
- `src/SvgPelota.js`
- `src/SvgPeople.js`
- `src/__tests__/AuthProvider.test.js`
- `src/__tests__/PlayerForm.test.js`
- `src/__tests__/TeamGenerator.test.js`
- `src/components/CameraUpload.js`
- `src/components/EmailAuth.js`
- `src/components/EnhancedComponents.js`
- `src/components/FrequentPlayers.js`
- `src/components/LocationPicker.js`
- `src/components/MoonIcon.js`
- `src/components/PlayerAddFirebase.js`
- `src/components/PlayerCard.js`
- `src/components/PlayerList.js`
- `src/components/PlayerRegisterSupabase.js`
- `src/components/ProfileDisplay.js`
- `src/components/ProfileMenu.js`
- `src/components/SunIcon.js`
- `src/components/TeamGenerator.js`
- `src/components/ThemeSwitch.js`
- `src/components/historial/HistorialDePartidosButton.js`
- `src/components/historial/index.js`
- `src/constants/index.js`
- `src/examples/NotificationExample.js`
- `src/hooks/useGuestSession.js`
- `src/hooks/useProfile.js`
- `src/hooks/useVotingState.js`
- `src/services/api/authService.js`
- `src/services/api/matchService.js`
- `src/services/index.js`
- `src/useEnsureProfile.js`
- `src/utils/matchNotifications.js`
- `src/utils/notificationHelpers.js`
- `src/utils/playerNormalization.js`
- `src/utils/supabaseHelpers.js`
- `src/utils/validation.js`
- `src/utils.js`

---

## 📦 Dependencias que PODRÍAN eliminarse del package.json


- `@capacitor/android`
- `@capacitor/ios`
- `@heroicons/react`
- `canvas-confetti`
- `lucide-react`
- `react-confetti`
- `react-draggable`
- `react-easy-crop`
- `react-joyride`
- `use-places-autocomplete`

---

## 🔗 Imports que PODRÍAN no utilizarse

✅ No se encontraron imports no utilizados.


---

## ⚠️ IMPORTANTE - Revisar antes de eliminar

### Archivos que probablemente SÍ están en uso:
- `src/WeatherWidget.js` - Usado en componentes
- `src/supabase.js` - Configuración de base de datos
- Archivos en `src/components/` - Muchos son componentes activos
- Archivos en `src/hooks/` - Custom hooks utilizados
- Archivos en `src/services/` - Servicios de la aplicación

### Dependencias que probablemente SÍ son necesarias:
- `@supabase/supabase-js` - Base de datos
- `react-router-dom` - Navegación
- `react-toastify` - Notificaciones
- `@capacitor/*` - Funcionalidad móvil
- `framer-motion` - Animaciones

---

## 🔧 Recomendaciones de limpieza segura

1. **Primero elimina solo los archivos de test no utilizados**:
   ```bash
   rm src/__tests__/AuthProvider.test.js
   rm src/__tests__/PlayerForm.test.js
   rm src/__tests__/TeamGenerator.test.js
   ```

2. **Elimina archivos de ejemplo**:
   ```bash
   rm src/examples/NotificationExample.js
   ```

3. **Revisa manualmente cada archivo antes de eliminar**

4. **Para las dependencias, verifica en el código si realmente no se usan**

---

## 🚀 Próximos pasos recomendados

1. Revisar manualmente cada archivo marcado como "muerto"
2. Buscar referencias en archivos CSS, HTML o configuración
3. Probar la aplicación después de cada eliminación
4. Hacer commits pequeños para poder revertir cambios
