# Reporte de ejecución — QA Foundation

Fecha: 2026-07-30.

Worktree:
`/Users/nicoavayu/Downloads/arma2/arma2-torneos-qa-foundation`

Base exacta:
`3de01b435fcdb4a63c6b92ba8b5dc934c1bb3a4c`

## Resultado

| Verificación | Resultado |
| --- | --- |
| `npm ci` | OK |
| `npm run test:qa:guards` | 9 passed |
| `npm run qa:torneos:seed:dry-run` | OK; sin conexión ni escritura |
| `npm run test:e2e` | 35 passed, 40 skipped por sesiones/datos ausentes |
| `npm run test:ci` | 250 suites, 1861 tests passed |
| `npm run test:db:torneos` | OK; todas las verificaciones locales pasaron |
| `npm run lint` | OK, 0 errores |
| Lint explícito de archivos QA | OK, 0 errores |
| `npm run build` con variables locales placeholder | OK |

La suite DB se ejecutó contra un Supabase efímero exclusivamente local en el
puerto 57322 porque el puerto default estaba ocupado por otro worktree. Al
terminar se detuvo y eliminó el entorno local; el cambio temporal de
`supabase/config.toml` fue revertido y no forma parte del diff.

## Viewports

Los cinco proyectos pasaron acceso sin sesión, preservación de `returnTo`,
guards de rutas, navegación del shell de login, overflow horizontal y captura
de screenshot:

- Chromium desktop 1440x900.
- Tablet 768x1024.
- Mobile 320x700.
- Mobile 375x812.
- Mobile 430x932.

## Pendientes explícitos

Cuarenta ejecuciones quedan en `skipped`, no aprobadas:

- navegación del shell organizacional como owner;
- guardas reales de admin, delegate, player, outsider y collaborator;
- navegación móvil organizacional;
- apertura y cierre de un modal real.

Requieren storage states no versionados y que el dataset sea ejecutado más
adelante en un entorno autorizado.

## Warnings observados

- `npm ci` informó 70 vulnerabilidades del árbol existente: 10 low, 27
  moderate, 29 high y 4 critical. No se ejecutó `npm audit fix` porque sería un
  cambio general fuera de alcance.
- La compilación de desarrollo de CRA informó tres source maps faltantes en
  `@capacitor-community/apple-sign-in`.
- `caniuse-lite` tiene seis meses y Browserslist recomienda actualizarlo.
- Webpack Dev Server informó deprecaciones de `onBeforeSetupMiddleware` y
  `onAfterSetupMiddleware`.
- Jest muestra warnings preexistentes de `act()`,
  `ReactDOMTestUtils.act` y future flags de React Router v7, además de logs
  intencionales de pruebas negativas.

Ninguno pertenece a archivos funcionales modificados en esta etapa, por lo que
no se hizo una refactorización general para silenciarlos.
