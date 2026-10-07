# Promoción web de Torneos conectado — CONNECTED-V1 + BRANDING-V1 + preferencia de push de Core

**Estado (2026-10-07): preparada y ensayada. No se ejecutó nada en Production.** Cada gate necesita un GO explícito de
Nico en el chat. Las letras son las del runbook de operador: A merge, B deploy o tráfico, C env, D escritura en DB,
E rollback, L borrado, M plan pago. Las apps de iOS y Android quedan fuera: esta promoción no autoriza builds de
tienda ni certifica Android, APNs real, la renovación de tokens o los enlaces universales (ver §10).

## 1. Candidato

**PR #182** (`claude/torneos-connected-product`). Su head es el commit que contiene esta versión del documento; el
SHA exacto y su CI figuran en el cuerpo de la PR. Composición, de abajo hacia arriba:

| Capa | Commits | Nota |
| --- | --- | --- |
| `main` | `ffaf131c` | Es lo que sirve Production hoy (Vercel, #176) |
| #179 | `44477d73`, `45018c0d` (head) | Nada fuera de pantalla; estados de carga, error y vacío |
| #180 | merge de `e9b690bb` (head) | Inicio y contexto |
| #181 | merge de `4d851810` (head) | Densidad de listas de competencia |
| #178 | merge de `d7eb31b2` (head) | Estudio Social, la alternativa elegida |
| Integración | `30f6e429` | `claude/torneos-ux-integration-178-181`, la base actual de #182 |
| #182 | `258f39a9`, `3593891c`, `985c22a2`, `517c8940`, `4a398711`, `90015b72`, `66396608`, `120b5b21`, `05a61031`, `ce90c6b8`, `faceb89a`, `1ccbb980`, `c9239613`, `b6c44e93`, `06dc9ef5`, `4fe15a8b`, `c365f7fc`, `bc8e21db`, `b2c3ba3f` y el commit de este documento | Producto conectado, logos, preferencia de push, correcciones del ensayo |

- **Dependencias.**
  - Los commits propios de #182 necesitan #179–#181: sin ellos, `TorneosLanding` entra en conflicto.
  - #178 no depende de nada (sólo comparte los pins de B04), pero es la alternativa de Social elegida y es parte del
    árbol probado.
- **#177 queda afuera:** duplica la alternativa de Social de #178. Se cierra como reemplazada después del merge.
- **Relación con `main`:** `main` (`ffaf131c`) es ancestro del head, así que el árbol mergeado es idéntico al
  probado.

### Mecánica del merge (gate A)

1. Re-apuntar la base de #182 a `main` (`gh pr edit 182 --base main`) y esperar el CI (`quality` + Vercel) del head.
   Ese CI es la evidencia; no sirve el de un commit anterior.
2. Mergear #182 con **«Create a merge commit»**, no squash. Así los heads de #178–#181 entran en `main` y GitHub los
   marca mergeados solos.
3. Cerrar #177 con un comentario: «reemplazada por #178, entró con #182».
4. No se mergean #178–#181 por separado ni se toca `main` antes.

## 2. Preflight de Production (lecturas, 2026-10-06)

| Pieza | Observado | Lo que pide el candidato |
| --- | --- | --- |
| Frontend (Vercel `arma2`, Hobby) | Production = deploy de #176 (`ffaf131c`, bundle `main.5514fd05.js`); el anterior instantáneo es #175 (`8a53a42`). Variables de Torneos: `ENABLED`, `PRODUCTION_ENABLED`, `DATA_ENV`, `WORKSPACES_ENABLED`, `WORKSPACE_SWITCHER_ENABLED`, `PUBLIC_PAGES_ENABLED`, `GATEWAY_URL`, `PLAN_READ_MODE`, `SOCIAL_GENERATOR_ENABLED`, `PRODUCTION_PROJECT_REF`. **Sin** `REACT_APP_TORNEOS_CONNECTED_MODE` ni `REACT_APP_TORNEOS_BRANDING_MODE` (tampoco compiladas en el bundle) | Agregar las dos variables en G7 y G9 |
| Gateway (Cloud Run `torneos-gateway`, `southamerica-east1`) | 100 % en `torneos-gateway-00005-dx5`. Imagen `e9b4ed0f…` (`main` `2b22aadd`), 15 variables, `TORNEOS_PLAN_READ_MODE=on`, `TORNEOS_SOCIAL_MODE=on`. Sin `CONNECTED`, `BRANDING` ni `STORAGE_*`. Máximo 3 instancias, timeout 30 s. `00004-jn4` sigue disponible | Imagen nueva desde `main` con un grafo de 25 archivos (agrega `connected.ts`, `branding.ts`, sus dos allowlists y `my-teams.schema.json`). Production **no** configura `TORNEOS_STORAGE_*`: el storage se deriva de `TORNEOS_REST_URL` |
| Core DB (`rcyuuoaqfwcembdajcss`) | Ledger hasta `20260915120000` (contrato v1.1). Pendientes: `20261007120000` y `20261008120000`. `20261006120000` (gemela LOCAL) ausente, y así debe seguir. **Plan Free: sin backups ni PITR.** Tamaño de la base: **505,16 MB sobre una cuota de 500 MB** (la organización está al 106 %) | `20261007120000` (cuerpo de `torneos_contract_execute` con `my_teams`) y `20261008120000` (preferencia de push) |
| Core Edge `torneos-core-contract` | Desplegada hace 12 días (INFRA-1), 3 despliegues. Sin `/v1/my-teams` | Redeploy con `supabase/functions/_shared/torneosCoreContract.ts` del candidato |
| Torneos (`onzpwnqxnvlgsevivngf`) | **Plan Free: sin backups ni PITR.** 36,9 MB. El ledger del panel dice «No migrations» (las migraciones se aplican con drivers de operador, no con la CLI). Último estado certificado: **POST_0008** (172/12, 2026-10-04). Clave JWT ECC P-256. El bridge se acepta por una integración Third-Party Auth `jwks_url` creada por Management API (W5 `--b03`), que el panel no lista | `0009` → `0010` → `0011` |
| Aceptación del token del bridge | PostgREST lo acepta: PLAN READ certificó 32/32 con ese token en Production. **Storage: sin verificar** | Firmar logos con el bearer del usuario (G8) |

**Bloqueos concretos (no se reemplazaron por suposiciones):**

| # | Bloqueo | Qué hace falta | Bloquea |
| --- | --- | --- | --- |
| B1 | Las dos bases sin backups ni PITR, y Core sobre la cuota del plan Free | Gate M: pasar la organización a Pro. Da backups diarios a los dos proyectos y saca a Core del límite que puede ponerla en sólo lectura. Además, un `pg_dump` manual de cada base justo antes de G2 y de G4 (lo corre Nico en Terminal, con la contraseña por `/dev/tty`; el archivo queda fuera del repo) | G2, G4 |
| B2 | No existe la herramienta para Core v1.2. INFRA-0.5 instala exactamente `[20260914120000, 20260915120000]`; las dos ya están, así que su runner se niega con razón | **INFRA-1.2**: fijar `20261007120000` (`61474a49…`) y `20261008120000` (`f20b8c49…`) con sha256, la línea base del ledger después de v1.1, el artefacto de la función certificado primero en Core Staging (`ezbr_sha256`), su frase, el harness firmado + `my_teams` y un ensayo offline. Y una **excepción nueva y limitada** de Nico a «NO modificar DB Core» para esas dos migraciones y esa función | G2, G3 |
| B3 | Esta sesión no pudo leer los catálogos de DB de Production. El driver lee la contraseña del Keychain y se frenó la exploración de credenciales | Que Nico corra en Terminal `node backend/torneos/connected-v1/remote/db-0009-0011.mjs observe` (sólo lectura) ⇒ `POST_0008`, y las lecturas de Core de G0 | G0 |
| B4 | No está probado que Storage del proyecto aislado acepte el bearer del bridge | En G0, con una cuenta QA: `GET /storage/v1/bucket` con ese bearer ⇒ 200, no un 400/403 de JWT | G8 |

## 3. Ensayo de la promoción (laboratorio descartable `arma2-promo-rehearsal`, 2026-10-06/07)

El laboratorio corrió sólo en loopback: Core real con Auth, PostgREST y Edge; Torneos aislado con Storage real; el
gateway en Node y en Edge (Edge = el mismo runtime que Cloud Run). S0 reproduce Production: `main`, Core hasta
`20260915120000`, Torneos 0000–0008, gateway con `PLAN_READ=on` + `SOCIAL=on` y el frontend con los flags de
Production.

En cada etapa se usaron dos medidas:
- **Sonda:** 30 observaciones (estado + código + hash normalizado del cuerpo, en Edge y en Node). Cubre rutas públicas,
  `/exchange`, PLAN READ, Social, RPC conectadas, branding y casos de outsider.
- **Suites congeladas de `main`:** `test`, `exposure`, `competition`, `officialization` y `error-contract`, en los
  dos gateways. Se compara el conjunto de casos que fallan.

| Etapa | Cambio | Resultado |
| --- | --- | --- |
| S0 | Production hoy | Línea base (los fallos de las suites son históricos del laboratorio y se repiten igual en todas las etapas) |
| F1 | Frontend candidato con los flags de Production, backend de hoy | Las pantallas existentes quedan intactas: organizador, Mi plan FREE, Estudio Social, PLAN READ. Las nuevas degradan sin error: «Mis torneos» vacío, Avisos sólo con comunicados, Perfil con el nombre de Core, sin «Explorar» y sin control de push (`PGRST202`) |
| S1 | Core `20261007` + `20261008` | Sonda = S0 |
| S2 | Función Core del candidato | Sonda = S0; `/v1/my-teams` sin firma ⇒ 401 |
| S3 | Storage + `0009` + `0010` con el gateway de `main` | Sonda y suites = S0: el gateway viejo funciona igual sobre la DB nueva |
| S4 | Gateway candidato con flags apagados | Sonda y suites = S0 |
| S5 | `TORNEOS_CONNECTED_MODE=on` | Sólo cambian las RPC conectadas; `connected.test` 8/8 en Edge y Node; suites = S0 |
| S6 | Frontend con CONNECTED | Recorrido completo en el navegador (ver abajo) |
| S7 | `TORNEOS_BRANDING_MODE=on` | Sólo cambian las respuestas con logos; `branding.test` 8/8 en Edge y Node. Las suites suman tres casos esperados de las suites viejas (A4 de officialization por `0011`, D2 de competition y D1 de Node, porque BRANDING sirve esas RPC) |
| S8 | Frontend con BRANDING | Logo subido desde la interfaz, visible en catálogo, ficha, página pública, solicitud, equipo y ajustes |
| C1 | Contención: BRANDING apagado en el gateway | = S5; iniciales en vez de logos; datos y objetos intactos |
| C2 | Contención: CONNECTED apagado en el gateway | = S0; datos intactos (6 perfiles, 996 avisos, 5 convocatorias, 5 solicitudes). Un frontend que sigue con CONNECTED muestra un error limpio en Explorar ⇒ **primero se contiene el frontend** |
| C3 | Contención: gateway de `main` sobre la DB ya migrada y con datos | Sonda = S0 (30/30) ⇒ volver el tráfico a `00005-dx5` es seguro |
| C4 | Rollback seguro de la preferencia de push en Core | Trigger fuera y EXECUTE revocado; un valor `false` sobrevive al rollback y a la reaplicación; el frontend candidato oculta el control (ver hallazgo 4) |
| C5 | Sólo en el laboratorio: `rollback-0011` → `rollback-0010` → `rollback-0009` con el driver de Production; después reaplicación y restauración desde el export | `POST_0011 → POST_0010 → POST_0009 → POST_0008` con `changedOutside = []` en cada paso; en `POST_0008`, sonda y suites = S0. Lo que borra cada paso está en §7. La reaplicación sobre el residuo del bucket vuelve a `POST_0011` con el catálogo anterior idéntico; restaurar los CSV devuelve los mismos conteos, y con los flags prendidos la sonda = antes del rollback (30/30) y el preview muestra lo mismo |

**Recorrido S6/S8 en el navegador** (gateway Edge, cuentas del laboratorio):
- Capitán sin torneos: estado vacío con «Explorar torneos» → Explorar → ficha → «Solicitar inscripción» → equipo de
  Core → condiciones → plantel → búsqueda de jugadores de Arma2 → 5/5 con arquero → enviar.
- «Tus solicitudes» muestra la pendiente («Todavía no ocupa un cupo») y «Mis torneos» queda vacío.
- Organizador: sólo «Gestionar»; aviso «Nueva solicitud» → revisión → pedir cambios → el capitán ve el motivo,
  corrige y reenvía → aprobada.
- Capitán: aviso de aprobación y «Mis torneos» con la competencia.
- Dual: conmutador «Mis torneos | Gestionar» con las dos listas separadas.
- Perfil de Torneos sin tocar el perfil deportivo de Core; punto de avisos del otro producto junto al logo.
- Página pública sin sesión → «Solicitar» → `/login?returnTo=…` → vuelve al formulario.
- Explorar y las pantallas del capitán a 375 px sin desborde horizontal.
- Los datos del formulario se conservan cuando el envío falla. Para probarlo se apagó CONNECTED a mitad del
  formulario.

**Hallazgos del ensayo (todos corregidos en #182):**

1. **Contrato de runtime del gateway.** Las pruebas de endurecimiento del laboratorio detectaron variables nuevas sin
   declarar y un hostname literal (`b6c44e93`).
2. **`0011`.** En el proyecto aislado, el capitán de un equipo de afuera de la organización no podía buscar jugadores
   de Arma2 para su plantel (`TORNEOS_RESOURCE_FORBIDDEN`): la guarda de temporada también se aplicaba al camino de la
   inscripción.
   - `0011` la deja sólo en el camino de la organización, en `search_tournament_players` y en el autorizador
     (`4fe15a8b`).
   - Verificado en la base: un miembro sin acceso a la temporada sigue rechazado.
3. **Logo de la organización en sus ajustes.** No se firmaba en híbrido (`c365f7fc`).
4. **Preferencia de push después del rollback seguro de Core.** Con el frontend candidato publicado, Perfil mostraba
   la casilla deshabilitada y «No pudimos leer esta preferencia» (EXECUTE revocado ⇒ `42501`).
   - Ahora un EXECUTE revocado cuenta como «no disponible» y el control se oculta. El `AUTH_REQUIRED` de la propia
     función sigue siendo error.
   - Resultado: el rollback seguro de Core ya no depende de revertir el frontend.
5. **Driver `db-0009-0011`.** `rollback-0010` deja la fila del bucket privado porque Storage no borra un bucket con
   objetos. `classify()` la tomaba como DRIFT, lo que trababa `rollback-0009` y una reaplicación de `0010`.
   - Ahora acepta exactamente ese residuo: privado, con la configuración de `0010`, sin políticas ni funciones.
   - Lo cubren los tests offline y quedó probado en el laboratorio.

## 4. Qué se despliega y dónde

| Pieza | Destino | Archivo | sha256 |
| --- | --- | --- | --- |
| Contrato Core v1.2 `my_teams` | DB Core | `supabase/migrations/20261007120000_torneos_core_contract_v1_2_my_teams.sql` | `61474a4996c95c3c…` |
| Preferencia de push | DB Core | `supabase/migrations/20261008120000_core_push_preference_v1.sql` | `f20b8c49ef15ff67…` |
| Función `torneos-core-contract` | Core Edge | `supabase/functions/torneos-core-contract/index.ts` + `_shared/torneosCoreContract.ts` | `ezbr` a certificar en Staging (B2) |
| Producto conectado | Torneos | `backend/torneos/supabase/migrations/00000000000009_connected_product_v1.sql` | `8bb8e6c84bbe…` |
| Logos y escudos | Torneos (DB + Storage) | `backend/torneos/supabase/migrations/00000000000010_branding_v1.sql` | `76d13425116d…` |
| Búsqueda de jugadores para el responsable de la inscripción | Torneos | `backend/torneos/supabase/migrations/00000000000011_connected_roster_search.sql` | `3cac4d885955…` |
| Gateway | Cloud Run | imagen desde el merge commit de `main` (grafo de 25 archivos) | digest a registrar en G5 |
| Frontend | Vercel | `main` + `REACT_APP_TORNEOS_CONNECTED_MODE=on`, después `REACT_APP_TORNEOS_BRANDING_MODE=on` | bundle a registrar en G1, G7 y G9 |

**No van a Production:**
- `supabase/migrations/20261006120000_torneos_connected_product_v1.sql`, la gemela LOCAL (`legacy-local`).
- Ningún `db push` general.

## 5. Secuencia recomendada

Cada gate deja Production en un estado coherente, ensayado y en el que se puede frenar. Hay tres criterios de parada
que valen para todos los gates:
- Un veredicto distinto del esperado (`DRIFT`, `*_FAILED`, `changedOutside` no vacío, frase o hash rechazados).
- Cualquier 5xx nuevo, `bootDisabled` o `CORE_UNAVAILABLE` en `cloudrun-readonly`.
- Una diferencia en PLAN READ, Social o en la suite unauth respecto del gate anterior.

Ante cualquiera de ellos, el siguiente gate no se ejecuta y se aplica la contención de la fila.

| Gate | Letra | Acción exacta | Verificación | Contención |
| --- | --- | --- | --- | --- |
| **G0** Preparación | M + lecturas | Pasar la organización Supabase a Pro (B1). Lecturas: `db-0009-0011.mjs observe` ⇒ `POST_0008` (B3); ledger de Core = `…20260915120000` y `usuarios.push_enabled` presente; `cloudrun-readonly.mjs --expect-env TORNEOS_CONNECTED_MODE='<absent>' --expect-env TORNEOS_BRANDING_MODE='<absent>'` sin fallas; Vercel sin las dos variables; Storage acepta el bearer del bridge de una cuenta QA (B4). INFRA-1.2 listo y certificado en Core Staging (B2) | Todo lo anterior. Primer backup diario visible en los dos proyectos | — |
| **G1** Merge | A | §1 «Mecánica del merge». Vercel publica `main` sin variables nuevas | Bundle nuevo **sin** los dos flags. Con QA1: landing de Torneos, Mi plan, Estudio Social y PLAN READ como hoy; `/torneos/perfil` sin el control de push (`PGRST202`). Sin errores de consola nuevos | Vercel Instant Rollback al deploy de #176 (`ffaf131c`). Disponible mientras no haya otro deploy |
| **G2** Core DB | D (+ excepción Core) | `pg_dump` de Core. INFRA-1.2: `20261007120000`, verificar; después `20261008120000`, verificar | Ledger con las dos filas nuevas y nada más. `torneos_contract_execute` sólo para `service_role`. Trigger `trg_notification_delivery_push_preference` presente. `anon` sin EXECUTE de `set_my_push_preference`. Con QA1, Perfil muestra el control y apagar/prender guarda; queda en `true` al terminar | Push: `supabase/rollbacks/20261008120000_core_push_preference_v1.safe.sql` (conserva valores y filas; el frontend oculta el control). `my_teams`: no tiene llamadores hasta G6; para revertir el cuerpo hace falta una migración forward que recree el de v1.1 |
| **G3** Core Edge | B | INFRA-1.2: redeploy de `torneos-core-contract` con el artefacto certificado (`ezbr` = Staging) | `POST /v1/my-teams` sin firma ⇒ 401. Harness firmado de v1.1 sin cambios + `my_teams` | Redeploy del artefacto de INFRA-1 (`ezbr` fijado en `core-prod-contract/pins`) |
| **G4** Torneos DB | D | `pg_dump` de Torneos. Después, en este orden: `db-0009-0011.mjs apply-0009 APPLY TORNEOS 0009 onzpwnqxnvlgsevivngf 8bb8e6c84bbe` ⇒ `APPLY_0009_DONE`; `apply-0010 APPLY TORNEOS 0010 onzpwnqxnvlgsevivngf 76d13425116d` ⇒ `APPLY_0010_DONE`; `apply-0011 APPLY TORNEOS 0011 onzpwnqxnvlgsevivngf 3cac4d885955` ⇒ `APPLY_0011_DONE` | `observe` ⇒ `POST_0011` (193/16, bucket privado, 5 políticas, búsqueda `2c261685…`, autorizador `d04babed…`). `changedOutside = []` en cada paso. Con el gateway de hoy no se expone nada nuevo (C3) | No hace falta: sin flags no hay exposición. Rollback SQL sólo según §7 |
| **G5** Gateway, imagen | B | Runbook §10: imagen del merge commit (grafo de 25 archivos = `main`), `gcrane cp` a `torneos-gateway/gateway:main-<sha8>`, revisión nueva con la **misma** env que `00005-dx5` (sin CONNECTED ni BRANDING) a 0 % + tag ⇒ suite unauth idéntica ⇒ 100 % por REVISION ⇒ quitar el tag | `cloudrun-readonly` sin fallas. Las RPC conectadas y `/torneos/branding/v1/object` ⇒ 403/404. PLAN READ y Social con QA1 iguales a hoy. 0 5xx | Tráfico 100 % a `torneos-gateway-00005-dx5` |
| **G6** Gateway CONNECTED | B + C | Revisión = G5 + `TORNEOS_CONNECTED_MODE=on`, a 0 % + tag. Matriz API con QA1 y QA2 por el tag (ver §8). Después, 100 % | Catálogo público 200; ficha; solicitud → plantel → envío → revisión → aprobada; bandejas separadas; `my_teams` 200 para QA2; outsider 403; PLAN READ/Social sin cambios; 0 5xx | Tráfico a la revisión de G5 |
| **G7** Frontend CONNECTED | C + B | Vercel `REACT_APP_TORNEOS_CONNECTED_MODE=on` (production-only) + redeploy de `main` | Recorrido de §8 en `app.arma2.com.ar`, desktop y 390/320 px | **Primero el frontend:** Instant Rollback al deploy de G1. Después, si hace falta, el gateway vuelve a G5 |
| **G8** Gateway BRANDING | B + C | Requiere B4. Revisión = G6 + `TORNEOS_BRANDING_MODE=on`, 0 % + tag ⇒ 100 % | Página pública con logo firmado (`/object/sign/tournament-branding/…`, 1 h). Anon sin URL para un objeto no publicado. Subida de un no autorizado ⇒ 403 `TORNEOS_BRANDING_FORBIDDEN`. Sin requests al storage de Core | Tráfico a la revisión de G6: los logos vuelven a iniciales y los objetos quedan |
| **G9** Frontend BRANDING | C + B | Vercel `REACT_APP_TORNEOS_BRANDING_MODE=on` + redeploy | QA1 sube logo de organización y de torneo; se ven en catálogo, ficha, página pública, solicitud, equipo y ajustes; reemplazarlo borra el objeto anterior | Instant Rollback al deploy de G7 |
| **G10** Datos de prueba | — | Retiro de §8 por la interfaz o las RPC del producto (sin SQL) | La convocatoria QA no aparece en Explorar; QA2 sin equipo QA en Core | — |
| **G11** Seguimiento | lecturas | 24 h y 72 h: `cloudrun-readonly` (5xx, `bootDisabled`, `CORE_UNAVAILABLE`), logs de Supabase (Core y Torneos), tamaño de la base de Core, filas `skipped/push_disabled` (conteo, sin datos personales) | Sin regresiones | Lo de la fila correspondiente |

**Por qué este orden:**
- G1 va primero porque la imagen del gateway y el artefacto de Core salen de `main`. El frontend nuevo no cambia nada
  visible sin los flags (F1).
- Core (G2, G3) y Torneos (G4) van antes que cualquier flag: los ensayos S1–S4 muestran que el sistema de hoy sigue
  igual sobre las bases nuevas.
- Cada flag se prende primero en el gateway y después en el frontend. Un frontend conectado frente a un gateway sin
  CONNECTED muestra errores (C2).
- Vercel Hobby sólo revierte al deploy inmediatamente anterior. La secuencia G1 → G7 → G9 hace que ese deploy sea
  siempre el estado previo correcto: G7 vuelve a G1 (sin CONNECTED) y G9 vuelve a G7 (sin BRANDING). Para volver más
  atrás de G1 hay que redeployar `ffaf131c` (un build nuevo).

## 6. Contención y recuperación (en este orden, nunca SQL primero)

1. **Frontend:** Vercel Instant Rollback al deploy anterior, o borrar la variable y redeployar. Segundos.
2. **Gateway:** tráfico 100 % por REVISION a la revisión anterior: G8 → G6 → G5 → `00005-dx5`. Segundos, sin rebuild
   ni pérdida de datos (C1–C3).
3. **Preferencia de push de Core:** el script seguro (C4). No borra nada y el frontend no necesita cambios.
4. **Función Core:** redeploy del artefacto de INFRA-1.
5. **SQL destructivo de Torneos:** último recurso, con las condiciones de §7.

Apagar un flag nunca borra datos: vuelven a verse al prenderlo.

## 7. Rollback SQL destructivo (no es la primera respuesta)

Se ensayó completo en el laboratorio (C5) con el driver de Production (`db-0009-0011.mjs`, mismas frases y hashes) y
sobre los datos del recorrido.

| Paso | Frase | Qué elimina (laboratorio) | Qué queda |
| --- | --- | --- | --- |
| `rollback-0011` | `ROLLBACK TORNEOS 0011 onzpwnqxnvlgsevivngf 7fb0a3aeefbe` | Ningún dato: restaura los dos cuerpos certificados. El capitán de afuera vuelve a no poder buscar jugadores | Todo |
| `rollback-0010` | `ROLLBACK TORNEOS 0010 onzpwnqxnvlgsevivngf 9c4fbec32771` | Las 5 políticas de Storage y las 2 reglas de lectura | El bucket privado y sus objetos (9), sin acceso hasta que un operador los borre con la API de Storage (gate L). Los `logo_path` y `shield_path` (3 + 3 + 3) quedan y se ven como iniciales. El driver lo acepta como residuo |
| `rollback-0009` | `ROLLBACK TORNEOS 0009 onzpwnqxnvlgsevivngf 291fb2d0fb5e` | **Destructivo:** las 5 tablas con todo lo creado desde G4. En el laboratorio: 6 perfiles de Torneos, 996 avisos de la bandeja, 5 convocatorias, 0 capacidades, 5 marcadores de solicitud y 7 atestaciones `my_teams` | Las inscripciones que crearon las solicitudes (5 de 443) quedan como inscripciones comunes; torneos, organizaciones, planteles y comunicados quedan intactos |

**Cuándo tiene sentido:**
- Sólo si una de estas migraciones daña datos anteriores, o si hay que retirar el producto conectado de forma
  definitiva y la contención por flags no alcanza.
- Nunca para resolver un error de pantalla.

**Qué exige:**
- Flags apagados en el gateway y en el frontend.
- Un `pg_dump` y el backup diario de Pro posteriores al último uso.
- Un export de las 5 tablas en CSV. En el ensayo, `copy (select * from public.<tabla>) to stdout with (format csv,
  header true)` produjo un archivo por tabla, con su sha256. Para volver: reaplicar `0009`/`0010`/`0011` con el driver
  y cargar los CSV con `copy public.<tabla> from stdin with (format csv, header true)`, en este orden: perfiles,
  convocatorias, capacidades, solicitudes, avisos. Así se ensayó, en una sola transacción. Las atestaciones `my_teams`
  son de un solo uso y no se restauran.
- GO de los gates E y D, y de L si se borran objetos.
- Siempre en orden: `rollback-0011` → `rollback-0010` → `rollback-0009`. El driver rechaza cualquier otro.

Los objetos del bucket no se borran con SQL. En esta promoción no se ejecuta ningún rollback sobre datos reales.

## 8. Verificación con cuentas QA y datos de prueba

**Cuentas.**
- **QA1:** core `44106956`, dueña de las tres organizaciones QA de Production. Hace de organizadora y de dual.
- **QA2:** `arma2app@gmail.com`, core `c2296168`. Hace de solicitante y necesita un equipo de Core que administre.

Recomendado: en G6, QA2 crea desde la app de Arma2 el equipo **«QA Torneos Conectado»** y se retira en G10.

**Recorrido (G6 por API con el tag; G7–G9 en `app.arma2.com.ar`).**
1. QA1 publica en Explorar un torneo QA de una organización QA. Nombre «QA — no inscribirse», precio opcional y
   WhatsApp de formato válido sin persona real.
2. QA2 lo encuentra, solicita la inscripción con su equipo, arma el plantel y lo envía. Ve la solicitud en «Tus
   solicitudes» y no en «Mis torneos».
3. QA1 recibe el aviso, pide cambios; QA2 corrige y reenvía; QA1 aprueba.
4. QA2 ve el aviso y «Mis torneos».
5. Página pública sin sesión → «Solicitar» → login → vuelve al formulario.
6. Perfil de Torneos de QA2: nombre de Torneos guardado, perfil de Core sin cambios.
7. Punto de avisos entre productos.
8. 390/320 px sin desborde.
9. Con BRANDING (G9): QA1 sube logo y escudo y se ven en todas las superficies.

**Ventana.** La convocatoria QA queda publicada sólo durante el recorrido, idealmente menos de 30 minutos y en
horario de poco tráfico.
- Al aprobar, QA1 pone «Recepción de solicitudes» en «Cerradas» y toca «Retirar del catálogo».
- Si en esa ventana entra una solicitud real, se deja sin revisar y se avisa a Nico. No se rechaza: rechazarla
  enviaría un aviso a una persona real.
- No se usan pushes ni emails en ningún paso: los avisos de Torneos son internos.

**Retiro (G10, sin SQL).**
- Convocatoria QA: «Retirar del catálogo» (`set_tournament_catalog_listing_status`) y solicitudes «Cerradas».
- Torneo QA: queda en la organización QA (el dominio no borra organizaciones); se puede archivar.
- Logos QA: «Quitar» en el campo del logo limpia la referencia y borra el objeto (`removeBrandingAsset`).
- Equipo QA de QA2: se borra desde la app de Arma2.
- Preferencia de push de QA1: termina en `true`.
- Los perfiles y avisos de Torneos de QA1/QA2 quedan; son de cuentas QA.

## 9. Composiciones separadas

| Composición | Migraciones | Dónde corre |
| --- | --- | --- |
| LOCAL (`legacy-local`) | `20261006120000` + las de Core en la misma base | Stack `arma2-torneos-qa-seed`, preview 3102, simulador iOS |
| Core Production | Sólo `20261007120000`, `20261008120000` y la función `torneos-core-contract` | INFRA-1.2 |
| Torneos aislado | `0009`, `0010`, `0011` + gateway + flags | `db-0009-0011.mjs`, runbook §10, Vercel |

Torneos nunca escribe en Core: la autoridad sobre los equipos de Core llega atestada por el contrato (`team_snapshot`,
`directory_teams`, `my_teams`).

Ensayo reproducible:
- `scripts/torneos-frontend/start-hybrid-lab-app.mjs --start --edge --production-flags [--connected] [--branding]`.
- Las suites de `integration/torneos-core-contracts`.

## 10. Fuera de esta promoción (móvil)

La app nativa empaqueta su propio bundle: el deploy web no la cambia. Lo único que la alcanza es `20261008120000`, que
se aplica en el servidor a todas las cuentas: una cuenta con `push_enabled = false` deja de recibir también los push de
los flujos dirigidos.

Quedan para un GO separado, con su validación en dispositivo firmado:
- token APNs real y su renovación;
- Android;
- enlaces universales;
- el primer pedido de permiso.

La matriz del simulador está en `NOTIFICATIONS-AUDIT.md`.
