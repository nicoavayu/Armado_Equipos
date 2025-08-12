# Optimización del Chat para Teclado Virtual

## Problema
Cuando se abre el chat en móvil, el teclado virtual aparece y tapa casi toda la parte inferior de la ventana de chat, requiriendo scroll manual para ver el contenido.

## Solución Implementada

### 1. Plugin de Capacitor Keyboard
- **Instalado**: `@capacitor/keyboard`
- **Configuración**: En `capacitor.config.ts` con `resize: "ionic"` y `resizeOnFullScreen: true`
- **Funcionalidad**: Detecta cuando aparece/desaparece el teclado virtual

### 2. Hook Personalizado `useKeyboard`
- **Ubicación**: `src/hooks/useKeyboard.js`
- **Funcionalidad**: 
  - Maneja eventos del teclado en plataformas nativas (Capacitor)
  - Usa Visual Viewport API para web/PWA
  - Retorna altura del teclado y estado (abierto/cerrado)

### 3. Ajustes en MatchChat
- **Altura dinámica**: El modal se ajusta automáticamente cuando aparece el teclado
- **Scroll automático**: Se hace scroll al final cuando aparece el teclado
- **Padding adaptativo**: Se ajusta el padding inferior según la altura del teclado

### 4. Mejoras CSS
- **Environment variables**: Soporte para `env(keyboard-inset-height)`
- **Dynamic viewport**: Uso de `100dvh` cuando está disponible
- **iOS optimizations**: Fixes específicos para iOS con hardware acceleration
- **Responsive design**: Diferentes comportamientos para móvil vs desktop

## Características Técnicas

### Detección del Teclado
```javascript
// Nativo (Capacitor)
Keyboard.addListener('keyboardWillShow', info => {
  setKeyboardHeight(info.keyboardHeight);
});

// Web (Visual Viewport API)
window.visualViewport.addEventListener('resize', handleViewportChange);
```

### Ajuste Dinámico del Modal
```css
.chat-modal {
  max-height: calc(100vh - 30px - env(keyboard-inset-height, 0px));
}
```

### Scroll Automático
```javascript
useEffect(() => {
  if (isKeyboardOpen) {
    setTimeout(() => scrollToBottom(), 100);
  }
}, [isKeyboardOpen]);
```

## Compatibilidad
- ✅ iOS (nativo)
- ✅ Android (nativo)
- ✅ Web/PWA (con Visual Viewport API)
- ✅ Navegadores modernos

## Comandos para Aplicar
```bash
# Instalar dependencias
npm install @capacitor/keyboard @capacitor/cli @capacitor/android @capacitor/ios --save-dev

# Sincronizar con plataformas nativas
npx cap sync

# Compilar para móvil
npm run build
npx cap sync android
npx cap open android
```

## Resultado
- El chat se ajusta automáticamente al teclado virtual
- No es necesario hacer scroll manual
- El input siempre permanece visible
- Experiencia fluida en todas las plataformas