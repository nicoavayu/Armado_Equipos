# CONNECTED-V1 + BRANDING-V1 + preferencia de push de Core — procedimiento de despliegue

Estado: **documentado, no ejecutado.** Nada de esto se aplicó en remoto. Cada paso es un gate que necesita un GO
explícito de Nico; los flags quedan apagados hasta ese GO. Formato de cada gate: cambio exacto · verificación antes ·
verificación después · rollback.

## Qué se despliega y dónde

| Pieza | Destino | Archivos |
| --- | --- | --- |
| Contrato Core v1.2 `my_teams` | DB Core Production | `supabase/migrations/20261007120000_torneos_core_contract_v1_2_my_teams.sql` |
| Función Edge Core | `torneos-core-contract` (Core) | `supabase/functions/_shared/torneosCoreContract.ts` (ruta `/v1/my-teams`) |
| Preferencia de push de Core | DB Core Production | `supabase/migrations/20261008120000_core_push_preference_v1.sql` |
| Producto conectado (Torneos aislado) | `onzpwnqxnvlgsevivngf` | `backend/torneos/supabase/migrations/00000000000009_connected_product_v1.sql` |
| Logos y escudos (Torneos aislado) | `onzpwnqxnvlgsevivngf` (DB + Storage) | `backend/torneos/supabase/migrations/00000000000010_branding_v1.sql` |
| Gateway | Cloud Run `torneos-gateway` (`southamerica-east1`) | grafo de 25 archivos (`gateway-remote.test.mjs`): suma `connected.ts`, `connected-v1-rpc-allowlist.json`, `my-teams.schema.json`, `branding.ts`, `branding-v1-rpc-allowlist.json` |
| Frontend web | Vercel (`main`) | flags `REACT_APP_TORNEOS_CONNECTED_MODE`, `REACT_APP_TORNEOS_BRANDING_MODE` |
| App nativa | builds de tienda (gate aparte) | `CorePushRegistrationKeeper`, restauración de pantalla, punto entre productos |

**Fuera de Production:** `supabase/migrations/20261006120000_torneos_connected_product_v1.sql` es la composición LOCAL
(`legacy-local`, Torneos en la misma base que Core). Production sirve Torneos sólo por el gateway desde el proyecto
aislado, así que **no hace falta aplicarla en Core Production**. Si la política del ledger de Core exigiera continuidad
de versiones, aplicarla dejaría RPC autenticadas del producto conectado sobre tablas legacy que Production no usa:
esa decisión es de Nico y va en una promoción separada con su ensayo, no en este despliegue.

Flags del gateway (Cloud Run): `TORNEOS_CONNECTED_MODE` y `TORNEOS_BRANDING_MODE` (`on`; ausente/`off` = sin cambios;
cualquier otro valor deshabilita el gateway al arrancar y `cloudrun-readonly` lo cuenta como `bootDisabled`).
`TORNEOS_STORAGE_URL`/`TORNEOS_STORAGE_PUBLIC_URL` no se configuran en Production: el storage se deriva de
`https://<ref>.supabase.co/rest/v1`; sólo el laboratorio usa la URL explícita.

## Orden y compatibilidad en cada estado intermedio

| # | Gate | Cambio exacto | Estado intermedio que deja | Verificación después | Rollback |
| --- | --- | --- | --- | --- | --- |
| 0 | Pre | Sólo lecturas: CI verde del head; ledger de Core sin `20261007120000`/`20261008120000` y con `usuarios.push_enabled` + `notification_delivery_log`; ledger del proyecto aislado en `0008` y esquema `storage` presente; `cloudrun-readonly --expect-env TORNEOS_CONNECTED_MODE=<absent> --expect-env TORNEOS_BRANDING_MODE=<absent>`; Vercel sin los dos `REACT_APP_*`; backup/PITR confirmado en ambas bases | — | — | — |
| 1 | Core DB | Aplicar `20261007120000` y `20261008120000` (promoción controlada, sin CLI de Supabase) | `my_teams` existe pero nadie lo llama (gateway sin CONNECTED). La preferencia queda activa en el servidor para todos: `push_enabled` ya existía (default `true`) y el trigger principal ya lo respetaba; ahora también los flujos dirigidos | `has_function_privilege('anon', 'set_my_push_preference(boolean)')` = false; trigger `trg_notification_delivery_push_preference` presente; `torneos_contract_execute` sólo `service_role`; un push de prueba a una **cuenta QA** con la preferencia en `false` queda `skipped/push_disabled` | `supabase/rollbacks/20261008120000_core_push_preference_v1.safe.sql` (quita trigger y EXECUTE de cliente; conserva valores y filas). `my_teams`: contención = gateway sin CONNECTED; revertir el cuerpo exige una migración forward que recree la función v1.1 (`20260915120000`) |
| 2 | Core Edge | Redeploy de `torneos-core-contract` con `/v1/my-teams` | Ruta nueva sin llamadores | `POST /v1/my-teams` sin firma del gateway ⇒ 401 `SERVICE_AUTH_REQUIRED`; operaciones existentes sin cambios (probe del contrato v1.1) | redeploy de la versión anterior de la función |
| 3 | Torneos DB | Aplicar `0009` y después `0010` | RPC y tablas nuevas sin exposición (el gateway no las permite: las allowlists se cargan sólo con el flag). Bucket `tournament-branding` **privado** y vacío | `0010` verifica sus postcondiciones (bucket privado, 5 políticas, `anon` sin `can_read`); grants de `0009` = contrato (`connected-v1-migration.test.mjs`) | `rollback/00000000000010_branding_v1.rollback.sql` y luego `rollback/00000000000009_connected_product_v1.rollback.sql` (ver «Efectos sobre datos») |
| 4 | Gateway B | Imagen nueva (grafo de 25 archivos = `main`), **sin** los dos flags, revisión nueva a 0 % + tag ⇒ 100 % | Comportamiento idéntico al actual: rutas y respuestas sin cambios (`connected.test.mjs`/`branding.test.mjs` casos OFF) | unauth sin diferencias; las RPC conectadas y la ruta `/torneos/branding/v1/object` ⇒ 403/404; PLAN READ 32/32 y SOCIAL sin regresión; 0 5xx; `bootDisabled` = 0 | tráfico a la revisión anterior |
| 5 | Gateway C | Revisión = paso 4 + `TORNEOS_CONNECTED_MODE=on` | Explorar/solicitudes disponibles por API; el frontend actual no las usa todavía | matriz conectada con cuentas QA (catálogo público, ficha, solicitud, bandeja, revisión); `my_teams` responde 200 a través del gateway para una cuenta QA con equipos; 0 5xx | tráfico a la revisión del paso 4 |
| 6 | Frontend C | Vercel `REACT_APP_TORNEOS_CONNECTED_MODE=on` + redeploy de `main` | Producto conectado visible | recorrido con cuentas QA: Explorar → ficha → solicitud → plantel → envío → revisión del organizador; «Mis torneos» sólo participación y «Gestionar» separado; 390/320 sin overflow | promover el deploy anterior o borrar la env |
| 7 | Gateway D | Revisión = paso 5 + `TORNEOS_BRANDING_MODE=on` | El gateway firma logos/escudos publicados; el frontend sin el flag ya los muestra (sólo URLs firmadas) pero no ofrece subir | probe: página pública con logo firmado (`/object/sign/tournament-branding/...`, 1 h); anon sobre un objeto no publicado ⇒ sin URL; capitán activo ve su escudo; subida de un no autorizado ⇒ 403 `TORNEOS_BRANDING_FORBIDDEN` | tráfico a la revisión del paso 5 (las imágenes vuelven a iniciales) |
| 8 | Frontend D | Vercel `REACT_APP_TORNEOS_BRANDING_MODE=on` + redeploy | Subir/quitar logo y escudo con la secuencia LOCAL | organizador sube logo de torneo y de organización; se ve en catálogo, ficha, solicitud y equipo; ningún request a storage de Core | promover el deploy anterior o borrar la env |
| 9 | Nativo | Builds iOS/Android de `main` (gate aparte, como J) | Mantener el registro push de Core desde Torneos, restauración y punto | matriz nativa pendiente (ver `NOTIFICATIONS-AUDIT.md`) en dispositivo firmado | build anterior en las tiendas |

Notas de compatibilidad:

- **Frontend antes que Core (paso 1):** `/torneos/perfil` no depende de flags. Si la RPC
  `get_my_push_preference` todavía no existe (PostgREST `PGRST202`), el control «Recibir notificaciones de Arma2 en el
  teléfono» no se muestra (sin error). Aun así, conviene aplicar el paso 1 antes de mergear.
- **Frontend conectado sin gateway conectado:** las RPC responden «rpc not enabled» y las pantallas muestran error. Por
  eso el paso 6 va siempre después del 5.
- **Gateway con BRANDING y frontend sin él (entre 7 y 8):** compatible: el frontend sólo convierte en imagen una URL
  firmada para esa ruta exacta; sin firma, iniciales. Una firma que falla (storage caído, timeout de 3 s) degrada a
  iniciales, nunca a error de pantalla.
- **Storage del proyecto aislado:** la firma usa el token del propio usuario (bridge). Production ya acepta ese token
  en PostgREST por Third-Party Auth con el JWKS del bridge; Storage valida con la misma configuración del proyecto. Antes
  del paso 7, confirmar con una cuenta QA que `POST /storage/v1/object/sign/tournament-branding` con el bearer del
  bridge responde 200 (y no 400/403 de JWT).
- **Anon key:** si el proyecto usa una `sb_publishable_*`, el gateway la manda sólo como `apikey` (sin `Bearer`); con
  una anon JWT legada, también como bearer (`anonCredential`).

## Efectos sobre datos existentes

| Pieza | Al aplicar | Al hacer rollback |
| --- | --- | --- |
| `20261008120000` | Ninguna fila cambia. Si una cuenta ya tenía `push_enabled = false`, desde ahora tampoco recibe los push de los flujos dirigidos (antes sí) | Se conservan los valores de `push_enabled` y las filas `skipped/push_disabled` (no se reenvían: la persona había optado por no recibirlos) |
| `20261007120000` | Ninguna (sólo el cuerpo de la función) | Ninguna |
| `0009` | Tablas nuevas vacías; triggers nuevos sobre inscripciones y revisiones existentes (no modifican filas viejas) | **Destructivo para lo creado después del deploy:** borra perfiles de Torneos, la actividad de la bandeja de Torneos, convocatorias del catálogo, capacidades y marcadores de solicitud. Las inscripciones creadas por solicitudes quedan como inscripciones comunes. Antes: exportar esas tablas y contener con flags; ejecutar sólo con GO |
| `0010` | Bucket privado vacío + políticas. Las referencias existentes (`logo_path`, `shield_path`) no cambian | Quita políticas y funciones; los objetos quedan en el bucket privado sin acceso hasta que un operador los borre con la API de Storage; las rutas guardadas quedan (son rutas, no URLs) y todas las composiciones muestran iniciales |
| Flags | — | Apagar un flag no borra nada: los datos quedan y vuelven a verse al encenderlo |

Contención primero, SQL después: ante un problema se apaga el flag (frontend y/o gateway) y se vuelve a la revisión
anterior; el rollback SQL es un paso posterior y separado, con GO, export y backup confirmados.

## Composiciones separadas

- **LOCAL (`legacy-local`):** `20261006120000` + las de Core en la misma base (stack `arma2-torneos-qa-seed`). Es donde
  se ejercitó la app nativa de esta validación.
- **Core Production:** sólo `20261007120000`, `20261008120000` y la función `torneos-core-contract`.
- **Torneos aislado (`onzpwnqxnvlgsevivngf`):** `0009`, `0010`, gateway y flags. Nunca escribe en Core: la autoridad sobre
  equipos de Core llega atestada por el contrato (`team_snapshot`, `directory_teams`, `my_teams`).

## Qué queda fuera

Merge, despliegue, migraciones remotas, envíos reales y builds de tienda. Rediseño general, chat y pagos no forman parte
de este cierre.
