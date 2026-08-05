# Revisión: uso de `service_role` por el worker Multimedia

Revisión documental, local, sin contacto con Staging ni con Production. **No cambia el contrato vigente.** Su salida es un inventario exacto, un riesgo declarado y una alternativa de menor privilegio evaluada, para decidir por separado y con pruebas completas.

## Qué usa hoy

`workers/tournament-media-processor/src/supabase.mjs` toma `SUPABASE_SERVICE_ROLE_KEY` (o `SUPABASE_SECRET_KEY`) y la usa como `apikey` y como `Authorization: Bearer` contra dos superficies: PostgREST (`/rest/v1/rpc/*`) y Storage (`/storage/v1/object/*`).

### Operaciones que realmente necesita

| Operación | Contrato | Por qué la necesita |
|---|---|---|
| `tournament_media_backend_fingerprint` | RPC | atar la atestación a **esta** base |
| `attest_tournament_media_service('processor', …)` | RPC | escribir su propia atestación tras el self-test |
| `revoke_tournament_media_service_attestation('processor')` | RPC | cerrar readiness al fallar el self-test o al apagarse |
| `lease_tournament_media_processing_jobs` | RPC | tomar trabajo con lease token |
| `complete_tournament_media_upload_for_job` | RPC | registrar mime/bytes/dimensiones/checksum reales |
| `finalize_tournament_media_variants` | RPC | mover las variantes a `ready` con la geometría que deriva la base |
| `complete_tournament_media_processing_job` | RPC | cerrar el job con su lease token |
| `fail_tournament_media_processing_job` | RPC | cerrar en falla con un código acotado |
| `cleanup_tournament_media_processing_jobs` | RPC | barrer leases vencidos |
| `GET` objeto de cuarentena | Storage | leer el original a procesar |
| `POST` objetos de variante | Storage | escribir thumbnail/grid/detail y el original saneado |
| `DELETE` objetos | Storage | borrar el objeto del self-test y los residuos que le corresponden |

**No necesita**, y sin embargo su credencial se lo permite: leer o escribir cualquier otra tabla del proyecto (`usuarios`, `partidos`, `notifications`, todo el dominio de Torneos), leer o borrar cualquier otro bucket, invocar cualquier otro RPC con grant a `service_role`, y saltarse RLS en todas partes.

## El riesgo, dicho sin adornos

`service_role` es una credencial de proyecto entero. La migración A2 hace bien la mitad difícil: cada RPC tiene `REVOKE ALL … FROM PUBLIC` y un `GRANT … TO service_role` explícito, y cada transición de estado exige además el **lease token** que la base emitió, así que una credencial filtrada no puede cerrar un job que no arrendó ni publicar un asset cuyas compuertas de readiness están cerradas. Ése es el control que hoy contiene el daño.

Lo que la credencial sí permitiría a un atacante que comprometa el contenedor:

1. **Lectura completa del proyecto Staging**, incluida la correlación entre galerías, torneos y usuarios: el mapa de identidad que todo el resto del pipeline evita construir.
2. **Escritura en tablas ajenas al pipeline**, sin pasar por ningún RPC auditado.
3. **Acceso a otros buckets**, si existieran, con la misma llave.
4. **Uso desde fuera del contenedor**: la llave no está atada a un host, a una IP ni a un `worker_id`.

Lo que **no** permite, por diseño de A2: publicar contenido sin que el worker haya atestiguado pixel decode, transcode, metadata stripping y antivirus; falsificar una atestación (las capabilities se validan contra un allowlist y contra el self-test); ni mover un job ajeno (lease token).

Contrapeso real: el proceso más expuesto del sistema — el renovador de la atestación del signer — **no** tiene esta credencial (ver [renovación de la atestación del signer](tournament-media-signer-attestation-renewal.md)). La superficie con `service_role` es exactamente un contenedor privado sin ingress.

## Alternativa de menor privilegio evaluada

**Un rol dedicado `tournament_media_worker`**, con JWT firmado por el proyecto y `role` propio:

- `GRANT EXECUTE` sólo sobre los nueve RPC de la tabla de arriba;
- ningún grant sobre tablas: el worker ya opera únicamente vía RPC `SECURITY DEFINER`, así que no pierde nada;
- policies de `storage.objects` acotadas al bucket `tournament-media` y, si se quiere apretar más, a los prefijos que el worker realmente toca;
- el mismo lease token como segundo factor, sin cambios.

Es viable sin tocar el código del worker: sólo cambia el valor de la variable de entorno y se agregan grants/policies. Costos y riesgos de hacerlo:

- **No es gratis en Supabase.** El rol nuevo necesita ser emitible como JWT del proyecto y sobrevivir a la rotación de llaves; hay que decidir dónde se firma y cómo se rota, y eso es infraestructura, no una migración.
- **Requiere una migración propia** con sus grants, sus policies de Storage y su rollback probado — es decir, una etapa autorizada nueva, que hoy no existe (ver [propuesta de etapas](torneos-authorized-stages-proposal.md)).
- **Cambia el contrato de un pipeline ya aplicado en Staging.** A1 y A2 están aplicadas; tocar grants sin la batería completa de pruebas es exactamente lo que el contrato de ejecución prohíbe.

## Decisión

**Mantener `service_role` por ahora**, con estas condiciones ya vigentes en el código y en el runbook:

1. La credencial vive sólo en el secret store del host del worker; nunca en la imagen, nunca en el compose versionado, nunca en el browser (`static-guard` y el test de flags lo verifican).
2. **Nunca se imprime ni se persiste.** `supabase.mjs` no ecoa el cuerpo del backend en errores (`RPC_FAILED:<nombre>:<status>`), y los logs del worker son JSON sin object names, tokens, paths ni identidad.
3. Egress restringido al host de Staging autorizado; ninguna ruta a Production.
4. El lease token sigue siendo obligatorio en cada transición: la credencial sola no alcanza.
5. Fail-closed intacto ante ClamAV ausente, codec ausente o self-test fallado: la capability no se reclama, la atestación la pierde y `uploadReady` se cierra.

**Migrar al rol dedicado** queda propuesto para una etapa autorizada propia, con: migración con grants explícitos + policies de Storage por prefijo, rollback probado, prueba de que el rol nuevo **no** puede leer `usuarios` ni ningún otro bucket, y corrida completa del pipeline en Staging antes y después. Sin esa batería, no se toca.

## Qué vigilar mientras tanto

- `arma2_torneos_media_processor_attestation_expires_in_seconds`: un worker que deja de atestiguar puede ser un worker comprometido, no sólo uno caído.
- `arma2_torneos_media_residual_selftest_objects`: escritura en `_selftest/` fuera de cadencia es actividad de esa credencial fuera del contrato.
- `arma2_torneos_media_cleanup_failures_total` y `arma2_torneos_media_expired_leases`: un tercero usando la llave desde afuera altera el patrón de leases.

Ante sospecha de credencial comprometida: revocar en Staging, no imprimirla, reemplazarla desde el secret store, repetir fingerprint y self-test, y tratar los objetos en cuarentena como evidencia — no borrarlos.
