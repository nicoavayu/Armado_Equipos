# MEDIA-V1 — activación y rollback

Galería de fotos de Torneos en la composición híbrida (gateway + proyecto aislado de Torneos). Nada de esto se
ejecuta sin el GO explícito de Nico para cada entorno. Producción no se toca desde esta rama.

## Qué hay que encender (todo o nada)

| Capa | Interruptor | Default | Efecto |
|---|---|---|---|
| Base Torneos | migración `00000000000012_media_gallery_v1.sql` | no aplicada | bucket privado `tournament-media`, policies con claim del gateway, RPCs del gateway, entrega firmada, grants de retiro/reporte. **No cambia nada visible**: el modo del pipeline sigue igual |
| Base Torneos | modo del pipeline → `MVP_SIMPLE` (SQL de operador, abajo) | `PROCESSOR_EXTERNAL` | habilita la emisión de sesiones de carga (sólo owner/admin) |
| Gateway | `TORNEOS_MEDIA_MODE=on` | ausente = off | RPCs de galería + `POST /torneos/media/v1/upload` + `POST /torneos/media/v1/urls`. Cualquier otro valor deshabilita el gateway (fail closed) |
| Frontend | `REACT_APP_TORNEOS_MEDIA_MODE=on` **y** `REACT_APP_TORNEOS_MEDIA_ENABLED=true` | off | Centro Multimedia, sección Fotos del hub y del partido, link «Fotos» en Mis torneos, fila de Mi plan |

`REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED` y las variables `*_READY` son del camino legacy (signer/worker del proyecto
Core) y quedan cerradas en Producción: MEDIA-V1 no las usa.

Orden de activación: **base → modo → gateway → frontend**. Orden de apagado: el inverso. Con cualquier capa apagada
la galería no aparece o no carga; nunca queda una mitad insegura (sin gateway no hay quién firme el claim; sin modo
`MVP_SIMPLE` la base no emite sesiones; sin el flag de frontend no hay ruta).

## 1. Base (Torneos, GO requerido)

Pre-check (sólo lectura, SQL editor o psql `READ ONLY`):

```sql
select to_regprocedure('public.search_tournament_players(uuid,uuid,text,integer,uuid)') is not null as has_0011,
       to_regprocedure('public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint)') is not null as has_0012,
       (select mode from public.tournament_media_pipeline_configuration where singleton) as mode,
       (select count(*) from storage.objects where bucket_id = 'tournament-media') as media_objects;
-- esperado antes de aplicar: has_0011 = true, has_0012 = false, mode = PROCESSOR_EXTERNAL, media_objects = 0
```

Aplicar el archivo exacto de la rama (sha256 en el PR) en una transacción (el archivo trae `BEGIN/COMMIT`, pre y
postcondiciones; si una falla, no queda nada aplicado).

Post-check:

```sql
select public.tournament_media_storage_contract_status() ->> 'clientWriteBlocked' as client_write_blocked,  -- true
       public.tournament_media_storage_contract_status() -> 'gatewayWritePolicies' as gateway_policies,      -- 2 nombres
       (select public from storage.buckets where id = 'tournament-media') as bucket_public,                  -- false
       (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'tournament_media_%') as policies; -- 8
```

## 2. Modo del pipeline (operador, GO requerido)

```sql
update public.tournament_media_pipeline_configuration set mode = 'MVP_SIMPLE', updated_at = now() where singleton;
select public.tournament_media_effective_readiness() ->> 'uploadReady';   -- true
select public.tournament_media_effective_readiness() -> 'blockers';       -- []
```

Volver atrás: `set mode = 'PROCESSOR_EXTERNAL'` (o `'DISABLED'`). Con eso la base deja de emitir sesiones al
instante; lo publicado se sigue viendo (la lectura no depende del modo).

## 3. Gateway

Agregar `TORNEOS_MEDIA_MODE=on` a la revisión del gateway (mismo despliegue que BRANDING-V1: el módulo ya está en el
grafo, 29 archivos). Verificación: `POST /torneos/media/v1/urls` con un bearer válido y `{"items":[]}` responde
`400 invalid arguments` (ruta viva) y una RPC de galería deja de responder `403 rpc not enabled`.

Requisitos que ya cumple el gateway de BRANDING-V1 y MEDIA-V1 reutiliza: Storage del proyecto Torneos confía en el
JWKS del bridge (Third-Party Auth), `TORNEOS_ANON_KEY` configurada, sin service key.

## 4. Frontend

`REACT_APP_TORNEOS_MEDIA_MODE=on` y `REACT_APP_TORNEOS_MEDIA_ENABLED=true` en el build (Vercel). Hobby sólo permite
Instant Rollback al deploy inmediatamente anterior: hacerlo en un deploy propio, no mezclado con otro cambio.

## Rollback

1. Frontend: quitar las dos variables y redeployar (o Instant Rollback al deploy anterior).
2. Gateway: quitar `TORNEOS_MEDIA_MODE` (o `off`).
3. Modo: `PROCESSOR_EXTERNAL`.
4. Base (sólo si hace falta retirar el contrato): `backend/torneos/media-v1/rollback/00000000000012_media_gallery_v1.rollback.sql`.
   Restaura los tres cuerpos del baseline al byte, borra policies y funciones nuevas y devuelve los grants de 0001.
   **No borra fotos ni filas**: las fotos son contenido de usuarios; borrarlas es una decisión de datos aparte
   (export + `delete` del bucket por un operador, con GO propio).

## Datos de laboratorio

Cuentas y organización del laboratorio: ver `REPORT.md`. Nunca en Producción.
