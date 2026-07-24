# Arquitectura actual

Relevamiento realizado sobre `origin/main` en `5659d2d7c3976c313218a7d3cb28f01b6a632860`.

## Aplicación

- SPA React 18 creada con Create React App.
- `react-router-dom` 6 con `BrowserRouter` y rutas centralizadas en `src/App.js`.
- Tailwind 3 más estilos globales en `src/styles.css`.
- Carga diferida de páginas mediante `React.lazy` y `Suspense`.
- Capacitor 7 para iOS y Android; `webDir` apunta a `build`.
- Vercel sirve la SPA y reescribe rutas a `index.html`.

## Shell y navegación

`MainLayout` envuelve la experiencia autenticada personal, monta onboarding y agrega `TabBar`. El estado visual del home, los safe areas y algunos comportamientos de scroll están acoplados a rutas personales. Las rutas públicas (login, invitaciones, votaciones y legales) viven fuera del shell autenticado.

Implicación: Torneos debe ser una ruta hermana de `MainLayout`, dentro del guard de autenticación, para evitar montar tab bar, onboarding y estado del home personal.

## Autenticación e identidad

`AuthProvider` mantiene `user`, `profile`, `loading` y `authResolved`, utiliza una única instancia de Supabase y escucha `onAuthStateChange`. Existe un modo local de edición con usuario ficticio, restringido al desarrollo. `AppAuthWrapper` conserva el destino y redirige al login cuando no hay sesión.

Implicación: se reutiliza la sesión común, pero el perfil futbolístico no puede convertirse en requisito para acceder a Torneos. La autorización de membresías deberá resolverse aparte.

## Datos y Supabase

- Cliente único en `src/lib/supabaseClient.js`.
- Servicios organizados en `src/services`, con acceso directo a tablas y RPCs.
- Migraciones versionadas en `supabase/migrations`.
- Edge Functions para invitaciones, cuentas y push.
- RLS y funciones `SECURITY DEFINER` ya forman parte del patrón del repositorio.
- Existen conceptos de equipos (`teams`, `team_members`), partidos personales y desafíos, pero no representan una inscripción a torneo ni un partido oficial.

Implicación: reutilizar identidad y equipo base; modelar por separado organización, competencia, inscripción, roster oficial y partido de torneo.

## Estado global

No hay un store global único. El estado se distribuye entre contextos React, hooks, estado de componentes, URL y `localStorage`. Los contextos actuales cubren autenticación, notificaciones, badges y onboarding.

Implicación: el workspace de Torneos tendrá un contexto propio y pequeño. La preferencia local no otorgará permisos.

## Notificaciones y deep links

La app procesa push nativo, mensajes de service worker y enlaces de Capacitor. Las rutas de notificación actuales están orientadas a partidos, encuestas y equipos existentes. El manejador de app links tiene una lista explícita de rutas válidas.

Implicación: no agregar rutas de Torneos hasta definir contratos, validación de acceso y flags específicos. No se habilita push en esta fase.

## Sistema visual

El sistema actual define tokens violetas, superficies oscuras, safe areas, Bebas Neue y Oswald. Conviven Tailwind, estilos globales y componentes propios.

Implicación: el shell inicial reutiliza tokens y fuentes, con estilos encapsulados en un CSS Module. No altera tokens globales ni componentes personales.

## Calidad, build y despliegue

- Jest/Testing Library: más de 200 archivos de prueba.
- ESLint para `src`.
- Build CRA con validación previa de variables.
- Suite PostgreSQL integrada disponible.
- GitHub Actions ejecuta lint, build, Jest y DB en PRs hacia `main`.
- Vercel exige control de acceso web privado y apunta al dominio actual.
- Workflows programados pueden invocar el pipeline de push existente.

Implicación: un PR hacia la epic no hereda hoy el quality gate de `main`; deben ejecutarse checks localmente y planificarse un workflow específico antes de escalar el desarrollo.

## Riesgos detectados

| Riesgo | Consecuencia | Respuesta inicial |
|---|---|---|
| Router raíz y shell personal centralizados | Fuga de navegación/onboarding | Ruta hermana y lazy bajo gate |
| Build web conectado a configuración actual | Preview contra recursos equivocados | No desplegar; exigir proyecto/env separados |
| Supabase local puede estar enlazado | Migración accidental | No ejecutar `db push`; cero migraciones |
| Push programado existente | Notificar usuarios reales | Sin eventos ni funciones de Torneos |
| Entidades de equipo/partido parecidas | Mezcla de reglas e historial | Adaptadores explícitos y entidades de unión |
| Preferencias en `localStorage` | Suplantación de workspace | Validación autoritativa futura en servidor/RLS |
| Perfil personal en auth | Onboarding indebido para organizadores | Separar identidad de perfil deportivo |
| No hay TypeScript en frontend | Contratos menos verificables | JSDoc/tests ahora; evaluar migración incremental |
| Checkout original sucio y desactualizado | Pérdida de trabajo local | Worktree limpio desde `origin/main` |

