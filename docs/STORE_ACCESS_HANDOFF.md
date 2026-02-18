# Access Handoff (Store Release)

Para que Codex complete la publicación end-to-end, colocar estos archivos de acceso en:

`/Users/nicoavayu/Downloads/arma2/arma2/.secrets/`

## 1) Firebase (Push)

- `firebase/google-services.json` (Android app)
- `firebase/GoogleService-Info.plist` (iOS app)

## 2) Google Play Console (upload AAB)

- `google-play/service-account.json`
  - Service account con permisos de release en Play Console.

## 3) Apple App Store Connect (upload TestFlight/metadata)

- `apple/AuthKey_<KEY_ID>.p8`
- `apple/appstoreconnect.env` con:
  - `ASC_KEY_ID=...`
  - `ASC_ISSUER_ID=...`
  - `ASC_BUNDLE_ID=com.teambalancer.app`
  - `ASC_APPLE_TEAM_ID=...`

## 4) Android signing

- `android/release-keystore.jks`
- `android/keystore.env` con:
  - `ANDROID_KEYSTORE_PASSWORD=...`
  - `ANDROID_KEY_ALIAS=...`
  - `ANDROID_KEY_PASSWORD=...`

## 5) Datos de ficha store (texto)

Crear `store-metadata.txt` con:

- Nombre final de app
- Short description (Play)
- Full description (Play)
- Subtitle (App Store)
- URL soporte
- URL privacidad final

## Estado esperado luego del handoff

Con estos archivos listos, Codex puede:

- Configurar push nativo Android/iOS
- Preparar build firmada Android
- Preparar build iOS/TestFlight (si la máquina tiene Xcode/CocoaPods)
- Asistir en carga técnica para stores

## Comando útil

Para copiar automáticamente los archivos Firebase desde `.secrets` a sus rutas nativas:

`npm run mobile:secrets:sync`
