# 🎯 Top 5 Prioridades - Team Balancer

## 1. 🔴 CRÍTICO: Corregir Error de Compilación en MatchInfoSection.jsx

**Impacto**: El proyecto NO compila actualmente.  
**Tiempo**: 15 minutos  
**Línea de código**: [src/components/MatchInfoSection.jsx#L80](src/components/MatchInfoSection.jsx#L80)

```javascript
// ❌ PROBLEMA
const cleaned = w.replace(/[^\p{L}\p{N}_-]/gu, '');

// ✅ SOLUCIÓN 1: Actualizar jsconfig.json
// "target": "ES6"

// ✅ SOLUCIÓN 2: Cambiar el regex
const cleaned = w.replace(/[^a-zA-Z0-9_-]/g, '');
```

**Acción**: Haz esto **HOY**, es lo primero.

---

## 2. 🔴 CRÍTICO: Habilitar ESLint en Build

**Impacto**: Build oculta errores, bugs escapan a producción.  
**Tiempo**: 2-3 horas  
**Archivo**: [package.json#L45](package.json#L45)

```json
// ❌ ANTES
"build": "DISABLE_ESLINT_PLUGIN=true react-scripts build"

// ✅ DESPUÉS
"build": "react-scripts build"
```

**Luego**:
```bash
npm run lint
npm run lint:fix
# Corregir los que quedan manualmente
```

---

## 3. 🔴 CRÍTICO: Remover console.log de Producción

**Impacto**: Leaks de información, performance degradado.  
**Archivos**: 30+ archivos  
**Tiempo**: 2-3 horas

**Crear archivo centralizado**: `src/utils/logger.js`

```javascript
const isDev = process.env.NODE_ENV === 'development';

export default {
  debug: (label, data) => isDev && console.log(`[${label}]`, data),
  error: (label, error) => console.error(`[${label}]`, error),
};
```

**Reemplazar en servicios**:
```javascript
// ❌ Antes
console.log('[CallToVote] start', { partidoId, type });

// ✅ Después  
import logger from '../utils/logger';
logger.debug('CallToVote', { action: 'start', partidoId, type });
```

---

## 4. 🟡 ALTA: Reorganizar src/ - Demasiado Caótico

**Impacto**: Difícil navegar, difícil mantener.  
**Tiempo**: 4-6 horas  
**Problema**: 40+ archivos en src/ raíz

**Mover archivos**:
```bash
# Assets
mv src/Logo*.png src/assets/
mv src/SVG_*.svg src/assets/
mv src/football.svg src/assets/

# Verificar que src/pages/ y src/components/ existan
# y reorganizar según necesidad
```

**Estructura final**:
```
src/
├── assets/           (imágenes, SVGs)
├── components/       (componentes React)
├── context/          (Context API)
├── hooks/            (custom hooks)
├── pages/            (páginas completas)
├── services/         (lógica de negocio)
├── utils/            (utilidades)
├── constants/        (constantes)
└── lib/              (librerías custom)
```

---

## 5. 🟡 ALTA: Extraer Lógica de Componentes Grandes

**Impacto**: Componentes más mantenibles, reutilización de lógica.  
**Archivo**: [src/components/ProfileEditor.js](src/components/ProfileEditor.js) (817 líneas)  
**Tiempo**: 6-8 horas

**Crear hook**:
```javascript
// src/hooks/useProfileForm.js
export function useProfileForm(initialProfile, onSave) {
  const [formData, setFormData] = useState({...});
  const [hasChanges, setHasChanges] = useState(false);
  
  // Toda la lógica del formulario
  
  return { formData, hasChanges, handleInputChange, handleSave };
}
```

**Usar en componente**:
```javascript
function ProfileEditor({ isOpen, onClose }) {
  const { formData, hasChanges, handleInputChange, handleSave } = 
    useProfileForm(profile, updateProfile);
  
  // Solo UI, muy limpio
  return <ProfileForm data={formData} onChange={handleInputChange} />;
}
```

---

## 📋 Quick Action List

### Hoy (1-2 horas):
- [ ] Corregir regex Unicode
- [ ] Verificar que `npm run build` funciona

### Esta semana (6-8 horas):
- [ ] Habilitar ESLint
- [ ] Crear logger centralizado
- [ ] Remover console.log
- [ ] Remover código comentado

### Próxima semana (12+ horas):
- [ ] Reorganizar src/
- [ ] Crear hooks de lógica
- [ ] Refactorizar componentes grandes

---

## 📚 Documentación Disponible

- **CODE_REVIEW.md** - Análisis completo (540 líneas)
- **EXECUTION_PLAN.md** - Plan paso a paso (800+ líneas)
- **Este documento** - Resumen ejecutivo

---

## ✅ Checklist de Éxito

Una vez implementes estas 5 prioridades, el proyecto estará mucho mejor:

- [ ] Proyecto compila sin errores
- [ ] ESLint está habilitado y no hay warnings
- [ ] Sin console.log en producción
- [ ] src/ está bien organizado
- [ ] Componentes mantenibles (< 500 líneas)

**Estimado**: 2 semanas de trabajo fulltime = **80 horas**

---

**Buena suerte! 🚀**
