# Estudio Social

Genera placas listas para publicar a partir de datos **oficiales y publicados**
del torneo. Apagado por defecto
(`REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=false`) y forzado a `false` en
Production.

## Estado de integración

Multimedia Upload ya está integrado en `epic/arma2-torneos` y Estudio Social
se valida directamente contra esa epic. La integración conserva los scripts y
las migraciones de ambos dominios sin duplicados; el diff resultante contiene
únicamente esta superficie social.

La certificación local posterior al merge cubrió las once piezas en los dos
formatos: 22/22 renders Canvas, dimensiones exactas, igualdad entre preview y
PNG exportado, nombres largos, escudos ausentes, tablas extensas, caracteres
especiales, safe areas y fallback de descarga. Staging y Production permanecen
fuera de alcance; el QA con datos reales continúa listado como pendiente.

## Qué NO es

No es un editor tipo Canva. No hace screenshots de la aplicación. No captura el
DOM de ninguna pantalla de Torneos. No publica en ninguna red. No usa IA para
elegir jugadores ni para escribir textos.

## Snapshots tipados

Una pieza sólo puede dibujar un **snapshot**: un objeto versionado
(`schemaVersion: 1`) que separa dos capas que nunca se mezclan.

```jsonc
{
  "schemaVersion": 1,
  "piece": "standings",
  "source": {
    "organizationId": "…", "tournamentId": "…", "categoryId": "…",
    "phaseId": "…", "roundId": "…",
    "fixtureVersionId": "…",          // siempre de un fixture PUBLICADO
    "standingsRevisionId": "…",
    "standingsRevisionNumber": "9"    // trazabilidad de la pieza exportada
  },
  "competition": { "organizationName": "…", "tournamentName": "…", "…": "…" },
  "official": { "rows": [ … ] },      // proyección oficial, jamás editable
  "capabilities": ["social.read", "social.create", "social.export"]
}
```

`get_tournament_social_snapshot` lo arma en la base. Tres reglas se cumplen ahí
y no se delegan al cliente:

1. **Sólo publicado.** El scope se resuelve contra un `fixture_version`
   `published` y no invalidado. Una tabla en borrador, un resultado sin
   `official_at`, una nota privada, la disponibilidad del rival o cualquier fila
   de auditoría son inalcanzables: las consultas no las tocan.
2. **Sin recálculo.** Tabla, goleadores y disciplina salen de
   `get_published_tournament_standings` y `get_published_tournament_statistics`,
   las proyecciones oficiales que ya existían. No hay una segunda
   implementación de un desempate en ningún lado.
3. **Sin juicio editorial automático.** Equipo ideal, figura y campeón
   devuelven **candidatos** y, cuando existe, el resultado oficialmente
   decidido. La base nunca arma un once ideal por estadística ni elige una
   figura por ranking.

El cliente revalida al recibir: versión de schema, pieza registrada, tenant
coincidente, fixture publicado y forma de la colección esperada. Además hay un
barrido de claves prohibidas (`auditLog`, `notes`, `internalPath`, `checksum`,
`availability`…) porque una filtración dentro de un PNG es permanente.

## Piezas

| Pieza | Colección | Curaduría humana |
|---|---|---|
| Próxima fecha | `matches` | — |
| Resultados de la fecha | `matches` | — |
| Tabla de posiciones | `rows` | — |
| Goleadores | `players` | — |
| Sancionados | `players` | — |
| Equipo ideal | `candidates` | **11 jugadores** |
| Figura | `candidates` | **1 jugador** |
| Resumen de fecha | `matches` + `leaders` | — |
| Semifinales | `matches` | — |
| Final | `matches` | — |
| Campeón | `candidates` | **confirmación** |

Las tres piezas curadas no se pueden exportar sin selección: `renderSocialPiece`
lanza `CURATION_REQUIRED` antes de dibujar. El campeón exige confirmación
incluso cuando el torneo ya está `completed` y la tabla muestra un primero.

## Renderer

Canvas 2D determinístico, no SVG-en-`<img>`: ese documento está en sandbox, no
puede cargar tipografías y obligaría a inlinear todo igual. Canvas dibuja con
las fuentes que la página ya cargó (`document.fonts.load` antes de exportar) y
con bitmaps que le pasamos nosotros.

- Formatos: **1080 × 1350** y **1080 × 1920**. Un tercero es una entrada en
  `SOCIAL_FORMATS` más aritmética de bandas en `drawFrame`, no once plantillas
  nuevas.
- Identidad Arma2: fondo negro, bloom violeta, borde azul eléctrico, tarjetas
  black-glass, Bebas/Oswald para jerarquía, Inter para cuerpo.
- Nombres largos: cada slot tiene autofit con piso y elipsis. Las listas largas
  se truncan con `+N más` en vez de comprimirse hasta ser ilegibles.
- Escudos ausentes: monograma con el acento, nunca un hueco.
- La **vista previa es el export**, escalado por CSS. No hay un segundo layout
  que pueda diferir del archivo.

Determinismo probado como igualdad de la **secuencia de operaciones de canvas**
entre dos renders con el mismo input — una aserción más fuerte que un diff de
píxeles.

## Assets privados

Los escudos viven en `team-crests` (bucket con lectura pública en el contrato
vigente) y se resuelven por URL directa. Las **fotografías** vienen del bucket
privado `tournament-media` a través del signer de Multimedia, que es lo que
aplica publicación, audiencia y consentimiento.

En los dos casos el asset se descarga y se convierte en bitmap **antes** de
dibujar, y la URL se descarta. Un PNG exportado no contiene una firma, y sigue
funcionando cuando la firma vence.

Una foto que el usuario eligió y que no se puede resolver **falla el render**.
No se descarta en silencio: eso produciría una pieza distinta de la que pidió.

## Permisos

| Rol | Estudio |
|---|---|
| owner / admin | ver, crear, editar textos, selección manual, ocultar marca, exportar, administrar permisos |
| collaborator | **ver** |
| collaborator con permiso social | ver, crear, editar textos, exportar |
| delegate / player / outsider | sin acceso |
| segundo tenant | bloqueado |
| miembro suspendido o removido | bloqueado |

El permiso del colaborador es una fila explícita en
`tournament_social_permissions`, otorgada por owner/admin. **El modelo de
permisos deportivos no se tocó.** La validación ocurre al pedir el snapshot y al
pedir el asset, no sólo ocultando botones.

## Feature flag

`REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=false` por defecto. Se enciende sólo
con `REACT_APP_TORNEOS_ENABLED=true`, entorno no-Production y backend aislado
(local o el staging autorizado). Con la flag apagada la ruta no existe y el
ítem no aparece en la navegación.

No depende de Multimedia Upload: las piezas sin foto funcionan igual. Las piezas
con foto degradan de forma segura — sin signer disponible, elegir una foto es un
error explícito, no una pieza a medias.

## Fuera de alcance

Instagram/Facebook API, publicación automática, programación, Canva, editor
libre, copy o imágenes con IA, persistencia de PNGs en Storage, analytics
publicitario, URLs públicas permanentes, watermark removible fuera de la
configuración autorizada, video o animación.

## Pruebas

```bash
npm run test:db:torneos:social      # 39/39 PostgreSQL/RLS
CI=true npx react-scripts test --testPathPattern torneosSocialStudio   # 36/36
```

Cubren: schemas, snapshots, copy determinístico, selección manual, fallbacks,
nombres largos, tabla/resultados/sanciones, equipo ideal y MVP manuales, campeón
oficial, asset ausente, consentimiento revocado, segundo tenant; dimensiones
exactas, PNG válido, secuencia determinística, ausencia de URLs firmadas
embebidas, imágenes privadas convertidas, fallo de asset, múltiples templates,
ambas relaciones de aspecto, textos largos, caracteres especiales, escudos
faltantes; exportación, Web Share y su fallback; tabla de 20 equipos con nombres
largos, generación repetida y liberación de bitmaps.

## Pendientes para Staging

1. Activar la flag sólo en el staging autorizado.
2. QA visual de las once piezas en ambos formatos con datos reales.
3. Revisar el contraste final de los presets de acento sobre fotos reales.
4. Confirmar la política editorial de uso de imagen en piezas con fotos.
