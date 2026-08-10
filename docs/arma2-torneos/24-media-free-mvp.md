# Multimedia gratuito: MVP local de galerías

## Estado

Esta entrega agrega el código de `MVP_SIMPLE`, pero **no lo activa**. La nueva
configuración nace en `PROCESSOR_EXTERNAL`; no se aplica SQL remoto, no se
despliega ninguna Edge Function y no se modifica Storage.

Los modos son fail-closed:

- `DISABLED`: no emite sesiones ni URLs de carga.
- `MVP_SIMPLE`: habilita únicamente fotos de galerías para miembros `owner` y
  `admin`, con el contrato reducido de este documento.
- `PROCESSOR_EXTERNAL`: conserva la readiness robusta, attestations, worker,
  variantes reales, libvips y antivirus existentes.

`MVP_SIMPLE` es una reducción temporal de seguridad y **no es equivalente** a
`PROCESSOR_EXTERNAL`.

## Flujo simple

1. El browser admite sólo JPEG, PNG estático y WebP estático; HEIC/HEIF, SVG,
   GIF, AVIF, TIFF, BMP y cualquier formato arbitrario quedan afuera.
2. El browser decodifica con orientación aplicada, ajusta a un máximo de 1600
   px y 2,56 MP, re-encodea un único display image y exige un máximo de 4 MiB.
3. La base emite una sesión actor-bound de cinco minutos. Organización,
   torneo, galería y path se derivan en servidor; el nombre local nunca define
   el objeto.
4. Para cumplir el TTL de 300 segundos, el signer existente entrega una URL de
   capability exact-path y vuelve a validar actor, token, tamaño y MIME antes
   de escribir con service role. Esto es necesario porque los signed upload
   tokens nativos de Supabase Storage tienen una vigencia fija de dos horas.
5. `tournament-media-processor` ejecuta la acción separada `finalize-simple`,
   descarga el objeto privado, inspecciona el archivo completo, calcula SHA-256
   y recién entonces crea el asset `mvp_simple` en `pending_review`.
6. Si falla, no crea el asset, marca la sesión con un código auditable y borra
   cuarentena best-effort. El sweeper existente sigue siendo la red final.
7. `thumbnail`, `grid` y `detail` firman el mismo objeto normalizado. No se
   inventan ni se persisten variantes físicas.

El bucket `tournament-media` sigue siendo privado. No existe policy de escritura
general para `anon` ni `authenticated`, no hay upsert y las lecturas siguen
usando URLs firmadas por 300 segundos.

## Límites de MVP_SIMPLE

| Contrato | Límite |
|---|---:|
| archivo seleccionado | 8 MiB |
| objeto normalizado | 4 MiB |
| lado / píxeles | 1600 px / 2,56 MP |
| selección / concurrencia | 10 / 2 |
| fotos por galería / torneo / organización | 20 / 60 / 100 |
| cuota por galería / torneo / organización | 50 / 200 / 400 MiB |
| sesiones abiertas por usuario | 10 |
| emisiones por usuario | 30 cada 15 minutos |
| capability de upload / URL de lectura | 300 s / 300 s |

Los límites robustos existentes (12 MiB, 36 MP, batch 40 y sus cuotas) no se
modifican y sólo aplican a `PROCESSOR_EXTERNAL`.

## Controles

### KEEP

- autenticación real y sesión ligada al actor;
- autorización `owner`/`admin` para el MVP;
- aislamiento por organización, torneo y galería;
- paths UUID generados por servidor e idempotencia;
- bucket privado, escritura sólo server-side y URLs de lectura firmadas;
- validación de magic bytes, MIME detectado y estructura completa;
- JPEG markers, PNG chunks/CRC/IEND y WebP RIFF/chunks;
- rechazo de animación, markup, trailing bytes y tamaños/dimensiones excesivos;
- SHA-256, cuotas, expiración, revocación, auditoría y moderación.

### DEGRADED

- sanitización de metadata: depende del re-encode en canvas y de que el
  verificador estructural confirme que no quedan carriers; no hay re-encode de
  servidor;
- detección de polyglots: se rechazan markup y trailing bytes y se recorre el
  contenedor, pero no existe pixel decode de servidor;
- protección contra decompression bombs: hay límites de bytes, dimensiones y
  píxeles declarados estructuralmente, sin decodificar el payload comprimido.

### LOST

- ClamAV;
- pixel decode real en servidor;
- re-encode de servidor/libvips.

El worker `workers/tournament-media-processor`, el renovador de attestations y
el runtime externo quedan preservados para escalar sin convertir el MVP en una
certificación falsa.
