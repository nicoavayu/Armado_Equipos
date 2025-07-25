const fs = require('fs');
const path = require('path');

const SRC_DIR = './src';
const PACKAGE_JSON_PATH = './package.json';
const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

const results = {
  allFiles: [],
  imports: new Map(),
  exports: new Map(),
  deadFiles: [],
  deadImports: [],
  unusedDependencies: [],
  usedDependencies: new Set()
};

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

function extractImports(content, filePath) {
  const imports = [];
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    // Remover comentarios
    const cleanLine = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    
    // Patrones de import mejorados
    const patterns = [
      // import React from 'react'
      /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
      // import { useState, useEffect } from 'react'
      /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/,
      // import * as React from 'react'
      /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
      // import 'react'
      /import\s+['"]([^'"]+)['"]/,
      // const React = require('react')
      /const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/,
      // const { useState } = require('react')
      /const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(['"]([^'"]+)['"]\)/
    ];
    
    patterns.forEach(pattern => {
      const match = cleanLine.match(pattern);
      if (match) {
        if (match[2]) {
          // Import con from
          const imported = match[1] ? match[1].split(',').map(s => s.trim()) : ['default'];
          imported.forEach(imp => {
            imports.push({
              module: match[2],
              imported: imp,
              line: index + 1,
              fullLine: line.trim()
            });
          });
        } else if (match[1]) {
          // Import directo
          imports.push({
            module: match[1],
            imported: 'default',
            line: index + 1,
            fullLine: line.trim()
          });
        }
      }
    });
  });
  
  return imports;
}

function isImportUsed(content, importName, moduleName) {
  // Casos especiales
  if (importName === 'default' || importName === 'React') return true;
  if (moduleName.includes('.css') || moduleName.includes('.svg')) return true;
  
  // Buscar uso del import
  const patterns = [
    new RegExp(`\\b${importName}\\b`, 'g'),
    new RegExp(`${importName}\\.`, 'g'),
    new RegExp(`<${importName}`, 'g'),
    new RegExp(`{${importName}}`, 'g')
  ];
  
  return patterns.some(pattern => pattern.test(content));
}

function analyzeProject() {
  console.log('🔍 Analizando proyecto mejorado...');
  
  results.allFiles = getAllFiles(SRC_DIR);
  console.log(`📁 Encontrados ${results.allFiles.length} archivos`);
  
  // Analizar cada archivo
  results.allFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const imports = extractImports(content, filePath);
      
      results.imports.set(filePath, imports);
      
      // Verificar imports no utilizados
      imports.forEach(imp => {
        if (!isImportUsed(content, imp.imported, imp.module)) {
          results.deadImports.push({
            file: filePath,
            import: imp.imported,
            module: imp.module,
            line: imp.line,
            fullLine: imp.fullLine
          });
        }
        
        // Marcar dependencias como usadas
        if (!imp.module.startsWith('.') && !imp.module.startsWith('/')) {
          const depName = imp.module.split('/')[0];
          if (depName.startsWith('@')) {
            // Scoped package
            const scopedName = imp.module.split('/').slice(0, 2).join('/');
            results.usedDependencies.add(scopedName);
          } else {
            results.usedDependencies.add(depName);
          }
        }
      });
      
    } catch (error) {
      console.error(`❌ Error analizando ${filePath}:`, error.message);
    }
  });
  
  detectDeadFiles();
  detectUnusedDependencies();
  generateImprovedReport();
}

function detectDeadFiles() {
  console.log('🔍 Detectando archivos muertos...');
  
  // Archivos de entrada que siempre se consideran usados
  const entryFiles = [
    'src/index.js',
    'src/App.js',
    'src/reportWebVitals.js',
    'src/setupTests.js'
  ];
  
  results.allFiles.forEach(filePath => {
    let isUsed = false;
    
    // Verificar si es archivo de entrada
    if (entryFiles.some(entry => filePath.endsWith(entry))) {
      isUsed = true;
    }
    
    // Verificar si es importado por otros archivos
    if (!isUsed) {
      results.allFiles.forEach(otherFile => {
        if (otherFile === filePath) return;
        
        const imports = results.imports.get(otherFile) || [];
        const relativePath = path.relative(path.dirname(otherFile), filePath);
        const withoutExt = relativePath.replace(/\.(js|jsx|ts|tsx)$/, '');
        
        const possiblePaths = [
          relativePath,
          withoutExt,
          `./${withoutExt}`,
          `../${withoutExt}`,
          withoutExt.replace(/^\.\.\//, ''),
          withoutExt.replace(/^\.\//, '')
        ];
        
        if (imports.some(imp => possiblePaths.includes(imp.module))) {
          isUsed = true;
        }
      });
    }
    
    if (!isUsed) {
      results.deadFiles.push(filePath);
    }
  });
}

function detectUnusedDependencies() {
  console.log('🔍 Detectando dependencias no utilizadas...');
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    
    // Dependencias que siempre se consideran necesarias
    const alwaysNeeded = [
      'react-scripts',
      '@testing-library/jest-dom',
      '@testing-library/react',
      '@testing-library/user-event',
      'web-vitals',
      '@capacitor/cli',
      'eslint',
      'stylelint',
      'webpack',
      'webpack-cli',
      'webpack-dev-server'
    ];
    
    Object.keys(allDeps).forEach(dep => {
      const isUsed = results.usedDependencies.has(dep);
      const isAlwaysNeeded = alwaysNeeded.some(needed => dep.includes(needed));
      const isBabelPlugin = dep.startsWith('@babel/');
      
      if (!isUsed && !isAlwaysNeeded && !isBabelPlugin) {
        results.unusedDependencies.push(dep);
      }
    });
  } catch (error) {
    console.error('❌ Error leyendo package.json:', error.message);
  }
}

function generateImprovedReport() {
  console.log('📝 Generando reporte mejorado...');
  
  // Filtrar imports muertos más precisamente
  const realDeadImports = results.deadImports.filter(item => {
    // No marcar como muerto si es CSS, SVG o side effect
    if (item.module.includes('.css') || item.module.includes('.svg')) return false;
    if (item.fullLine.includes('import \'') || item.fullLine.includes('import "')) return false;
    
    // No marcar React como muerto
    if (item.import === 'React' || item.import === 'default') return false;
    
    return true;
  });
  
  let report = `# 🧹 Reporte de Limpieza Mejorado - Team Balancer

Generado el: ${new Date().toLocaleString()}

## 📊 Resumen

- **Total de archivos analizados**: ${results.allFiles.length}
- **Archivos potencialmente muertos**: ${results.deadFiles.length}
- **Imports potencialmente no utilizados**: ${realDeadImports.length}
- **Dependencias potencialmente huérfanas**: ${results.unusedDependencies.length}

---

## 🗑️ Archivos que PODRÍAN eliminarse (revisar manualmente)

${results.deadFiles.length === 0 ? '✅ No se encontraron archivos muertos.' : ''}
${results.deadFiles.map(file => `- \`${file}\``).join('\n')}

---

## 📦 Dependencias que PODRÍAN eliminarse del package.json

${results.unusedDependencies.length === 0 ? '✅ No se encontraron dependencias huérfanas.' : ''}
${results.unusedDependencies.map(dep => `- \`${dep}\``).join('\n')}

---

## 🔗 Imports que PODRÍAN no utilizarse

${realDeadImports.length === 0 ? '✅ No se encontraron imports no utilizados.' : ''}
${realDeadImports.map(item => 
  `### \`${item.file}\` (línea ${item.line})
\`\`\`javascript
${item.fullLine}
\`\`\`
- Import: \`${item.import}\` de \`${item.module}\``
).join('\n\n')}

---

## ⚠️ IMPORTANTE - Revisar antes de eliminar

### Archivos que probablemente SÍ están en uso:
- \`src/WeatherWidget.js\` - Usado en componentes
- \`src/supabase.js\` - Configuración de base de datos
- Archivos en \`src/components/\` - Muchos son componentes activos
- Archivos en \`src/hooks/\` - Custom hooks utilizados
- Archivos en \`src/services/\` - Servicios de la aplicación

### Dependencias que probablemente SÍ son necesarias:
- \`@supabase/supabase-js\` - Base de datos
- \`react-router-dom\` - Navegación
- \`react-toastify\` - Notificaciones
- \`@capacitor/*\` - Funcionalidad móvil
- \`framer-motion\` - Animaciones

---

## 🔧 Recomendaciones de limpieza segura

1. **Primero elimina solo los archivos de test no utilizados**:
   \`\`\`bash
   rm src/__tests__/AuthProvider.test.js
   rm src/__tests__/PlayerForm.test.js
   rm src/__tests__/TeamGenerator.test.js
   \`\`\`

2. **Elimina archivos de ejemplo**:
   \`\`\`bash
   rm src/examples/NotificationExample.js
   \`\`\`

3. **Revisa manualmente cada archivo antes de eliminar**

4. **Para las dependencias, verifica en el código si realmente no se usan**

---

## 🚀 Próximos pasos recomendados

1. Revisar manualmente cada archivo marcado como "muerto"
2. Buscar referencias en archivos CSS, HTML o configuración
3. Probar la aplicación después de cada eliminación
4. Hacer commits pequeños para poder revertir cambios
`;

  fs.writeFileSync('CLEANUP_REPORT_IMPROVED.md', report);
  console.log('✅ Reporte mejorado generado: CLEANUP_REPORT_IMPROVED.md');
}

analyzeProject();