# Lanzamiento — lista única de pendientes, orden de publicación y recuperación

Fecha: 2026-10-08. Contrastada con las sesiones de Core, Galería y Premium (respuestas del 2026-10-08).

**Etiquetas:**
- **LAB:** probado en laboratorio. Incluye todo lo que depende del emulador de Mercado Pago o del emulador de Netlify.
- **REAL:** comprobado contra un servicio real.
- **PENDIENTE:** no hecho.

Nada de lo LAB cuenta como listo para Production.

## 1. Qué se integró y CI

Rama local `claude/netlify-integrated-preview`, head de código **`dddf3ba8`** (actualizada el 2026-10-08 con #190 `0317caee`). Sin push, sin merges, sin cambios en Production.

| PR | Commit integrado | Qué trae |
| --- | --- | --- |
| #190 | `0317caee` | Premium (`0013` `72943492…`) + #189 `388bd54e` (Galería, `0012` `859fa24d…`, driver `db-0012`, confirmación al retirar la última foto y textos de rechazo corregidos) + #182 `938d6ddd` (+ docs `ffb888d6`) + #178–#181 |
| #187 | `abd9e8f2` | Core UX + #183 `415624af` (seguridad, migraciones 120000–133000) + #186 `f05147b4` (encuesta) |
| #184 | `dadc7c19` | Core rendimiento |
| #185 | `64de0d89` | Core UX |
| #191 | `9c40146d` | Netlify (prueba) |
| esta rama | `edb0ae16`, `e27f4923` | `apple-app-site-association` como JSON, `ignore` de builds no web, tests de hosting en CI, docs |

**CI final** (local, `npm run test:ci` sobre `dddf3ba8`), todo verde, rc=0:

| Suite | Resultado |
| --- | --- |
| foundation | 109 |
| social | 26 |
| connected | 22 |
| branding | 14 |
| media | 28 |
| commerce-production | 78 |
| ops | 16 |
| netlify hosting | 31 |
| Social Studio en navegador | PASS (76 exportaciones, 106 chequeos) |
| android | 6 |
| staging guard | 259 |
| workers | 156 / 118 |
| media runtime | 84 |
| Jest | 3680/3680 |

La prueba del Estudio Social en navegador había fallado 2 de 5 veces antes de esta corrida, con un recurso abortado sin URL; sobre #190 solo pasó 3 de 3. Hay que vigilarla. El CI de GitHub no corrió sobre esta rama porque no está subida.

## 2. Preview y cuentas (LAB)

1. Abrí **http://127.0.0.1:3198**, la página de cuentas de laboratorio.
2. Elegí una cuenta y tocá **«Entrar (Netlify)»**: abre `http://netlify-lab.localhost:3131`, el build de producción servido como en Netlify contra el laboratorio.
3. **«Entrar (dev 3121)»** sirve sólo para la compra de prueba de Premium, que existe únicamente en el servidor de desarrollo, por diseño.

| Cuenta | Para revisar |
| --- | --- |
| `b04-owner@lab.test` | Organizador: convocatorias, solicitudes, Mi plan, Premium, logos |
| `b04-captain@lab.test` | Capitán: Explorar, inscripción, plantel, avisos; Core mobile con el selector de espacios |
| `b04-ana@lab.test` | Jugadora |
| `b04-sin-equipos@lab.test` | Cuenta nueva sin equipos |
| `galeria-owner@lab.test` | Galería FREE con el tope lleno (25/25) |
| `galeria-capitan@lab.test` | Participante: Fotos y visor |
| `galeria-otra@lab.test` | Galería PREMIUM: subir, aprobar, publicar, retirar |

Core en la web está detrás del acceso privado. La contraseña de laboratorio está en `netlify-emu/.runtime/lab-web-access-password.txt` (0600, en el scratchpad de la sesión de #182).

## 3. Qué se comprobó

| Tema | Resultado | Tipo |
| --- | --- | --- |
| Login, callback, sesión al recargar, logout | OK | LAB |
| Navegación de Torneos en desktop y 375 px; carga directa de rutas profundas | OK | LAB |
| Inscripción completa: el capitán pide con «Lab Halcones Reserva» en «Lab Copa Conectada» con plantel 5/5 y arquero → envía → el organizador la ve pendiente y la aprueba → el capitán recibe «Solicitud aprobada» | OK | LAB |
| Galería, subida real desde la interfaz (Playwright): una foto nueva subida, aprobada, de portada, publicada y retirada en «Lab Otra Liga» (PREMIUM) | OK | LAB |
| Galería: fotos ya cargadas | Rechazadas por duplicado | LAB |
| Galería: tope FREE 25/25 | Rechazo antes de escribir; siguen contando 25 | LAB |
| Galería: participante (fotos firmadas, visor 1600 px) | OK | LAB |
| Galería: el participante no entra al Centro Multimedia | OK | LAB |
| Premium: compra con el emulador → la vuelta en el build de Netlify carga → PREMIUM → devolución → FREE | OK | LAB, **depende del emulador** |
| Premium con Mercado Pago real | **PENDIENTE** (R4–R8) | — |
| Gate de acceso web en Netlify: semántica de `context.next` | Leída del código real de Netlify | REAL (lectura de código) |
| Gate de acceso web en Netlify: comportamiento | En el emulador | LAB |
| Gate de acceso web en un deploy real de Netlify | **PENDIENTE**: el sitio es privado y da 401 sin sesión de Netlify | — |
| Comparación con Vercel en Production: `/health`, `apple-app-site-association` como JSON, asset inexistente | GET de sólo lectura | REAL |
| Contención (fase B): interruptor de compras, MEDIA, BRANDING y CONNECTED apagados; restauración igual a D0 | OK | LAB |

## 4. Lista única de pendientes

### 4.1 Decisiones de Nico

| # | Decisión | Bloquea |
| --- | --- | --- |
| D1 | **Hosting comercial.** Vercel Hobby no permite uso comercial y Netlify Free sí. Mover `app.arma2.com.ar` a Netlify antes de vender. El código sólo vende en ese dominio | C3 (ventas) |
| D2 | **Términos de Deno Deploy Free.** Su política de uso acepta e-commerce, pero el plan se presenta como «personal use and smaller projects». Aceptar, o Pro a USD 20 (no autorizado) | No bloquea técnicamente |
| D3 | **Legal y fiscal:** términos de venta, política de devoluciones, botón de arrepentimiento (Res. SCI 424/2020), facturación | Abrir ventas (R9) |
| D4 | **Tope de fotos Premium:** 200 recomendado, o 1000. El catálogo, el texto de Mi plan y la Galería cambian juntos | C3 si se cambia |
| D5 | **Plazo de acreditación de Mercado Pago:** la comisión va de 6,29 % + IVA (instantáneo) a 1,49 % + IVA (35 días), más impuestos provinciales | — |
| D6 | **Privacidad de Core:** aceptar el riesgo con una fecha (ver §5) y publicar la fase A antes o junto al lanzamiento | No técnico; riesgo |
| D7 | **CI de calidad de #189:** el clasificador bloqueó en la sesión de Galería el cherry-pick de `48dcc028`. Opciones: aprobarlo, mergear antes #187 (que lo trae) o cambiar la base | Merge de #189 con gate |
| D8 | **Link de una foto retirada:** hoy dura hasta 300 s; la alternativa es 120 s | — |
| D9 | **Galería:** retirar la última foto publicada (la portada) archiva la galería, y el archivo es terminal. **Corregido en #189 `388bd54e` e integrado (`0317caee`)**, verificado en LAB sobre el build de Netlify. Hay confirmación: «¿Retirar la única foto publicada? La galería quedará archivada…»; cancelar no hace nada y aceptar oculta la foto y archiva. Los rechazos ya no dicen «Retirá». Queda a decisión de Nico si archivar debe dejar de ser terminal (requiere rediseño) | — |

### 4.2 REAL, por estación (cada una con GO propio)

**C0 — Backups (PENDIENTE):**
- Base de Torneos, Storage de Core y Storage de Torneos con `ops_free_plan.py` y restauración verificada.
- Backup de Core de menos de 24 h antes de sus migraciones.

**H — Mudanza a Netlify:** preparada en [`PUBLICACION-NETLIFY.md`](PUBLICACION-NETLIFY.md) (2026-10-09). Lista original:
1. Verificar el deploy preview con una sesión de Netlify del equipo (tabla de `INTEGRATED-PREVIEW.md` §2).
2. `[context.production.environment]` con los valores de Production. Hoy se fuerza `preview` y Torneos apagado.
3. Paridad del build: `validate:web-access-env`, release de Sentry (`$COMMIT_REF`, `SENTRY_AUTH_TOKEN` sólo en el build).
4. Variables de entorno del proyecto de Vercel copiadas por nombre:
   - las públicas `REACT_APP_*` en el build;
   - los secretos del acceso privado sólo en Functions/Edge.
5. Rama de producción dedicada a releases, por los créditos.
6. Bajar el TTL del CNAME `app` antes del corte; después, CNAME → Netlify y certificado de Netlify.
7. Comprobar los links universales y `/.well-known/*` en el dominio.
8. Dejar Vercel como respaldo y redirector de los dominios `*.vercel.app`.
9. Sacar la protección «privado para el equipo» del sitio de Netlify en el corte.

**C1 — #182 (PENDIENTE):**
- `DEPLOY.md` G1–G11: merge;
- Core `20261007`/`20261008` y su función;
- Torneos `0009`–`0011`;
- gateway con CONNECTED y BRANDING;
- frontend;
- limpieza de los datos de QA.

**Core — #183 → #186 → #187, #184, #185 (PENDIENTE):**
1. Merge, regenerando B04 después de cada uno.
2. Migraciones `20261010120000`…`134000` (15), en orden, con backup y ventana. Antes de `134000`, pre-check de `partidos.template_id`.
3. **Builds nativos:** Android `versionCode` ≥ 45, iOS ≥ 42. Los cambios de Core llegan a los usuarios sólo así.
4. Pruebas en teléfonos reales: premios, pagos, encuesta, tutorial, tarjeta de Mis partidos.

**C2 — Galería (PENDIENTE):**
1. `db-0012.mjs observe` → `apply-0012` (exige Production en `POST_0011`).
2. `mode MVP_SIMPLE`.
3. Imagen del gateway (29 archivos, MEDIA encendido, timeout 30 s, máximo 3 instancias).
4. Frontend con MEDIA en un deploy propio.
5. Alarmas de Storage y egress: hoy no hay ninguna. Mínimo: chequeo periódico de `tournament_media_storage_budget_status()` y del panel de uso.
6. Confirmar el presupuesto de bytes contra el uso real del Storage de Torneos.
7. Safari/iOS en un dispositivo real.
8. Smoke posterior con una organización ajena real, porque falta ese fixture.
9. Limitaciones a aceptar: sin antivirus y sin decodificar imágenes en el servidor (MVP_SIMPLE), y sin borrado físico desde la interfaz.

**C3 — Premium (PENDIENTE, `commerce-production/DEPLOY.md`):**
- **R2:** `0013` con `db-0013.mjs`.
- **R3:** acceso a la base por Keychain.
- **R4:** credenciales de producción de Mercado Pago y webhooks en «Modo productivo» (Pagos y Contracargos).
- **R5:** Deno Deploy `torneos-payments`. Nico escribe los secretos en la TTY.
- **R6:** gateway con commerce a 0 % con tag, después 100 %.
- **R7:** billing en el contexto de producción. **Exige H hecho.**
- **R8:** primera compra real con allowlist (ARS 39.900), devolución desde el panel, interruptor en `off`.
- **R9:** abrir, con `monitoring.sql` diario.

Las devoluciones son manuales desde el panel de Mercado Pago.

**QA:** fixture de una organización ajena real, para las pruebas cruzadas entre organizaciones (pendiente desde Gate B+C).

## 5. Privacidad de Core

Según la sesión de Core: LAB, con el mismo esquema que Production; no se sondeó Production.

**Hoy**, cualquier cuenta autenticada puede leer de todos los usuarios, por PostgREST:
- email;
- teléfono;
- fecha de nacimiento;
- ubicación exacta.

Incluye una cuenta creada para entrar a Torneos, porque el registro es abierto y la identidad de Core es compartida. También puede leer el `partidos.codigo` de cualquier partido y el plantel de cualquier partido. La fase B no cierra el plantel.

**Fase A**, en #183/#187: migraciones 124000, 128000, 130000 y 133000 más el cliente. No está en Production.

**Fase B** se aplica a mano y necesita:
- builds nativos con el cliente de la fase A;
- 30 días de `report_client_build`;
- el desglose de versiones de las tiendas;
- `privacy_phase_b_readiness` en 0.

La versión 1.1.21, publicada hoy en las tiendas, se rompe con la fase B y no hay actualización forzada.

**Conclusión:** no bloquea técnicamente Torneos web, Galería, Premium ni Netlify. Pero el lanzamiento web pone la URL y la clave pública en cualquier navegador e invita a registrarse, así que la exposición crece. Recomendación: que Nico acepte el riesgo **por escrito y con fecha**, publicar la **fase A antes o junto** al lanzamiento, y fechar la fase B a los builds nativos. No dar la seguridad por resuelta mientras la fase B esté pendiente.

## 6. Dónde corre cada servicio y cuánto cuesta

| Servicio | Dónde | Costo |
| --- | --- | --- |
| Frontend web | Netlify Free (después del corte) | 0. 300 créditos por mes, tope duro; deploy de producción = 15; previews gratis; 20 por GB; 2 por cada 10.000 pedidos |
| Gateway de Torneos (web) | **Cloud Run** `torneos-gateway`, `arma2-465223`, `southamerica-east1`, desde el corte del 2026-09-30 | Free Tier (2 M pedidos, 180.000 vCPU-s, 360.000 GiB-s). Necesita cuenta de facturación (ya existe). El egress desde São Paulo no es gratis: centavos |
| Pagos y webhooks | **Deno Deploy**, org `nicoavayu`, app `torneos-payments`: servicio `…/functions/v1/torneos-payments-production`, webhook `…/webhooks/mercadopago/v1` | Free: 1 M pedidos, 20 GiB, 10 h de CPU por mes, **por organización**. Ahí también está el gateway viejo `torneos-gateway.nicoavayu.deno.net` y comparte la cuota. El cron cada 15 min ≈ 2.976 pedidos por mes |
| Bases, Auth, Storage, fotos, logos | Supabase Free (Core y Torneos) | 0. Cuotas de organización: 500 MB por base, 1 GB de Storage, 5 GB de egress |
| Mercado Pago | — | Comisión por venta, impuestos y retenciones. Una devolución no garantiza que vuelva la comisión. Facturación y contabilidad aparte (D3) |

No hay contrataciones nuevas. Si se alcanza un límite: Deno Pro USD 20 por mes, o un plan pago de Netlify. Ninguno está autorizado.

## 7. Orden de publicación y recuperación ante fallos

> **Reemplazado (2026-10-09)** por [`PUBLICACION-NETLIFY.md`](PUBLICACION-NETLIFY.md): Netlify elegido, variables, Vercel sin deploy de `main`, corte de DNS, día D y recuperación. Esta tabla queda como historia.

| Paso | Qué | Si falla |
| --- | --- | --- |
| 0 | Decisiones D1–D9 y backups C0 | — |
| H | Netlify con `main` sin cambios de producto: deploy preview verificado → contexto de producción → CNAME `app` → Netlify | CNAME de vuelta a Vercel (sigue intacto y publicando `main`). En Netlify, volver a un deploy anterior es instantáneo y cuesta 0 créditos |
| C1 | #182 según su `DEPLOY.md` | Frontend: deploy anterior. Gateway: revisión anterior de Cloud Run. Flags CONNECTED/BRANDING en `off` (probado en LAB). SQL de rollback sólo como último recurso |
| Core | Merge y fase A (15 migraciones) → builds nativos → fase B con readiness | Rollback por migración (`PROMOTION.md`); el cliente tolera la base con o sin ellas |
| C2 | Galería: `0012` → modo → gateway → frontend | En orden inverso: frontend → gateway → modo → base. El rollback de `0012` conserva las fotos |
| C3 | Premium R2–R9, con allowlist antes de `open` | Interruptor de compras en `off` (probado en LAB: 409 sin crear nada) → modo commerce `off` sólo sin compras abiertas → frontend → `0013` rollback sólo antes de la primera compra. Devoluciones desde el panel de Mercado Pago |

**Riesgo transversal:** si Netlify agota sus créditos, se pausan todos los sitios. Mitigación:
- releases deliberados, no un deploy por merge;
- `ignore` de builds no web;
- revisar los créditos cada semana;
- Vercel listo como respaldo por DNS.
