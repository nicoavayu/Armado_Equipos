# Implementación: Pantalla Pública de Votación de Equipos

## ✅ Archivos Creados/Modificados

### 1. **`src/pages/PublicTeamVoting.jsx`** (NUEVO)
Componente completo de votación pública con:
- Validación de query params (`partidoId` y `codigo`)
- Paso 1: Input de nombre del votante (guardado en localStorage)
- Paso 2: Lista de candidatos con UI de votación
- Estados por jugador: idle, sending, ok, already, error
- Manejo de respuestas del servidor
- Feedback visual con badges de estado
- Estilo consistente con el resto de la app (dark theme + cards)

### 2. **`src/App.js`** (MODIFICADO)
- Import lazy del nuevo componente: `PublicTeamVoting`
- Nueva ruta pública: `/votar-equipos` (sin auth requerido)
- Ruta agregada junto a otras rutas públicas como `/partido/:partidoId/invitacion`

## 📍 Ruta de Acceso

```
/votar-equipos?partidoId=228&codigo=PPMPM8
```

**Query params obligatorios:**
- `partidoId`: ID numérico del partido
- `codigo`: Código de acceso (trim + uppercase automático)

## 🔄 Flujo de Usuario

### Paso 1: Validación Inicial
- ❌ Si faltan params → Error screen con botón "Volver"
- ✅ Si están OK → Continúa al input de nombre

### Paso 2: Nombre del Votante
- Input text obligatorio (min 2 caracteres)
- Persistencia en `localStorage` con key: `public_voter_name_${partidoId}`
- Precarga automática si ya existe
- Botón "Empezar" → carga candidatos

### Paso 3: Votación
- **Spinner** mientras carga candidatos
- Lista de jugadores con:
  - Nombre
  - Badge "ARQUERO" si `is_goalkeeper === true`
  - 5 botones (1-5) para puntuar
  - Botón "No lo conozco"
  
**Estados por jugador:**
- `idle`: Sin votar
- `sending`: Enviando (spinner + disabled)
- `ok`: Voto exitoso (badge verde ✓)
- `already`: Ya votado (badge azul)
- `error`: Error (badge rojo + botón "Reintentar")

## 🛠️ RPCs Utilizados (Backend)

### 1. `public_get_candidates`
```javascript
await supabase.rpc('public_get_candidates', {
  p_partido_id: partidoId,
  p_codigo: codigo
});
```
**Retorna:** Array de candidatos
```javascript
[{
  jugador_id: number,
  jugador_nombre: string,
  is_goalkeeper: boolean
}]
```

### 2. `public_submit_player_rating`
```javascript
await supabase.rpc('public_submit_player_rating', {
  p_partido_id: partidoId,
  p_codigo: codigo,
  p_voter_name: voterName,
  p_jugador_id: jugadorId,
  p_score: score // 1-5
});
```
**Respuestas:**
- `{ result: 'ok' }` → Voto exitoso
- `{ result: 'already_voted_for_player' }` → Ya votó
- `{ result: 'invalid' }` → Código inválido
- `{ result: 'invalid_player' }` → Jugador no existe

### 3. `public_submit_no_lo_conozco`
```javascript
await supabase.rpc('public_submit_no_lo_conozco', {
  p_partido_id: partidoId,
  p_codigo: codigo,
  p_voter_name: voterName,
  p_jugador_id: jugadorId
});
```
**Mismas respuestas** que `public_submit_player_rating`

## 📱 Compartir por WhatsApp

**Link a compartir:**
```
https://tuapp.com/votar-equipos?partidoId=${id}&codigo=${codigo}
```

**Mensaje sugerido:**
```
Votá a los jugadores para armar equipos parejos: https://tuapp.com/votar-equipos?partidoId=${id}&codigo=${codigo}
```

## 🎨 Características de UX

### Diseño
- ✅ Fondo dark (`bg-fifa-gradient`)
- ✅ Cards blancas transparentes (`bg-white/10 border-white/20`)
- ✅ Font: Bebas (títulos) + Oswald (body)
- ✅ Colores consistentes con ProfileCard y otras vistas

### Estados y Feedback
- ✅ Spinners durante carga/envío
- ✅ Toasts para errores de red
- ✅ Badges persistentes por jugador (ok/already/error)
- ✅ Deshabilitado automático de botones ya votados
- ✅ Botón "Reintentar" en errores

### Persistencia
- ✅ Nombre guardado en localStorage
- ✅ Precarga automática en reingresos
- ✅ Estado independiente por jugador

## 🔒 Seguridad

- ✅ **No requiere login** (público)
- ✅ Validación de código en backend (RPCs)
- ✅ Sanitización de inputs (trim, uppercase)
- ✅ No hay acceso directo a tablas (solo RPCs)

## 🚀 Testing Rápido

1. Acceder a: `/votar-equipos?partidoId=123&codigo=TEST123`
2. Ingresar nombre (ej: "Juan Test")
3. Click "Empezar"
4. Votar jugadores 1-5 o "No lo conozco"
5. Verificar badges de estado
6. Recargar página → nombre precargado

## 📋 Checklist de Integración

- ✅ Componente creado: `PublicTeamVoting.jsx`
- ✅ Ruta agregada en `App.js`
- ✅ Lazy loading configurado
- ✅ Estilos consistentes con la app
- ✅ No rompe nada existente
- ✅ No requiere nuevas tablas (usa RPCs existentes)
- ✅ localStorage para persistencia
- ✅ Error handling completo

## 🎯 Próximos Pasos (Opcional)

1. **Generar código de votación** en el backend al crear partido
2. **Botón "Compartir"** en vista de admin con link pre-formateado
3. **Dashboard de resultados** para ver votaciones agregadas
4. **Expiración de códigos** por tiempo/fecha
5. **Limitar votos por IP** (si es necesario)

---

## 📞 Soporte

Si hay issues con los RPCs:
- Verificar que existan en Supabase SQL Editor
- Verificar permisos de ejecución (deben ser públicos)
- Verificar signatures de parámetros
- Revisar logs en console.error

**Implementación completa y lista para usar. Sin dependencias nuevas. Sin breaking changes.** ✅
