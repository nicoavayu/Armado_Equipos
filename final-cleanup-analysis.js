const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC_DIR = './src';
const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (EXTENSIONS.includes(path.extname(file))) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function isFileReferenced(filePath) {
  const fileName = path.basename(filePath, path.extname(filePath));
  const relativePath = filePath.replace('src/', '');
  
  try {
    // Buscar referencias directas al archivo
    const grepResult = execSync(`grep -r "${fileName}" src/ --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" || true`, { encoding: 'utf8' });
    
    // Filtrar la línea del propio archivo
    const references = grepResult.split('\n').filter(line => 
      line.trim() && 
      !line.includes(filePath) && 
      (line.includes('import') || line.includes('require'))
    );
    
    return references.length > 0;
  } catch (error) {
    return false;
  }
}

function analyzeUsedDependencies() {
  const usedDeps = new Set();
  const allFiles = getAllFiles(SRC_DIR);
  
  allFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Buscar imports de node_modules
      const importRegex = /(?:import.*from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
      let match;
      
      while ((match = importRegex.exec(content)) !== null) {
        const moduleName = match[1] || match[2];
        if (moduleName && !moduleName.startsWith('.') && !moduleName.startsWith('/')) {
          const depName = moduleName.startsWith('@') 
            ? moduleName.split('/').slice(0, 2).join('/')
            : moduleName.split('/')[0];
          usedDeps.add(depName);
        }
      }
    } catch (error) {
      // Ignorar errores de lectura
    }
  });
  
  return usedDeps;
}

function generateFinalReport() {
  console.log('🔍 Análisis final de limpieza...');
  
  const allFiles = getAllFiles(SRC_DIR);
  const reallyDeadFiles = [];
  const probablyDeadFiles = [];
  
  // Archivos que nunca deben eliminarse
  const protectedFiles = [
    'src/index.js',
    'src/App.js',
    'src/reportWebVitals.js',
    'src/setupTests.js',
    'src/supabase.js'
  ];
  
  allFiles.forEach(filePath => {
    if (protectedFiles.includes(filePath)) return;
    
    const isReferenced = isFileReferenced(filePath);
    
    if (!isReferenced) {
      // Verificar si es un archivo de configuración o especial
      const fileName = path.basename(filePath);
      if (fileName.includes('test') || fileName.includes('Test')) {
        reallyDeadFiles.push(filePath);
      } else if (filePath.includes('examples/') || filePath.includes('__tests__/')) {
        reallyDeadFiles.push(filePath);
      } else {
        probablyDeadFiles.push(filePath);
      }
    }
  });
  
  // Analizar dependencias
  const usedDeps = analyzeUsedDependencies();
  const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  const unusedDeps = [];
  const criticalDeps = [
    'react', 'react-dom', 'react-scripts', 'react-router-dom',
    '@supabase/supabase-js', 'react-toastify', 'framer-motion',
    '@testing-library/jest-dom', '@testing-library/react', '@testing-library/user-event',
    'web-vitals'
  ];
  
  Object.keys(allDeps).forEach(dep => {
    if (!usedDeps.has(dep) && !criticalDeps.includes(dep) && !dep.startsWith('@babel/') && !dep.includes('eslint') && !dep.includes('webpack')) {
      unusedDeps.push(dep);
    }
  });
  
  const report = `# 🧹 REPORTE FINAL DE LIMPIEZA - Team Balancer

Generado el: ${new Date().toLocaleString()}

## 📊 Resumen Ejecutivo

- **Total de archivos analizados**: ${allFiles.length}
- **Archivos seguros para eliminar**: ${reallyDeadFiles.length}
- **Archivos que requieren revisión manual**: ${probablyDeadFiles.length}
- **Dependencias no utilizadas**: ${unusedDeps.length}

---

## ✅ ARCHIVOS SEGUROS PARA ELIMINAR

Estos archivos pueden eliminarse sin riesgo:

${reallyDeadFiles.map(file => `- \`${file}\``).join('\n')}

### Comando para eliminar archivos seguros:
\`\`\`bash
${reallyDeadFiles.map(file => `rm "${file}"`).join('\n')}
\`\`\`

---

## ⚠️ ARCHIVOS QUE REQUIEREN REVISIÓN MANUAL

Estos archivos podrían estar en uso pero no se detectaron referencias directas:

${probablyDeadFiles.map(file => `- \`${file}\``).join('\n')}

---

## 📦 DEPENDENCIAS NO UTILIZADAS

Estas dependencias pueden eliminarse del package.json:

${unusedDeps.map(dep => `- \`${dep}\``).join('\n')}

### Comando para eliminar dependencias:
\`\`\`bash
${unusedDeps.map(dep => `npm uninstall ${dep}`).join('\n')}
\`\`\`

---

## 🛠️ PLAN DE LIMPIEZA RECOMENDADO

### Paso 1: Eliminar archivos seguros
\`\`\`bash
# Crear backup
git add -A && git commit -m "Backup antes de limpieza"

# Eliminar archivos seguros
${reallyDeadFiles.map(file => `rm "${file}"`).join('\n')}
\`\`\`

### Paso 2: Eliminar dependencias no utilizadas
\`\`\`bash
${unusedDeps.map(dep => `npm uninstall ${dep}`).join('\n')}
\`\`\`

### Paso 3: Probar la aplicación
\`\`\`bash
npm start
npm test
npm run build
\`\`\`

### Paso 4: Revisar archivos dudosos manualmente
Revisar uno por uno los archivos en la lista de "revisión manual"

---

## 📈 IMPACTO ESTIMADO

- **Archivos eliminados**: ${reallyDeadFiles.length}
- **Dependencias eliminadas**: ${unusedDeps.length}
- **Espacio liberado**: Estimado ~${Math.round((reallyDeadFiles.length * 2 + unusedDeps.length * 50) / 1024)} MB

---

## ⚠️ PRECAUCIONES

1. **Hacer backup** antes de cualquier eliminación
2. **Probar la aplicación** después de cada paso
3. **Revisar manualmente** archivos dudosos
4. **Verificar funcionalidad móvil** (Capacitor) después de eliminar dependencias

---

## 🔧 Script de limpieza automática

Ejecuta este script para limpiar automáticamente:

\`\`\`bash
#!/bin/bash
echo "🧹 Iniciando limpieza automática..."

# Backup
git add -A && git commit -m "Backup antes de limpieza automática"

# Eliminar archivos seguros
${reallyDeadFiles.map(file => `rm -f "${file}"`).join('\n')}

# Eliminar dependencias
${unusedDeps.map(dep => `npm uninstall ${dep}`).join('\n')}

echo "✅ Limpieza completada. Prueba la aplicación con: npm start"
\`\`\`
`;

  fs.writeFileSync('FINAL_CLEANUP_REPORT.md', report);
  
  // Crear script ejecutable
  const script = `#!/bin/bash
echo "🧹 Iniciando limpieza automática..."

# Backup
git add -A && git commit -m "Backup antes de limpieza automática"

# Eliminar archivos seguros
${reallyDeadFiles.map(file => `rm -f "${file}"`).join('\n')}

# Eliminar dependencias
${unusedDeps.map(dep => `npm uninstall ${dep}`).join('\n')}

echo "✅ Limpieza completada. Prueba la aplicación con: npm start"
`;

  fs.writeFileSync('auto-cleanup.sh', script);
  fs.chmodSync('auto-cleanup.sh', '755');
  
  console.log('✅ Reporte final generado: FINAL_CLEANUP_REPORT.md');
  console.log('✅ Script de limpieza generado: auto-cleanup.sh');
}

generateFinalReport();