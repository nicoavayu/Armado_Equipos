# Bucket público `team-crests`: cerrar SVG (XSS almacenado)

> **Estado: paquete preparado, NADA aplicado.** Este documento no cambia
> Producción. Cada paso remoto (cambio de bucket, decisión sobre objetos
> existentes) necesita su propio GO explícito de Nico. El único paso remoto
> hecho hasta ahora es el **inventario solo lectura del 2026-10-16**
> (sección 2), que corrió el coordinador con autorización de Nico.

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

Para comparar: `jugadores-fotos` (público) admite
`image/jpeg, image/png, image/webp, image/gif` con 15 MiB desde el Stage A
del parche M4 (`20260724124000`, incorporado en
`supabase/migrations/20260727215106_canonical_core_rls_contracts.sql`; antes
`allowed_mime_types` era `NULL`, o sea cualquier tipo). La baseline es la
fuente del repo; el valor real de Producción se leyó con el inventario
(sección 2).

## 2. Inventario de Producción (2026-10-16)

**Método.** Lo corrió el coordinador (Codex) contra Core Production por un
conector que Nico autorizó: transacciones `READ ONLY` terminadas en
`ROLLBACK`, sólo conteos y configuración, sin datos personales. No se abrió,
descargó, cambió ni borró ningún objeto ni bucket. Las consultas equivalentes
están en
[`team-crests-svg-inventory-readonly.sql`](../../../scripts/ops/core-storage/team-crests-svg-inventory-readonly.sql).

| Bucket | Config. actual en Prod | Objetos | Por tipo | SVG |
| --- | --- | --- | --- | --- |
| `team-crests` | `public`, 5 MiB, `allowed_mime_types` **todavía incluye `image/svg+xml`** | 24 | 8 jpeg / 16 png | **0 objetos, 0 referencias** |
| `jugadores-fotos` | `public`, 15 MiB, `jpeg, png, webp, gif` (SVG **no** permitido hoy) | 334 | 192 jpeg, 133 png, 6 SVG, 1 heif, 2 heic | **6 (legacy)** |
| `avatars` | — | 8 | — | — |

- `team-crests`: 20 objetos referenciados por `teams.crest_url` /
  `team_members.photo_url` y 4 sin referencia.
- `jugadores-fotos`: el allowlist actual no admite SVG, así que los 6 son
  **anteriores** a él (subidos cuando `allowed_mime_types` era `NULL`). Ver
  sección 8.

**Limitaciones.**

- Referenciado/no referenciado se calculó comparando la URL guardada con la
  ruta del objeto **sin decodificar** (`%20`, etc.). Un nombre con caracteres
  codificados puede figurar como no referenciado: los 4 "sin referencia" de
  `team-crests` son una cota superior, no una lista para borrar.
- El inventario es una foto al 2026-10-16. Hasta que el bucket cambie
  (sección 5), un SVG nuevo en `team-crests` sigue siendo posible por la API
  de Storage.
- La configuración exacta de `team-crests` para el rollback es la que
  devolvió la consulta 1 de ese inventario; este documento sólo registra que
  incluye `image/svg+xml`.

## 3. El riesgo

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

## 4. Corrección de cliente (este PR, primero)

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

**Cobertura: todos los selectores de imagen de Core.** Cada subida pasa por
`prepareImageForUpload` (escudo y foto de miembro → `team-crests`; avatar en
`ProfileEditor`, `services/db/profiles.js` y `services/api/playerService.js`,
foto de partido frecuente y foto de votación → `jugadores-fotos`), así que un
SVG se rechaza con el mensaje claro en cualquiera de ellos, aunque el selector
de `ProfileEditor` / `EditarPartidoFrecuente` siga con `accept="image/*"` y
el sistema operativo lo deje elegir.

`image/gif` sigue permitido en `jugadores-fotos` (bucket) y no se toca: GIF es
raster, no ejecuta script; queda fuera de alcance de este paquete.

El cliente es defensa en profundidad: un atacante puede llamar a la API de
Storage sin la app. **El cierre real es la configuración del bucket.**

## 5. Configuración PROPUESTA

| Campo | Hoy (repo; Prod 2026-10-16) | Propuesto |
| --- | --- | --- |
| `public` | `true` | `true` (sin cambio: lectura pública de raster) |
| `file_size_limit` | `5242880` (5 MiB) | `5242880` (sin cambio) |
| `allowed_mime_types` | `jpeg, png, webp, svg+xml` (Prod: incluye `svg+xml`) | `jpeg, png, webp` |

Como el inventario encontró **0 SVG** en `team-crests`, el cambio no tiene
ningún seguimiento sobre objetos existentes y puede aplicarse **apenas esté
desplegada la corrección de cliente** (sección 9).

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

Restaurar **el valor exacto que devolvió la consulta 1 del inventario del
2026-10-16** (confirmado: incluye `image/svg+xml`; contrastar el array
completo con esa salida antes de correrlo). Si coincide con el repo, es:

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

## 6. Prerrequisitos

1. **Cliente desplegado** (este PR mergeado y publicado en web; en la app
   nativa, la versión que lo incluya). Con el cliente viejo, quien elija un
   SVG verá el error genérico de Storage en vez del mensaje claro; no rompe
   nada más.
2. **Inventario solo lectura — HECHO el 2026-10-16** (sección 2). Se puede
   repetir con
   `scripts/ops/core-storage/team-crests-svg-inventory-readonly.sql`
   (`BEGIN READ ONLY` … `ROLLBACK`, sólo `SELECT`) justo antes del cambio
   para confirmar que siguen siendo 0. Lo corre una persona con GO; la URL de
   conexión va por entorno/llavero, nunca en archivo. Consulta central:

   ```sql
   select name, metadata->>'mimetype', created_at
   from storage.objects
   where bucket_id = 'team-crests'
     and (metadata->>'mimetype' = 'image/svg+xml' or name ilike '%.svg');
   ```

   Además devuelve: configuración actual de `team-crests` y `jugadores-fotos`
   (guardar para el rollback), conteo por MIME, objetos no raster, equipos
   (`teams.crest_url`) y miembros (`team_members.photo_url`) que apuntan a
   SVG, control cruzado de SVG en `jugadores-fotos` y, para la sección 8, la
   revisión de metadatos de esos SVG (consulta 8, **salida sensible**) y su
   resumen por forma de ruta (consulta 9).
3. Guardar la salida del inventario con fecha (UTC) junto a la evidencia del
   cambio (la de la consulta 8, fuera del repo).

## 7. SVG existentes en `team-crests`: no hay

- **Inventario 2026-10-16: 0 objetos SVG y 0 referencias a SVG** en
  `teams.crest_url` / `team_members.photo_url` (sección 2).
- Por eso el cambio de bucket **no tiene seguimiento sobre objetos
  existentes**: no hay nada que re-encodear, retirar ni revisar en
  `team-crests`. Las opciones A/B/C que este paquete preveía para SVG
  existentes ya no aplican a este bucket.
- **El único riesgo que queda es el de subidas nuevas**: mientras
  `allowed_mime_types` incluya `image/svg+xml`, cualquier usuario autenticado
  puede subir un SVG a su carpeta por la API de Storage, sin la app. Lo cierra
  el cambio de la sección 5, que puede ir **inmediatamente después** del
  despliegue del cliente.
- Si al repetir el inventario justo antes del cambio apareciera algún SVG
  nuevo, se trata igual que los de `jugadores-fotos` (sección 8): revisión de
  metadatos y una decisión con GO aparte. El cambio de bucket no depende de
  esa decisión (sólo afecta subidas nuevas).
- El rollback SQL de la sección 5 se mantiene en seco, sin cambios.

## 8. Hallazgo nuevo: 6 SVG legacy en `jugadores-fotos` (público)

> **Nada ejecutado.** No abrir, descargar ni borrar estos objetos. Cada paso
> de esta sección necesita su propio GO de Nico.

**Qué hay.** El inventario del 2026-10-16 encontró 6 objetos SVG en
`jugadores-fotos` (bucket **público**, 15 MiB). El allowlist actual
(`jpeg, png, webp, gif`) no admite SVG, así que son **anteriores** al Stage A
del parche M4 (`20260724124000`), cuando `allowed_mime_types` era `NULL`.

**Riesgo.** Cada uno es alcanzable directo en su URL pública
`…/storage/v1/object/public/jugadores-fotos/<ruta>`. Si alguno contiene
script, abrir esa URL lo ejecuta en el origen de Storage (`*.supabase.co`):
el mismo vector de XSS almacenado de la sección 3. Dentro de la app no hay
ejecución (los avatares se muestran con `<img>`). No sabemos si alguno es
malicioso: **no se abrió ninguno, a propósito**.

**Lo que ya no puede pasar.** El bucket no acepta SVG nuevos, y la corrección
de cliente de este PR rechaza SVG en todos los selectores (sección 4). El
problema se limita a estos 6 objetos.

### Propuesta (sin ejecutar; cada paso con GO)

**a) Revisión de metadatos, solo lectura.** Consultas 8 y 9 de
`team-crests-svg-inventory-readonly.sql` (`BEGIN READ ONLY` … `ROLLBACK`).
Por objeto devuelve:

- id del objeto;
- forma de la ruta: `uid_carpeta` (`<uid>/…`), `uid_prefijo_legacy`
  (`<uid>_…`), `invitado_votacion` (`guest/…`), `partido_frecuente_legacy`
  (`partido_…`) u `otra`;
- forma del owner: sin owner, igual al uid de la ruta, distinto, o ruta sin uid;
- `created_at`, tamaño en bytes y MIME guardado;
- si la cuenta del uid de la ruta existe;
- si lo referencia `usuarios.avatar_url`, `jugadores.avatar_url`,
  `profiles.avatar_url`, `team_members.photo_url`, `teams.crest_url`,
  `tournament_roster_players.avatar_url` o los `avatar_url_snapshot` de
  partidos de torneo.

Reglas de la consulta:

- **No devuelve la ruta** (contiene uids), ni nombres ni emails.
- Sobre `usuarios`/`jugadores` sólo hace `EXISTS` por la columna que
  referencia (o por `id`), sin listas explícitas de columnas.
- La salida de la consulta 8 es **sensible** (ids ligados a cuentas): se
  guarda fuera del repo y no se pega en PRs ni chats. La consulta 9 es el
  resumen sin ids, por forma de ruta.
- Misma limitación que en la sección 2: compara URLs sin decodificar.
- No incluye `auth.users` (metadatos de Auth) ni una columna de imagen de
  `partidos_frecuentes`, que no está en el esquema canónico.
- **Nunca** abrir el contenido en un navegador.

**b) Opciones por objeto, según (a).**

| Opción | Qué implica | Cuándo |
| --- | --- | --- |
| Retirar los no referenciados | Quitar el objeto por la **API de Storage** con service role, nunca con `delete from storage.objects` (deja el archivo físico huérfano). | Ninguna fila lo referencia. |
| Re-encodear a PNG | 1. Bajar los bytes **en un entorno aislado** (contenedor sin red tras la descarga, nunca un navegador). 2. Rasterizar offline (`resvg`/`rsvg-convert`). 3. Subir el PNG a la misma carpeta/forma de ruta. 4. Repuntar las columnas que lo referencian. 5. Recién después retirar el SVG. | Está referenciado y en uso. |
| Dejar con nota de riesgo | Registrar id, forma y motivo; riesgo residual aceptado por Nico. | Si se decide no tocar Producción por ahora. |

**c) Relación con el borrado de cuenta (#218).** #218 hace que
`delete-account` borre de `jugadores-fotos` todo lo que está bajo `<uid>/…`
y lo que empieza con `<uid>_…` en la raíz. Entonces:

- los SVG con forma `uid_carpeta` o `uid_prefijo_legacy` se borran **cuando
  esa cuenta se elimine**, no antes: hasta entonces siguen públicos;
- los de forma `invitado_votacion`, `partido_frecuente_legacy` u `otra` no
  pertenecen a ninguna cuenta y #218 nunca los toca;
- #218 no reemplaza esta decisión.

## 9. Orden de despliegue

1. **Cliente** (este PR): merge + deploy web (y build nativa cuando
   corresponda). Verificar en la app que elegir un `.svg` muestra «No
   aceptamos imágenes SVG…» y que un PNG/JPG sigue subiendo.
2. **Inventario** solo lectura — hecho el 2026-10-16 (sección 2): 0 SVG en
   `team-crests`. Opcional: repetir las consultas 1–7 justo antes del paso 3.
3. **Configuración del bucket** (GO): SQL de la sección 5, inmediatamente
   después del paso 1. No hay objetos SVG existentes que esperar en
   `team-crests`.
4. **Verificación** (sección 10).
5. **`jugadores-fotos`, 6 SVG legacy** (sección 8; independiente de los pasos
   1–4): revisión de metadatos con GO y después la decisión por objeto con
   otro GO.
6. **Alinear el repo** (PR aparte): una migración que deje la baseline/
   entornos nuevos sin `image/svg+xml`, para que un rebuild de laboratorio no
   reintroduzca SVG. No se incluye aquí para que nada se aplique por accidente.

## 10. Verificación (después del paso 3)

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
  se ven; los escudos existentes (todos jpeg/png según el inventario) se
  siguen viendo.
- El PNG de verificación queda en la carpeta del QA; retirarlo por la API de
  Storage dentro del mismo GO.

## 11. Rollback

- **Bucket**: SQL de rollback de la sección 5 con el valor guardado por el
  inventario del 2026-10-16. Inmediato; no toca objetos.
- **Cliente**: revertir el PR. Sin migraciones ni datos involucrados.
- Disparadores: subidas raster legítimas rechazadas por Storage tras el
  cambio (no esperado), o errores de subida de escudo/foto en la app.

## 12. Torneos

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

**No se cambió nada en Producción.** Sin buckets, policies ni objetos
tocados. La única consulta remota fue el inventario solo lectura del
2026-10-16 (sección 2), que corrió el coordinador con autorización de Nico;
la preparación de este paquete no corrió nada remoto. Las consultas nuevas 8
y 9 se validaron sólo contra un Postgres 16 local descartable con tablas
sustitutas.
