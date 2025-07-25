const fs = require('fs');
const path = require('path');

// Configuración
const SRC_DIR = './src';
const PACKAGE_JSON_PATH = './package.json';
const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

// Resultados del análisis
const results = {
  allFiles: [],
  imports: new Map(),
  exports: new Map(),
  deadFiles: [],
  deadImports: [],
  unusedDependencies: [],
  usedDependencies: new Set()
};

// Función para obtener todos los archivos JS/TS/JSX/TSX
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

// Función para extraer imports de un archivo
function extractImports(content, filePath) {
  const imports = [];
  
  // Regex para diferentes tipos de imports
  const importPatterns = [
    // import React from 'react'
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    // import { useState, useEffect } from 'react'
    /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/g,
    // import * as React from 'react'
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    // import 'react'
    /import\s+['"]([^'"]+)['"]/g,
    // const React = require('react')
    /const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g,
    // const { useState } = require('react')
    /const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(['"]([^'"]+)['"]\)/g
  ];
  
  importPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[2]) {
        // Import con from
        imports.push({
          module: match[2],
          imported: match[1] || 'default',
          line: content.substring(0, match.index).split('\n').length
        });
      } else if (match[1]) {
        // Import directo
        imports.push({
          module: match[1],
          imported: 'default',
          line: content.substring(0, match.index).split('\n').length
        });
      }
    }
  });
  
  return imports;
}

// Función para extraer exports de un archivo
function extractExports(content) {
  const exports = [];
  
  const exportPatterns = [
    /export\s+default\s+(\w+)/g,
    /export\s+\{\s*([^}]+)\s*\}/g,
    /export\s+const\s+(\w+)/g,
    /export\s+function\s+(\w+)/g,
    /export\s+class\s+(\w+)/g
  ];
  
  exportPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      exports.push(match[1]);
    }
  });
  
  return exports;
}

// Función para verificar si un import se usa en el código
function isImportUsed(content, importName, moduleName) {
  if (importName === 'default') return true; // Asumimos que los imports default se usan
  
  // Buscar uso del import en el código
  const usagePatterns = [
    new RegExp(`\\b${importName}\\b`, 'g'),
    new RegExp(`${importName}\\.`, 'g'),
    new RegExp(`<${importName}`, 'g')
  ];
  
  return usagePatterns.some(pattern => pattern.test(content));
}

// Función principal de análisis
function analyzeProject() {
  console.log('🔍 Analizando proyecto...');
  
  // Obtener todos los archivos
  results.allFiles = getAllFiles(SRC_DIR);
  console.log(`📁 Encontrados ${results.allFiles.length} archivos`);
  
  // Analizar cada archivo
  results.allFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const imports = extractImports(content, filePath);
      const exports = extractExports(content);
      
      results.imports.set(filePath, imports);
      results.exports.set(filePath, exports);
      
      // Verificar imports no utilizados
      imports.forEach(imp => {
        if (!isImportUsed(content, imp.imported, imp.module)) {
          results.deadImports.push({
            file: filePath,
            import: imp.imported,
            module: imp.module,
            line: imp.line
          });
        }
        
        // Marcar dependencias como usadas
        if (!imp.module.startsWith('.') && !imp.module.startsWith('/')) {
          const depName = imp.module.split('/')[0];
          results.usedDependencies.add(depName);
        }
      });
      
    } catch (error) {
      console.error(`❌ Error analizando ${filePath}:`, error.message);
    }
  });
  
  // Detectar archivos muertos
  detectDeadFiles();
  
  // Detectar dependencias no utilizadas
  detectUnusedDependencies();
  
  // Generar reporte
  generateReport();
}

// Función para detectar archivos muertos
function detectDeadFiles() {
  console.log('🔍 Detectando archivos muertos...');
  
  results.allFiles.forEach(filePath => {
    let isUsed = false;
    
    // Verificar si el archivo es importado por otros
    results.allFiles.forEach(otherFile => {
      if (otherFile === filePath) return;
      
      const imports = results.imports.get(otherFile) || [];
      const relativePath = path.relative(path.dirname(otherFile), filePath);
      const withoutExt = relativePath.replace(/\.(js|jsx|ts|tsx)$/, '');
      
      if (imports.some(imp => 
        imp.module === relativePath || 
        imp.module === withoutExt ||
        imp.module === `./${withoutExt}` ||
        imp.module === `../${withoutExt}`
      )) {
        isUsed = true;
      }
    });
    
    // Verificar si es un archivo de entrada (App.js, index.js, etc.)
    const fileName = path.basename(filePath);
    const isEntryFile = ['App.js', 'index.js', 'reportWebVitals.js', 'setupTests.js'].includes(fileName);
    
    if (!isUsed && !isEntryFile) {
      results.deadFiles.push(filePath);
    }
  });
}

// Función para detectar dependencias no utilizadas
function detectUnusedDependencies() {
  console.log('🔍 Detectando dependencias no utilizadas...');
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    
    Object.keys(allDeps).forEach(dep => {
      if (!results.usedDependencies.has(dep)) {
        // Verificar algunas excepciones comunes
        const exceptions = [
          'react-scripts', // Usado por npm scripts
          '@testing-library', // Usado en tests
          'web-vitals', // Usado en reportWebVitals
          '@capacitor/cli', // CLI tool
          'eslint', // Linter
          'stylelint', // CSS linter
          'webpack', // Build tool
          '@babel' // Babel plugins
        ];
        
        const isException = exceptions.some(exc => dep.includes(exc));
        
        if (!isException) {
          results.unusedDependencies.push(dep);
        }
      }
    });
  } catch (error) {
    console.error('❌ Error leyendo package.json:', error.message);
  }
}

// Función para generar el reporte
function generateReport() {
  console.log('📝 Generando reporte...');
  
  let report = `# 🧹 Reporte de Limpieza del Proyecto Team Balancer

Generado el: ${new Date().toLocaleString()}

## 📊 Resumen

- **Total de archivos analizados**: ${results.allFiles.length}
- **Archivos muertos**: ${results.deadFiles.length}
- **Imports no utilizados**: ${results.deadImports.length}
- **Dependencias huérfanas**: ${results.unusedDependencies.length}

---

## 🗑️ Archivos que puedes eliminar

${results.deadFiles.length === 0 ? '✅ No se encontraron archivos muertos.' : ''}
${results.deadFiles.map(file => `- \`${file}\``).join('\n')}

---

## 📦 Dependencias que puedes eliminar del package.json

${results.unusedDependencies.length === 0 ? '✅ No se encontraron dependencias huérfanas.' : ''}
${results.unusedDependencies.map(dep => `- \`${dep}\``).join('\n')}

---

## 🔗 Imports no utilizados por archivo

${results.deadImports.length === 0 ? '✅ No se encontraron imports no utilizados.' : ''}
${results.deadImports.map(item => 
  `### \`${item.file}\` (línea ${item.line})
- Import: \`${item.imported}\` de \`${item.module}\``
).join('\n\n')}

---

## 🛠️ Comandos para limpiar automáticamente

### Eliminar archivos muertos:
\`\`\`bash
${results.deadFiles.map(file => `rm "${file}"`).join('\n')}
\`\`\`

### Eliminar dependencias huérfanas:
\`\`\`bash
${results.unusedDependencies.map(dep => `npm uninstall ${dep}`).join('\n')}
\`\`\`

---

## ⚠️ Notas importantes

1. **Revisa manualmente** antes de eliminar archivos, especialmente si son:
   - Archivos de configuración
   - Assets que se cargan dinámicamente
   - Archivos referenciados en HTML o CSS

2. **Para los imports no utilizados**, algunos pueden ser:
   - Side effects necesarios
   - Tipos de TypeScript
   - Imports para JSX (React)

3. **Las dependencias** marcadas como huérfanas pueden ser:
   - Usadas en archivos de configuración
   - Dependencias de desarrollo necesarias
   - Plugins de Babel/Webpack

## 🔧 Script de limpieza automática

Ejecuta este comando para generar un script de limpieza:

\`\`\`bash
node generate-cleanup-script.js
\`\`\`
`;

  fs.writeFileSync('CLEANUP_REPORT.md', report);
  console.log('✅ Reporte generado: CLEANUP_REPORT.md');
  
  // Generar script de limpieza
  generateCleanupScript();
}

// Función para generar script de limpieza automática
function generateCleanupScript() {
  const script = `#!/bin/bash

# 🧹 Script de limpieza automática para Team Balancer
# Generado automáticamente - REVISA ANTES DE EJECUTAR

echo "🧹 Iniciando limpieza del proyecto..."

# Eliminar archivos muertos
echo "🗑️ Eliminando archivos muertos..."
${results.deadFiles.map(file => `rm -f "${file}"`).join('\n')}

# Eliminar dependencias huérfanas
echo "📦 Eliminando dependencias huérfanas..."
${results.unusedDependencies.map(dep => `npm uninstall ${dep}`).join('\n')}

echo "✅ Limpieza completada!"
echo "📝 Revisa el archivo CLEANUP_REPORT.md para más detalles"
`;

  fs.writeFileSync('cleanup.sh', script);
  fs.chmodSync('cleanup.sh', '755');
  console.log('✅ Script de limpieza generado: cleanup.sh');
}

// Ejecutar análisis
analyzeProject();