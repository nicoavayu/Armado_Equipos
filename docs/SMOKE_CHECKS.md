# Smoke Checks - Team Balancer

Validación rápida de funcionalidad crítica. Ejecutar estos pasos después de cambios importantes o antes de deploy.

## ✅ Checklist de Validación

### 1. Arranque
```bash
npm start
```
- ✓ Abre en `http://localhost:3000` sin errores en consola
- ✓ Home carga correctamente
- ✓ No hay warnings críticos en DevTools

### 2. Health Check
```
Navegar a: http://localhost:3000/health
```
- ✓ Supabase: status OK, latencia <500ms
- ✓ Auth: muestra estado de autenticación
- ✓ Notifications: status OK, latencia <3s

### 3. Login/Auth
```
1. Click en "Iniciar Sesión" o "Registrarse"
2. Completar formulario
3. Verificar redirección al home
```
- ✓ Login exitoso sin errores
- ✓ User ID visible en `/health`
- ✓ Perfil cargado correctamente

### 4. Crear Partido
```
1. Click en "Armar Equipos" o "Nuevo Partido"
2. Completar formulario (fecha, hora, sede, modalidad)
3. Confirmar creación
```
- ✓ Formulario se completa sin errores
- ✓ Partido creado en DB (verificar en `/health` que Supabase OK)
- ✓ Redirección a panel de admin del partido

### 5. Agregar Jugadores
```
1. En panel de admin, agregar jugadores
2. Usar campo "Nombre del jugador"
3. Click en "Agregar"
```
- ✓ Jugadores se agregan sin errores
- ✓ Lista se actualiza en tiempo real
- ✓ No hay duplicados inesperados

### 6. Votar (Flujo Jugador)
```
1. Copiar código del partido
2. Abrir en ventana incógnito: /?codigo=XXXXX
3. Votar jugadores con estrellas
4. Confirmar votación
```
- ✓ Vista de votación carga correctamente
- ✓ Autocompletado de nombre funciona (si aplica)
- ✓ Votos se registran sin errores
- ✓ Confirmación visible

### 7. Armar Equipos
```
1. Con ≥8 jugadores, click "Armar Equipos Parejos"
2. Verificar distribución
```
- ✓ Equipos se generan correctamente
- ✓ Distribución balanceada por puntuación
- ✓ No hay errores en consola

### 8. Encuesta Post-Partido
```
Navegar a: /encuesta/:partidoId
```
- ✓ Formulario carga sin errores
- ✓ Selección de jugadores destacados funciona
- ✓ Envío exitoso

### 9. Ver Resultados
```
Navegar a: /resultados/:partidoId
```
- ✓ Resultados cargan correctamente
- ✓ Gráficos/estadísticas visibles
- ✓ No hay errores de renderizado

### 10. Notificaciones
```
1. Navegar a /notifications
2. Verificar lista de notificaciones
```
- ✓ Lista carga sin errores
- ✓ Latencias razonables (<2s)
- ✓ Marcar como leído funciona

## 🛠️ Comandos Útiles

### Build de Producción
```bash
npm run build
```
- ✓ Build completa sin errores
- ✓ No hay warnings críticos
- ✓ Bundle size razonable

### Buscar Errores No Manejados
```bash
# Buscar "Unhandled" en código
grep -RIn "Unhandled" src/ || echo "✓ OK: no unhandled errors"

# Buscar strings de error de red
grep -RIn "Network Error" src/ || echo "✓ OK: no hardcoded network errors"

# Buscar console.error sin manejo
grep -RIn "console.error" src/ | wc -l
```

### Verificar Logs de Red
```bash
# En DevTools Console, filtrar por:
[Network]        # Requests exitosos
[Network Error]  # Requests fallidos
```

### Limpiar Cache y Reinstalar
```bash
rm -rf node_modules package-lock.json
npm install
npm start
```

## 🚨 Señales de Alerta

### Errores Críticos
- ❌ "Cannot read property of undefined" en componentes principales
- ❌ Supabase status FAIL en `/health`
- ❌ Auth no funciona (no puede login/logout)
- ❌ Partidos no se crean o no se guardan jugadores

### Warnings Importantes
- ⚠️ Latencias >1s en operaciones básicas
- ⚠️ Memory leaks (usar Chrome DevTools Memory)
- ⚠️ Requests fallidos repetidos en Network tab

## 📊 Métricas de Referencia

### Performance
- Home load: <2s
- Supabase queries: <500ms
- Auth check: <300ms
- Notifications: <3s

### Funcionalidad
- Success rate de crear partido: >95%
- Success rate de votar: >98%
- Success rate de armar equipos: >99%

## 🔄 Rollback Rápido

Si algo falla crítico:
```bash
# Volver al último commit estable
git log --oneline -10
git reset --hard <commit-hash>
npm install
npm start
```

## 📝 Notas

- Ejecutar smoke checks en **desarrollo** antes de merge a main
- Ejecutar smoke checks en **staging** antes de deploy a producción
- Documentar cualquier fallo en GitHub Issues
- Actualizar este documento si se agregan features críticas

---

**Última actualización**: 2025-01-03
**Versión**: 1.0.0
