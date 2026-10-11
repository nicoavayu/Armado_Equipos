# MEDIA-STORE-V1 — Logos y Galería sobre Storage alojado

## Por qué existe

Storage alojado de Supabase verifica sólo las claves de firma del propio proyecto. Hoy esa clave es una sola, ES256 `f0e562f7…`.

Los tokens del puente son RS256 (`arma2-torneos-prod-k1/k2`). Storage los rechaza antes de evaluar cualquier política, con `400 "alg" (Algorithm) Header Parameter value not allowed`. La Data API, en cambio, los acepta vía Third-Party Auth.

Por eso BRANDING (G8) dio 403 en Producción. El laboratorio anterior lo ocultaba: confiaba en el JWKS del puente dentro de Storage.

Ahora el laboratorio confía sólo en lo mismo que el alojado: la ES256 del proyecto y el HS256 legado. Reproduce el 400 con el token del puente. Lo verifican `branding.test.mjs` G y `media-store.test.mjs` B.

Se descartó importar una clave ES256 al gateway, porque una clave de firma del proyecto puede emitir `service_role` y cualquier claim (ver la comparación de diseños).

## Diseño

| Pieza | Qué hace | Qué no puede |
|---|---|---|
| `torneos-media-store` (Edge Function del proyecto Torneos, `verify_jwt = false`) | Sólo 6 operaciones: `branding-put`, `branding-delete`, `branding-sign`, `media-put`, `media-delete` y `media-sign`. Antes de cada una pregunta a la base con el token del usuario (o del claim de sesión). Recién después usa la service key. | Listar. Sobrescribir (sin upsert). Aceptar bucket, rol, claim o ruta del cliente: en `branding-put` el nombre lo genera ella. Firmar o escribir algo que la base no devolvió. |
| `0017` `authorize_tournament_storage_objects(bucket, op, names[])` | Devuelve el subconjunto permitido. Usa **los mismos predicados existentes** de 0010 y 0012. Agrega una sola regla: un logo referenciado no se borra. | Conceder a `anon` o a `service_role`. Tocar políticas, buckets o tablas. |
| Gateway (`media-store-client.ts`) | Firma cada llamada con HMAC-SHA256: método, ruta, query, timestamp (±60 s), hash del cuerpo y hash de la identidad. | No tiene service key. No decide permisos. |

## Alcance real de un compromiso (sin minimizar)

**Gateway comprometido** (código en Cloud Run, o sus secretos: llaves del puente, secreto HMAC, logins de la base):

- **Ya antes podía** emitir tokens del puente para **cualquier** identidad de Torneos. Con eso tenía, vía la Data API, todo lo que cualquier usuario puede hacer, en todas las organizaciones. Storage era la excepción: lo rechazaba.
- **Ahora además puede**, haciéndose pasar por un usuario autorizado:
  - escribir objetos nuevos (logos donde esa identidad puede escribir; fotos sólo dentro de sesiones de subida que abra como esa identidad, con cuotas, presupuesto, límite de 30 sesiones cada 15 min por usuario y validación real de tipo y tamaño);
  - firmar lecturas de cualquier foto o logo que alguna identidad pueda leer (fotos 300 s, logos 3600 s), así que en la práctica puede leer todo el contenido privado de una organización suplantando a su staff;
  - borrar logos no referenciados y objetos de sesiones vivas.
- **Sigue sin poder:**
  - listar los buckets;
  - sobrescribir objetos;
  - elegir nombres o rutas arbitrarias;
  - tocar la configuración de buckets o políticas, u otros buckets;
  - obtener la service key;
  - saltear las validaciones de bytes de la función.

**Esto es un aumento real:** la superficie de Storage pasa de «nada» a «lo que pueda un usuario suplantado». Los límites son los predicados de la base, no la confianza en el gateway.

**Secreto HMAC filtrado solo** (sin las llaves del puente):

- Hace falta además un token válido de una identidad, y la cuenta propia del atacante alcanza. Sólo puede actuar como esa identidad: lo mismo que ya puede por la app. `media-store.test.mjs` E lo prueba con la identidad de otra organización: 403 o vacío en todo.
- Repetición de una solicitud capturada dentro de ±60 s, con la misma identidad, cuerpo y operación:
  - un `branding-put` repetido crea otro objeto con nombre nuevo, que consume espacio;
  - un `media-put` repetido da 409.
- No hay nonce. La ventana es de 60 s.

**Función o service key comprometidas:** acceso total a datos y Storage de Torneos.

- Supabase **ya inyecta** la service key en **toda** Edge Function del proyecto. MEDIA-STORE-V1 no crea una clave nueva, pero sí agrega código que la usa.
- Por eso hay operaciones fijas, regex de nombres, autorización antes de cada operación y errores fijos.

**Secretos compartidos en el proyecto:** en Supabase alojado, `TORNEOS_MEDIA_STORE_SECRET` es legible por **todas** las Edge Functions del proyecto Torneos. `observe` lista cuáles existen.

- El laboratorio aísla por worker (prefijo `MEDIA_STORE__`), pero eso **no** es una propiedad del alojado.

**Sesiones vencidas:** con un token del puente de 120 s,

- el gateway lo rechaza pasado `exp + 5 s` (`clockTolerance`);
- la Data API (que juzga a la función) pasado `exp + ~30 s`;
- `media-store.test.mjs` K lo mide a `exp + 35 s`: 401 en el gateway y 403 en la función aunque la firma sea válida.

**URLs firmadas ya emitidas:** son al portador hasta su vencimiento (fotos 300 s, logos 3600 s), aunque la foto se retire después. Es una propiedad existente.

## Evidencia de ensayo (laboratorio con Storage que valida como el alojado)

Todo es local, proyecto `arma2-media-store-lab`.

**Driver 0017** (`lab/db-0017-lab.mjs`, salida en `evidence/db-0017-lab.jsonl`), escrituras como `postgres`:

- observe → apply → rechazo del re-apply → rollback → re-apply. Todos con `changedOutside: []`.
- Cuerpos md5, ACL y buckets coinciden con los fijados.
- Única emulación: `GRANT CREATE ON SCHEMA private TO postgres`. En el alojado `postgres` es dueño de `private`; 0009 y 0012 ya crearon funciones ahí en Producción.

**`media-on` con 0017 instalada:** db-0012 reconoce POST_0014 con exactamente +1/+0, pasa a MVP_SIMPLE con `changedOutside: []`, y db-0017 sigue en POST_0017.

**`branding.test.mjs`:** 9/9 con gateway Node y 9/9 con Edge.

**`media-store.test.mjs`:** 13/13 con Node y 13/13 con Edge. Cubre:

- permisos por usuario, organización y recurso (capitán, ajeno, otra organización, visitante);
- HMAC válido con identidades ajenas;
- tipos y tamaños reales;
- reintentos e idempotencia;
- doble toque;
- 4 subidas concurrentes;
- lecturas sólo para participantes (galería de participantes) o sólo staff (galería «organización");
- ninguna URL pública ni firma anon;
- cuota FREE 25/25;
- Storage caído a mitad de la subida (503, nada a medio escribir, reintento OK);
- sesiones vencidas.

**Recuperación con tráfico** (`media-store-recovery.test.mjs`): 5/5.

- `rollback-0017` con el sistema andando: toda escritura y firma autenticada falla cerrada (403), no se escribe nada y las RPC siguen respondiendo; `apply-0017` restablece.
- `mode PROCESSOR_EXTERNAL`: las subidas se rechazan antes de escribir un byte; MVP_SIMPLE restablece.
- Función inalcanzable: 503 y nada a medio escribir; al volver, la misma clave sube.
- El laboratorio termina en POST_0017 + MVP_SIMPLE.

**Suites sin red:** `test:torneos:media-store` (store, driver 0017, herramienta de despliegue), `test:torneos:branding` y `test:torneos:media`.

## Procedimiento de despliegue y activación

Cada paso tiene su verificación y su recuperación. Orden de apagado: frontend → gateway → modo → base.

| # | Paso | Quién | Verificación | Recuperación |
|---|---|---|---|---|
| 0 | Backup Torneos con RESTORE VERIFIED de menos de 24 h | Nico (contraseñas) | `RESTORE VERIFIED` | — |
| 1 | `db-0017.mjs observe` → `apply-0017` con su frase | Nico (Llavero) | `APPLY_0017_DONE`, `changedOutside: []`; db-0012 observe = POST_0014 | `rollback-0017` con su frase |
| 2 | `deploy-media-store.sh observe` → `deploy` | Nico (PAT oculto + frase) | `ACTIVE`, `verify_jwt false`, sonda sin firma = 401 | Sin llamador queda inerte; `remove` la borra |
| 3 | Gateway: imagen desde `main` + revisión sin tráfico con `TORNEOS_BRANDING_MODE=on` y el secreto `torneos-gw-media-store-secret:1` → suite sin auth en el tag → 100 % | Agente (gcloud) con GO | `/health`, suite sin auth, logs sin `disabled` | Tráfico a `00016-hef` |
| 4 | Netlify: `REACT_APP_TORNEOS_BRANDING_MODE=on` + publicar `main` | Agente con GO | QA sube un logo; el catálogo público lo muestra a un visitante; otra organización recibe 403 | Restaurar el deploy anterior + borrar la variable; gateway a `00016-hef` |
| 5 | `media-on` (db-0012 `mode MVP_SIMPLE`, checkout del merge) | Nico (Llavero) | `MODE_MVP_SIMPLE_DONE`, `changedOutside: []` | `mode PROCESSOR_EXTERNAL` (con MEDIA apagado arriba) |
| 6 | Gateway: revisión con `TORNEOS_MEDIA_MODE=on` además | Agente con GO | Suite sin auth; subida de QA | Tráfico a la revisión del paso 3 |
| 7 | Netlify: `REACT_APP_TORNEOS_MEDIA_MODE=on` + `REACT_APP_TORNEOS_MEDIA_ENABLED=true` | Agente con GO | QA: subir, aprobar, publicar; el participante ve; un ajeno no | Restaurar el deploy del paso 4 |

Pagos siguen apagados en todos los pasos. 0013 no se aplica.
