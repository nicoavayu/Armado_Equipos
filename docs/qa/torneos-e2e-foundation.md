# Fundación E2E de Torneos

## Qué se ejecuta hoy

- Acceso a `/torneos` sin sesión.
- Redirección al login conservando `returnTo`, incluso query y hash.
- Guards de rutas autenticadas.
- Navegación básica del shell de login.
- Detección de overflow horizontal.
- Captura de la pantalla sin sesión en los cinco viewports.
- Guards unitarios contra Production y validación del dataset demo.

## Qué queda preparado y pendiente

Los casos del shell autenticado, RBAC, navegación móvil organizacional y modales
reales usan fixtures para `owner`, `admin`, `delegate`, `player`, `outsider` y
`collaborator`. Se omiten explícitamente hasta que existan:

1. archivos de storage state reales, fuera del repositorio, en
   `QA_AUTH_STATE_DIR/{role}.json`;
2. el dataset demo ejecutado en un entorno autorizado;
3. `QA_TORNEOS_DEMO_READY=true`;
4. `QA_TORNEOS_ORGANIZATION_ID`;
5. para el caso de modal, `QA_TORNEOS_MODAL_TRIGGER_NAME`.

No se incluyen contraseñas, tokens, cookies ni sesiones. La ausencia de esos
datos produce `skipped`, nunca un falso positivo.

## Viewports

| Proyecto | Viewport |
| --- | --- |
| `chromium-desktop-1440x900` | 1440x900 |
| `chromium-tablet-768x1024` | 768x1024 |
| `chromium-mobile-320x700` | 320x700 |
| `chromium-mobile-375x812` | 375x812 |
| `chromium-mobile-430x932` | 430x932 |

## Evidencia de fallos

Playwright retiene screenshot, trace y video en fallos. El fixture automático
adjunta `browser-diagnostics.json` con consola, requests fallidos y violaciones
de Production. El reporte HTML queda bajo `artifacts/playwright/html-report`.

## Aislamiento

- El servidor E2E local recibe `REACT_APP_SUPABASE_URL=http://127.0.0.1:54321`.
- `app.arma2.com.ar` siempre está prohibido.
- Todo host remoto `*.supabase.co` debe estar allowlisteado explícitamente.
- Si `QA_PRODUCTION_PROJECT_REF`, `ARMA2_PRODUCTION_PROJECT_REF` o
  `REACT_APP_PRODUCTION_PROJECT_REF` está configurado, su aparición en URL,
  consola, DOM o variables de entorno falla el test.
- `VERCEL_ENV=production`, `ARMA2_DEPLOY_ENV=production` y
  `REACT_APP_DEPLOY_ENV=production` fallan antes de iniciar la suite.

## Comandos

```bash
npm run test:qa:guards
npm run qa:torneos:seed:dry-run
npm run test:e2e
npm run test:e2e:report
```
