# SOCIAL-V1 — Estudio Social V2 completo, listo para Production

Estado: **SOCIAL_STUDIO_V2_READY_FOR_GATE_A** (2026-10-03). Todo queda **OFF por defecto**: este PR no habilita nada en
Production, no toca la DB de Production, ni Cloud Run, ni Vercel, ni Android. Billing, Commerce y Mercado Pago siguen OFF.
Auditoría y plan de origen: [`AUDIT.md`](AUDIT.md), [`PLAN.md`](PLAN.md) (T1–T5, todos hechos).

## 1. Qué hace el Estudio

| | FREE | PREMIUM |
|---|---|---|
| Abrir el Estudio, ver el catálogo y previsualizar | 11 placas × 5 estilos × 2 formatos (lo Premium, con candado fuera del arte) | igual |
| Descargar / compartir PNG | Resultados, Tabla de posiciones y Próxima fecha, estilo Base | las 11 placas en los 5 estilos |
| Firma Arma2 | obligatoria | opcional en Base; Heritage, Street, Scoreboard y Editorial siempre sin firma |
| Si pide algo Premium | candado + "Ver Premium" → Mi plan `#premium` ("La compra de Premium todavía no está disponible"). Sin checkout | — |

Formatos: Feed 4:5 (1080×1350) e Historia 9:16 (1080×1920), composiciones independientes. Placas: Próxima fecha,
Resultados de la fecha, Tabla de posiciones, Goleadores, Sancionados, Equipo de la fecha (5/6/7/8/9/11 jugadores, línea
editorial manual), Figura (foto local opcional con punto focal arrastrable, zoom y restablecer), Resumen de fecha,
Semifinales, Final y Campeón.

**Sin Multimedia:** ninguna placa se oculta. Escudos → monograma/iniciales; Figura/Campeón sin foto → variante diseñada;
foto de la Figura → archivo local (nunca se sube); firma Arma2 embebida en el bundle. El adapter híbrido no expone el
firmador de Multimedia ni los resolvers de escudos/logos.

## 2. Capas (todas fail-closed)

| Capa | Qué | OFF por defecto |
|---|---|---|
| DB | `00000000000008_social_v1_export_authorization.sql`: NULL-guards (tema, placa y firma `NULL` ⇒ 22023, sin coerción ni default) + `GRANT EXECUTE` a `authenticated` sobre **una** función. 171→172 / anon 12. Pre/postcondición exactas, re-aplicar = no-op, rollback versionado | no aplicada en Production (gate D) |
| Gateway | `social.ts` + `social-v1-rpc-allowlist.json`: `TORNEOS_SOCIAL_MODE` ausente/`""`/`off` = sin cambio; `on` = exactamente las 3 RPC; cualquier otro valor o un documento adulterado ⇒ el gateway no arranca. `set_tournament_social_permission` nunca; ruta pública nunca | env ausente |
| Web | `socialContentGenerator` en `PRODUCTION_ELIGIBLE_FLAGS`; `resolveTorneosSocialStudio` = híbrido **y** PLAN READ **y** flag; overlay `social_studio`, scope del cliente `socialV1Scope.js` y 3 alias del adapter, juntos o nada | `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED` ausente |
| Página | antes de cada archivo: política del cliente, firma de lo renderizado = la autorizada, y `authorize_tournament_social_export`; la respuesta del servidor tiene que describir exactamente la placa, el estilo y la firma renderizados o no hay archivo | — |
| Mi plan | el Estudio pasa de "Próximamente" a la comparación FREE vs PREMIUM sólo cuando la navegación lo ofrece (flag + feature) | sigue en Próximamente |

La DB es la autoridad final: el plan del browser, el tema elegido y la firma enviada nunca alcanzan solos.

## 3. Bugs encontrados y corregidos

1. **F1 (DB):** `authorize_tournament_social_export` autorizaba a un FREE como white-label con tema `NULL`, autorizaba placa
   `NULL` y devolvía firma `null` a un PREMIUM con firma `NULL`. ⇒ 0008.
2. **Firma Arma2 perdida en silencio (PREMIUM):** mirar un estilo Premium y volver a Base dejaba la firma apagada (el efecto
   pisaba la elección). ⇒ la elección se conserva; los estilos Premium son white-label por política, no por pisar el estado.
3. **Autorización ignorada:** la página no verificaba la respuesta del servidor. ⇒ si lo autorizado no es lo renderizado
   (placa, estilo, firma), no hay archivo.
4. **Nombres de archivo ambiguos:** el nombre no tenía el estilo (Base y Heritage de la misma placa = mismo archivo) y el
   recorte a 90 caracteres podía borrar el formato. ⇒ `<torneo>-<categoría>-<fecha>-<placa>-<estilo>-<feed-4x5|historia-9x16>[-pagina-N-de-M].png`;
   se acorta la descripción, nunca estilo ni formato.
5. **Editorial multipágina al compartir:** se compartía sólo la página visible. ⇒ todas las páginas en una sola hoja de
   compartir, o se descargan todas. Las descargas consecutivas ahora se espacian (los navegadores descartaban algunas).
6. **Carrera de React:** al salir del Estudio con una vista Premium montada se desmontaba su raíz de forma síncrona dentro
   del commit del árbol principal (warning de React en el navegador). ⇒ desmontaje diferido.
7. **Errores del servidor:** cualquier rechazo terminaba en "No pudimos exportar la pieza" y tapaba la vista previa con un
   error. ⇒ copy humano por código (Premium, firma, rol, sin fixture publicado, estilo/placa desconocidos) y la vista previa
   queda intacta.
8. **Modal que tapaba la vista previa:** en FREE, elegir un estilo Premium abría un modal encima de la vista previa que se
   quería mostrar. ⇒ aviso en línea + "Ver Premium".
9. **Estados vacíos:** sin torneos, o con un torneo sin fixture publicado, la página quedaba con selects vacíos. ⇒ estados
   explicativos, sin pedir snapshots.
10. **Copy técnico:** "familias visibles", "Premium habilita las 11 familias Base", "theme", "Preview white-label · export
    bloqueado", "Exportar diseño · Premium 🔒 · Próximamente", mensaje de curaduría duplicado. ⇒ lenguaje humano, sin IDs.
11. **Vista previa fuera de pantalla al encuadrar la foto:** el CSS global (`body { overflow-y: scroll }` con
    `html { overflow-x: clip }`) anula `position: sticky`, así que al bajar hasta el editor de la foto la vista previa —donde
    se arrastra el punto focal— quedaba fuera de pantalla. ⇒ las herramientas de la foto (elegir, zoom, restablecer) viven
    bajo la vista previa. El CSS global no se tocó (afecta a toda la app).
12. **Render no determinístico:** el renderer Base dibuja Oswald 300/400 pero sólo esperaba 500/600, y la app declara
    Oswald dos veces (variable local + caras estáticas de Google). Un primer render podía salir con una cara y uno
    posterior con otra. ⇒ se esperan todos los pesos que dibuja, con un test que lo deriva del código del renderer.
13. **Renders de más:** la vista previa se regeneraba sin cambios visibles (el objeto `branding` dependía de identidades
    y volver a tocar el formato elegido creaba otro estado), y el botón de descarga se deshabilitaba un instante. ⇒
    `branding` memoizado por valores; re-elegir lo elegido no cambia el estado.
14. **Tipografías tardías:** con caché fría el primer render fallaba cerrado ("No pudimos cargar las tipografías") y la
    vista previa quedaba rota. ⇒ hasta 2 reintentos automáticos antes de informar el error (nunca se dibuja con una
    tipografía de reemplazo).
15. **Frontera de la foundation:** el primer borrador de `resolveTorneosSocialStudio` importaba la config del shell desde
    `foundation/` (lo atrapó el guard). ⇒ los flags se inyectan; sin flags, cerrado.

**Legacy eliminado** (sin importadores, probado): `socialTemplates.js`, `resultsThemeLayouts.js`,
`results{Editorial,Street,List}Layout.js`, `resultsBranding.js`, `resultsLayoutTuning.js` y `domain/planExperience.js`
(copy vieja "Social Studio Premium"). El producto renderiza sólo con V2: Base en Canvas, Premium en DOM (8 layouts).

## 4. Evidencia

| Prueba | Resultado |
|---|---|
| Lab Docker 0008 (`lab/run-lab.sh`, Postgres 17.6.1.143, 0000…0007 + fixtures) | **94/94** `SOCIAL_V1_LAB_PASS` — RED F1 reproducido, 0008, matriz NULL/desconocido/org cruzada/temporada cruzada/sin identidad/FREE/PREMIUM/roles, re-apply no-op, estado adulterado ⇒ aborta sin cambios, rollback = catálogo POST_0007 byte a byte, re-forward. `evidence/sql-cases-0008.txt` |
| `test:torneos:social` (en `test:ci`) | migración/rollback/driver db8 8, gateway 14, matriz de certificación 4 |
| `test:torneos:frontend-foundation` | incluye `social-adapter.test.mjs` (paridad exacta con el servicio legacy, scope = allowlist = contrato, entradas inválidas antes de la red, copy humano) |
| Jest | Estudio V1 (página: FREE/PREMIUM, locks, firma, autorización, multipágina, roles, vacíos, copy) + Mi plan con Estudio + suites existentes del Estudio |
| Navegador real (`scripts/qa/social-studio/browser-check.cjs`, Chromium) | ver `artifacts/social-studio/evidence.json` al correrlo: PNG reales de tamaño exacto para FREE (3 × Base × 2, **idénticos byte a byte al canvas de la vista previa**) y PREMIUM (11 × 5 × 2); Figura foto/arrastre/zoom/restablecer; Equipo ideal 5–11 con línea editorial; Editorial 16/24 equipos (15 por página, sin duplicar ni omitir, alineado arriba, todas las páginas); 1440/1024/390/320 sin scroll horizontal; colaborador; vacíos; Estudio OFF |
| Guards que fijan el estado | G1 (delta SOCIAL revisado y fijado por sha256), season-scope, OEC (0008 conocido), grafo del gateway 18→20, env declaradas `TORNEOS_SOCIAL_MODE` |

## 5. Rollout en Production (cada paso es un gate)

| # | Gate | Cambio exacto | Certificación | Rollback |
|---|---|---|---|---|
| 0 | **A** | Merge de este PR. Vercel redeploya `main` sin env nueva | bundle sin valor para `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED`; sin "Estudio Social" en la navegación; Mi plan igual (Próximamente). Gateway Prod sin cambios (imagen `dc8049d3…` no tiene `social.ts`) | revert del merge |
| 1 | **D** | `node backend/torneos/social-v1/remote/db8.mjs observe` ⇒ `POST_0007`; luego `node backend/torneos/social-v1/remote/db8.mjs apply APPLY TORNEOS 0008 onzpwnqxnvlgsevivngf 8b1e7bf96c13` | `APPLY_0008_DONE`, `observe` ⇒ `POST_0008` (172/12, md5 `85bb4858…`, resto del catálogo idéntico) | `db8.mjs rollback ROLLBACK TORNEOS 0008 onzpwnqxnvlgsevivngf dcc65afe7aeb` ⇒ `POST_0007` |
| 2 | **B** | Imagen nueva del gateway desde `main` (grafo de 20 archivos), revisión nueva a 0 % + tag con `TORNEOS_SOCIAL_MODE` **ausente** ⇒ 100 % | unauth 15/15 sin diffs; las 3 RPC ⇒ 403 `rpc not enabled`; `cloudrun-readonly.mjs --expect-env TORNEOS_SOCIAL_MODE='<absent>'`; 0 5xx | tráfico 100 % a `torneos-gateway-00003-b78` |
| 3 | **B+C** | Revisión nueva = anterior + `TORNEOS_SOCIAL_MODE=on` | `probe/social-matrix.mjs` `browserProbe(PRODUCTION_QA)` desde `/login` con la sesión QA (un `/exchange`): matriz completa en verde, regresión PLAN READ, 0 5xx, 0 `CORE_UNAVAILABLE` | tráfico a la revisión del paso 2 |
| 4 | **C** | Vercel `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=true` (production-only) + redeploy de `main` | UX con sesión QA (FREE): nav "Estudio Social", 3 placas Base descargan PNG con firma, el resto con candado y sin checkout, Mi plan con el Estudio en la comparación, 390/320 sin overflow, 0 requests de commerce/medios | promover el deploy anterior o borrar la env |

Orden obligatorio: el paso 3 no puede ir antes del 1 (sin 0008 el export responde `permission denied`), y el 4 no puede ir
antes del 3 (sin las 3 RPC en el gateway el Estudio aparecería en la navegación y no podría abrirse). Cada paso deja Production coherente si se
detiene ahí.

## 6. Riesgos aceptados / fuera de alcance

- La exportación es client-side: un cliente modificado puede generar un PNG Premium para un FREE (pérdida de valor
  comercial, sin exposición de datos). La DB nunca lo autoriza. Se revisa cuando exista compra.
- Colaboradores: sin `set_tournament_social_permission` en la UI no hay forma de darles export (sólo owner/admin exportan).
- Las suites del lab de integración (`integration/torneos-core-contracts`, stack Docker completo) fijan la ACL POST_0007;
  no se pudieron correr acá porque otro lab ocupa sus puertos fijos. La prueba de 0008 con SQL real es el lab propio.
- Android (gate J), PREMIUM real en una temporada (gate D), Multimedia y logos/escudos: fuera de alcance.
