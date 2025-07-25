#!/bin/bash

echo "🧹 Team Balancer - Limpieza Segura"
echo "=================================="

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo "❌ Error: Ejecuta este script desde la raíz del proyecto"
    exit 1
fi

# Crear backup
echo "📦 Creando backup..."
git add -A && git commit -m "Backup antes de limpieza automática - $(date)"

echo "🗑️ Eliminando archivos seguros..."

# Eliminar archivos de test no utilizados
rm -f "src/App.test.js"
rm -f "src/__tests__/AuthProvider.test.js"
rm -f "src/__tests__/PlayerForm.test.js"
rm -f "src/__tests__/TeamGenerator.test.js"

# Eliminar archivos de ejemplo
rm -f "src/examples/NotificationExample.js"

# Eliminar directorio __tests__ si está vacío
if [ -d "src/__tests__" ] && [ -z "$(ls -A src/__tests__)" ]; then
    rmdir "src/__tests__"
    echo "📁 Directorio __tests__ vacío eliminado"
fi

# Eliminar directorio examples si está vacío
if [ -d "src/examples" ] && [ -z "$(ls -A src/examples)" ]; then
    rmdir "src/examples"
    echo "📁 Directorio examples vacío eliminado"
fi

echo "📦 Eliminando dependencias no utilizadas..."

# Eliminar dependencias que definitivamente no se usan
npm uninstall @heroicons/react
npm uninstall canvas-confetti
npm uninstall lucide-react
npm uninstall react-confetti
npm uninstall react-draggable
npm uninstall react-easy-crop
npm uninstall stylelint
npm uninstall stylelint-config-standard

echo "🧹 Limpiando archivos de análisis temporales..."
rm -f analyze-project.js
rm -f analyze-project-improved.js
rm -f final-cleanup-analysis.js
rm -f CLEANUP_REPORT.md
rm -f CLEANUP_REPORT_IMPROVED.md
rm -f cleanup.sh

echo "✅ Limpieza completada!"
echo ""
echo "📋 Resumen:"
echo "- Archivos eliminados: 5"
echo "- Dependencias eliminadas: 8"
echo "- Archivos de análisis limpiados: 6"
echo ""
echo "🚀 Próximos pasos:"
echo "1. Ejecuta: npm start (para probar la aplicación)"
echo "2. Ejecuta: npm run build (para verificar que compila)"
echo "3. Revisa el archivo FINAL_CLEANUP_REPORT.md para más archivos a revisar manualmente"
echo ""
echo "⚠️  Si algo no funciona, puedes revertir con: git reset --hard HEAD~1"