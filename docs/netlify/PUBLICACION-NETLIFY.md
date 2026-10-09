# Publicación del piloto en Netlify Free — configuración, transición y recuperación

**Decisión de Nico (2026-10-09):** Netlify Free para el piloto sin cobros. Premium y pagos siguen apagados.

**Candidato:** #192 (rama `claude/netlify-integrated-preview`), el commit que agrega este documento. Al resto de las
piezas de la integración no se les agregó ninguna funcionalidad.

**Preview:** #194 se usa sólo como preview y está marcado **NO MERGEAR**. Mergearlo publicaría el árbol como
producción del sitio de prueba.

**Este documento no ejecuta nada.** Merges, migraciones, DNS y ajustes del sitio de Netlify esperan su GO.

## 1. Estado leído hoy (sólo lecturas, 2026-10-09)

| Pieza | Estado |
| --- | --- |
| Vercel `arma2` (Hobby) | **Rama de producción:** `main`, con deploy automático en cada push (`createDeployments: enabled`), sin comando para ignorar builds y con `autoAssignCustomDomains: true`. **Production:** `dpl_5hMt4Aq1…`, el merge de #176 (`ffaf131c`). **Dominios:** `app.arma2.com.ar` y `arma2.vercel.app`. **Variables de Production:** 22. Hoy, **un merge a `main` se publicaría solo en `app.arma2.com.ar`** |
| DNS de `arma2.com.ar` | **Lo sirve Vercel DNS** (`ns1/ns2.vercel-dns.com`). `app` es un registro explícito: `CNAME b345e1b8b5c34d6a.vercel-dns-017.com.`, TTL 60 s (`rec_9140681bdbd131ef66dfb919`). El apex y `*` son ALIAS de Vercel y no se tocan. CAA permite `letsencrypt.org`, la CA de Netlify |
| Netlify `silly-licorice-383784` (equipo `arma2app`, Free) | **Producción:** la rama `codex/netlify-hosting-preview` (deploy `9c40146d`). Sin dominio propio. **Protección de equipo:** «all» (401 sin sesión). **Variables:** `REACT_APP_SUPABASE_URL` y `REACT_APP_SUPABASE_ANON_KEY` para todos los contextos, iguales a las de Vercel Production (comparadas por sha256, sin mostrarlas). **Free no permite elegir scopes:** toda variable queda en builds, functions, runtime y post-processing |

## 2. Configuración de producción

### `netlify.toml` (en el candidato)

| Contexto | Qué fija el archivo |
| --- | --- |
| Base (`[build]`) | `prepare.mjs` + `npm run build`, `ignore` de merges no web, `NODE_VERSION=22`, `GENERATE_SOURCEMAP=false`. **Ningún `REACT_APP_*`.** Antes forzaba `preview` y Torneos apagado en *todos* los contextos, producción incluida |
| `production` | El mismo build que Vercel: `prepare.mjs` → `validate:web-access-env` (sin los secretos del acceso privado, el build falla) → `release:web:sentry`, con `REACT_APP_SENTRY_RELEASE=$COMMIT_REF`. Además, `REACT_APP_DEPLOY_ENV=production`; Vercel lo deja vacío, que da el mismo resultado. **No fija ningún flag de Torneos:** salen de las variables del sitio |
| `deploy-preview` y `branch-deploy` | `REACT_APP_DEPLOY_ENV=preview` y `REACT_APP_TORNEOS_PRODUCTION_ENABLED=false`. Un valor del archivo pisa al del panel en su contexto, así que una preview nunca es Torneos de producción |
| Cabeceras | Las de Vercel: `nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection` y `Referrer-Policy`. **Se quitó `X-Robots-Tag: noindex`:** en producción habría ocultado las páginas públicas de torneos. Las previews quedan detrás de la protección de equipo |

- **Source maps:** el build de producción los genera, como en Vercel. Sin `SENTRY_AUTH_TOKEN`, la subida a Sentry se
  saltea sola. Los `.map` quedan detrás del gate: sin la cookie del acceso privado devuelven la página «mobile-only». Hay
  test.
- **Pruebas:** `scripts/netlify/hosting.test.mjs`, 15 casos (antes 10). Cubren los contextos, que ninguno fije
  billing, la paridad de cabeceras, los `.map` y que Vercel no deploye `main`.
- **Build reproducido en local** con el comando exacto del contexto `production`, los valores públicos de Production y
  secretos de prueba descartables:
  - exit 0: «Private web access server-side configuration validated», «Build environment validated» y «Upload
    skipped», porque no había token;
  - en el bundle, exactamente los flags de Vercel Production: `ENABLED`, `PRODUCTION_ENABLED`, `DATA_ENV`,
    `PLAN_READ_MODE=on`, `PUBLIC_PAGES`, `SOCIAL_GENERATOR`, `WORKSPACES`, `WORKSPACE_SWITCHER` y el gateway de Cloud
    Run;
  - **ningún** `CONNECTED`, `BRANDING`, `MEDIA`, `BILLING` ni `QA_*`;
  - 0 secretos: ni el hash ni el secreto del gate, ni `SENTRY_AUTH_TOKEN`, `service_role`, `sb_secret_` o tokens de
    Mercado Pago.

- **Preview real del commit `a716ba45`** (#194, contexto `deploy-preview`, con las variables de Production ya cargadas
  en el sitio):
  - 95 archivos JS con `REACT_APP_DEPLOY_ENV:"preview"` y `REACT_APP_TORNEOS_PRODUCTION_ENABLED:"false"` como único
    flag de Torneos: los valores de Production no llegan a las previews;
  - 0 coincidencias en 6 patrones de secretos;
  - `X-XSS-Protection` presente y `X-Robots-Tag: noindex` puesto por Netlify en la preview.
  - Ningún deploy de producción nuevo: el publicado sigue siendo `9c40146d`.
- **CI local de `a716ba45`:** `test:ci` completo con exit 0, Jest 3699/3699 (386 suites), hosting 15/15 y el resto de
  las suites como antes.

### `vercel.json` (en el candidato): `"git": {"deploymentEnabled": {"main": false}}`

- **Efecto:** el merge de #192 **no publica nada en Vercel**. Vercel lee la configuración del commit que va a
  deployar, así que vale desde ese mismo merge.
- **Production de Vercel queda congelado** en `ffaf131c`, el respaldo por DNS (§4).
- **Las previews de Vercel de las otras ramas siguen.** Es la única diferencia de configuración con hoy.
- **Prueba hecha:**
  - se empujó la rama descartable `probe/vercel-skip-check` (`56221942`) con `{"probe/*": false}`: **Vercel no creó
    ningún deployment**, cuando cada push de rama crea uno (hay 8 en la lista para comparar);
  - el push de este candidato, con sólo `main` deshabilitado, sí generó su preview (control).
  - La rama descartable se borró.

## 3. Variables del sitio de Netlify (contexto Production)

Público = se compila en el bundle y cualquiera lo lee. Secreto = sólo del servidor (build, functions, edge).

| Variable | Tipo | Valor u origen | Estado |
| --- | --- | --- | --- |
| `REACT_APP_SUPABASE_URL` | pública | Core Production | **Ya estaba** (todos los contextos), igual a Vercel |
| `REACT_APP_SUPABASE_ANON_KEY` | pública (clave anon) | Core Production | **Ya estaba** (todos los contextos), igual a Vercel (sha256 `a1d1cb5d369c…`) |
| `REACT_APP_PRODUCTION_PROJECT_REF` | pública | `rcyuuoaqfwcembdajcss` | **Cargada** (Production) |
| `REACT_APP_PUBLIC_APP_URL` | pública | `https://app.arma2.com.ar` | **Cargada** |
| `REACT_APP_ENABLE_EQUIPOS_TAB` | pública | `true` | **Cargada** |
| `REACT_APP_SENTRY_ENVIRONMENT` | pública | `production` | **Cargada** |
| `REACT_APP_TORNEOS_ENABLED`, `…_PRODUCTION_ENABLED`, `…_PUBLIC_PAGES_ENABLED`, `…_SOCIAL_GENERATOR_ENABLED`, `…_WORKSPACES_ENABLED`, `…_WORKSPACE_SWITCHER_ENABLED` | públicas | `true` | **Cargadas** |
| `REACT_APP_TORNEOS_DATA_ENV` | pública | `production` | **Cargada** |
| `REACT_APP_TORNEOS_PLAN_READ_MODE` | pública | `on` | **Cargada** |
| `REACT_APP_TORNEOS_GATEWAY_URL` | pública | gateway de Cloud Run (`southamerica-east1`), igual a Vercel | **Cargada** |
| `SENTRY_ORG`, `SENTRY_PROJECT` | build, no secretas | `arma2`, `javascript-react` | **Cargadas** |
| `REACT_APP_GOOGLE_MAPS_API_KEY` | pública, pero es una clave de API | copiar de Vercel (tipo «encrypted»: el panel la deja ver) | **Nico** |
| `REACT_APP_SENTRY_DSN` | pública, pero lleva clave | copiar de Vercel (encrypted) | **Nico** |
| `PRIVATE_WEB_ACCESS_PASSWORD_HASH` | **secreta** | hash nuevo de la contraseña del acceso web (comando abajo). La de Vercel es «sensitive» y no se puede leer | **Nico** |
| `PRIVATE_WEB_ACCESS_SIGNING_SECRET` | **secreta** | valor nuevo al azar (comando abajo) | **Nico** |
| `SENTRY_AUTH_TOKEN` | **secreta**, opcional | token nuevo de Sentry. La de Vercel es «sensitive». Sin él, Sentry igual recibe los errores, pero sin source maps | **Nico** (o se omite) |

**Al día D, no ahora:**
- `REACT_APP_TORNEOS_CONNECTED_MODE=on` en D6;
- `REACT_APP_TORNEOS_BRANDING_MODE=on` en D7;
- `REACT_APP_TORNEOS_MEDIA_MODE=on` + `REACT_APP_TORNEOS_MEDIA_ENABLED=true` en D8.

**Nunca:** `REACT_APP_TORNEOS_BILLING_MODE` (pagos apagados), `REACT_APP_TORNEOS_QA_ROLE_SWITCHER` ni ninguna clave
`service_role`. El build rechaza un billing que no sea de producción.

**Por qué esas cinco las carga Nico:**
- dos son claves de API (aunque terminen en el bundle);
- tres son secretos.
- No se copian de Vercel porque los «sensitive» no se pueden leer. Se generan nuevos.

**Consecuencias:**
- Un secreto nuevo de firma invalida las cookies del acceso web: quien lo use vuelve a escribir la contraseña una vez.
- La contraseña puede ser la misma de hoy.

### Cómo las carga Nico (5 minutos, una sola vez)

1. Netlify → `silly-licorice-383784` → *Project configuration* → *Environment variables* → *Add a variable* →
   *Add a single variable*:
   - marcar «Contains secret values» en las tres secretas, si el plan lo ofrece;
   - en «Values», **sólo Production**.
2. Las dos claves de Vercel: Vercel → `arma2` → *Settings* → *Environment Variables* → cada una (Production) → ver →
   copiar → pegar en Netlify.
3. Hash de la contraseña. Pide la contraseña sin mostrarla y deja el hash en el portapapeles:

```bash
cd /Users/nicoavayu/Downloads/arma2/arma2/.claude/worktrees/torneos-connected-product-c3f3a0 && printf 'Contraseña del acceso web: ' && read -rs PW && echo && PW="$PW" node --input-type=module -e "import {createPrivateWebPasswordHash as h} from './server/privateWebAccess.mjs'; process.stdout.write(await h(process.env.PW))" | pbcopy && unset PW && echo 'Hash copiado: pegalo en PRIVATE_WEB_ACCESS_PASSWORD_HASH'
```

4. Secreto de firma, al portapapeles:

```bash
openssl rand -hex 32 | tr -d '\n' | pbcopy && echo 'Secreto copiado: pegalo en PRIVATE_WEB_ACCESS_SIGNING_SECRET'
```

5. Opcional, `SENTRY_AUTH_TOKEN`: Sentry → *Settings* → *Auth Tokens* → token de organización con permiso de releases.

**Verificación:** el agente lista nombres, contextos y largos, nunca valores. El build de producción falla si faltan
los dos secretos del gate.

## 4. Netlify y el dominio durante la transición

- **Principio:** el dominio no cambia (`app.arma2.com.ar`). Así quedan iguales:
  - los links de WhatsApp;
  - las URLs de retorno de Supabase Auth;
  - el origen permitido del gateway de Cloud Run;
  - los links universales.
- **Lo único que cambia** es a dónde apunta el CNAME `app`.
- **Regla de compatibilidad:** la web de Vercel (`ffaf131c`) sólo funciona con Core **anterior a `125000`** (después
  se rompen la votación y la invitación por link, según RUNBOOK-193 §8). La web nueva funciona con y sin las
  migraciones. Por eso:
  - el corte de DNS a Netlify va **antes** de D3;
  - volver a Vercel por DNS sólo vale **hasta el comienzo de D3**.

| Momento | `app.arma2.com.ar` sirve | Respaldo |
| --- | --- | --- |
| Hoy → D1a | Vercel `ffaf131c` | — |
| D1a merge | Vercel `ffaf131c` (el merge no deploya: `deploymentEnabled.main=false`) | — |
| D1b–D1d | Vercel `ffaf131c`. Netlify ya publica el candidato en su URL propia, sin dominio | — |
| D1e corte | Netlify, candidato | CNAME de vuelta a Vercel (TTL 60 s): **sólo hasta D3** |
| Desde D3 | Netlify | Deploy anterior en Netlify (instantáneo, 0 créditos). Vercel ya no sirve como respaldo |
| Después de D9 + 7 días | Netlify | Se puede quitar `app.arma2.com.ar` del proyecto de Vercel (GO aparte); `arma2.vercel.app` sigue redirigiendo |

**Ventana de TLS:**
- Netlify pide el certificado de Let's Encrypt cuando el CNAME ya apunta a él. Mientras tanto, quien resuelva a Netlify
  puede ver un error de certificado: normalmente uno o dos minutos.
- Si a los 15 minutos no hay certificado, el CNAME vuelve a Vercel y se reintenta en otro momento.
- **Pestañas abiertas:** no hay service worker. Una pestaña abierta antes del corte puede fallar al cargar un chunk
  viejo hasta recargar.

## 5. Procedimiento del día D

Cada paso tiene su GO y su verificación; si falla, se pasa a §6. **Lo que necesita a Nico está en negrita.**

| Paso | Qué | Quién | Verificación |
| --- | --- | --- | --- |
| **D0** Backups | `backup-db` de Core y de Torneos + `restore-check` de cada uno; `backup-storage` + `storage-check` de Core y de Torneos | **Nico en Terminal.app:** escribe la contraseña de cada base, la passphrase (guardada antes en el gestor) y la `service_role` de cada proyecto para Storage. El agente prepara los comandos y lee los reportes | `RESTORE VERIFIED` ×2 y `STORAGE ARCHIVE VERIFIED` ×2. Sin eso no sigue nada |
| D0b Variables | Las cinco de §3 | **Nico** (5 minutos) | El agente lista nombres, contextos y largos |
| D1a Merge | Un solo merge de #192 a `main` | Agente, con GO | **Vercel:** ningún deployment nuevo para el SHA del merge (API de Vercel). `app.arma2.com.ar` sigue sirviendo `main.5514fd05.js` |
| D1b Rama de producción de Netlify | Crear la rama `netlify-production` en el SHA del merge y fijarla como producción del sitio. Branch deploys sólo para `netlify-production` y `codex/netlify-hosting-preview` (así #194 sigue con preview). Protección de equipo sólo para no-producción; si Free no deja elegir el contexto, se quita en el corte (D1e) y las previews quedan públicas, que son la misma web pública | Agente con GO, desde la sesión de Netlify de Nico | El build arranca solo (15 créditos). El log muestra «Private web access … validated» y «Build environment validated» |
| D1c Verificación sin dominio | En la URL permanente del deploy: rutas, `/health`, gate («mobile-only» sin cookie), `.well-known`, `.map` gateado, cabeceras, flags compilados (§2), 0 secretos en el bundle | Agente | Igual que la preview. Login y Torneos no se prueban acá: el origen `*.netlify.app` no está permitido en Auth ni en el gateway |
| D1d Dominio en Netlify | Agregar `app.arma2.com.ar` como dominio del sitio, sin tocar el DNS | Agente con GO | Netlify espera el DNS |
| D1e Corte de DNS | En Vercel DNS, el registro `rec_9140681b…` (`app`): de `b345e1b8b5c34d6a.vercel-dns-017.com.` a `silly-licorice-383784.netlify.app.`, TTL 60. Después, certificado | Agente con GO, desde la sesión de Vercel de Nico | `dig` → Netlify; HTTPS válido; mismo bundle que D1c; `/.well-known/*`; link de votación con código inexistente → «No encontramos ese partido»; `/torneos/explorar` con datos. **Login con QA1** (el recorrido de §8 de `DEPLOY.md`) en desktop y en 390 px |
| D2 | `core_apply` `20261007` y `20261008` + función del contrato | Agente con GO. **Nico escribe la contraseña de Core** | `MIGRATION-…_DONE` ×2 |
| D3 | `RUNBOOK-193`: precheck → `apply-193.psql` (22) → postcheck | Agente con GO. **Nico: contraseña de Core** | 13/13 · 22/22 · postcheck completo. Votación por link de punta a punta en el dominio |
| D4 | Torneos: `0009–0011`, `0012`, `0014`, `0015`, `0016` con sus drivers (sin `0013`) | Agente con GO. **Nico: la contraseña de Torneos**, si el Keychain no la tiene | `*_DONE`, `changedOutside = []` |
| D5 | Gateway: revisión con CONNECTED a 0 % + tag → matriz → 100 % | Agente con GO | Matriz de `DEPLOY.md` G6 |
| D6 | Frontend CONNECTED: variable en Netlify + *Trigger deploy* (15 créditos) | Agente con GO | Recorrido G7 |
| D7 | BRANDING: gateway (G8) → frontend (G9), otro deploy | Agente con GO | G8/G9 |
| D8 | Galería: `db-0012 mode MVP_SIMPLE` → gateway MEDIA → frontend MEDIA, otro deploy | Agente con GO | `ACTIVATION.md` |
| D9 | Limpieza de datos de QA, **backup nuevo de Core y Torneos** (mueve el punto de restauración) y 24 h de seguimiento | Agente. **Nico: contraseñas y passphrase** | Recién entonces se abre a usuarios reales (GO aparte) |

**Créditos de Netlify:**
- 4 deploys de producción (D1b, D6, D7, D8) = **60** de 300.
- Volver a un deploy anterior no cuesta nada.
- Un merge que sólo toca backend o docs no construye (`ignore`).
- Como la producción sale de `netlify-production`, un merge a `main` no publica nada en Netlify hasta que se mueve
  esa rama a propósito.

## 6. Recuperación

**Regla:** primero se apaga la función afectada y después se revierte, de arriba hacia abajo. En cada paso, la web
publicada y las bases tienen que ser compatibles entre sí.

**Compatibilidades verificadas** (ensayo general, RUNBOOK-193 §8, `DEPLOY.md` §6):
- **Web nueva:** funciona con Core antes, durante y después de `120000–141000`, y con cualquier rollback de
  `141000 → 135000`.
- **Web vieja (Vercel):** sólo funciona con Core antes de `125000`.
- **App 1.1.21:** funciona con todas.
- **Un flag de Torneos en el frontend** necesita el mismo flag en el gateway y su migración. Por eso se apagan en orden
  inverso al encendido: frontend → gateway → base.

### Escalera (parar en el primer escalón que resuelve)

| # | Acción | Cuándo | Tiempo | Datos |
| --- | --- | --- | --- | --- |
| 1 | **Netlify: publicar el deploy de producción anterior**, que no tenía el flag (*Deploys* → deploy → *Publish deploy*). Netlify bloquea la publicación automática hasta desbloquearla a propósito. Después se quita la variable, para que el próximo build no la vuelva a prender | Falla de pantalla o de un flujo después de D6, D7 o D8 | Segundos, 0 créditos | Ninguno |
| 2 | **Gateway:** tráfico a la revisión anterior de Cloud Run (G8 → G6 → G5 → `00005-dx5`) | Errores del gateway o del servidor en una función. **Siempre después del 1** si el frontend de esa función estaba prendido | Segundos | Ninguno: apagar un flag no borra nada, y al prenderlo se vuelve a ver |
| 3 | **Galería:** `db-0012 mode PROCESSOR_EXTERNAL` (el driver rechaza `rollback-0012` con el pipeline prendido) | Sólo con MEDIA apagado en el frontend y en el gateway | Segundos | Ninguno |
| 4 | **Torneos SQL**, con todos los flags apagados, por driver y en orden: `0016 → 0015 → 0014 → 0012 → 0011 → 0010 → 0009` | Sólo si una migración daña datos o hay que retirar el producto. Nunca por un error de pantalla | < 1 s cada uno | **0016** borra los avisos de reprogramación y postergación (el historial queda). **0015** y **0014**: ninguno. **0012**: ninguno (fotos y filas quedan). **0011**: ninguno. **0010**: los objetos de logos quedan sin acceso. **0009**: destructivo, se lleva todo lo creado en el producto conectado (perfiles, convocatorias, solicitudes, avisos): antes, export CSV de las 5 tablas (`DEPLOY.md` §7) |
| 5 | **Core:** rollbacks de `141000 → 135000` de `RUNBOOK-193` §9, en orden inverso. La web nueva sigue funcionando | Si una de esas migraciones rompe un flujo | < 1 s cada uno | Ninguno (cada fila del runbook dice qué vuelve a exponerse). Volver de `140000`/`141000` reabre el acceso a planteles y vuelve a impedir que el organizador apruebe |
| 6 | **DNS a Vercel** (registro `app` → `b345e1b8b5c34d6a.vercel-dns-017.com.`) | **Sólo antes de D3**, si falla el hosting (Netlify caído o sin créditos, certificado) | ~60 s de TTL | Ninguno |
| 7 | **Restaurar un backup** | Sección siguiente | Minutos a horas | Ver abajo |

### Cuándo hace falta el backup y qué se pierde

**Se restaura sólo si:**
1. Una migración dañó datos anteriores y su rollback no los devuelve: el driver o el postcheck dan otro digest que el
   del backup, o el rollback se niega por `DRIFT`.
2. Hay que volver más atrás de `135000` y el SQL de `120000–134000` de `PROMOTION.md` §5 falla. Esos rollbacks no se
   ensayaron como archivos.
3. Se ejecutó `rollback-0009` y el export CSV de sus tablas falló o no existe.

**Cómo:**
- Por tabla, en el mismo proyecto (`pg_restore -t` / `-L`), con GO propio.
- En Free no se puede restaurar un proyecto completo en uno nuevo sin pausar otro.
- La integridad de cada backup sí está probada (`RESTORE VERIFIED`). La restauración por tabla en Production **no se
  probó de punta a punta**.
- Storage se repone con `storage-restore`: sube sólo lo que falta y nunca pisa.

**Qué se pierde (todo lo escrito en las tablas restauradas después del backup):**
- **Core:**
  - cuentas nuevas (`auth.users` y `usuarios`), cambios de perfil;
  - partidos, planteles, solicitudes, votos, encuestas, avisos, amigos, frecuentes.
  - Un pago posterior a un partido que se haya registrado en la app también.
- **Torneos:**
  - organizaciones, torneos, inscripciones, solicitudes;
  - fixture, horarios, reprogramaciones, avisos, logos y filas de fotos.
- **Storage:**
  - un archivo subido después del backup queda sin su fila (huérfano);
  - uno borrado después vuelve sólo con `storage-restore`.

**Para achicar la pérdida:**
- D0 → D4 en el mismo día, con el backup de menos de 24 h que exigen `core_apply` y el runbook;
- backup nuevo en D9, para que el punto de restauración quede después del lanzamiento;
- casi sin usuarios, lo escrito en esa ventana es poco: antes de restaurar se exportan (CSV) las filas posteriores de las tablas afectadas, para recargar a mano lo que corresponda.
