#!/bin/bash

# 🧹 Script de limpieza automática para Team Balancer
# Generado automáticamente - REVISA ANTES DE EJECUTAR

echo "🧹 Iniciando limpieza del proyecto..."

# Eliminar archivos muertos
echo "🗑️ Eliminando archivos muertos..."
rm -f "src/App.test.js"
rm -f "src/ElegirPartidoFrecuente.js"
rm -f "src/IngresoVotacion.js"
rm -f "src/JugadorIngresarCodigo.js"
rm -f "src/RegistroJugador.js"
rm -f "src/SeleccionarTipoPartido.js"
rm -f "src/SvgPelota.js"
rm -f "src/SvgPeople.js"
rm -f "src/__tests__/AuthProvider.test.js"
rm -f "src/__tests__/PlayerForm.test.js"
rm -f "src/__tests__/TeamGenerator.test.js"
rm -f "src/components/CameraUpload.js"
rm -f "src/components/EmailAuth.js"
rm -f "src/components/EnhancedComponents.js"
rm -f "src/components/FrequentPlayers.js"
rm -f "src/components/LocationPicker.js"
rm -f "src/components/MoonIcon.js"
rm -f "src/components/PlayerAddFirebase.js"
rm -f "src/components/PlayerCard.js"
rm -f "src/components/PlayerList.js"
rm -f "src/components/PlayerRegisterSupabase.js"
rm -f "src/components/ProfileDisplay.js"
rm -f "src/components/ProfileMenu.js"
rm -f "src/components/SunIcon.js"
rm -f "src/components/TeamGenerator.js"
rm -f "src/components/ThemeSwitch.js"
rm -f "src/components/historial/HistorialDePartidosButton.js"
rm -f "src/examples/NotificationExample.js"
rm -f "src/hooks/useGuestSession.js"
rm -f "src/hooks/useProfile.js"
rm -f "src/hooks/useVotingState.js"
rm -f "src/services/api/authService.js"
rm -f "src/services/api/matchService.js"
rm -f "src/useEnsureProfile.js"
rm -f "src/utils/matchNotifications.js"
rm -f "src/utils/notificationHelpers.js"
rm -f "src/utils/playerNormalization.js"
rm -f "src/utils/supabaseHelpers.js"
rm -f "src/utils/validation.js"
rm -f "src/utils.js"

# Eliminar dependencias huérfanas
echo "📦 Eliminando dependencias huérfanas..."
npm uninstall @capacitor/android
npm uninstall @capacitor/camera
npm uninstall @capacitor/core
npm uninstall @capacitor/geolocation
npm uninstall @capacitor/haptics
npm uninstall @capacitor/ios
npm uninstall @capacitor/network
npm uninstall @capacitor/preferences
npm uninstall @capacitor/push-notifications
npm uninstall @capacitor/share
npm uninstall @hello-pangea/dnd
npm uninstall @heroicons/react
npm uninstall @supabase/supabase-js
npm uninstall canvas-confetti
npm uninstall lucide-react
npm uninstall react-confetti
npm uninstall react-draggable
npm uninstall react-easy-crop
npm uninstall react-joyride
npm uninstall use-places-autocomplete

echo "✅ Limpieza completada!"
echo "📝 Revisa el archivo CLEANUP_REPORT.md para más detalles"
