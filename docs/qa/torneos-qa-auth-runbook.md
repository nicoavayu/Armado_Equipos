# Runbook de identidades QA de Torneos

Estado: diseño y automatización local listos. Ningún paso remoto fue ejecutado.

## Contrato de identidades

`QAIdentityMap` contiene exactamente `owner`, `admin`, `collaborator`, `delegate`,
`player` y `outsider`. Cada entrada declara:

- `auth_user_id`: UUID real devuelto por Supabase Auth;
- `expected_email`: email QA esperado;
- `logical_role`: uno de los seis roles;
- `projected_relations`: relaciones exactas permitidas por el manifest.

El mapa rechaza roles faltantes, UUIDs/emails duplicados, relaciones distintas a
las esperadas, campos desconocidos y cualquier campo con forma de contraseña,
access token, refresh token, service-role o secret key. Puede entrar por variables
`QA_IDENTITY_<ROLE>_AUTH_USER_ID/EMAIL` o por `QA_IDENTITY_MAP_FILE`. El archivo
debe estar ignorado por Git; el preparador local sólo lo escribe con modo `0600`,
en una ruta nueva ya ignorada, indicada por `QA_IDENTITY_MAP_OUTPUT`.

Los reportes muestran rol, relaciones y fingerprints truncados del UUID y email.
Nunca muestran el UUID o email completos.

## Manifest base y resolución

1. `buildBaseManifest()` produce el dataset determinístico con placeholders
   internos por rol y sin depender de Auth.
2. `QAIdentityMap` aporta los UUID reales y emails esperados.
3. `resolveCanonicalManifest()` reemplaza únicamente los placeholders de Auth,
   calcula el hash SHA-256 sobre las 586 filas de datos ya resueltas y agrega el
   marker como fila 587.

El marker `qa.seed.applied` persiste:

- `seed_key`;
- `manifest_hash` resuelto;
- `dataset_version`;
- `identity_map_fingerprint` (UUIDs, hashes de email, roles y relaciones);
- `created_at`;
- `creation_key`;
- `ownership_fingerprint`;
- cantidad esperada de filas y tablas.

Una ejecución existente con otro fingerprint devuelve
`identity_map_changed`. Nunca reemplaza usuarios o relaciones. Un cambio legítimo
de UUID antes de materializar genera un nuevo hash resuelto; no se exige conservar
el hash antiguo.

## Preflight conectado

Antes de insertar, el runner verifica:

- existencia única de las seis identidades por UUID y email;
- `raw_app_meta_data.qa_seed_key=torneos-demo-v2` y `qa_role` exacto, para impedir
  reutilizar usuarios personales o identidades de otro dataset;
- perfil sincronizado en `public.usuarios`;
- ausencia de relaciones previas para una creación nueva;
- igualdad exacta de relaciones proyectadas cuando el marker ya existe;
- cero relaciones para `outsider`;
- tablas, columnas, identidades determinísticas y natural keys;
- 587 filas en 32 tablas;
- contenido materializado exacto, normalizando sólo representaciones equivalentes
  de `date`, JSON y enteros de PostgreSQL.

## Cleanup con integridad activa

El código ya no usa ni cambia `session_replication_role`. Mantiene el marker hasta
el último `DELETE`, usa orden inverso explícito, transacción SERIALIZABLE,
advisory lock, identidades exactas y verificaciones de ownership, filas ajenas y
cero leftovers antes y después del commit.

El esquema canónico actual impide ejecutar esa secuencia con triggers activos.
El catálogo local confirmó estos guards relevantes:

- `tournament_audit_append_only`;
- `tournament_match_events_history_guard` y
  `tournament_match_events_no_delete`;
- `tournament_match_operation_players_history_guard`;
- `tournament_match_operations_history_guard`;
- `tournament_match_outcomes_history_guard`;
- `tournament_match_reviews_no_delete`;
- `tournament_match_scores_history_guard`;
- `tournament_standings_revisions_no_delete`;
- los guards `*_immutable` de proyecciones y disciplina.

En particular, audit log, eventos, reviews, standings revisions y operaciones
oficiales rechazan `DELETE` aun con un orden FK correcto. Por eso el cleanup
devuelve `active_append_only_cleanup_guards` antes de mutar.

La solución específica requiere una migración futura y autorización separada:
los guard functions deben aceptar un contexto transaccional de cleanup QA sólo
para el database owner, comprobar dentro del trigger el marker, `creation_key`,
hash resuelto, fingerprint y organización exacta, y permitir únicamente los
`DELETE` de esas identidades. Todos los triggers y FKs permanecen habilitados;
cualquier fila ajena continúa siendo append-only. No se incluyó esa migración en
este PR.

## Creación futura en Staging (no ejecutada)

### A. Crear usuarios QA

1. Autorizar sólo esta etapa y confirmar ref `hhyvmhgpapyuzjgxfnqv`.
2. Ejecutar un proceso server-side con `supabase.auth.admin.createUser`; no pasar
   el campo `id`, para que Auth genere UUID v4.
3. Ingresar service-role y contraseñas QA por prompt sin echo o secret environment
   efímero. No escribirlos en logs, shell history ni identity map.
4. Enviar `app_metadata` con `qa_seed_key=torneos-demo-v2` y `qa_role` exacto.
5. Confirmar por UUID que el trigger creó los seis perfiles `public.usuarios`.
6. Guardar sólo UUID, email esperado, rol y relaciones en un archivo `0600`
   ignorado por Git.

### B. Resolver manifest y ejecutar preflight

Autorizar lectura conectada. Resolver el manifest con el mapa, registrar sólo
fingerprints/hash y exigir resultado `safe_to_create`. No aplicar filas.

### C. Aplicar seed

Autorizar por separado la transacción SERIALIZABLE. Aplicar exactamente 587 filas
en 32 tablas; no hay upsert. Reejecutar y exigir `skip`.

### D. Generar storage states

Autorizar por separado. Leer credenciales desde input seguro, iniciar sesión por
rol y escribir estados sólo bajo `playwright/.auth/` o `tests/.auth/`, ambos
ignorados. No incluir service-role en Playwright.

### E. Ejecutar pruebas

Autorizar la suite contra Staging con los storage states. No ejecutar en
Production y no imprimir emails, tokens ni datos personales.

### F. Cleanup del dataset

No autorizar hasta aprobar la migración acotada de guards descripta arriba.
Después: verificar ownership íntegro, ejecutar deletes en orden inverso con
marker al final, mantener FKs/triggers activos y confirmar cero referencias.

### G. Eliminar usuarios QA

Sólo después de F:

1. comprobar cero referencias;
2. revocar globalmente cada sesión conocida usando sus tokens en memoria;
3. eliminar cada usuario con `auth.admin.deleteUser`;
4. confirmar eliminación del perfil sincronizado;
5. borrar los storage states y credenciales temporales.

Los JWT de acceso ya emitidos pueden seguir siendo criptográficamente válidos
hasta expirar. Para una revocación estricta, los endpoints sensibles deben además
validar `session_id` contra sesiones activas o se debe esperar el TTL máximo antes
de considerar cerrada la etapa G.
