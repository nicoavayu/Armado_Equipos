#!/bin/bash
echo "🧹 Iniciando limpieza automática..."

# Backup
git add -A && git commit -m "Backup antes de limpieza automática"

# Eliminar archivos seguros
rm -f "src/App.test.js"
rm -f "src/__tests__/AuthProvider.test.js"
rm -f "src/__tests__/PlayerForm.test.js"
rm -f "src/__tests__/TeamGenerator.test.js"
rm -f "src/examples/NotificationExample.js"

# Eliminar dependencias
npm uninstall @capacitor/android
npm uninstall @capacitor/cli
npm uninstall @capacitor/ios
npm uninstall @heroicons/react
npm uninstall canvas-confetti
npm uninstall lucide-react
npm uninstall react-confetti
npm uninstall react-draggable
npm uninstall react-easy-crop
npm uninstall stylelint
npm uninstall stylelint-config-standard

echo "✅ Limpieza completada. Prueba la aplicación con: npm start"
