# Social Studio V1 — descubrimiento visual local

Fecha: 2026-08-14
Estado: **REVIEW visual, no certificación final**
Branch: `feature/torneos-social-studio-v1`
Base: `a679f00f5390b1ff6389384e8a464e3c48243cf5`
Entorno: React LOCAL `http://127.0.0.1:3001` + Supabase LOCAL `http://127.0.0.1:57321`

## Resultado de la pasada

El Estudio Social existente quedó abierto con `qa-owner` y el dataset canónico:

- Asociación Metropolitana de Fútbol Amateur del Río de la Plata;
- Temporada QA 2026;
- Torneo Apertura QA 2026;
- Categoría Abierta.

Las cuatro piezas prioritarias renderizan en Canvas a `1080 × 1350` con datos
oficiales reales:

| Pieza | Resultado local |
| --- | --- |
| Próxima fecha | Render funcional; la selección automática de jornada no representa una próxima fecha coherente. |
| Resultados de la fecha | 4 resultados oficiales de Fecha 7. |
| Tabla de posiciones | 8 equipos, revisión publicada 1. |
| Goleadores | 3 jugadores con goles en la proyección publicada. |

La descarga PNG de Tabla de posiciones se ejecutó desde la UI y produjo el
nombre `torneo-apertura-qa-2026-categoria-abierta-tabla-de-posiciones-portrait.png`.

No se modificaron Auth, usuarios, dataset canónico, flags persistidos ni ningún
entorno remoto. El plan PRO local ya otorgaba `social_studio.basic` y
`social_studio.full`; no fue necesario crear un override.

## Qué está implementado hoy

### Activación y acceso

- La ruta es
  `/torneos/organizacion/:organizationId/estudio-social`.
- El ítem y la ruta existen sólo con
  `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=true` y el aislamiento general de
  Torneos activo.
- Hay dos controles independientes y fail-closed:
  1. entitlement de producto `social_studio.basic`;
  2. capabilities sociales server-side por rol.
- Owner/admin pueden ver, crear, editar texto, seleccionar, ocultar la marca
  Arma2 y exportar. Collaborator es lectura, salvo grant social explícito.

### Contrato de datos

- `get_tournament_social_studio_context` entrega torneos, categorías, fases,
  jornadas, capabilities y un bloque `brand` mínimo.
- `get_tournament_social_snapshot` entrega snapshots `schemaVersion: 1`.
- Los snapshots se limitan a fixture publicado y proyecciones publicadas de
  tabla/estadísticas. No recalculan desempates ni eligen automáticamente Equipo
  ideal, Figura o Campeón.
- El cliente vuelve a validar versión, tenant, pieza, colección y ausencia de
  claves privadas antes de renderizar.

### Templates y renderer

- Existen 11 piezas: Próxima fecha, Resultados, Tabla, Goleadores, Sancionados,
  Equipo ideal, Figura, Resumen, Semifinales, Final y Campeón.
- Existen dos formatos: Feed 4:5 (`1080 × 1350`) e Historia 9:16
  (`1080 × 1920`).
- El renderer es Canvas 2D determinístico. La vista previa usa el mismo canvas
  del archivo, escalado por CSS.
- El default actual usa fondo oscuro, bloom violeta/azul, tarjetas black-glass,
  Bebas Neue/Oswald/Inter y marca Arma2 opcional según capability.
- Hay cuatro acentos editoriales manuales: violeta, azul eléctrico, cyan y
  ámbar.
- Los escudos ausentes degradan a monogramas. Las fotos privadas, cuando se
  eligen, se resuelven por el signer de Multimedia antes del render.
- Export PNG, Web Share y fallback de descarga están implementados.

## Hallazgo corregido en esta pasada

Las piezas sin jornada (`standings`, `scorers`, `discipline` y las curadas por
fase) enviaban `p_round_id = null`, pero la función dereferenciaba un record
`v_round` nunca asignado. PostgreSQL respondía SQLSTATE `55000` y la UI mostraba
un error genérico.

La migración
`20260814053900_fix_tournament_social_snapshot_nullable_round.sql` reemplaza el
record opcional por escalares nullable, sin cambiar autorización ni fuentes de
datos. La integración ahora prueba explícitamente las seis piezas phase-scoped
con jornada nula.

## Dataset real observado

- 31 partidos en el fixture publicado.
- 12 partidos con horario.
- 28 operaciones oficiales con marcador.
- Fecha 7 tiene 4 resultados oficiales pero ningún horario.
- El único partido futuro con horario está en Fecha 2, figura pospuesto y está
  programado para el 2026-09-05.
- La tabla publicada tiene 8 equipos.
- La estadística publicada produce 3 goleadores con al menos un gol.
- Los paths de escudos QA existen en las filas, pero los objetos no están en el
  bucket local `team-crests`; el renderer usa correctamente sus monogramas de
  fallback.

### Carencia de “Próxima fecha”

La pieza es renderizable, pero hoy no resuelve semánticamente “lo próximo”:

1. la UI selecciona por default la última jornada de la fase (Fecha 7);
2. el snapshot devuelve todos los cruces de la jornada elegida;
3. no filtra partidos ya oficiales, pospuestos ni fechas pasadas;
4. Fecha 7 no tiene horarios y se presenta completa como “A confirmar”;
5. Fecha 2 mezcla el único partido futuro con tres partidos pasados.

No se suplementó ni alteró el dataset. La siguiente etapa debe decidir si
“Próxima fecha” significa la próxima jornada completa o el conjunto de próximos
partidos y modelar esa selección en backend, no inferirla sólo en la plantilla.

## Auditoría de branding A–G

### A. Logo del torneo

No existe un campo de logo en `public.tournaments`. Sí existe
`public.tournament_organizations.logo_path`, que es identidad de organización,
no identidad estructural del torneo. El dataset canónico tiene ese campo en
`NULL`.

### B. Dónde se guarda hoy

`tournament_organizations.logo_path` acepta una ruta relativa validada de hasta
512 caracteres. No hay tabla/columna específica de branding por torneo ni un
bucket `tournament-branding` provisionado. Multimedia/Galería es un dominio
separado y no debe usarse como sustituto.

### C. Cómo se accede

Los contextos de workspace y participant hub exponen el `logoPath` de la
organización. Sin embargo:

- `update_tournament_organization` no permite cambiarlo;
- Configuración no ofrece upload ni edición de logo;
- no existe un resolver de URL para logos de organización;
- algunas vistas usan el valor crudo como `src`, aunque el constraint exige una
  ruta relativa.

La infraestructura es un comienzo de modelo, no un flujo operativo completo.

### D. Snapshot social

El snapshot social no recibe ningún logo. El bloque `brand` del contexto sólo
contiene `organizationName` y `canHideArma2Logo`.

### E. Renderer

El renderer carga escudos de equipos y una foto privada seleccionada. No carga
logo de torneo ni de organización. La única marca estructural dibujada es el
wordmark Arma2.

### F. Colores y estilo

- No hay colores de torneo modelados.
- Los colores primario/secundario existentes pertenecen a inscripciones de
  equipos y snapshots de participantes.
- El acento social es una preferencia editorial efímera entre cuatro presets;
  no se persiste como identidad del torneo.
- No existe elección de estilo visual por torneo.
- `tournaments.format_settings` es configuración competitiva genérica y no
  debería convertirse implícitamente en un contrato de branding.

### G. Contrato mínimo propuesto

Crear una identidad 1:1 explícita por torneo, separada de Multimedia, por
ejemplo `tournament_branding`:

- `organization_id` y `tournament_id`;
- `logo_path` nullable, relativo a un bucket de branding controlado;
- `primary_color` y `secondary_color` hex validados;
- `visual_style` como enum/preset pequeño y versionable;
- política de marca Arma2 derivada de producto/plan, no un boolean libre;
- `updated_by`, `created_at`, `updated_at` y auditoría.

El contrato de lectura social debería incorporar `competition.brand` con esas
referencias estructurales. El cliente resolvería el asset antes de dibujar, sin
persistir URLs firmadas en el snapshot. La precedencia recomendada es:

`branding del torneo → branding de organización compatible → default excelente`.

También hacen falta upload/update autorizados, validación de MIME/tamaño,
resolver de URL y tratamiento de contraste. No hace falta un editor libre.

## Decisión de producto registrada

**El default tiene que ser excelente.**

Una organización que no personalice nada debe obtener una placa profesional,
deportiva, moderna, premium, legible, publicable y con jerarquía visual fuerte.
La personalización agrega identidad al torneo; no es un requisito para que la
placa sea atractiva.

Esta decisión implica que todos los presets deben conservar grilla, contraste,
safe areas, tipografía, overflow y fallbacks de calidad. La identidad elegida no
puede degradar esos mínimos.

## Validación

| Verificación | Resultado |
| --- | --- |
| React Social Studio + entitlement gate | **PASS — 2 suites, 39 tests** |
| PostgreSQL/RLS Social Studio | **PASS — 45/45** |
| ESLint focal | **PASS** |
| Supabase security advisor LOCAL, nivel error | **PASS — sin hallazgos** |
| `git diff --check` | **PASS** |

Warnings no bloqueantes: source maps faltantes del paquete
`@capacitor-community/apple-sign-in`, deprecaciones conocidas de React tests y
objetos QA de escudos ausentes en Storage local.
