# Reporte de ejecución — torneos-demo-v3

Fecha: 2026-07-31.

- Rama: `codex/torneos-qa-seed`.
- Base del cambio: `0dc66b5f0297d7c59be486559ec36c8c50779e96`.
- Dataset remoto observado previamente: `torneos-demo-v2`, 587/587, marker único.
- Alcance de esta ejecución: código, documentación y Supabase local.
- Staging y Production: sin conexiones ni escrituras.

## Causa y corrección

El manifest v2 asignaba el rol `captain` de los equipos 03 a 08 al usuario QA
`collaborator`. Ese vínculo le otorgaba equipos administrados y acceso a RPCs de
convocatoria, roster y retiro que no correspondían a su membership de lectura.

V3 conserva los nueve registros de `tournament_team_managers`, sus IDs, equipos,
roles `captain` y estados `active`, pero reasigna al owner las seis capitanías de
RIB, PPC, EDS, FER, SDC y VIL. El admin conserva HOR; el owner ya tenía BNO y
termina con siete capitanías. El delegate conserva únicamente BNO como
`delegate` y su roster link.

## Contrato de identidades

| Identidad | Memberships | Managers | Roster links | Resultado funcional |
| --- | ---: | ---: | ---: | --- |
| owner | 1 (`owner`) | 7 `captain` | 0 | equipos administrados y acceso coherente |
| admin | 1 (`admin`) | 1 `captain` | 0 | regresión positiva |
| collaborator | 1 (`collaborator`) | 0 | 0 | 0 managed matches; escrituras denegadas |
| delegate | 0 | 1 `delegate` | 1 | regresión positiva |
| player | 0 | 0 | 1 | 0 managed matches |
| outsider | 0 | 0 | 0 | 0 relaciones y 0 managed matches |

`validateQAIdentityRelations()` deriva todas las referencias a UUIDs QA por
tabla/columna y las relaciones semánticas de membership, manager, roster,
creador y validador. La comparación con `QA_IDENTITY_RELATIONS` es exacta y
rechaza faltantes, inesperadas, rol/estado incorrecto y duplicados. El runner la
ejecuta antes de cargar CA, solicitar credenciales o abrir una conexión.

## Versionado v3

- seed key: `torneos-demo-v3`;
- versión: `3`;
- marker: `85ab8c2e-6cd5-54c4-86b6-fbbfc0f0b050`;
- manifest hash: `0afc357d733bdfbed0bae9ea8bf87b6c0b58a05ada2c0d8b65ef4b51cbb596f4`;
- identity map fingerprint: `d13bf642667c8a02c79a6f7b6db3325be3a2196c1569cfb655d67a72a3ab4cdd`;
- ownership fingerprint: `940e50032644694b3e2e06f0a022ada8b0474bfa4e70cb22ea45e4ceb3701d7a`.

Ningún valor anterior de v2 se reutiliza. La huella de ownership incluye ahora
el `seed_key`, además de las identidades determinísticas de filas. El preflight
devuelve `replacement_authorization_required` si detecta el marker v2 en la
organización y no borra ni reemplaza datasets automáticamente. Las identidades
Auth v2 existentes se aceptan como predecesor explícito para no modificar Auth.

## Resultado local

| Verificación | Resultado |
| --- | --- |
| manifest estático | 586 base + 1 marker = 587; 32 tablas |
| relación manifest ↔ identity map | igualdad exacta; mutaciones negativas rechazadas |
| Supabase local | reset completo, migraciones canónicas aplicadas |
| marker v2 presente | `reject: replacement_authorization_required` |
| rollback deliberado | 0 filas persistidas |
| primera aplicación | `created`; 587/587; 32 tablas |
| segunda aplicación | `skip`; 587/587; `inserted=[]` |
| collaborator | 1 membership, 0 managers, 0 roster, 0 managed matches |
| escrituras collaborator | retiro, roster lock y convocatoria: SQLSTATE `42501` |
| owner | 7 capitanías; 7 equipos observados en managed matches |
| admin/delegate/player | conteos y acceso esperados |
| outsider | 0 relaciones, 0 managed matches, 0 organizaciones visibles por RLS |
| cleanup default | bloquea guards antes de mutar |
| cleanup local autorizado | `cleaned`; 0 huérfanos; guards restaurados |
| fila sentinel ajena | intacta después del cleanup |
| suite QA/TLS | 38 passed; integración local omitida por diseño |
| ciclo conectado final | 1 passed desde `supabase db reset --local --no-seed` |

## Cleanup local

El cleanup mantiene SERIALIZABLE, advisory lock, prueba exacta de ownership y
FKs activas. Sólo en `--apply-local`, después de validar loopback y confirmaciones,
toma locks `ACCESS EXCLUSIVE`, deshabilita dentro de la transacción los triggers
de DELETE definidos por usuario en las tablas del seed, elimina únicamente las
identidades verificadas y restaura cada trigger antes del commit. No usa
`session_replication_role`, no toca triggers FK/internos y no existe cleanup
remoto.

## Límites confirmados

No se modificaron Auth remoto, contraseñas, storage states, RLS, policies,
migraciones, Storage, Production, Vercel ni builds. No se aplicó v3 en Staging,
no se limpió v2 y no se realizó merge ni deployment.
