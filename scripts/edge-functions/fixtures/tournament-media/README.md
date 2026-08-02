# Fixtures de verificación de imagen

Archivos binarios reales producidos por codecs reales (Pillow). No son bytes
inventados a mano: el verificador del processor tiene que aceptar exactamente lo
que un encoder produce y rechazar todo lo demás.

| Archivo | Qué prueba |
|---|---|
| `clean-64x48.jpg` / `.png` / `.webp` | salida limpia de un encoder: pasa sin tocarse |
| `exif-orient6-64x48.jpg` | EXIF con `Orientation=6` y un `ImageDescription` con nombre propio |
| `text-64x48.png` | chunks `tEXt` con datos personales |
| `exif-64x48.webp` | chunk `EXIF` dentro de un contenedor `VP8X` |
| `animated-16x16.png` / `.webp` | animación (APNG / WebP ANIM): se rechaza, no se aplana |
| `sample-8x8.gif` | contenedor soportado por navegadores pero fuera del contrato |
| `payload.svg` | markup con `<script>`: nunca puede pasar como fotografía |
| `probe-1x1.png`, `probe-8x8.jpg`, `probe-8x8.webp` | fixtures mínimos embebidos en el self-test del processor |

Los casos corruptos, truncados y con bytes agregados después del terminador se
derivan en tiempo de test a partir de estos archivos, así el repositorio no
guarda binarios rotos.

## Regenerar

```bash
python3 scripts/edge-functions/fixtures/tournament-media/generate.py
```

Si cambian los bytes, hay que regenerar también las constantes base64 embebidas
en `supabase/functions/_shared/tournamentMediaSelfTest.ts`; el script lo
imprime.
