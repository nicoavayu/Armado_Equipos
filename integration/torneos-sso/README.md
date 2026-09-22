# Phase 1.5 — Core real → Torneos aislado

App real: `nicoavayu/Armado_Equipos`. Base: `e61f089d873d00e8a2a62b9d41ecf26b6c820c53`.
Branch: `codex/torneos-real-core-sso-phase15`.
Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-torneos-real-core-sso-phase15`.

## Reproducir

Desde la raíz del worktree:

```sh
npm ci --ignore-scripts
npm ci --prefix integration/torneos-sso --ignore-scripts
npm --prefix integration/torneos-sso run up
npm --prefix integration/torneos-sso run build:app
npm --prefix integration/torneos-sso test
CI=true npm test -- --watchAll=false --runInBand torneosIsolatedSso appAuthWrapper AuthCallback torneosRouteIsolation torneosRuntimeIsolation
```

Requiere Docker Desktop local, Node con detección ESM de archivos `.js` y Google Chrome
instalado en la ruta macOS indicada en `app.test.mjs`. La app usa su SDK bloqueado
2.94.1; las herramientas backend conservan el SDK 2.116.0 del POC certificado.

Sólo se publica `http://127.0.0.1:58410`. El gateway sirve el build real de `src/App.js`.
Todos los destinos API son locales y constantes. No se leen `.env` del producto;
el build rechaza archivos de entorno y limpia las variables heredadas. La clave
anon local se genera automáticamente. Claves privadas, passwords y tokens de
administración no se incorporan al build. `.runtime`, `dist` y dependencias se ignoran.

El test crea cuentas GoTrue locales y filas propias de prueba, entrega la sesión
al callback existente de la app y prueba su navegación, persistencia y logout reales.
No agrega una pantalla de login, credenciales compartidas ni hooks de prueba al bundle.
Los tests interrumpen únicamente los servicios Compose `arma2-sso-phase15` y restauran
su estado. La prueba de caída del exchange corta su transporte desde Playwright.

Core local sólo contiene Auth y cuatro tablas de fixture para el lector de perfil
existente. No es un baseline del producto ni una copia de Production. Torneos sólo
tiene `torneos_identity` y `sso_probe`. No se aplica ninguna migración Arma2.

Para detener exclusivamente este laboratorio, conservando sus volúmenes:

```sh
npm --prefix integration/torneos-sso run down
```

Ver `REPORT.md` y `evidence/` para resultados, alcance y riesgos. No ejecutar Phase 2
ni desplegar este laboratorio como un servicio público.
