# 🛠️ Plan Detallado de Ejecución - Mejoras del Proyecto

## Parte 1: Problemas Críticos (Semana 1)

### ✅ Tarea 1.1: Corregir Error de Compilación en MatchInfoSection.jsx

**Archivo**: [src/components/MatchInfoSection.jsx](src/components/MatchInfoSection.jsx#L80)  
**Tiempo**: 15 minutos  
**Dificultad**: 🟢 Fácil

#### Opción A: Actualizar jsconfig.json (RECOMENDADA)

```json
{
  "compilerOptions": {
    "target": "ES6",  // ← AGREGAR ESTA LÍNEA
    "baseUrl": "src",
    "paths": {
      "@/*": ["*"],
      "@components/*": ["components/*"],
      // ... resto igual
    },
    "jsx": "react",
    "checkJs": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "dist"]
}
```

#### Opción B: Cambiar el Regex (Si Opción A no funciona)

En `src/components/MatchInfoSection.jsx`, línea 80:

```javascript
// ❌ ANTES
const cleaned = w.replace(/[^\p{L}\p{N}_-]/gu, ''); // remove punctuation

// ✅ DESPUÉS
const cleaned = w.replace(/[^a-zA-Z0-9_-]/g, ''); // remove punctuation
```

**Verificación**:
```bash
npm run build
# Debe compilar sin errores
```

---

### ✅ Tarea 1.2: Habilitar ESLint y Corregir Errores

**Archivo**: [package.json](package.json#L45)  
**Tiempo**: 2-3 horas  
**Dificultad**: 🟡 Media

#### Paso 1: Modificar package.json

```json
{
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",  // ← REMOVER DISABLE_ESLINT_PLUGIN=true
    "test": "react-scripts test",
    "eject": "react-scripts eject",
    "lint": "eslint src/ --ext .js,.jsx",  // ← AGREGAR
    "lint:fix": "eslint src/ --ext .js,.jsx --fix"  // ← AGREGAR
  }
}
```

#### Paso 2: Ejecutar y Revisar Errores

```bash
npm run lint
# Verá lista de errores
```

#### Paso 3: Arreglar Errores Automáticos

```bash
npm run lint:fix
# Arregla automáticamente lo que pueda
```

#### Paso 4: Corregir Manualmente los Restantes

Errores comunes que encontrará:
- `no-unused-vars`: Variables declaradas pero no usadas
- `no-console`: console.log no permitido → Tarea 1.3
- `react-hooks/exhaustive-deps`: Dependencias faltantes en useEffect
- `react/prop-types`: Sin validación de props (está apagado, ignorar)

**Ejemplo de correción para react-hooks/exhaustive-deps**:

```javascript
// ❌ ANTES
useEffect(() => {
  loadData();
}, []); // Falta 'loadData' en dependencias

// ✅ DESPUÉS
useEffect(() => {
  const loadData = async () => {
    // ...
  };
  loadData();
}, []); // Ahora está permitido
```

---

### ✅ Tarea 1.3: Crear Logger Centralizado y Remover console.log

**Tiempo**: 2-3 horas  
**Dificultad**: 🟡 Media

#### Paso 1: Crear src/utils/logger.js

```javascript
/**
 * Centralizado logger para la aplicación
 * En desarrollo muestra todos los logs
 * En producción solo muestra errores
 */

const isDev = process.env.NODE_ENV === 'development';

const logger = {
  /**
   * Log de debug (solo en desarrollo)
   */
  debug: (label, data) => {
    if (isDev) {
      console.log(`[${label}]`, data);
    }
  },

  /**
   * Log de info (solo en desarrollo)
   */
  info: (label, data) => {
    if (isDev) {
      console.info(`[${label}]`, data);
    }
  },

  /**
   * Log de warning (solo en desarrollo)
   */
  warn: (label, message) => {
    if (isDev) {
      console.warn(`[${label}]`, message);
    }
  },

  /**
   * Log de error (siempre, incluye en producción)
   */
  error: (label, error) => {
    console.error(`[${label}]`, error);
    // TODO: Enviar a servicio de error tracking (Sentry, etc)
  },
};

export default logger;
```

#### Paso 2: Reemplazar console.log en Archivos Críticos

Buscar archivos con `console.log`:
```bash
grep -r "console\.log" src/ --include="*.js" --include="*.jsx" | head -20
```

**Archivos prioritarios** (30+ matches):
1. `src/services/notificationService.js`
2. `src/services/matchStatsService.js`
3. `src/services/absenceService.js`
4. `src/services/db/matches.js`
5. `src/services/surveyService.js`

#### Reemplazos de Ejemplo:

**Antes** (src/services/notificationService.js):
```javascript
console.log('[CallToVote] start', { partidoId, type });
console.error('[Notifications] fallback partido query failed', fallbackErr);
```

**Después**:
```javascript
import logger from '../utils/logger';

logger.debug('CallToVote', { action: 'start', partidoId, type });
logger.error('Notifications', new Error(`Fallback query failed: ${fallbackErr}`));
```

#### Paso 3: Script de Búsqueda y Reemplazo (Opcional)

```bash
# Encontrar todos los console.log
grep -r "console\.log" src/ --include="*.js" --include="*.jsx" -n

# Reemplazar manualmente o crear script:
# for file in $(grep -r "console\.log" src/ --include="*.js" --include="*.jsx" -l); do
#   sed -i 's/console\.log(/logger.debug(/g' "$file"
# done
```

---

### ✅ Tarea 1.4: Remover Código Comentado

**Tiempo**: 1 hora  
**Dificultad**: 🟢 Fácil

Buscar y remover:
```bash
grep -r "// import" src/ --include="*.js" --include="*.jsx" | head -20
```

**Ejemplos a remover**:

```javascript
// ❌ En App.js línea 1
// import './HomeStyleKit.css'; // Removed in Tailwind migration

// ❌ En ProfileEditor.js
// import '../HomeStyleKit.css'; // Removed in Tailwind migration

// ❌ En index.js
//         console.log('SW registered: ', registration);
//         console.log('SW registration failed: ', registrationError);
```

**Script para limpiar**:
```bash
# Remover lineas comentadas que están solas
find src -name "*.js" -o -name "*.jsx" | xargs sed -i '/^[[:space:]]*\/\//d'

# CUIDADO: Esto removerá TODOS los comentarios, mejor hacerlo manualmente
```

**Mejor: Hacerlo manualmente por archivo:**

1. [src/App.js](src/App.js#L1) - Remover import comentados
2. [src/index.js](src/index.js#L25) - Remover console.log comentados
3. [src/components/ProfileEditor.js](src/components/ProfileEditor.js#L1) - Remover imports comentados

---

## Parte 2: Problemas Arquitectónicos (Semana 2)

### ✅ Tarea 2.1: Reorganizar src/ Directory

**Tiempo**: 4-6 horas  
**Dificultad**: 🟡 Media

#### Paso 1: Crear Nueva Estructura

```bash
# Crear carpetas necesarias
mkdir -p src/assets src/components/common src/components/layout src/components/match

# Si no existen
mkdir -p src/styles src/lib
```

#### Paso 2: Mover Archivos

**Archivos de assets**:
```bash
mv src/Logo*.png src/assets/
mv src/SVG_*.svg src/assets/
mv src/football.svg src/assets/
mv src/Digital_Glyph_White.svg src/assets/
```

**Archivos de páginas** (si no están en src/pages/):
```bash
mv src/IngresoAdminPartido.js src/pages/ 2>/dev/null || true
# (Probablemente ya existan en src/pages/)
```

**Archivos de componentes comunes**:
```bash
# Revisar y mover componentes generales
# Button.js, LoadingSpinner.js, Modal.js, etc.
# La mayoría probablemente ya están en src/components/
```

#### Paso 3: Actualizar Imports

```bash
# Buscar y actualizar imports de assets
grep -r "from.*Logo" src/ --include="*.js" --include="*.jsx" | head -5
```

**Ejemplo de cambio**:
```javascript
// ❌ ANTES
import Logo from '../Logo.png';

// ✅ DESPUÉS
import Logo from '../assets/Logo.png';
```

**Script para actualizar**: (hacer manualmente por archivo o usar find/replace)

---

### ✅ Tarea 2.2: Extraer Lógica de ProfileEditor a Hooks

**Tiempo**: 6-8 horas  
**Dificultad**: 🟠 Media-Difícil

#### Paso 1: Crear Hook useProfileForm

**Crear**: `src/hooks/useProfileForm.js`

```javascript
import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para gestionar el formulario de perfil
 * @param {Object} initialProfile - Perfil inicial
 * @param {Function} onSave - Callback al guardar
 * @returns {Object} Estado y funciones del formulario
 */
export function useProfileForm(initialProfile, onSave) {
  const [formData, setFormData] = useState({
    nombre: '',
    email: '',
    telefono: '',
    nacionalidad: 'Argentina',
    pais_codigo: 'AR',
    posicion: 'DEF',
    fecha_nacimiento: null,
    social: '',
    localidad: '',
    latitud: null,
    longitud: null,
    partidos_jugados: 0,
    partidos_abandonados: 0,
    ranking: 4.5,
    bio: '',
    acepta_invitaciones: true,
  });

  const [hasChanges, setHasChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Inicializar con datos del perfil
  useEffect(() => {
    if (initialProfile) {
      const newFormData = {
        nombre: initialProfile.nombre || '',
        email: initialProfile.email || '',
        // ... resto de campos
      };
      setFormData(newFormData);
      setHasChanges(false);
    }
  }, [initialProfile]);

  // Manejar cambios en inputs
  const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  }, []);

  // Guardar cambios
  const handleSave = useCallback(async () => {
    setIsLoading(true);
    try {
      await onSave(formData);
      setHasChanges(false);
    } catch (error) {
      console.error('Error saving profile:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [formData, onSave]);

  return {
    formData,
    hasChanges,
    isLoading,
    handleInputChange,
    handleSave,
  };
}
```

#### Paso 2: Refactorizar ProfileEditor.js

**Antes** (817 líneas):
```javascript
function ProfileEditor({ isOpen, onClose }) {
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [liveProfile, setLiveProfile] = useState(profile);
  const [hasChanges, setHasChanges] = useState(false);
  
  // ... 800+ líneas más
}
```

**Después** (mucho más limpio):
```javascript
import { useProfileForm } from '../hooks/useProfileForm';

function ProfileEditor({ isOpen, onClose }) {
  const { user, profile, refreshProfile } = useAuth();
  const {
    formData,
    hasChanges,
    isLoading,
    handleInputChange,
    handleSave,
  } = useProfileForm(profile, updateProfile);

  const handleSaveAndClose = async () => {
    await handleSave();
    onClose();
  };

  return (
    <div>
      <ProfileForm 
        data={formData}
        onInputChange={handleInputChange}
        onSave={handleSaveAndClose}
        isLoading={isLoading}
      />
    </div>
  );
}
```

---

### ✅ Tarea 2.3: Refactorizar App.js - Eliminar Duplicación

**Tiempo**: 3-4 horas  
**Dificultad**: 🟡 Media

#### Paso 1: Crear Componente Reutilizable

**Crear**: `src/components/common/PageSuspense.js`

```javascript
import React, { Suspense } from 'react';
import LoadingSpinner from './LoadingSpinner';

/**
 * Envuelve una página con Suspense y fallback estándar
 */
export function PageRoute({ element }) {
  return (
    <Suspense fallback={<PageLoadingFallback />}>
      {element}
    </Suspense>
  );
}

function PageLoadingFallback() {
  return (
    <div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center">
      <LoadingSpinner size="large" />
    </div>
  );
}
```

#### Paso 2: Actualizar App.js

**Antes** (15 repeticiones):
```javascript
<Route path="nuevo-partido" element={
  <Suspense fallback={
    <div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center">
      <LoadingSpinner size="large" />
    </div>
  }>
    <NuevoPartidoPage />
  </Suspense>
} />

<Route path="quiero-jugar" element={
  <Suspense fallback={
    <div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center">
      <LoadingSpinner size="large" />
    </div>
  }>
    <QuieroJugarPage />
  </Suspense>
} />
// ... repetido 13 veces más
```

**Después** (limpio):
```javascript
import { PageRoute } from './components/common/PageSuspense';

// En las rutas:
<Route path="nuevo-partido" element={
  <PageRoute element={<NuevoPartidoPage />} />
} />

<Route path="quiero-jugar" element={
  <PageRoute element={<QuieroJugarPage />} />
} />
// Mucho más legible
```

---

### ✅ Tarea 2.4: Estandarizar Extensiones de Archivo

**Tiempo**: 2-3 horas  
**Dificultad**: 🟡 Media

#### Paso 1: Identificar Archivos para Renombrar

```bash
# Encontrar todos los .js que son componentes React
grep -r "^import React" src --include="*.js" -l | head -20
```

Estos deberían ser `.jsx`:
- src/components/*.js
- src/pages/*.js
- src/context/*.js (algunos)

#### Paso 2: Renombrar Archivos

```bash
# Opción 1: Hacer manualmente en VS Code
# - Click derecho → Rename
# - Cambiar .js a .jsx

# Opción 2: Script bash (si sabes qué archivos)
# for file in src/components/*.js src/pages/*.js; do
#   mv "$file" "${file%.js}.jsx"
# done
```

#### Paso 3: Actualizar Imports

Hacer find/replace en VS Code:
```
Find: from '\./(.*?)\.js';
Replace: from './$1.jsx';
```

**Casos especiales a mantener como .js**:
- src/supabase.js
- src/index.js
- Archivos en src/services/
- Archivos en src/utils/
- src/setupTests.js

---

## Parte 3: Testing y Documentación (Semana 3+)

### ✅ Tarea 3.1: Crear Tests Unitarios

**Tiempo**: 16-20 horas  
**Dificultad**: 🟠 Difícil

#### Paso 1: Estructura de Tests

```bash
mkdir -p src/__tests__/{components,hooks,utils,services}
```

#### Paso 2: Test de parsePriceNumber (Función Crítica)

**Crear**: `src/__tests__/utils/parsePriceNumber.test.js`

```javascript
import { parsePriceNumber } from '../../utils/parsePriceNumber';

describe('parsePriceNumber', () => {
  describe('currency symbols', () => {
    it('should remove $ symbol', () => {
      expect(parsePriceNumber('$1234')).toBe(1234);
    });

    it('should handle multiple symbols', () => {
      expect(parsePriceNumber('$$1,234.56')).toBe(1234.56);
    });
  });

  describe('decimal formats', () => {
    it('should handle US format (comma as thousands)', () => {
      expect(parsePriceNumber('1,234.56')).toBe(1234.56);
    });

    it('should handle European format (dot as thousands)', () => {
      expect(parsePriceNumber('1.234,56')).toBe(1234.56);
    });

    it('should handle comma as decimal', () => {
      expect(parsePriceNumber('1234,56')).toBe(1234.56);
    });
  });

  describe('edge cases', () => {
    it('should return null for invalid input', () => {
      expect(parsePriceNumber('invalid')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parsePriceNumber('')).toBeNull();
    });

    it('should return null for null', () => {
      expect(parsePriceNumber(null)).toBeNull();
    });

    it('should handle negative numbers', () => {
      expect(parsePriceNumber('-$1234')).toBe(-1234);
    });
  });
});
```

#### Paso 3: Ejecutar Tests

```bash
npm test
# Ejecutará Jest y los tests
```

---

### ✅ Tarea 3.2: Añadir JSDoc a Funciones Complejas

**Tiempo**: 4-6 horas  
**Dificultad**: 🟢 Fácil

Enfocarse en:
1. Functions en `src/utils/`
2. Custom hooks en `src/hooks/`
3. Services en `src/services/`

**Ejemplo**:
```javascript
/**
 * Parsea un string de precio en múltiples formatos
 * 
 * Soporta:
 * - Símbolos de moneda ($, €, £)
 * - Puntos como separador de miles
 * - Comas como separador de miles o decimal
 * 
 * @param {string|number|null} raw - Valor de precio a parsear
 * @returns {number|null} Número parseado o null si inválido
 * 
 * @example
 * parsePriceNumber('$1,234.56')   // 1234.56
 * parsePriceNumber('1.234,56')    // 1234.56 (europeo)
 * parsePriceNumber('1234,50')     // 1234.50
 * parsePriceNumber('invalid')     // null
 */
const parsePriceNumber = (raw) => {
  // implementación
};
```

---

### ✅ Tarea 3.3: Documentación de Módulos

**Crear**: `src/services/README.md`

```markdown
# Services - Servicios de Lógica de Negocio

## Estructura

- **db/** - Servicios de base de datos
  - matches.js - Operaciones de partidos
  - profiles.js - Operaciones de perfiles
  - etc.

- **api/** - Llamadas a APIs externas
  - supabase.js - Cliente Supabase

- **auth/** - Autenticación

## Uso

```javascript
import { getPartido } from '@services/db/matches';

const partido = await getPartido(partidoId);
```

...
```

---

## Parte 4: Futuro (Mes 2-3)

### 📌 Tarea 4.1: Migrar a TypeScript

**Tiempo**: 40+ horas  
**Dificultad**: 🔴 Muy Difícil

1. Instalar TypeScript y configurar `tsconfig.json`
2. Renombrar archivos `.js` a `.ts` / `.jsx` a `.tsx`
3. Añadir tipos a:
   - Props de componentes
   - Funciones
   - API responses
   - State

### 📌 Tarea 4.2: Setup de Sentry (Error Tracking)

Reemplazar logger.error con envío a Sentry:
```javascript
import * as Sentry from "@sentry/react";

logger.error = (label, error) => {
  console.error(`[${label}]`, error);
  Sentry.captureException(error, {
    contexts: {
      app: { label }
    }
  });
};
```

### 📌 Tarea 4.3: Implementar i18n

Usar `react-i18next` para internacionalización:
```javascript
import { useTranslation } from 'react-i18next';

function Component() {
  const { t } = useTranslation();
  return <h1>{t('common.welcome')}</h1>;
}
```

---

## 📋 Checklist de Implementación

### Semana 1 - Críticos
- [ ] Corregir regex Unicode en MatchInfoSection.jsx
- [ ] Habilitar ESLint y corregir errores
- [ ] Crear logger centralizado
- [ ] Remover console.log
- [ ] Remover código comentado
- [ ] Verificar que `npm run build` funciona

### Semana 2 - Arquitectura
- [ ] Reorganizar src/ (assets, componentes, páginas)
- [ ] Crear hook useProfileForm
- [ ] Refactorizar ProfileEditor.js
- [ ] Crear PageRoute component
- [ ] Actualizar App.js
- [ ] Estandarizar extensiones (.jsx)
- [ ] Actualizar todos los imports

### Semana 3+ - Testing
- [ ] Crear estructura de tests
- [ ] Escribir tests para funciones críticas
- [ ] Añadir JSDoc
- [ ] Documentar módulos
- [ ] Setup CI/CD

### Futuro
- [ ] Migrar a TypeScript (future)
- [ ] Setup Sentry (error tracking)
- [ ] Implementar i18n (si es global)
- [ ] Storybook para componentes

---

## 🚀 Cómo Ejecutar Este Plan

1. **Leer este documento completo**
2. **Hacer una rama nueva**: `git checkout -b refactor/cleanup-week1`
3. **Implementar Tarea 1.1 - 1.4** (Semana 1)
4. **Hacer commit y push**: `git push origin refactor/cleanup-week1`
5. **Crear Pull Request para revisar**
6. **Una vez aprobado, continuar con Semana 2, etc.**

---

**Última actualización**: 27 de Enero, 2026
