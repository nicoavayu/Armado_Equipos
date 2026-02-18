# Store Release Plan (App Store + Google Play)

Estado del proyecto al 2026-02-14:

- Web build OK (`npm run build`)
- Capacitor sync OK en Android (`npx cap sync`)
- Sync iOS bloqueado por entorno local (falta Xcode/CocoaPods)
- Build Android release bloqueado por entorno local (falta Java/JDK)

## Objetivo

Publicar una version estable de Team Balancer en:

- Apple App Store (iOS)
- Google Play Store (Android)

## Fases y tiempo estimado

1. Fase 0: Prerequisitos de entorno y cuentas (0.5 a 1 dia)
- Instalar Java 17 y Android SDK
- Instalar Xcode + CocoaPods
- Confirmar acceso a Apple Developer y Google Play Console

2. Fase 1: Hardening tecnico mobile (2 a 4 dias)
- Permisos iOS/Android y capacidades nativas
- Integracion push nativa completa (Firebase + APNs)
- Versionado de release (versionCode/versionName y build number iOS)
- Icono, splash y nombre final de app
- QA de flujos criticos en dispositivos reales

3. Fase 2: Compliance de stores (1 a 2 dias)
- Privacy Policy publica (URL)
- Formulario Data safety (Google Play)
- App Privacy details (App Store Connect)
- Clasificacion por edad y contenido

4. Fase 3: Subida de binarios y metadata (1 dia)
- Android AAB firmado + rollout interno
- iOS Archive firmado + TestFlight
- Capturas, descripcion corta/larga, keywords

5. Fase 4: Revision y ajustes (3 a 10 dias)
- Responder eventuales rechazos
- Reenviar build si aplica

## Cronograma total realista

- Minimo: 1 semana
- Realista: 1 a 3 semanas
- Con bloqueos de cuenta/revision: 3 a 5 semanas

## Checklist de bloqueo (must-have)

- [ ] Apple Developer activo
- [ ] Google Play Console activo
- [ ] Politica de privacidad publicada (URL final)
- [ ] Java/JDK instalado en la maquina de release
- [ ] Xcode y CocoaPods instalados en la maquina de release
- [ ] Firebase configurado para Android (`google-services.json`)
- [ ] Firebase + APNs configurado para iOS (`GoogleService-Info.plist`)
- [ ] Certificados y perfiles de firma iOS listos
- [ ] Keystore de firma Android y credenciales resguardadas
- [ ] Capturas de pantalla finales para stores
- [ ] Texto final de ficha de app (ES/EN si aplica)

## Plan de ejecucion sugerido (Dia 1 a Dia 5)

1. Dia 1
- Preparar entorno local (Java, Xcode, CocoaPods)
- Confirmar cuentas y permisos de consola
- Configurar scripts de release/sync

2. Dia 2
- Completar push nativo Android/iOS
- Validar permisos y consentimientos

3. Dia 3
- QA funcional mobile (login, crear partido, invitaciones, votacion, notificaciones)
- Corregir issues criticos

4. Dia 4
- Preparar metadata y compliance legal
- Generar AAB/IPA y subir a pistas de prueba

5. Dia 5
- Cerrar observaciones de testeo
- Enviar a revision de store

## Responsabilidad compartida

Equipo tecnico (yo):
- Cambios de codigo, configuracion nativa, build, QA tecnico, subida tecnica

Producto/owner (vos):
- Activos de marca, texto comercial, politica de privacidad, decisiones de rollout y paises
