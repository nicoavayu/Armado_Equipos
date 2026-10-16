# Bucket público `team-crests`: cerrar SVG (XSS almacenado)

> **Estado: paquete preparado, NADA aplicado.** Este documento no cambia
> Producción. Cada paso remoto (inventario, cambio de bucket, decisión sobre
> objetos existentes) necesita su propio GO explícito de Nico.

- Proyecto: Arma2 Core Production (`rcyuuoaqfwcembdajcss`).
- Bucket: `team-crests` (escudos de equipo y fotos de miembros de equipo).
- Corrección de cliente: rama `claude/core-crests-no-svg` (este mismo PR).
- Inventario solo lectura: [`scripts/ops/core-storage/team-crests-svg-inventory-readonly.sql`](../../../scripts/ops/core-storage/team-crests-svg-inventory-readonly.sql).

## 1. Configuración actual según el repo

El bucket es una fila de configuración (`storage.buckets`); `pg_dump` de
esquema no la trae, por eso el repo la declara explícitamente:

| Origen | `public` | `file_size_limit` | `allowed_mime_types` |
| --- | --- | --- | --- |
| `supabase/migrations_history/20260221200000_equipos_desafios_module.sql` (creación) | `true` | `5242880` (5 MiB) | `image/jpeg, image/png, image/webp, image/svg+xml` |
| `supabase/migrations/20260727090000_arma2_canonical_baseline.sql` (baseline canónica, `on conflict do update`) | `true` | `5242880` | `image/jpeg, image/png, image/webp, image/svg+xml` |

Policies (baseline, sin cambios en este paquete):

- `team_crests_public_read` — `select` para `public` (anon incluido).
- `team_crests_insert_owner_folder` / `_update_owner_folder` / `_delete_owner_folder` —
  `authenticated`, sólo bajo `<auth.uid()>/…`.

Para comparar: `jugadores-fotos` (público) ya admite sólo
`image/jpeg, image/png, image/webp`. La baseline es la fuente del repo; **el
valor real de Producción hay que leerlo con el inventario** (sección 5) antes
de tocar nada, porque puede haber divergido.

## 2. El riesgo

- Un SVG es un documento XML que puede contener `<script>`, `onload=…`,
  `<foreignObject>` con HTML, etc.
- El bucket es **público** y admite `image/svg+xml`: cualquier usuario
  autenticado puede subir un SVG a su carpeta (`<uid>/…`) y obtener una URL
  pública `https://rcyuuoaqfwcembdajcss.supabase.co/storage/v1/object/public/team-crests/<uid>/…/x.svg`.
- Si alguien **abre esa URL directamente** (link en WhatsApp, chat, QR,
  "abrir imagen en pestaña nueva"), el navegador renderiza el SVG como
  documento y **ejecuta su script en el origen del proyecto Supabase**
  (`*.supabase.co`). Es XSS almacenado en un dominio que la gente asocia a
  Arma2: phishing creíble, redirecciones, formularios falsos de login, y
  cualquier estado que ese origen tuviera en el navegador.
- La sesión de la app vive en el origen de la app (web / Capacitor), no en
  `supabase.co`, así que el script no lee el token directamente; el impacto es
  real igual (phishing en dominio confiable, abuso de reputación del dominio) y
  es un hallazgo de seguridad estándar.

### Cómo renderiza la app los escudos

Todos los usos de `crest_url` / `photo_url` del bucket son `<img src=…>`:
`TeamShieldAvatar`, `TeamCard`, `ChallengeCard`, `MisEquiposTab`,
`EquipoDetalleView` (escudo propio y rivales), `TeamMatchDetailPage`, y la
lectura de compatibilidad de Torneos (`TournamentApplicationPage` vía
`resolveBrandingAssetUrl`, sólo lectura de escudos legacy). La tarjeta para
compartir dibuja la imagen en canvas. No hay `<object>`, `<embed>`, `<iframe>`
ni `innerHTML` con estas URLs.

- Dentro de `<img>` (y en canvas) **los scripts de un SVG no se ejecutan** y
  no se cargan recursos externos: dentro de la app no hay XSS.
- **La navegación directa a la URL pública sí ejecuta el script.** Ese es el
  vector que cierra este paquete.

## 3. Corrección de cliente (este PR, primero)

- `src/utils/imageUpload.js`: SVG deja de "pasar intacto". `validateImageFile`
  lo rechaza por MIME (`*svg*`) o extensión (`.svg`, `.svgz`) con el mensaje
  «No aceptamos imágenes SVG. Elegí una foto JPG, PNG o WEBP.»;
  `prepareImageForUpload` además mira los primeros bytes y rechaza markup
  SVG/XML disfrazado de `.png`/`.jpg`/`.heic`. Lo demás sigue igual
  (HEIC→JPEG, redimensión/re-encode por canvas, PNG conserva transparencia).
  Este helper lo usan escudo, foto de miembro, avatar, foto de partido
  frecuente y foto de votación, así que todos quedan cubiertos.
- `src/services/storage/teamCrests.js`: última guarda antes de la red
  (`assertRasterTeamImage`): sólo `image/jpeg|png|webp`, nunca SVG; el
  `contentType` que se manda es el MIME raster validado.
- `TeamFormModal.jsx` y `EquipoDetalleView.jsx`: `accept` sin
  `image/svg+xml` (constante compartida `IMAGE_UPLOAD_ACCEPT`); texto de ayuda
  «PNG, JPG, WEBP o HEIC».

El cliente es defensa en profundidad: un atacante puede llamar a la API de
Storage sin la app. **El cierre real es la configuración del bucket.**

## 4. Configuración PROPUESTA

| Campo | Hoy (repo) | Propuesto |
| --- | --- | --- |
| `public` | `true` | `true` (sin cambio: lectura pública de raster) |
| `file_size_limit` | `5242880` | `5242880` (sin cambio) |
| `allowed_mime_types` | `jpeg, png, webp, svg+xml` | `jpeg, png, webp` |

Storage valida `allowed_mime_types` contra el `Content-Type` de cada subida
nueva. Un SVG subido declarándose `image/png` queda guardado y servido como
`image/png`, y el navegador no lo interpreta como SVG/documento (no hay
sniffing de PNG a SVG/HTML): el vector queda cerrado aunque se mienta el tipo.

### SQL del cambio (NO ejecutado; requiere GO)

```sql
-- team-crests: quitar image/svg+xml (sólo afecta subidas NUEVAS).
begin;

do $$
declare
  v_rows integer;
begin
  update storage.buckets
  set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  where id = 'team-crests';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'team-crests: se esperaba 1 fila, hubo %', v_rows;
  end if;
end
$$;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'team-crests';
-- Esperado: public = true, file_size_limit = 5242880,
--           allowed_mime_types = {image/jpeg,image/png,image/webp}

commit;
```

Equivalente por Dashboard: Storage → `team-crests` → Edit bucket → Allowed
MIME types = `image/jpeg, image/png, image/webp` (dejar "Public" activado y
el límite de 5 MB).

### SQL de rollback (NO ejecutado; requiere GO)

Restaurar **el valor exacto que devolvió el inventario** (consulta 1). Si
coincide con el repo, es:

```sql
begin;

do $$
declare
  v_rows integer;
begin
  update storage.buckets
  set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']::text[]
  where id = 'team-crests';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'team-crests rollback: se esperaba 1 fila, hubo %', v_rows;
  end if;
end
$$;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'team-crests';

commit;
```

El rollback reabre el vector: sólo se justifica si el cambio rompe subidas
raster legítimas (no debería: el cliente ya sube sólo jpeg/png/webp).

## 5. Prerrequisitos

1. **Cliente desplegado** (este PR mergeado y publicado en web; en la app
   nativa, la versión que lo incluya). Con el cliente viejo, quien elija un
   SVG verá el error genérico de Storage en vez del mensaje claro; no rompe
   nada más.
2. **Inventario solo lectura** con
   `scripts/ops/core-storage/team-crests-svg-inventory-readonly.sql`
   (`BEGIN READ ONLY` … `ROLLBACK`, sólo `SELECT`). Lo corre una persona con
   GO; la URL de conexión va por entorno/llavero, nunca en archivo. Consulta
   central:

   ```sql
   select name, metadata->>'mimetype', created_at
   from storage.objects
   where bucket_id = 'team-crests'
     and (metadata->>'mimetype' = 'image/svg+xml' or name ilike '%.svg');
   ```

   Además devuelve: configuración actual de `team-crests` y `jugadores-fotos`
   (guardar para el rollback), conteo por MIME, objetos no raster, equipos
   (`teams.crest_url`) y miembros (`team_members.photo_url`) que apuntan a
   SVG, y control cruzado de SVG en `jugadores-fotos`.
3. Guardar la salida del inventario con fecha (UTC) junto a la evidencia del
   cambio.

## 6. Compatibilidad: qué pasa con los SVG existentes

- **Siguen sirviéndose.** `allowed_mime_types` sólo se valida en subidas
  nuevas; los objetos ya guardados con `image/svg+xml` mantienen su
  `Content-Type` y su URL pública. Los escudos SVG existentes se siguen viendo
  en la app (vía `<img>`).
- **El riesgo de esos objetos concretos sigue vivo**: si alguno es malicioso,
  su URL pública sigue ejecutando script al abrirse directo.
- Reemplazar un escudo desde la app sube un raster nuevo (otra ruta, por el
  `Date.now()` del nombre) y actualiza `crest_url`; el SVG viejo queda
  huérfano pero accesible por su URL.

### Opciones para los SVG existentes (cada una con GO aparte)

| Opción | Qué implica | Cuándo |
| --- | --- | --- |
| A. Dejar como están | Riesgo residual documentado; revisar a mano el contenido (como texto, **nunca abriéndolo en el navegador**) buscando `<script`, `on*=`, `href="javascript:`, `<foreignObject`. | Inventario = 0, o pocos y todos benignos. |
| B. Re-encodear a PNG | Descargar cada SVG como texto, rasterizar offline en sandbox (p. ej. `resvg`/`rsvg-convert`, sin red), subir el PNG a la misma carpeta del dueño (service role), actualizar `teams.crest_url` / `team_members.photo_url` a la nueva URL y recién después retirar el SVG. | Hay SVG legítimos y en uso. |
| C. Retirar | Quitar los objetos con la **API de Storage** (no `delete from storage.objects`, que deja el archivo físico huérfano) y poner `crest_url`/`photo_url` en `null` (la app muestra el fallback de iniciales). | Contenido malicioso o sin uso. |

Ninguna se ejecuta en este paquete. B y C escriben en Producción.

## 7. Orden de despliegue

1. **Cliente** (este PR): merge + deploy web (y build nativa cuando
   corresponda). Verificar en la app que elegir un `.svg` muestra «No
   aceptamos imágenes SVG…» y que un PNG/JPG sigue subiendo.
2. **Inventario** solo lectura (GO). Guardar la configuración actual.
3. **Configuración del bucket** (GO): SQL de la sección 4.
4. **Verificación** (sección 8).
5. **Decisión sobre SVG existentes** (GO separado): A, B o C.
6. **Alinear el repo** (PR aparte): una migración que deje la baseline/
   entornos nuevos sin `image/svg+xml`, para que un rebuild de laboratorio no
   reintroduzca SVG. No se incluye aquí para que nada se aplique por accidente.

## 8. Verificación (después del paso 3)

Con una cuenta QA (token por entorno, nunca en archivo) y su propia carpeta:

```sh
# Debe FALLAR con 4xx (Storage responde 400/415 con mime type no soportado).
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  "$CORE_SUPABASE_URL/storage/v1/object/team-crests/$QA_UID/verify-svg/x.svg" \
  -H "Authorization: Bearer $QA_USER_JWT" -H "apikey: $CORE_ANON_KEY" \
  -H 'Content-Type: image/svg+xml' \
  --data-binary '<svg xmlns="http://www.w3.org/2000/svg"/>'

# Debe seguir funcionando (200): PNG mínimo.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  "$CORE_SUPABASE_URL/storage/v1/object/team-crests/$QA_UID/verify-svg/x.png" \
  -H "Authorization: Bearer $QA_USER_JWT" -H "apikey: $CORE_ANON_KEY" \
  -H 'Content-Type: image/png' --data-binary @pixel.png
```

- Releer la fila: `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'team-crests';`.
- En la app: crear/editar un equipo con escudo PNG y foto de miembro JPG →
  se ven; escudos existentes (incluidos SVG previos) se siguen viendo.
- El PNG de verificación queda en la carpeta del QA; retirarlo por la API de
  Storage dentro del mismo GO.

## 9. Rollback

- **Bucket**: SQL de rollback de la sección 4 con el valor guardado por el
  inventario. Inmediato; no toca objetos.
- **Cliente**: revertir el PR. Sin migraciones ni datos involucrados.
- Disparadores: subidas raster legítimas rechazadas por Storage tras el
  cambio (no esperado), o errores de subida de escudo/foto en la app.

## 10. Torneos

- Branding de Torneos usa otro bucket (`tournament-branding`, privado en el
  proyecto Torneos según `backend/torneos/supabase/migrations/00000000000010_branding_v1.sql`)
  con `allowed_mime_types` = `jpeg, png, webp`, validación de cliente
  (`BRANDING_ALLOWED_MIME`) y del gateway (sniffing de bytes; un `payload.svg`
  responde 415). **No acepta SVG**; no se toca.
- Los `accept` de Torneos (branding, foto de equipo, retrato, media, Social
  Studio) ya son `image/jpeg,image/png,image/webp`.
- Torneos sólo **lee** escudos legacy de `team-crests` (compatibilidad, vía
  `<img>`); la constraint `tournament_team_entries_shield_path_check` admite
  `qa/shields/*.svg` únicamente como fixture QA de lectura.

---

**No se cambió nada en Producción.** Sin buckets, policies, objetos ni
consultas remotas en la preparación de este paquete.
