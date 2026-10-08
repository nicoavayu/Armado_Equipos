# MEDIA-V1 — certificación de laboratorio (2026-10-07)

Lab `arma2-promo-rehearsal` (local). Código `claude/torneos-photo-gallery` @ 9b89004c, migración `0012` sin cambios desde
824582c4 (sha256 `859fa24d…`). Producción no se tocó.

- **Cuentas propias:** `galeria-owner`, `galeria-admin`, `galeria-capitan`, `galeria-ajeno` y `galeria-otra`, todas `@lab.test`.
- **Organizaciones propias:**
  - «Lab Galería»: FREE; admin con temporada asignada; equipo aprobado con capitán invitado.
  - «Lab Otra Liga»: PREMIUM por grant simulado de operador en SQL. Nunca desde el cliente.
- **No se tocaron** los datos b04-*, los logos ni la preview :3103.
- **Contenedores propios:**
  - `arma2-media-lab-gateway`: 127.0.0.1:58440;
  - `arma2-media-lab-storage`: 127.0.0.1:58445;
  - bridge: 58446/58447;
  - app: 3120.
- **Evidencia:** `evidence/` (JSON + capturas).

## Hallazgos corregidos durante el lab

1. **Ningún navegador real podía subir.** El canvas de Chromium siempre incrusta un perfil de color: APP2 ICC en JPEG, ICCP en WebP. El contrato del MVP exigía bytes "ya limpios". Ahora el gateway quita todo portador de metadatos con el limpiador del pipeline, re-verifica y guarda sólo esos bytes. Sigue rechazando una orientación EXIF distinta de 1.
2. **La ruta de firma descartaba las miniaturas**: la grilla mostraba "Vista protegida".
3. **PNG grande guardado como PNG**: 2,48 MB. Ahora las fotos de galería se guardan siempre como JPEG: la misma imagen ocupa 95 KB.
4. **Un admin asignado por temporada recibía error en el Centro Multimedia**: la vista de toda la organización le está vedada. Ahora abre el torneo activo.
5. **Una recarga fallida tras subir reemplazaba la página por un error**. Ahora conserva lo visible y la cola.
6. **Botón "Seleccionar archivos" sin estilo** (CSS previo) y el texto "1 fotos".

## Recorrido (navegador real, mobile 390×844 @3x y desktop 1440×900)

| Paso | Resultado |
|---|---|
| Organizador crea galería, elige 6 archivos | 4 fotos 201 → "Pendiente de aprobación"; HEIC explicado ANTES de subir; archivo roto: error por archivo |
| Retrato con EXIF 6 | guardado 1200×1600 (bien orientado) |
| Aprobar, portada, publicar | publicada |
| Participante (capitán) → Mis torneos → torneo → Fotos | grilla de miniaturas, visor, swipe (mobile) / flechas (desktop) |

## Permisos (`evidence/matrix.jsonl`)

| Actor | Resultado |
|---|---|
| Owner | sube (201) |
| Admin con temporada | sube (201) |
| Capitán (participante) | ve sus galerías: 4 de 4 URLs. Panel 403, subir 403, crear 403, ocultar 403 |
| Cuenta ajena | galerías 403, URLs por id: 0 de 4 (detalle y miniatura) |
| Otra organización | panel 403, URLs 0 de 4, subir/crear/publicar/ocultar 403 |
| Visitante | rutas 401; ruta pública 403; storage público, sin token o con token alterado: 400 |
| Token propio escribiendo directo en storage | 400 (exige el claim del gateway) |
| `kind=original` | 400 |

## Retiro con una URL emitida antes (`evidence/retire-url.jsonl`)

Al retirar la foto (0 s):
- el participante deja de recibir URLs nuevas;
- la foto sale de su galería;
- el organizador la sigue viendo.

**La URL ya emitida siguió respondiendo 200 a los 60, 120 y 240 s, y respondió 400 a los 300 s.** El retiro NO es inmediato para un link ya entregado: funciona hasta su vencimiento, 5 min desde que se emitió. Bajar el TTL a 120 s acorta esa ventana a costa de más re-firmas y re-descargas. Es una decisión pendiente.

## Cuotas, presupuesto, concurrencia

- **FREE:** con 8 fotos previas, se aceptaron 17 más. La número 26 recibe `422 TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED` con "25 de 25 · upgradeRequired". Rechazar una foto libera su lugar.
- **El cliente no puede volverse Premium:** 5 RPCs probadas, todas 403; el plan sigue FREE.
- **PREMIUM:** límite 1000 y la carga pasa; el acceso cruzado sigue en 0.
- **Presupuesto de bytes** (tope = lo guardado + 1 KB): `409 STORAGE_BUDGET_EXCEEDED`, sin ningún byte escrito.
- **Concurrencia** (1 cupo, 3 a la vez): una 201 y dos `429 BUSY`, que se pueden reintentar.

## Reintentos y red

- **Reintentos, misma clave:** 201 y luego 200 "replayed" (mismo asset). Doble toque concurrente: 201 + 409. Misma foto con otra clave: 409 duplicada. Quedan exactamente 2 fotos.
- **Corte real a mitad de la subida** (gateway muerto): ECONNRESET. Reintento con la misma clave: 201, y otro más: 200 replayed. 1 foto, 0 objetos huérfanos.
- **Red lenta** (emulación de Chrome), el tiempo incluye normalizar en el dispositivo:
  - 400 kbit/s, original de 4,8 MB: 5,1 s;
  - 1 Mbit/s, original de 10,4 MB: 3,4 s.
  - Las dos con progreso real de bytes y lejos del timeout de 30 s.

## Mediciones (MEDIDO)

| Concepto | Medido |
|---|---|
| Foto guardada (1600 px JPEG; 12 fotos, originales de 1–10 MB) | 95–328 KB, promedio 219 KB |
| Miniatura (640 px) | 17–39 KB, promedio 27 KB |
| Total guardado por foto | ~246 KB |
| Grilla mobile @3x, 4 fotos (la portada elige la foto grande por `srcset`) | 223 KB |
| Grilla desktop, 3 fotos | 204 KB |
| Abrir el visor y pasar a la siguiente (desktop; incluye precarga) | 483 KB |
| Storage del lab al final (fotos + miniaturas + logos) | 5,67 MB |

## Estimaciones (NO medidas)

- 25 fotos (FREE) ≈ 6 MB; 200 fotos ≈ 49 MB; 1000 fotos (PREMIUM) ≈ 0,25 GB.
- Presupuesto por defecto de galerías (400 MiB) ≈ 1.700 fotos en todo el proyecto.
- Galería de 20 fotos: grilla ≈ 0,3–0,5 MB; verlas todas ≈ 4–5 MB.
- Con 5 GB de egreso mensual compartido con Core: del orden de 10.000 aperturas de grilla, o ~20.000 fotos vistas por mes.

## Branding y rollback

- **Logos de "Lab Copa Conectada"** por el stack propio del lab (58420 / 58425): firman y cargan (200, PNG) después de las subidas en el volumen compartido.
- **`rollback-0012`** se ejecutó de verdad dentro de una transacción revertida:
  - dentro: 0 políticas, sin funciones nuevas, 39 fotos y 78 objetos conservados, grant de retiro revocado;
  - afuera: el estado quedó intacto.
- La `0013` de Premium no toca media; el orden 0012 → 0013 es independiente.

## 0014 — retirar la última foto devuelve a borrador (2026-10-08, `evidence/draft-on-retire.jsonl`)

Decisión de Nico. Antes, retirar la única foto publicada (la portada) archivaba la galería, sin vuelta atrás. La `0014`
se aplicó al lab con el driver de operador: `POST_0012 → POST_0014`, nada fuera de media se movió. Ciclo en «Lab Otra
Liga» (PREMIUM), con el capitán del lab como participante de un equipo de esa liga:

| Paso | Resultado |
|---|---|
| Publicar con 1 foto | publicada; el participante la ve (1 de 1 URL) |
| Capitán / ajeno / otra organización retiran o publican | 403 los tres; visitante 401; nada cambió |
| El organizador retira la única foto | galería en **borrador** (sin portada ni sellos), foto `hidden`; el participante deja de verla y no recibe URLs nuevas; la URL emitida antes respondió 200, como se espera hasta sus 300 s |
| Capitán sobre el borrador: restaurar / publicar | 403 / 403 |
| Foto pendiente de revisión en el borrador | publicar → `400 TORNEOS_MEDIA_GALLERY_NOT_PUBLISHABLE` (se rechazó después) |
| Aprobar otra foto, portada, publicar (la retirada sigue oculta) | publicada; el participante ve sólo la nueva (1 de 2) |
| Restaurar la retirada en la galería publicada | vuelve a `published` (2 de 2) |
| Retirar las dos (la portada al final) → restaurar → portada → publicar | borrador, y otra vez publicada |
| «Archivar galería» explícito | archivada; restaurar y republicar fallan: sigue siendo final |
| Auditoría | `created, cover_set, published, unpublished, cover_set, published, unpublished, cover_set, published, archive` |

La UI pide confirmación antes: «¿Retirar la única foto publicada? La galería volverá a borrador…». Después explica la
vuelta: restaurar o aprobar otra, elegir portada y publicar.

## Límites que siguen

- MVP_SIMPLE: sin antivirus, sin decodificación de píxeles en servidor.
- El retiro de un link ya entregado espera su vencimiento (≤ 5 min).
- Sin borrado físico desde la UI.
- Probado en Chromium; Safari/WebKit real no se probó.
