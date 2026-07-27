# Arma2 Torneos · staging readiness

Estado preparado sobre `epic/arma2-torneos` en la rama
`feature/torneos-staging-readiness`. Este documento es un runbook; no autoriza ni
ejecuta despliegues, migraciones remotas, creación de usuarios, buckets, secretos,
workers ni cambios de flags.

## Resultado y límites

- El gate local usa PostgreSQL embebido y datos sintéticos. No requiere Supabase
  remoto y elimina su base efímera al terminar.
- El verificador remoto es estrictamente `BEGIN READ ONLY`, requiere confirmación
  ligada al project ref y rechaza el project ref productivo conocido.
- La plantilla comienza con todos los flags en `false`.
- Galerías puede habilitarse separada de upload. Upload exige cinco gates
  operativos explícitos; `uploadReady` permanece efectivamente en `false` hasta
  entonces.
- No hay datos personales reales. Las identidades usan UUID fijos y el dominio
  reservado `example.invalid`.
- No se incluye Estudio Social. Su flag sigue en `false`.
- No se modifica `main`, producción, Storage, secretos, proyectos Supabase,
  aplicaciones nativas ni stores.

## Arquitectura futura

```text
Web / iOS / Android
        │ anon JWT + sesión Auth
        ▼
Supabase staging aislado ── PostgREST/RPC ── PostgreSQL + RLS
        │
        ├── bucket privado (sin lectura pública)
        ├── signer de upload/read (credenciales sólo servidor)
        ├── cola + worker de imágenes
        ├── cuarentena + antivirus + EXIF stripping
        └── logs, métricas, alertas y cleanup
```

Base/Auth pueden validarse antes que Media. Storage, signer, worker, antivirus y
observabilidad son gates independientes. Ninguno es condición implícita por
existir una tabla de metadata.

## Gate local exacto

Instalar y certificar:

```bash
npm ci
npm run torneos:staging:validate
npm run torneos:staging:seed:local
CI=true npm test -- --watchAll=false --runInBand
npm run lint
```

Resultados terminales esperados:

```text
STAGING_MIGRATIONS_OK count=9
STAGING_SYNTHETIC_MANIFEST_OK identities=15 evidence=14 pii=none
STAGING_ENV_OK mode=template flags=fail-closed
[migrations:guard] OK. Canonical migrations in supabase/migrations: 204 files.
STAGING_SCENARIO_OK suites=10 evidence=14 ...
```

El gate falla ante un archivo faltante, versión duplicada, orden divergente,
dependencia futura, SHA-256 alterado, migración Torneos no inventariada, flag de
plantilla activo o referencia real en la plantilla.

## Inventario y orden de migraciones

El orden es lineal y obligatorio. Los SHA-256 canónicos viven en
`scripts/torneos-staging/manifest.mjs` y los comprueba
`scripts/torneos-staging/validate-migrations.mjs`.

| # | Versión | Alcance | Depende de | Tablas | Funciones | Policies explícitas |
|---:|---|---|---|---:|---:|---:|
| 1 | `20260724233000` | organizaciones y workspaces | — | 3 | 11 | 3 |
| 2 | `20260725120000` | seasons, torneos, categorías y reglas | 1 | 9 | 13 | 9 |
| 3 | `20260725210000` | equipos, planteles, managers y auditoría | 2 | 9 | 29 | 9 |
| 4 | `20260726010000` | sorteo, fixture, sedes y programación | 3 | 15 | 38 | 15 |
| 5 | `20260726150000` | disponibilidad, convocatorias y actas | 4 | 10 | 38 | 10 |
| 6 | `20260726200000` | tabla, estadísticas, clasificación y disciplina | 5 | 12 | 20 | 12 |
| 7 | `20260726230000` | participant hub y payloads publicados | 6 | 1 | 10 | 0 nuevas |
| 8 | `20260727010000` | comunicaciones y documentos | 7 | 8 | 30 | 0 nuevas |
| 9 | `20260727060000` | galerías, consentimientos y reportes | 8 | 11 | 25 | 0 nuevas |

Archivos exactos:

1. `20260724233000_tournament_organization_workspaces.sql`
2. `20260725120000_tournament_competition_core.sql`
3. `20260725210000_tournament_teams_rosters.sql`
4. `20260726010000_tournament_fixture_scheduling.sql`
5. `20260726150000_tournament_match_operations.sql`
6. `20260726200000_tournament_standings_discipline.sql`
7. `20260726230000_tournament_participant_hub.sql`
8. `20260727010000_tournament_communications.sql`
9. `20260727060000_tournament_media_galleries.sql`

### Dependencias, reemplazos y conflictos

- `public.tournament_role_capabilities(text)` se reemplaza de forma acumulativa
  en las migraciones 2, 3, 4, 5 y 6. No aplicar una versión salteada: la última
  definición es el contrato vigente.
- Las fases 7–9 reutilizan organizaciones, membresías, capabilities, auditoría,
  categorías, fixture y planteles. No son migraciones autónomas.
- Funciones `create or replace` conservan firma. Un cambio futuro de firma debe
  revocar y eliminar la firma anterior de forma explícita antes de crear la nueva.
- Antes de promover, comparar `supabase_migrations.schema_migrations` con las
  nueve versiones; una versión remota inesperada o una de estas versiones con
  contenido distinto es bloqueo, no algo para “arreglar” con `repair`.
- No usar `supabase migration repair`, no editar una migración aplicada y no
  copiar funciones manualmente desde el dashboard.
- Los `REVOKE ALL` y `GRANT` finales de cada archivo son parte del contrato. RLS
  no sustituye grants, y grants no sustituyen RLS.
- Las tablas publicadas/official y la auditoría son append-only o inmutables por
  trigger. No se acepta rollback mediante `DELETE` de datos históricos.

### Reversibilidad y rollback

Estas migraciones son forward-only: no existe un `down.sql` seguro. La reversión
operativa es:

1. Forzar todos los flags Torneos y Media a `false`.
2. Detener signer, worker y consumidores sin borrar objetos.
3. Conservar base, bucket, logs y auditoría.
4. Restaurar una copia del proyecto de staging sólo si la validación exige volver
   al punto previo; nunca hacer restore sobre producción como parte de este plan.
5. Corregir con una migración nueva y monotónica.
6. Reejecutar inventario, escenario sintético, matriz multirol y verificación
   read-only antes de reactivar un único flag.

Para un incidente de frontend basta revertir el artefacto y mantener flags en
`false`; no se revierte schema. Para pérdida/corrupción, congelar escrituras,
capturar evidencia, restaurar a un proyecto aislado, comparar conteos/fingerprints
y recién entonces decidir una promoción.

## Seed sintético determinístico

`npm run torneos:staging:seed:local` compone diez suites sobre bases
PostgreSQL efímeras. El payload, seeds, UUID de idempotencia, fechas deportivas y
usuarios son fijos. Los UUID generados internamente no se comparan entre corridas;
la evidencia de negocio sí. Una segunda corrida parte de cero y no conserva filas.

Cobertura:

- dos organizaciones y dos seasons aisladas;
- múltiples torneos/categorías en liga, grupos, eliminación directa,
  grupos+playoffs y liga+playoffs;
- owner, admin, collaborator, dos capitanes, delegado, fotógrafo, jugadores
  vinculados, provisional, membership suspendida, manager revocado y outsider;
- equipos, planteles, freeze, sorteo determinístico, fixture, grupos, rounds,
  sedes, canchas y agenda;
- disponibilidad, convocatorias, acta, goles, asistencia, amarilla, segunda
  amarilla, roja directa, suspensión y reanudación;
- resultado oficial, corrección versionada y reemplazo atómico;
- walkover validado, ajuste de puntos, tabla publicada, cambio de líder/candidato
  a clasificado o campeón, acumulación de amarillas y jugador suspendido;
- comunicación urgente y corrección, documento publicado con nueva versión;
- galería publicada, cuatro variantes, consentimiento, reporte privado,
  moderación, ocultamiento y restauración segura.

El término “campeón candidato” es deliberado: el modelo actual resuelve el líder
de una tabla o ganador de la final mediante fuentes/resultados; no existe una
entidad separada `tournament_champions`. El gate no inventa ese contrato.

Identidades del manifiesto:

| Sesión | Rol/estado | Tenant |
|---|---|---|
| OwnerA | owner | A |
| AdminA | admin | A |
| CollaboratorA | collaborator, lectura acotada | A |
| CaptainA1 / CaptainA2 | manager/captain de su equipo | A |
| DelegateA | delegado de equipo | A |
| PhotographerA | assignment upload-only | A |
| PlayerA1 / PlayerA2 | jugador vinculado | A |
| ProvisionalA | jugador sin cuenta vinculada | A |
| SuspendedA | membership suspendida | A |
| RemovedManagerA | invitación/rol revocado | A |
| OwnerB / PlayerB | owner y jugador | B |
| Outsider | sin relación | ninguna |

Correos: `<sesión-en-minúsculas>@example.invalid`. No copiar usuarios reales al
seed. Para staging real, Auth debe crear estas cuentas sintéticas antes del seed y
un operador debe registrar los UUID resultantes en un artefacto temporal cifrado;
no se versionan contraseñas, tokens ni service-role keys.

La automatización incluida siembra y prueba únicamente PostgreSQL embebido. El
adaptador de Auth remoto se ejecutará cuando exista un proyecto autorizado:
necesita URL, anon/service credential entregada por un secret manager y los UUID
reales de Auth. No se simula hoy una importación remota ni se permite apuntar
`seed-synthetic.mjs` a cloud.

## Matriz multirol

La matriz se valida en los harnesses de PostgreSQL/RLS. “Propio” siempre exige
scope de tenant, torneo, equipo o jugador; conocer un UUID no concede acceso.

| Acción | OwnerA | AdminA | CollaboratorA | CaptainA1 | PlayerA1 | PhotographerA | OwnerB / Outsider | Suspendido / revocado |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| leer workspace A | sí | sí | sí | según relación | según relación | assignment | no | no |
| configurar torneo A | sí | sí | no | no | no | no | no | no |
| gestionar planteles | sí | sí | lectura | equipo propio | no | no | no | no |
| responder disponibilidad | no delegada | no delegada | no | manual equipo | propia | no | no | no |
| presentar convocatoria | sí | sí | no | equipo propio | no | no | no | no |
| editar/revisar acta | sí | sí, doble control | no oficializa | alcance limitado | lectura publicada | no | no | no |
| publicar tabla/documento | sí | sí | no | no | no | no | no | no |
| leer hub publicado | sí | sí | sí | relacionado | relacionado | no implícito | sólo tenant B / no | no |
| crear galería | sí | sí | no | no | no | no | no | no |
| subir archivo | sí si gate | sí si gate | no | no | no | assignment vigente | no | no |
| publicar/ocultar media | sí | capability | no | no | no | no | no | no |
| reportar foto visible | sí | sí | sí | sí | sí | según visibilidad | no cross-tenant | no |
| leer identidad/reporte privado | moderador | moderador | no | no | no | no | no | no |

Pruebas negativas obligatorias:

- OwnerB, PlayerB y Outsider no leen ni mutan A.
- CaptainA1 no opera el equipo A2.
- una respuesta propia no puede ser pisada manualmente;
- membership suspendida pierde acceso inmediatamente;
- manager/assignment revocado no reutiliza una sesión preemitida;
- fotógrafo no recibe review, publish ni report handling;
- collaborator no infiere reportes por detalles ni contadores;
- service role sin actor no completa uploads.

### Rutas, RPCs y payloads por sesión

- OwnerA/AdminA: rutas organizativas de centro competitivo, planteles, fixture,
  operación, tabla, comunicaciones y Media. RPCs de mutación sólo según capability
  y doble control; payloads administrativos pueden incluir estado/revisión, pero
  nunca token de upload, hash, path interno o identidad privada de reportante.
- CollaboratorA: rutas read-only de centro, fixture, actas, tablas y
  comunicaciones; `get_*_context` allowlistados. Puede preparar un comunicado si
  su capability lo permite, pero no publicar tabla, acta ni Media. No recibe
  reportes privados, conteos inferibles ni consents internos.
- CaptainA1/CaptainA2: participant hub, partidos y convocatoria del equipo propio;
  `respond_match_availability`, `record_manual_match_availability`,
  `save_match_squad` y `submit_match_squad` sólo en su scope. No recibe fixture
  global, ventanas administrativas, convocatorias rivales ni notas de revisión.
- PlayerA1/PlayerA2: Mis torneos, portada, partidos/resultados, tabla/estadísticas,
  documentos y galerías publicadas relacionadas. RPC propia de disponibilidad,
  lectura y reporte de foto. Sin drafts, auditoría, sanciones de compañeros,
  disponibilidad agregada, paths internos ni identidad del reportante.
- PhotographerA: sólo intención de upload para una galería asignada y mientras
  los gates estén activos. No recibe rutas de moderation, publish, consents,
  report handling, assignments ni auditoría.
- OwnerB/PlayerB: mismas rutas y RPCs únicamente dentro de B. Todo UUID de A debe
  devolver deny/not-found indistinguible y cero filas por RLS.
- Outsider: sin rutas Torneos privadas; conocer URL o UUID no concede payload.
- SuspendedA/RemovedManagerA: las rutas pueden existir en historial de cliente,
  pero toda RPC revalida autoridad y deniega. No se confía en una sesión emitida,
  cache o assignment anterior.

## Variables y activación fail-closed

Copiar `config/torneos-staging.env.example` fuera del repositorio y completar sólo
en el gestor de configuración del entorno. La plantilla no contiene secretos.

El frontend exige:

- `REACT_APP_DEPLOY_ENV=staging`;
- `REACT_APP_TORNEOS_DATA_ENV=staging`;
- project ref con formato válido;
- URL exacta `https://<ref>.supabase.co`, sin credenciales, path, query o puerto;
- anon key; nunca service role en variables `REACT_APP_*`;
- project ref distinto de `rcyuuoaqfwcembdajcss`.

Orden de activación:

1. Torneos base.
2. Workspaces y switcher.
3. Estadísticas oficiales y notificaciones.
4. Hub/páginas públicas si la matriz publicada pasa.
5. Galerías read-only (`MEDIA_ENABLED=true`, upload aún `false`).
6. Upload sólo cuando signer, worker, AV, cleanup y observabilidad estén todos
   certificados con sus variables `*_READY=true`.

`mediaUploadEnabled` depende de Torneos, galerías, su propio opt-in y los cinco
gates. Producción fuerza todo a `false` aunque se intenten forjar variables.

## Plan de Storage y procesamiento

Nada de esta sección fue creado ni ejecutado.

### Bucket y paths

- bucket privado y exclusivo: `tournament-media-staging`;
- nunca reutilizar el bucket productivo;
- path canónico emitido por signer:
  `<organization>/<tournament>/<gallery>/<session>/<asset>/original`;
- variantes sólo del worker:
  `{original,thumbnail,grid,detail}`; el original también queda restringido;
- prohibir listados, paths elegidos por el cliente y overwrite;
- content types allowlist (`image/jpeg`, `image/png`, `image/webp`, HEIC sólo si
  el pipeline lo normaliza), tamaño máximo 25 MiB y checksum SHA-256 obligatorio.

### Signer

- recibe usuario autenticado y `sessionId`, no un path arbitrario;
- revalida membership/assignment, estado de galería, expiración, cuota y flag;
- firma una sola carga, corta y no reutilizable;
- nunca expone service-role ni firma lectura pública;
- registra correlation id sin token ni URL firmada.
- expone endpoint batch sólo para lecturas ya autorizadas, con máximo acotado,
  una firma por asset/variant y denegación individual sin filtrar existencia;
  upload nunca se firma en batch.

### Worker y antivirus

1. Toma únicamente una sesión `uploaded` no expirada.
2. Descarga por canal interno, verifica tamaño, MIME real, checksum y magic bytes.
3. Ejecuta AV en cuarentena. Timeout/error equivale a rechazo, no aprobación.
4. Elimina EXIF/GPS y normaliza orientación/color.
5. Produce exactamente thumbnail/grid/detail y registra el original restringido.
6. Registra dimensiones, bytes, checksum y `metadata_stripped=true`.
7. Promueve el asset a review sólo con cuatro variantes completas.
8. Reintentos idempotentes con lease; dead-letter después del máximo.

### Lectura

- RPC devuelve sólo metadata autorizada;
- un endpoint interno vuelve a comprobar visibilidad, tenant, consentimiento,
  ocultamiento y reporte antes de firmar lectura;
- URLs de lectura cortas, sin cache compartida para contenido restringido;
- ocultar/revocar invalida futuras firmas; documentar la ventana de URLs ya
  emitidas y usar TTL acorde.

### Cleanup, cuotas y retención

- cancelar multipart incompleto y sesiones expiradas;
- borrar cuarentena fallida tras evidencia mínima segura;
- originales rechazados: 7 días; sesiones sin completar: 24 horas;
- reportes/auditoría: retención legal definida antes del launch;
- assets publicados: no borrar físicamente desde UI; ocultar y procesar una
  solicitud auditada;
- cuotas por organización, usuario, galería y ventana temporal;
- reconciliación diaria DB↔Storage, sin borrar automáticamente huérfanos hasta
  completar dos pasadas y revisión.

### Logs, métricas y alertas

No registrar PII, captions privados, tokens ni URLs firmadas. Dimensiones mínimas:
environment, correlation id, organization hash, stage y error code.

Métricas:

- sesiones solicitadas/completadas/canceladas/expiradas;
- bytes aceptados/rechazados y cuota;
- latencia y error de signer;
- cola, lease age, reintentos y dead letters;
- resultado/timeout de AV;
- variantes incompletas y checksum mismatch;
- reportes abiertos y tiempo de resolución;
- cleanup pendiente y divergencias DB↔Storage.

Alertas iniciales: signer 5xx > 1%/5m, AV timeout > 0, dead letter > 0, lease más
antiguo > 10m, variantes incompletas > 15m, cleanup atrasado > 24h, checksum
mismatch > 0 y aumento anómalo de reportes. Definir owner y canal antes de activar
upload.

## Checklist para staging real

Todo ítem requiere evidencia adjunta al change ticket:

- [ ] Proyecto nuevo, aislado, identificado como staging y no igual a producción.
- [ ] Backup/restore de staging probado sin datos reales.
- [ ] Variables validadas con `node scripts/torneos-staging/validate-env.mjs`.
- [ ] Nueve migraciones coinciden y se aplican en orden.
- [ ] No hay drift de funciones, policies, triggers, grants ni RLS.
- [ ] Usuarios sintéticos y matriz multirol creados sin PII.
- [ ] Escenario completo pasa dos veces desde cero.
- [ ] Verificación remota read-only pasa.
- [ ] PostgREST expone sólo tablas/views y RPCs previstas; grants inspeccionados.
- [ ] Network del navegador no contiene columnas privadas, tokens ni paths.
- [ ] Torneos activo con todos los subflags inicialmente apagados.
- [ ] Galerías read-only pasa UX/matriz antes de uploads.
- [ ] Bucket privado, CORS, cuota, MIME y límites revisados.
- [ ] Signer sin path arbitrario y sin credenciales al cliente.
- [ ] Worker idempotente, AV fail-closed y EXIF/GPS eliminado.
- [ ] Cleanup y reconciliación probados con dry-run.
- [ ] Dashboards, alertas, on-call y runbooks asignados.
- [ ] Rollback por flags ensayado.
- [ ] Retención, borrado y respuesta a reportes aprobados.
- [ ] Secret scan y diff contra `epic/arma2-torneos` limpios.
- [ ] Web manual en mobile/desktop y accesibilidad con teclado/lector/zoom.
- [ ] iOS y Android contra staging aislado, sin cambiar builds de store.
- [ ] Carga sintética de 20, 100 y 1.000 participantes/partidos/assets con límites,
      latencia, colas y cleanup medidos; nunca datos reales.

Verificación remota futura, sólo después del provisioning autorizado:

```bash
export REACT_APP_TORNEOS_STAGING_PROJECT_REF='<staging-ref>'
export TORNEOS_STAGING_DATABASE_URL='<postgres-url-de-staging>'
export TORNEOS_STAGING_VERIFY_CONFIRM="VERIFY_READ_ONLY_${REACT_APP_TORNEOS_STAGING_PROJECT_REF}"
npm run torneos:staging:verify
```

Resultado esperado:

```text
STAGING_ENV_OK mode=runtime flags=fail-closed
STAGING_READ_ONLY_VERIFY_OK migrations=9 rlsMissing=0 publicExecute=0
```

La URL de base es un secreto de operador y jamás se agrega a `.env`, logs, PR,
capturas o frontend. El script abre una transacción read-only y no siembra datos.

## Auditoría UX transversal

Se revisaron navegación, vacíos, errores, lectura publicada, acciones por rol,
modal/lightbox, foco, Escape, breakpoints y targets táctiles durante la auditoría
de Media. No apareció un defecto visual claro adicional que justificara ampliar
el alcance.

El único ajuste transversal de esta rama es de seguridad/configuración:

- separar `mediaEnabled` de `mediaUploadEnabled`;
- exigir los cinco gates operativos para mostrar flujo de upload;
- conservar navegación/lectura independiente del pipeline de carga;
- forzar ambos flags a `false` fuera de un backend local/staging aislado.

No se agregaron mocks permanentes, rutas QA ni texto técnico de Storage a la UI.

## Costos y autorizaciones pendientes

Antes de provisionar se necesita autorización explícita para:

- proyecto Supabase staging y su plan/backup;
- capacidad de Storage, egress y retención;
- runtime de signer/worker/cola y su escalado;
- proveedor o runtime de antivirus;
- observabilidad, retención de logs y canal de alertas;
- dispositivos/builds internos iOS/Android, si implican cuentas o distribución.

Primero estimar con 20/100/1.000 objetos y registrar costo mensual máximo. Ningún
script de esta rama compra, crea o despliega esos recursos.

## Gate de promoción y criterio de bloqueo

Bloquea la promoción cualquiera de:

- SHA o inventario divergente;
- project ref/URL ambiguos o productivos;
- migración sin rollback operativo documentado;
- grant a `PUBLIC`, escritura directa no prevista o tabla Torneos sin RLS;
- fuga cross-tenant o diferencia entre payload publicado y SQL directo;
- usuario suspendido/revocado con acceso;
- dos actas/revisiones oficiales simultáneas;
- upload activo sin un único gate operativo;
- AV/worker/signer/cleanup/observabilidad incompletos;
- test, lint, build, guard, secret scan o diff-check fallido;
- hallazgo crítico/alto abierto.

Promover flags de a uno, observar al menos una ventana acordada y registrar
rollback owner. Nunca promover schema y todos los flags en el mismo paso.
