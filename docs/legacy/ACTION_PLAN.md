# 🚀 PLAN DE ACCIÓN - TEAM BALANCER

## 📋 GUÍA DE IMPLEMENTACIÓN PASO A PASO

---

## 🔴 FASE 1: SEGURIDAD CRÍTICA (Días 1-3)

### Día 1: Vulnerabilidades CWE-94 (setTimeout sin cleanup)

#### Tarea 1.1: Arreglar useAnimatedNavigation.js

**Archivo:** `src/hooks/useAnimatedNavigation.js`

```javascript
// ❌ ANTES (VULNERABLE)
export const useAnimatedNavigation = () => {
  const navigate = useNavigate();

  const navigateWithAnimation = (path, direction = 'forward') => {
    const currentPage = document.querySelector('.page-transition');
    if (currentPage) {
      currentPage.classList.add(direction === 'back' ? 'page-exit-back' : 'page-exit-forward');
    }
    
    setTimeout(() => {
      navigate(path);
    }, 300);
  };

  return { navigateWithAnimation };
};

// ✅ DESPUÉS (SEGURO)
export const useAnimatedNavigation = () => {
  const navigate = useNavigate();
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const navigateWithAnimation = useCallback((path, direction = 'forward') => {
    const currentPage = document.querySelector('.page-transition');
    if (currentPage) {
      currentPage.classList.add(direction === 'back' ? 'page-exit-back' : 'page-exit-forward');
    }
    
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    
    timerRef.current = setTimeout(() => {
      navigate(path);
      timerRef.current = null;
    }, 300);
  }, [navigate]);

  return { navigateWithAnimation };
};
```

#### Tarea 1.2: Arreglar VotingView.js (2 instancias)

**Archivo:** `src/VotingView.js`

```javascript
// ❌ ANTES (líneas 329-339)
setTimeout(() => {
  if (editandoIdx !== null) {
    setEditandoIdx(null);
    setStep(3);
  } else {
    setCurrent((cur) => cur + 1);
  }
  setHovered(null);
  setAnimating(false);
}, 200);

// ✅ DESPUÉS
const [timers, setTimers] = useState([]);

useEffect(() => {
  return () => {
    timers.forEach(timer => clearTimeout(timer));
  };
}, [timers]);

const handleVoteSubmit = useCallback(() => {
  if (animating) return;
  setAnimating(true);
  
  const timer = setTimeout(() => {
    if (editandoIdx !== null) {
      setEditandoIdx(null);
      setStep(3);
    } else {
      setCurrent((cur) => cur + 1);
    }
    setHovered(null);
    setAnimating(false);
  }, 200);
  
  setTimers(prev => [...prev, timer]);
}, [animating, editandoIdx]);
```

#### Tarea 1.3: Arreglar otros archivos con setTimeout

**Archivos a corregir:**
- `FormularioNuevoPartidoFlow.js` (3 instancias)
- `ProximosPartidos.js` (1 instancia)
- `NotificationsModal.js` (1 instancia)
- `AbsencePenaltyAnimation.jsx` (1 instancia)
- `PlayerAwards.js` (1 instancia)

**Patrón a aplicar:**
```javascript
// Crear custom hook para manejar timers
// src/hooks/useTimeout.js
import { useEffect, useRef, useCallback } from 'react';

export const useTimeout = () => {
  const timeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const setTimeoutSafe = useCallback((callback, delay) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callback();
      timeoutRef.current = null;
    }, delay);
  }, []);

  const clearTimeoutSafe = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return { setTimeoutSafe, clearTimeoutSafe };
};

// Uso en componentes:
const { setTimeoutSafe } = useTimeout();

setTimeoutSafe(() => {
  navigate(path);
}, 300);
```

---

### Día 2: Credenciales y XSS

#### Tarea 2.1: Revisar profiles.js (líneas 287-288)

**Archivo:** `src/services/db/profiles.js`

```javascript
// Revisar esta sección y asegurar que no hay credenciales hardcodeadas
// Si hay, moverlas a .env
```

#### Tarea 2.2: Sanitizar inputs en VotingView.js

**Instalar DOMPurify:**
```bash
npm install dompurify
```

**Implementar:**
```javascript
import DOMPurify from 'dompurify';

// Sanitizar cualquier contenido dinámico
const sanitizedName = DOMPurify.sanitize(jugadorVotar.nombre);
```

---

### Día 3: Validación de Permisos

#### Tarea 3.1: Mejorar validación en VotingView.js

```javascript
// ✅ MEJORAR validación de acceso
const { data: jugadoresPartido } = await supabase
  .from('jugadores')
  .select('usuario_id, nombre')
  .eq('partido_id', partidoId);
  
const jugadorEnPartido = jugadoresPartido?.find((j) => j.usuario_id === user.id);

const { data: partidoData } = await supabase
  .from('partidos')
  .select('creado_por')
  .eq('id', partidoId)
  .single();
  
const esAdmin = partidoData?.creado_por === user.id;

if (!jugadorEnPartido && !esAdmin) {
  // Mostrar mensaje de error más claro
  return (
    <div className="voting-bg">
      <div className="voting-modern-card">
        <div className="voting-title-modern">ACCESO DENEGADO</div>
        <p>No estás invitado a este partido.</p>
        <button onClick={onReset}>VOLVER</button>
      </div>
    </div>
  );
}
```

#### Tarea 3.2: Agregar middleware de autenticación

**Crear:** `src/middleware/authMiddleware.js`

```javascript
import { supabase } from '../lib/supabaseClient';

export const requireAuth = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error('Authentication required');
  }
  return user;
};

export const requireMatchAccess = async (matchId, userId) => {
  // Verificar si es admin
  const { data: match } = await supabase
    .from('partidos')
    .select('creado_por')
    .eq('id', matchId)
    .single();
  
  if (match?.creado_por === userId) return true;
  
  // Verificar si es jugador
  const { data: player } = await supabase
    .from('jugadores')
    .select('id')
    .eq('partido_id', matchId)
    .eq('usuario_id', userId)
    .single();
  
  if (player) return true;
  
  throw new Error('Access denied');
};
```

---

## 🟠 FASE 2: REFACTORING (Días 4-10)

### Día 4-5: Wrapper de Supabase

#### Crear capa de abstracción

**Archivo:** `src/api/supabaseWrapper.js`

```javascript
import { supabase } from '../lib/supabaseClient';

class SupabaseAPI {
  async fetchOne(table, filters) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .match(filters)
      .single();
    
    if (error) throw error;
    return data;
  }

  async fetchMany(table, filters = {}, options = {}) {
    let query = supabase.from(table).select('*');
    
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
    
    if (options.orderBy) {
      query = query.order(options.orderBy.column, { 
        ascending: options.orderBy.ascending ?? true 
      });
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async insert(table, data) {
    const { data: result, error } = await supabase
      .from(table)
      .insert(data)
      .select()
      .single();
    
    if (error) throw error;
    return result;
  }

  async update(table, filters, updates) {
    const { data, error } = await supabase
      .from(table)
      .update(updates)
      .match(filters)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async delete(table, filters) {
    const { error } = await supabase
      .from(table)
      .delete()
      .match(filters);
    
    if (error) throw error;
  }
}

export const db = new SupabaseAPI();
```

**Uso:**
```javascript
// ❌ ANTES
const { data, error } = await supabase
  .from('partidos')
  .select('*')
  .eq('id', partidoId)
  .single();
if (error) throw error;

// ✅ DESPUÉS
const partido = await db.fetchOne('partidos', { id: partidoId });
```

---

### Día 6-7: Centralizar Manejo de Errores

**Crear:** `src/lib/errorHandler.js`

```javascript
import { toast } from 'react-toastify';

export class AppError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN: 'UNKNOWN',
};

export const ERROR_MESSAGES = {
  [ERROR_CODES.AUTH_REQUIRED]: 'Debes iniciar sesión',
  [ERROR_CODES.ACCESS_DENIED]: 'No tienes permiso para acceder',
  [ERROR_CODES.NOT_FOUND]: 'Recurso no encontrado',
  [ERROR_CODES.VALIDATION_ERROR]: 'Datos inválidos',
  [ERROR_CODES.NETWORK_ERROR]: 'Error de conexión',
  [ERROR_CODES.UNKNOWN]: 'Error inesperado',
};

export const handleError = (error, options = {}) => {
  console.error('[ERROR]', error);
  
  let message = ERROR_MESSAGES[ERROR_CODES.UNKNOWN];
  
  if (error instanceof AppError) {
    message = ERROR_MESSAGES[error.code] || error.message;
  } else if (error.message) {
    message = error.message;
  }
  
  if (options.showToast !== false) {
    toast.error(message);
  }
  
  if (options.onError) {
    options.onError(error);
  }
  
  return message;
};

// Uso en componentes:
try {
  await submitVotos(votos);
} catch (error) {
  handleError(error, {
    showToast: true,
    onError: () => setLoading(false)
  });
}
```

---

### Día 8-9: Unificar Utilidades

**Crear:** `src/lib/dateUtils.js`

```javascript
export const formatDate = (date) => {
  if (!date) return '';
  
  if (typeof date === 'string') {
    return date.split('T')[0];
  }
  
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  
  return '';
};

export const parseDate = (dateString) => {
  if (!dateString) return null;
  
  const cleaned = dateString.split('T')[0];
  return new Date(cleaned);
};

export const isValidDate = (dateString) => {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateString);
};

export const getCurrentDate = () => {
  return new Date().toISOString().split('T')[0];
};
```

**Crear:** `src/lib/idUtils.js`

```javascript
export const toBigIntId = (value) => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
};

export const toStringId = (value) => {
  if (value == null) return '';
  return String(value);
};

export const generateUniqueId = () => {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
```

---

### Día 10: Optimización de Performance

#### Tarea 10.1: Implementar Code Splitting

**Archivo:** `src/App.js`

```javascript
import React, { lazy, Suspense } from 'react';
import LoadingSpinner from './components/LoadingSpinner';

// Lazy load de páginas
const EncuestaPartido = lazy(() => import('./pages/EncuestaPartido'));
const ResultadosEncuestaView = lazy(() => import('./pages/ResultadosEncuestaView'));
const AdminPanel = lazy(() => import('./AdminPanel'));
const VotingView = lazy(() => import('./VotingView'));

// Wrapper con Suspense
const LazyRoute = ({ component: Component, ...props }) => (
  <Suspense fallback={<LoadingSpinner size="large" />}>
    <Component {...props} />
  </Suspense>
);

// En Routes:
<Route path="/encuesta/:partidoId" element={<LazyRoute component={EncuestaPartido} />} />
```

#### Tarea 10.2: Optimizar Re-renders

**Crear:** `src/hooks/useOptimizedCallback.js`

```javascript
import { useCallback, useRef } from 'react';

export const useOptimizedCallback = (callback) => {
  const callbackRef = useRef(callback);
  
  // Actualizar ref en cada render
  callbackRef.current = callback;
  
  // Retornar callback estable
  return useCallback((...args) => {
    return callbackRef.current(...args);
  }, []);
};
```

**Uso en componentes:**
```javascript
// ❌ ANTES
<Button onClick={() => handleClick(id)} />

// ✅ DESPUÉS
const handleClickOptimized = useOptimizedCallback(() => handleClick(id));
<Button onClick={handleClickOptimized} />
```

---

## 🟡 FASE 3: LIMPIEZA (Días 11-12)

### Día 11: Limpieza de Archivos

```bash
# Eliminar carpeta trash
rm -rf src/_trash

# Mover archivos SQL
mkdir -p migrations/legacy
mv *.sql migrations/legacy/

# Mover archivos MD
mkdir -p docs/legacy
mv *.md docs/legacy/
mv README.md .  # Mantener README en raíz

# Limpiar archivos de debug
rm -f debug*.js
rm -f test_*.js
rm -f DEBUG*.js
```

### Día 12: Reorganizar src/

**Estructura propuesta:**
```
src/
├── api/              # Capa de abstracción
├── components/       # Componentes UI
│   ├── common/       # Botones, inputs, etc.
│   ├── layout/       # Headers, footers, etc.
│   └── features/     # Componentes específicos
├── features/         # Módulos por funcionalidad
│   ├── auth/
│   ├── matches/
│   ├── voting/
│   └── profiles/
├── hooks/            # Custom hooks
├── lib/              # Utilidades
├── pages/            # Páginas completas
├── services/         # Lógica de negocio
└── styles/           # Estilos globales
```

**Script de migración:**
```bash
# Crear estructura
mkdir -p src/features/{auth,matches,voting,profiles}
mkdir -p src/components/{common,layout,features}

# Mover archivos (ejemplo)
mv src/AuthPage.js src/features/auth/
mv src/VotingView.js src/features/voting/
mv src/AdminPanel.js src/features/matches/
```

---

## 📊 CHECKLIST DE PROGRESO

### Seguridad (Días 1-3)
- [ ] Arreglar useAnimatedNavigation.js
- [ ] Arreglar VotingView.js (2 instancias)
- [ ] Arreglar FormularioNuevoPartidoFlow.js (3 instancias)
- [ ] Arreglar ProximosPartidos.js
- [ ] Arreglar NotificationsModal.js
- [ ] Arreglar AbsencePenaltyAnimation.jsx
- [ ] Arreglar PlayerAwards.js
- [ ] Revisar credenciales en profiles.js
- [ ] Implementar sanitización XSS
- [ ] Mejorar validación de permisos

### Refactoring (Días 4-10)
- [ ] Crear wrapper de Supabase
- [ ] Centralizar manejo de errores
- [ ] Unificar utilidades de fechas
- [ ] Unificar utilidades de IDs
- [ ] Implementar code splitting
- [ ] Optimizar re-renders
- [ ] Agregar useCallback/useMemo

### Limpieza (Días 11-12)
- [ ] Eliminar _trash/
- [ ] Mover archivos SQL
- [ ] Mover archivos MD
- [ ] Reorganizar src/
- [ ] Eliminar console.logs
- [ ] Eliminar código comentado

---

## 🎯 MÉTRICAS DE ÉXITO

| Métrica | Antes | Después |
|---------|-------|---------|
| Vulnerabilidades Críticas | 10 | 0 |
| Memory Leaks | 8+ | 0 |
| Código Duplicado | 15% | <5% |
| Archivos en src/ raíz | 40+ | <10 |
| Archivos en proyecto raíz | 60+ | <15 |

---

## 📝 NOTAS IMPORTANTES

1. **Hacer backup antes de empezar**
2. **Crear branch para cada fase**
3. **Testear después de cada cambio**
4. **Hacer commits pequeños y descriptivos**
5. **Documentar cambios importantes**

---

## 🚀 COMANDOS ÚTILES

```bash
# Crear branch para seguridad
git checkout -b fix/security-vulnerabilities

# Crear branch para refactoring
git checkout -b refactor/code-organization

# Crear branch para limpieza
git checkout -b chore/cleanup

# Verificar cambios
npm run build
npm test

# Commit con mensaje descriptivo
git commit -m "fix: resolve CWE-94 vulnerabilities in useAnimatedNavigation"
```

---

**Última actualización:** Enero 2025
